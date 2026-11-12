/*
=======================================================================================================================================
Util: utils/amzBuyBox.js   — THE rules for Amazon Buy Box readings (2026-11-12, docs/amz-buybox/PLAN.md)
=======================================================================================================================================
Purpose: Read who holds the Buy Box on our Amazon sizes, store it (latest + change-only history), and sort each size into the group
         that says what to do about it. Tables in migrations/20261112_amz_buybox.sql (read its header for the owner's decisions).

WHO RUNS A READ: the Buy Box screen's buttons (POST /amz-buybox-read — the whole list, or one style after a price change) and, once the
owner adds the line, the cron (scripts/amz-buybox-read.js). Both call startRun() + executeRun() here. THE SCREEN NEVER READS AMAZON BY
OPENING: it shows what the last read stored, with its age (owner, 2026-11-12 — "is the screen just a result of what we have in our
database?" — yes).

WHAT IS READ (two Product Pricing calls, side by side — they have separate rate limits):
  - getItemOffersBatch (v0)            by ASIN, 20 a batch, ~1 batch / 10 s — every offer: seller id, FBA?, price + postage, winner?
  - getFeaturedOfferExpectedPriceBatch by SKU, 40 a batch, ~1 batch / 30 s — Amazon's "expected" winning price for OUR offer
  The whole list (FBA live + inbound, ~360 sizes) takes about 4–5 minutes, paced to Amazon's limits; one style a few seconds.
  competitiveSummary is NOT read — the probe showed it adds nothing the screen uses (its CompetitivePrice is in itemOffers too).

FOUND BY THE PROBE (scripts/amz-buybox-probe.js, 2026-11-12) and built in here:
  - Amazon's expected price is SHOWN, NEVER A TARGET: £34.19 on IVES-WHITE-03 while we held the Buy Box at £39.79. The match target is
    the real Buy Box price, postage included.
  - The Buy Box can be SHARED: several offers flagged winner at once (Amazon splits it by Prime / non-Prime / postcode). We are
    US_SHARED when one of them; when losing, the price to match is the CHEAPEST rival winner.
  - A rival at OUR EXACT PRICE, to the penny, is tagged (a repricer following us — matching it starts a race).

HISTORY (change-only, KEEP_MONTHS): a size gets a row only when holder / Buy Box price / our price / cheapest rival (seller + price) /
rival count differs from its previous row. Purged by the read itself: a row older than the cut-off goes only once a newer row is also
at or before the cut-off, so the state at the cut-off can still be read. A size that fails to read writes nothing to history.

GROUPS (classify — computed when the screen loads, from the stored reading + today's cost / fee, so a cost change applies at once):
  alone       no other offer on the size — price is about demand (the pricing standard's job), not the Buy Box
  room        we hold it and the cheapest rival above us is > ROOM_MIN_GAP over our price — a GUESS (FBA wins above cheaper
              self-posters, so how far up we can go only history will show)
  top         we hold it, no room above
  can_match   a rival holds it and its price still keeps us the £3 walk-away profit
  cant_match  a rival holds it under our walk-away price — hold, no race to the bottom
  no_bb       nobody holds it (Amazon pulled the Buy Box — often "seen cheaper elsewhere")
  unknown     no walk-away price (no cost) or Amazon gave no price to match
  error       the read failed for this size
=======================================================================================================================================
*/

const { query } = require('../database');
const { withTransaction } = require('./transaction');
const sp = require('./amzSpApi');
const { amzProfit, priceForProfit } = require('./amzProfit');
const { SETTINGS } = require('./amzPricingStandard');
const { safeNumeric } = require('./sql');
const logger = require('./logger');

const KEEP_MONTHS = 12;
const AMAZON_RETAIL_UK = 'A3P5ROKL5A1OLE';   // Amazon's own seller id on amazon.co.uk
const ROOM_MIN_GAP = 0.02;                   // "room to go up" = the next rival above us is more than 2% over our price
const STALE_RUN_MINUTES = 20;                // a 'running' run older than this died (server restart) — it no longer blocks a new read
const LOCK_KEY = 'amz_buybox';
const OFFERS_BATCH = 20; const OFFERS_WAIT_MS = 11000;
const FOEP_BATCH = 40; const FOEP_WAIT_MS = 31000;

// Amazon's quota for these batch calls refills slowly (1 per 10 s / 30 s); amzSpApi's own 429 retry waits only ~12 s in all. A 429
// here (two reads back to back, or the cron straight after a press) waits one full refill and tries again, up to 3 times.
async function postPaced(path, body, waitMs) {
  for (let attempt = 0; ; attempt += 1) {
    try { return await sp.spPost(path, body); } catch (e) {
      if (e.status !== 429 || attempt >= 2) throw e;
      await sp.sleep(waitMs);
    }
  }
}

