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
  - getItemOffersBatch (v0)       by ASIN, 20 a batch, ~1 batch / 10 s — every offer: seller id, FBA?, price + postage
  - getCompetitiveSummaryBatch    by ASIN, 20 a batch, ~1 batch / 30 s — the FEATURED offer for each customer group (Prime /
                                  non-Prime / default, by postcode) with that group's SHARE OF PAGE VIEWS
  The whole list (FBA live + inbound, ~360 sizes) takes about 9–10 minutes, paced to Amazon's limits; one style a few seconds.

THE BUY BOX IS SHARED BY SHARE OF VIEWS (owner, 2026-11-12 — "swap to the share-of-views read. get rid of Amazon expected price").
  Found on IVES-WHITE-06: a self-poster at our exact £39.49 was featured to ~89% of page views, a £31.44 + £4.95 seller to ~11%
  (non-Prime), us to 0%. So:
  - our_share  = % of page views where WE are the featured offer — our own Buy Box %, per size, every read (the figure the pricing
                 standard has needed a downloaded Business Report for).
  - the LEAD   = the offer featured to the MOST views; holder / bb_price are the lead's. The price to match is the LEAD's price,
                 postage included — NOT the cheapest featured offer (on 06 that would have given away £3.10 a pair to win 11%).
  - Amazon's "featured offer expected price" is NOT read any more: wrong both times it was checked (£34.19 where we already won at
    £39.79; £31.43 on 06 = the cheap rival's item price minus 1p, WITHOUT its £4.95 postage).
  If competitiveSummary fails for a size, the reading falls back to itemOffers' IsBuyBoxWinner flags (the cheapest winner) with
  our_share unknown — the reading still stands.
  - A rival at OUR EXACT PRICE, to the penny, is tagged (a repricer following us — matching it starts a race).
  - OUR ELIGIBILITY (owner, 2026-11-12): itemOffers' IsFeaturedMerchant for our offer → our_eligible (+ elig on every offer in the
    offers jsonb). false = Amazon won't consider us for the Buy Box at all, so 0% whatever the price — tagged on the screen; the fix
    is in Seller Central, not the price. Kept in history (change-only), migration 20261112d. IVES-WHITE 03–09 were all eligible.

HISTORY (change-only, KEEP_MONTHS): a size gets a row only when holder / Buy Box price / our price / cheapest rival (seller + price) /
rival count / our share of views (as a WHOLE %) / our eligibility differs from its previous row. Purged by the read itself: a row older than the cut-off goes only once a newer row is also
at or before the cut-off, so the state at the cut-off can still be read. A size that fails to read writes nothing to history.