const GROUPS = ['can_match', 'room', 'cant_match', 'no_bb', 'top', 'alone', 'unknown', 'error'];

const chunk = (a, n) => { const out = []; for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n)); return out; };
const money = (m) => {
  if (!m) return null;
  const v = m.amount !== undefined ? m.amount : m.Amount;
  return v === undefined || v === null ? null : Number(v);
};
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? null : Math.round(Number(n) * 100) / 100);
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

/** The sizes a read covers: the whole list = every Amazon size with FBA stock live or inbound; a style = all its Amazon sizes. */
async function sizesToRead(db, groupid = null) {
  const where = groupid ? 'm.groupid = $1' : 'COALESCE(a.amztotal,0) > 0';
  const r = await db.query(
    `SELECT DISTINCT ON (a.code) a.code, a.sku, a.asin FROM amzfeed a JOIN skumap m ON m.code = a.code
     WHERE a.sku IS NOT NULL AND a.sku <> '' AND a.asin IS NOT NULL AND a.asin <> '' AND ${where} ORDER BY a.code`,
    groupid ? [groupid] : []
  );
  return r.rows;
}

/**
 * Claim a read. Returns { run } or { busy: <the running run> }. A short transaction under an advisory lock, so two presses (or a
 * press and the cron) can't both start; the run row then carries the progress while executeRun works outside any transaction.
 */
async function startRun({ by, groupid = null }) {
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
    // A run left 'running' by a restart would block for ever — close it.
    await client.query(
      `UPDATE amz_buybox_run SET status = 'error', finished_at = now(), error = 'Did not finish (server restarted?)'
       WHERE status = 'running' AND started_at < now() - make_interval(mins => $1)`, [STALE_RUN_MINUTES]);
    const running = await client.query(`SELECT id, by_name, scope, total, done, started_at FROM amz_buybox_run WHERE status = 'running' ORDER BY id DESC LIMIT 1`);
    if (running.rows.length) return { busy: running.rows[0] };
    const sizes = await sizesToRead(client, groupid);
    const ins = await client.query(
      `INSERT INTO amz_buybox_run (by_name, scope, total) VALUES ($1, $2, $3) RETURNING id`, [by, groupid || 'all', sizes.length]);
    return { run: { id: ins.rows[0].id, scope: groupid || 'all', sizes } };
  });
}

/** One size's offers -> the stored reading. `me` = our seller id. */
function summarise(size, offersResp, foepResp, me) {
  const out = { code: size.code, asin: size.asin, error: null };
  const okOffers = offersResp && offersResp.status && offersResp.status.statusCode === 200 && offersResp.body && offersResp.body.payload;
  if (!okOffers) {
    const e = offersResp && offersResp.body && offersResp.body.errors && offersResp.body.errors[0];
    out.error = e ? `${e.code}: ${e.message}` : `offers: HTTP ${offersResp && offersResp.status ? offersResp.status.statusCode : '?'}`;
    return out;
  }
  const payload = offersResp.body.payload;
  const landed = (x) => r2((money(x.ListingPrice) || 0) + (money(x.Shipping) || 0));
  const list = payload.Offers || [];
  const ours = list.find((x) => x.SellerId === me);
  const others = list.filter((x) => x.SellerId !== me);
  const winners = list.filter((x) => x.IsBuyBoxWinner);
  const usWin = winners.some((x) => x.SellerId === me);
  const rivalWinners = winners.filter((x) => x.SellerId !== me);
  out.our_price = ours ? landed(ours) : null;

  if (usWin) out.holder = rivalWinners.length ? 'US_SHARED' : 'US';
  else if (rivalWinners.length) {
    const w = rivalWinners.reduce((a, b) => (landed(a) <= landed(b) ? a : b));
    out.holder = w.SellerId === AMAZON_RETAIL_UK ? 'AMAZON' : w.IsFulfilledByAmazon ? 'OTHER_FBA' : 'OTHER_MFN';
  } else out.holder = 'NONE';
  out.bb_price = usWin ? out.our_price : rivalWinners.length ? Math.min(...rivalWinners.map(landed)) : null;

  const cheapest = others.length ? others.reduce((a, b) => (landed(a) <= landed(b) ? a : b)) : null;
  out.rival_seller = cheapest ? cheapest.SellerId : null;
  out.rival_price = cheapest ? landed(cheapest) : null;
  const above = out.our_price === null ? [] : others.map(landed).filter((p) => p > out.our_price + 0.005);
  out.next_up = above.length ? Math.min(...above) : null;
  out.rivals = others.length;
  out.rival_at_our_price = out.our_price !== null && others.some((x) => Math.abs(landed(x) - out.our_price) < 0.005);
  out.amazon_retail = list.some((x) => x.SellerId === AMAZON_RETAIL_UK);
  out.competitive_price = r2(money(payload.Summary && payload.Summary.CompetitivePriceThreshold));
  out.offers = list.map((x) => ({ seller: x.SellerId, us: x.SellerId === me, fba: !!x.IsFulfilledByAmazon, price: landed(x), bb: !!x.IsBuyBoxWinner }));

  const fr = foepResp && foepResp.body && (foepResp.body.featuredOfferExpectedPriceResults || [])[0];
  out.foep = fr ? r2(money(fr.featuredOfferExpectedPrice && fr.featuredOfferExpectedPrice.listingPrice)) : null;
  out.foep_status = fr ? fr.resultStatus || null : foepResp && foepResp.status ? `HTTP ${foepResp.status.statusCode}` : null;
  return out;
}