GROUPS (classify — computed when the screen loads, from the stored reading + today's cost / fee, so a cost change applies at once):
  alone       no other offer on the size — price is about demand (the pricing standard's job), not the Buy Box
  room        we LEAD (featured to the most views) and the cheapest rival above us is > ROOM_MIN_GAP over our price — a GUESS
              (FBA wins above cheaper self-posters, so how far up we can go only history will show)
  top         we lead, no room above
  can_match   a rival leads and its price still keeps us the £3 walk-away profit
  cant_match  a rival leads under our walk-away price — hold, no race to the bottom
  no_bb       nobody is featured (Amazon pulled the Buy Box — often "seen cheaper elsewhere")
  unknown     no walk-away price (no cost) or Amazon gave no price to match
  tie         a rival leads AT OUR EXACT PRICE (Amazon gives the tie to them) — matching changes nothing, only going under would,
              and a follower follows. LEFT AS A TIE for now (owner, 2026-11-12: "What can we do other than race to bottom ... Can just
              leave for now as a tie"); weeks of stock is on the row for when it is judged. Idea on file, not decided: nudge up and
              see whether the follower comes up too (the hourly history shows it).
  dearer      a rival leads at a HIGHER price than ours — price isn't the reason (owner: "That's Amazon's choice for whatever
              reason"). No action.
  not_live    NO STOCK SELLABLE AT FBA NOW (only on its way in) — Amazon can't feature an offer it can't ship, so no price fixes it;
              it comes back into the groups when the stock lands (owner, 2026-11-12: 56 of the 178 sizes shown to nobody were this).
              Checked FIRST, from today's amzfeed.amzlive.
  error       the read failed for this size

HEADLINE (owner, 2026-11-12 — "those headline percentages ... would be good to see on screen"; maybe promoted to the dashboard once
  agreed): over the sizes LIVE at FBA with a known share (an inbound-only size can't be shown, so it would only drag the figure). The
  screen shows TWO figures only (owner, 2026-11-12, after a strip of five and then the full chat sentence both confused: "I think only
  the 55% and the 127 are useful"): avg_share (our share of views, averaged per size) and full (sizes shown to on every view). The
  rest (weighted_share by 30-day pairs, part, none) stay in the API for a later look, not on screen.
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
const SUMMARY_BATCH = 20; const SUMMARY_WAIT_MS = 31000;

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

const GROUPS = ['can_match', 'room', 'cant_match', 'tie', 'dearer', 'no_bb', 'top', 'alone', 'not_live', 'unknown', 'error'];

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

/**
 * The featured offers from competitiveSummary, one per seller, each with its share of page views (its segments summed), biggest first.
 * Returns null when the summary is missing / refused — the caller then falls back to itemOffers' winner flags.
 */
function featuredOffers(summaryResp, me) {
  const body = summaryResp && summaryResp.status && summaryResp.status.statusCode === 200 ? summaryResp.body : null;
  if (!body || body.errors) return null;
  const bySeller = new Map();
  for (const fbo of body.featuredBuyingOptions || []) {
    if (fbo.buyingOptionType && fbo.buyingOptionType !== 'New') continue;
    for (const so of fbo.segmentedFeaturedOffers || []) {
      const opts = so.shippingOptions || [];
      const ship = opts.find((x) => x.shippingOptionType === 'DEFAULT') || opts[0];
      const price = r2((money(so.listingPrice) || 0) + (money(ship && ship.price) || 0));
      const segs = (so.featuredOfferSegments || []).map((g) => ({
        who: g.customerMembership || '?', pct: Number((g.segmentDetails && g.segmentDetails.glanceViewWeightPercentage) || 0),
      }));
      const cur = bySeller.get(so.sellerId) || { seller: so.sellerId, us: so.sellerId === me, fba: so.fulfillmentType === 'AFN', price, share: 0, segments: [] };
      cur.share += segs.reduce((t, g) => t + g.pct, 0);
      cur.segments.push(...segs);
      bySeller.set(so.sellerId, cur);
    }
  }
  return [...bySeller.values()].map((f) => ({ ...f, share: Math.min(100, Math.round(f.share * 10) / 10) })).sort((a, b) => b.share - a.share);
}

const typeOf = (seller, fba) => (seller === AMAZON_RETAIL_UK ? 'AMAZON' : fba ? 'OTHER_FBA' : 'OTHER_MFN');

/** One size's offers + featured summary -> the stored reading. `me` = our seller id. */
function summarise(size, offersResp, summaryResp, me) {
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
  out.our_price = ours ? landed(ours) : null;

  const featured = featuredOffers(summaryResp, me);
  out.featured = featured;
  if (featured) {
    // SHARE OF VIEWS (header): the lead = featured to the most views; our_share = the views we are featured to.
    const mine = featured.find((f) => f.us);
    out.our_share = mine ? mine.share : 0;
    const lead = featured[0] || null;
    if (!lead) { out.holder = 'NONE'; out.bb_price = null; out.lead_share = null; }
    else {
      out.lead_share = lead.share;
      out.holder = lead.us ? (featured.length > 1 ? 'US_SHARED' : 'US') : typeOf(lead.seller, lead.fba);
      out.bb_price = lead.us && out.our_price !== null ? out.our_price : lead.price;
    }
  } else {
    // Fallback: itemOffers' winner flags (the cheapest winner); share unknown.
    const winners = list.filter((x) => x.IsBuyBoxWinner);
    const usWin = winners.some((x) => x.SellerId === me);
    const rivalWinners = winners.filter((x) => x.SellerId !== me);
    out.our_share = null; out.lead_share = null;
    if (usWin) out.holder = rivalWinners.length ? 'US_SHARED' : 'US';
    else if (rivalWinners.length) {
      const w = rivalWinners.reduce((a, b) => (landed(a) <= landed(b) ? a : b));
      out.holder = typeOf(w.SellerId, w.IsFulfilledByAmazon);
    } else out.holder = 'NONE';
    out.bb_price = usWin ? out.our_price : rivalWinners.length ? Math.min(...rivalWinners.map(landed)) : null;
  }

  const cheapest = others.length ? others.reduce((a, b) => (landed(a) <= landed(b) ? a : b)) : null;
  out.rival_seller = cheapest ? cheapest.SellerId : null;
  out.rival_price = cheapest ? landed(cheapest) : null;
  const above = out.our_price === null ? [] : others.map(landed).filter((p) => p > out.our_price + 0.005);
  out.next_up = above.length ? Math.min(...above) : null;
  out.rivals = others.length;
  out.rival_at_our_price = out.our_price !== null && others.some((x) => Math.abs(landed(x) - out.our_price) < 0.005);
  out.amazon_retail = list.some((x) => x.SellerId === AMAZON_RETAIL_UK);
  out.competitive_price = r2(money(payload.Summary && payload.Summary.CompetitivePriceThreshold));
  // ELIGIBILITY (2026-11-12): IsFeaturedMerchant = Amazon will consider the offer for the Buy Box at all. Ours false = no price
  // fixes a 0% share. NULL = our offer not in the list (or Amazon left the flag out).
  const elig = (x) => (typeof x.IsFeaturedMerchant === 'boolean' ? x.IsFeaturedMerchant : null);
  out.our_eligible = ours ? elig(ours) : null;
  out.offers = list.map((x) => ({ seller: x.SellerId, us: x.SellerId === me, fba: !!x.IsFulfilledByAmazon, price: landed(x), bb: !!x.IsBuyBoxWinner, elig: elig(x) }));
  return out;
}

/** Ask Amazon about `sizes`. onProgress(done) is called as batches land. Returns one reading per size. */
async function readAmazon(sizes, onProgress = () => {}) {
  const mkt = sp.marketplaceId();
  const me = sp.sellerId();
  const asins = [...new Set(sizes.map((s) => s.asin))];
  const offersByAsin = new Map();
  const summaryByAsin = new Map();
  // Sizes done = those with both parts back.
  const progress = () => onProgress(sizes.filter((s) => offersByAsin.has(s.asin) && summaryByAsin.has(s.asin)).length);

  // One paced job per call. A batch refused whole marks every item in it; one bad batch never stops the read.
  const job = (path, batch, waitMs, makeReq, store) => (async () => {
    const parts = chunk(asins, batch);
    for (let i = 0; i < parts.length; i += 1) {
      try {
        const res = await postPaced(path, { requests: parts[i].map(makeReq) }, waitMs);
        (res.responses || []).forEach((r, j) => store.set(parts[i][j], r));
      } catch (e) {
        logger.error(`amzBuyBox: ${path} batch failed: ${e.message}`);
        parts[i].forEach((asin) => store.set(asin, { status: { statusCode: e.status || 0 }, body: { errors: [{ code: e.code || 'ERROR', message: e.message }] } }));
      }
      progress();
      if (i < parts.length - 1) await sp.sleep(waitMs);
    }
  })();
  await Promise.all([
    job('/batches/products/pricing/v0/itemOffers', OFFERS_BATCH, OFFERS_WAIT_MS,
      (asin) => ({ uri: `/products/pricing/v0/items/${asin}/offers`, method: 'GET', MarketplaceId: mkt, ItemCondition: 'New', CustomerType: 'Consumer' }),
      offersByAsin),
    job('/batches/products/pricing/2022-05-01/items/competitiveSummary', SUMMARY_BATCH, SUMMARY_WAIT_MS,
      (asin) => ({ uri: '/products/pricing/2022-05-01/items/competitiveSummary', method: 'GET', asin, marketplaceId: mkt, includedData: ['featuredBuyingOptions'] }),
      summaryByAsin),
  ]);
  return sizes.map((s) => summarise(s, offersByAsin.get(s.asin), summaryByAsin.get(s.asin), me));
}

// our_share is compared and stored as a WHOLE % — Amazon's view weights move by fractions between reads, and a fraction is not news.
const HISTORY_KEYS = ['our_price', 'holder', 'bb_price', 'rival_seller', 'rival_price', 'rivals', 'share', 'our_eligible'];
// pg hands numerics back as strings ('39.79'), the reading has numbers — compare as numbers where both are numeric.
const norm = (v) => (v === null || v === undefined || v === '' ? null : typeof v === 'boolean' ? v : Number.isFinite(Number(v)) ? Number(v) : String(v));
const same = (a, b) => norm(a) === norm(b);

/** Store the readings: replace _now, write change-only history, purge history past KEEP_MONTHS. One transaction. */
async function saveReadings(client, runId, readings, scopeAll) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${LOCK_KEY}:save`]);
  const now = (await client.query(`SELECT now() AS t`)).rows[0].t;
  const codes = readings.map((r) => r.code);
  const prev = await client.query(
    `SELECT DISTINCT ON (code) code, our_price, holder, bb_price, rival_seller, rival_price, rivals, our_share AS share, our_eligible
     FROM amz_buybox_history WHERE code = ANY($1) ORDER BY code, read_at DESC`, [codes]);
  const last = new Map(prev.rows.map((r) => [r.code, r]));

  let changed = 0;
  for (const r of readings) {
    r.share = r.our_share === null || r.our_share === undefined ? null : Math.round(r.our_share);
    await client.query(
      `INSERT INTO amz_buybox_now (code, read_at, run_id, asin, our_price, holder, bb_price, rival_seller, rival_price, next_up, rivals,
                                   rival_at_our_price, amazon_retail, our_share, lead_share, featured, competitive_price, offers, error,
                                   our_eligible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (code) DO UPDATE SET read_at = EXCLUDED.read_at, run_id = EXCLUDED.run_id, asin = EXCLUDED.asin,
         our_price = EXCLUDED.our_price, holder = EXCLUDED.holder, bb_price = EXCLUDED.bb_price, rival_seller = EXCLUDED.rival_seller,
         rival_price = EXCLUDED.rival_price, next_up = EXCLUDED.next_up, rivals = EXCLUDED.rivals,
         rival_at_our_price = EXCLUDED.rival_at_our_price, amazon_retail = EXCLUDED.amazon_retail,
         our_share = EXCLUDED.our_share, lead_share = EXCLUDED.lead_share, featured = EXCLUDED.featured,
         competitive_price = EXCLUDED.competitive_price, offers = EXCLUDED.offers, error = EXCLUDED.error,
         our_eligible = EXCLUDED.our_eligible`,
      [r.code, now, runId, r.asin, r.our_price ?? null, r.holder || 'NONE', r.bb_price ?? null, r.rival_seller ?? null, r.rival_price ?? null,
        r.next_up ?? null, r.rivals ?? 0, !!r.rival_at_our_price, !!r.amazon_retail, r.our_share ?? null, r.lead_share ?? null,
        r.featured ? JSON.stringify(r.featured) : null, r.competitive_price ?? null, r.offers ? JSON.stringify(r.offers) : null, r.error,
        r.our_eligible ?? null]);
    if (r.error) continue; // a failed read says nothing about the Buy Box — no history row
    const p = last.get(r.code);
    if (p && HISTORY_KEYS.every((k) => same(p[k], r[k]))) continue;
    await client.query(
      `INSERT INTO amz_buybox_history (code, read_at, our_price, holder, bb_price, rival_seller, rival_price, rivals, our_share, our_eligible)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (code, read_at) DO NOTHING`,
      [r.code, now, r.our_price ?? null, r.holder, r.bb_price ?? null, r.rival_seller ?? null, r.rival_price ?? null, r.rivals ?? 0, r.share,
        r.our_eligible ?? null]);
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
  if (!(Number(r.live) > 0)) return { group: 'not_live', target: null, kept: null, walk };
  const us = r.holder === 'US' || r.holder === 'US_SHARED';
  const target = us ? null : num(r.bb_price);
  // KEPT = our profit a pair: at the Buy Box price when someone else holds it (what matching would leave us), at OUR price when we
  // hold it (nothing to match — owner, 2026-11-12: show what the size makes now, so "Room to go up" isn't a blank column).
  const keptAt = us ? num(r.our_price) : target;
  const kept = keptAt === null ? null : amzProfit({ price: keptAt, cost: r.cost, fbafee: r.fbafee, tax: r.tax }).profit;
  let group;
  if (!(r.rivals > 0)) group = 'alone';
  else if (us) group = r.next_up !== null && r.our_price !== null && num(r.next_up) > num(r.our_price) * (1 + ROOM_MIN_GAP) ? 'room' : 'top';
  else if (r.holder === 'NONE') group = 'no_bb';
  else if (target !== null && r.our_price !== null && Math.abs(target - r.our_price) < 0.005) group = 'tie';
  else if (target !== null && r.our_price !== null && target > r.our_price) group = 'dearer';
  else if (target === null || walk === null) group = 'unknown';
  else group = target >= walk ? 'can_match' : 'cant_match';
  return { group, target, kept, walk };
}

/** Everything the screen shows: the stored readings with today's stock / cost, grouped; the last finished read; a read in progress. */
async function readScreen(db) {
  const rows = await db.query(
    `SELECT b.*, b.read_at::text AS read_at_text, m.groupid, t.shopifytitle AS title, sk.brand,
            -- A price SET AFTER this reading (any screen; the newest) — the row then says the reading is out of date for it.
            -- Not amzfeed.amzprice: on 2026-11-12, 40 sizes showed a false "changed" because amzfeed still held the price from
            -- BEFORE changes Amazon had already taken (the nightly report catches it up); the Amazon reading was right.
            (SELECT l.new_price FROM amz_price_log l WHERE l.code = b.code AND l.changed_at > b.read_at
             ORDER BY l.id DESC LIMIT 1) AS set_since,
            COALESCE(a.amzlive,0)::int AS live, COALESCE(a.amztotal,0)::int AS total,
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
      our_price: num(r.our_price), set_since: num(r.set_since), rrp: num(r.rrp),
      holder: r.holder, bb_price: num(r.bb_price), rivals: Number(r.rivals), rival_price: num(r.rival_price), rival_seller: r.rival_seller,
      next_up: num(r.next_up), rival_at_our_price: r.rival_at_our_price, amazon_retail: r.amazon_retail, our_eligible: r.our_eligible,
      our_share: num(r.our_share), lead_share: num(r.lead_share), featured: r.featured || [],
      competitive_price: num(r.competitive_price), offers: r.offers || [], error: r.error,
      group: c.group, target: c.target, kept: c.kept, walk: c.walk,
    };
  });
  const counts = Object.fromEntries(GROUPS.map((g) => [g, 0]));
  for (const r of out) counts[r.group] += 1;

  // HEADLINE (header): sizes live at FBA whose share is known.
  const known = out.filter((r) => r.live > 0 && r.our_share !== null && !r.error);
  const sold = known.filter((r) => r.sold30 > 0);
  const soldPairs = sold.reduce((t, r) => t + r.sold30, 0);
  const headline = {
    sizes: known.length,
    avg_share: known.length ? Math.round((known.reduce((t, r) => t + r.our_share, 0) / known.length) * 10) / 10 : null,
    weighted_share: soldPairs ? Math.round((sold.reduce((t, r) => t + r.our_share * r.sold30, 0) / soldPairs) * 10) / 10 : null,
    full: known.filter((r) => r.our_share >= 99.5).length,
    part: known.filter((r) => r.our_share > 0 && r.our_share < 99.5).length,
    none: known.filter((r) => r.our_share === 0).length,
  };
  const lastAll = await db.query(
    `SELECT id, started_at::text, finished_at::text, by_name, total, changed, error FROM amz_buybox_run
     WHERE scope = 'all' AND status = 'ok' ORDER BY id DESC LIMIT 1`);
  const lastAny = await db.query(
    `SELECT id, scope, status, started_at::text, finished_at::text, by_name, total, done, changed, error FROM amz_buybox_run
     WHERE status <> 'running' ORDER BY id DESC LIMIT 1`);
  const running = await db.query(
    `SELECT id, scope, started_at::text, by_name, total, done FROM amz_buybox_run
     WHERE status = 'running' AND started_at >= now() - make_interval(mins => $1) ORDER BY id DESC LIMIT 1`, [STALE_RUN_MINUTES]);
  return { rows: out, counts, headline, last_all: lastAll.rows[0] || null, last_run: lastAny.rows[0] || null, running: running.rows[0] || null };
}

module.exports = { GROUPS, KEEP_MONTHS, sizesToRead, startRun, executeRun, readAmazon, summarise, saveReadings, classify, readScreen };