/** Ask Amazon about `sizes`. onProgress(done) is called as batches land. Returns one reading per size. */
async function readAmazon(sizes, onProgress = () => {}) {
  const mkt = sp.marketplaceId();
  const me = sp.sellerId();
  const asins = [...new Set(sizes.map((s) => s.asin))];
  const offersByAsin = new Map();
  const foepBySku = new Map();
  let foepDone = 0;
  // Sizes done = those with both parts back.
  const progress = () => onProgress(Math.min(sizes.filter((s) => offersByAsin.has(s.asin)).length, foepDone));

  // Batch errors (a whole batch refused) mark every item in it; one bad batch never stops the read.
  const offersJob = (async () => {
    const parts = chunk(asins, OFFERS_BATCH);
    for (let i = 0; i < parts.length; i += 1) {
      try {
        const res = await postPaced('/batches/products/pricing/v0/itemOffers', {
          requests: parts[i].map((asin) => ({ uri: `/products/pricing/v0/items/${asin}/offers`, method: 'GET', MarketplaceId: mkt, ItemCondition: 'New', CustomerType: 'Consumer' })),
        });
        (res.responses || []).forEach((r, j) => offersByAsin.set(parts[i][j], r));
      } catch (e) {
        parts[i].forEach((asin) => offersByAsin.set(asin, { status: { statusCode: e.status || 0 }, body: { errors: [{ code: e.code || 'ERROR', message: e.message }] } }));
      }
      progress();
      if (i < parts.length - 1) await sp.sleep(OFFERS_WAIT_MS);
    }
  })();
  const foepJob = (async () => {
    const parts = chunk(sizes, FOEP_BATCH);
    for (let i = 0; i < parts.length; i += 1) {
      try {
        const res = await postPaced('/batches/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', {
          requests: parts[i].map((s) => ({ uri: '/products/pricing/2022-05-01/offer/featuredOfferExpectedPrice', method: 'GET', marketplaceId: mkt, sku: s.sku })),
        }, FOEP_WAIT_MS);
        (res.responses || []).forEach((r, j) => foepBySku.set(parts[i][j].sku, r));
      } catch (e) {
        // The expected price is only shown — a failure here keeps the size's LAST expected price (saveReadings) and the reading stands.
        logger.error(`amzBuyBox: expected-price batch failed: ${e.message}`);
      }
      foepDone += parts[i].length;
      progress();
      if (i < parts.length - 1) await sp.sleep(FOEP_WAIT_MS);
    }
  })();
  await Promise.all([offersJob, foepJob]);
  return sizes.map((s) => summarise(s, offersByAsin.get(s.asin), foepBySku.get(s.sku), me));
}

const HISTORY_KEYS = ['our_price', 'holder', 'bb_price', 'rival_seller', 'rival_price', 'rivals'];
// pg hands numerics back as strings ('39.79'), the reading has numbers — compare as numbers where both are numeric.
const norm = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? v : Number.isFinite(Number(v)) ? Number(v) : String(v));
const same = (a, b) => norm(a) === norm(b);

/** Store the readings: replace _now, write change-only history, purge history past KEEP_MONTHS. One transaction. */
async function saveReadings(client, runId, readings, scopeAll) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${LOCK_KEY}:save`]);
  const now = (await client.query(`SELECT now() AS t`)).rows[0].t;
  const codes = readings.map((r) => r.code);
  const prev = await client.query(
    `SELECT DISTINCT ON (code) code, our_price, holder, bb_price, rival_seller, rival_price, rivals
     FROM amz_buybox_history WHERE code = ANY($1) ORDER BY code, read_at DESC`, [codes]);
  const last = new Map(prev.rows.map((r) => [r.code, r]));

  let changed = 0;
  for (const r of readings) {
    await client.query(
      `INSERT INTO amz_buybox_now (code, read_at, run_id, asin, our_price, holder, bb_price, rival_seller, rival_price, next_up, rivals,
                                   rival_at_our_price, amazon_retail, foep, foep_status, competitive_price, offers, error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (code) DO UPDATE SET read_at = EXCLUDED.read_at, run_id = EXCLUDED.run_id, asin = EXCLUDED.asin,
         our_price = EXCLUDED.our_price, holder = EXCLUDED.holder, bb_price = EXCLUDED.bb_price, rival_seller = EXCLUDED.rival_seller,
         rival_price = EXCLUDED.rival_price, next_up = EXCLUDED.next_up, rivals = EXCLUDED.rivals,
         rival_at_our_price = EXCLUDED.rival_at_our_price, amazon_retail = EXCLUDED.amazon_retail, 
         -- No expected-price answer this read (its batch failed): keep the last one rather than blank it.
         foep = CASE WHEN EXCLUDED.foep_status IS NULL THEN amz_buybox_now.foep ELSE EXCLUDED.foep END,
         foep_status = COALESCE(EXCLUDED.foep_status, amz_buybox_now.foep_status), competitive_price = EXCLUDED.competitive_price, offers = EXCLUDED.offers, error = EXCLUDED.error`,
      [r.code, now, runId, r.asin, r.our_price ?? null, r.holder || 'NONE', r.bb_price ?? null, r.rival_seller ?? null, r.rival_price ?? null,
        r.next_up ?? null, r.rivals ?? 0, !!r.rival_at_our_price, !!r.amazon_retail, r.foep ?? null, r.foep_status ?? null,
        r.competitive_price ?? null, r.offers ? JSON.stringify(r.offers) : null, r.error]);
    if (r.error) continue; // a failed read says nothing about the Buy Box — no history row
    const p = last.get(r.code);
    if (p && HISTORY_KEYS.every((k) => same(p[k], r[k]))) continue;
    await client.query(
      `INSERT INTO amz_buybox_history (code, read_at, our_price, holder, bb_price, rival_seller, rival_price, rivals)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (code, read_at) DO NOTHING`,
      [r.code, now, r.our_price ?? null, r.holder, r.bb_price ?? null, r.rival_seller ?? null, r.rival_price ?? null, r.rivals ?? 0]);
    changed += 1;
  }
  // The whole list read: a size no longer stocked at FBA leaves the screen (its history stays until it ages out).
  if (scopeAll) await client.query(`DELETE FROM amz_buybox_now WHERE NOT (code = ANY($1))`, [codes]);

  // KEEP_MONTHS, purged as we write (header: the row in force at the cut-off survives).
  await client.query(
    `DELETE FROM amz_buybox_history h
     WHERE h.read_at < now() - make_interval(months => $1)
       AND EXISTS (SELECT 1 FROM amz_buybox_history n
                   WHERE n.code = h.code AND n.read_at > h.read_at AND n.read_at <= now() - make_interval(months => $1))`, [KEEP_MONTHS]);
  await client.query(`DELETE FROM amz_buybox_run WHERE started_at < now() - make_interval(months => $1)`, [KEEP_MONTHS]);
  return changed;
}

/** Do the claimed read: Amazon, then save, then close the run row. Never throws — the error goes on the run row. */
async function executeRun(run) {
  try {
    let lastWrite = 0;
    const readings = await readAmazon(run.sizes, (done) => {
      const t = Date.now();
      if (t - lastWrite < 3000 && done < run.sizes.length) return;
      lastWrite = t;
      query(`UPDATE amz_buybox_run SET done = $2 WHERE id = $1`, [run.id, done]).catch(() => {});
    });
    const changed = await withTransaction((client) => saveReadings(client, run.id, readings, run.scope === 'all'));
    const failed = readings.filter((r) => r.error).length;
    await query(
      `UPDATE amz_buybox_run SET status = 'ok', finished_at = now(), done = total, changed = $2, error = $3 WHERE id = $1`,
      [run.id, changed, failed ? `${failed} of ${readings.length} sizes could not be read` : null]);
    return { ok: true, sizes: readings.length, changed, failed };
  } catch (e) {
    logger.error(`amzBuyBox: read ${run.id} failed: ${e.message}`);
    await query(`UPDATE amz_buybox_run SET status = 'error', finished_at = now(), error = $2 WHERE id = $1`, [run.id, e.message]).catch(() => {});
    return { ok: false, error: e.message };
  }
}

/** The group for one stored reading + its economics. Returns { group, target, kept, walk }. */
function classify(r) {
  const walk = priceForProfit({ cost: r.cost, fbafee: r.fbafee, tax: r.tax }, SETTINGS.WALK_AWAY_PROFIT);
  if (r.error) return { group: 'error', target: null, kept: null, walk };
  const us = r.holder === 'US' || r.holder === 'US_SHARED';
  const target = us ? null : num(r.bb_price);
  const kept = target === null ? null : amzProfit({ price: target, cost: r.cost, fbafee: r.fbafee, tax: r.tax }).profit;
  let group;
  if (!(r.rivals > 0)) group = 'alone';
  else if (us) group = r.next_up !== null && r.our_price !== null && num(r.next_up) > num(r.our_price) * (1 + ROOM_MIN_GAP) ? 'room' : 'top';
  else if (r.holder === 'NONE') group = 'no_bb';
  else if (target === null || walk === null) group = 'unknown';
  else group = target >= walk ? 'can_match' : 'cant_match';
  return { group, target, kept, walk };
}

/** Everything the screen shows: the stored readings with today's stock / cost, grouped; the last finished read; a read in progress. */
async function readScreen(db) {
  const rows = await db.query(
    `SELECT b.*, b.read_at::text AS read_at_text, m.groupid, t.shopifytitle AS title, sk.brand,
            ${safeNumeric('a.amzprice')} AS price_now, COALESCE(a.amzlive,0)::int AS live, COALESCE(a.amztotal,0)::int AS total,
            GREATEST(COALESCE(a.amzsold,0) - COALESCE(a.amzreturn,0), 0)::int AS sold30,
            a.fbafee, sk.cost, sk.tax, ${safeNumeric('sk.rrp')} AS rrp
     FROM amz_buybox_now b
     JOIN amzfeed a ON a.code = b.code
     LEFT JOIN skumap m ON m.code = b.code
     LEFT JOIN skusummary sk ON sk.groupid = m.groupid
     LEFT JOIN title t ON t.groupid = m.groupid
     ORDER BY b.code`);
  const out = rows.rows.map((r) => {
    const c = classify({ ...r, our_price: num(r.our_price), rivals: Number(r.rivals) });
    const weeks = r.sold30 > 0 ? Math.round((r.total / (r.sold30 / (30 / 7))) * 10) / 10 : null;
    return {
      code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, asin: r.asin, read_at: r.read_at_text,
      live: r.live, total: r.total, sold30: r.sold30, weeks_left: weeks,
      our_price: num(r.our_price), price_now: num(r.price_now), rrp: num(r.rrp),
      holder: r.holder, bb_price: num(r.bb_price), rivals: Number(r.rivals), rival_price: num(r.rival_price), rival_seller: r.rival_seller,
      next_up: num(r.next_up), rival_at_our_price: r.rival_at_our_price, amazon_retail: r.amazon_retail,
      foep: num(r.foep), foep_status: r.foep_status, competitive_price: num(r.competitive_price),
      offers: r.offers || [], error: r.error,
      group: c.group, target: c.target, kept: c.kept, walk: c.walk,
    };
  });
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const r of out) counts[r.group] += 1;
  const lastAll = await db.query(
    `SELECT id, started_at::text, finished_at::text, by_name, total, changed, error FROM amz_buybox_run
     WHERE scope = 'all' AND status = 'ok' ORDER BY id DESC LIMIT 1`);
  const lastAny = await db.query(
    `SELECT id, scope, status, started_at::text, finished_at::text, by_name, total, done, changed, error FROM amz_buybox_run
     WHERE status <> 'running' ORDER BY id DESC LIMIT 1`);
  const running = await db.query(
    `SELECT id, scope, started_at::text, by_name, total, done FROM amz_buybox_run
     WHERE status = 'running' AND started_at >= now() - make_interval(mins => $1) ORDER BY id DESC LIMIT 1`, [STALE_RUN_MINUTES]);
  return { rows: out, counts, last_all: lastAll.rows[0] || null, last_run: lastAny.rows[0] || null, running: running.rows[0] || null };
}

module.exports = { GROUPS, KEEP_MONTHS, sizesToRead, startRun, executeRun, readAmazon, summarise, saveReadings, classify, readScreen };
