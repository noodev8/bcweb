/*
=======================================================================================================================================
Util: utils/amzStockSync.js   — FBA stock from the Amazon SP-API onto amzfeed (+ the size history)
=======================================================================================================================================
Purpose: Keep amzfeed's FBA stock (amzlive / amztotal) current WITHOUT anyone downloading a file (owner, 2026-11-09: "We dont have as
much human intervention"). Before this, FBA stock was only as fresh as the last Update Amazon upload of the FBA Inventory report, and
Update Orders sent THAT figure to Shopify and eBay as "FBA live".

TWO WAYS IN:
  QUICK (default) — a step of Update Orders (utils/orderSync.js, button + cron), straight AFTER the orders commit and BEFORE the
          Shopify stock step, so Shopify and eBay are sent this run's FBA numbers. Asks Amazon only for SKUs whose inventory CHANGED
          since the last good run (FBA Inventory API getInventorySummaries with startDateTime) — measured 2026-11-09: 1-3 seconds,
          24 SKUs in 4 hours, 108 in 24 hours. Goes back an extra hour each time (OVERLAP): re-reading a change does no harm. Never
          fails Update Orders: an error is logged, kept in amz_api_sync, and the next run simply asks from the same point again.
  FULL    — every SKU Amazon holds (~10,600 at 50 a page, ~2.5 minutes), by hand: scripts/amz-stock-sync.js --full. Sets the starting
          point the first time; also ZEROES amzfeed rows Amazon no longer reports (the quick read can't see a SKU that vanished).
          The nightly FBA Inventory report (scripts/amz-inventory-nightly.js) is the everyday full check.

THE NUMBERS — the same as the inventory file gave (verified 2026-11-09: all 699 amzfeed SKUs matched; differences were stock that
had moved since the last upload):
  amzlive  = fulfillableQuantity  (file: afn-fulfillable-quantity)
  amztotal = totalQuantity        (file: afn-total-quantity — includes inbound and reserved)
  inbound  = inbound working + shipped + receiving, for the size history only (amzfeed has no inbound column)

WHAT IT DOES NOT TOUCH: amzprice (this API carries no price — the nightly report brings prices and the "changed in Seller Central"
check), sales, returns, fees. A NEW FBA SKU (in skumap, not yet in amzfeed) gets its amzfeed row with NO price until the nightly report.
Unknown SKUs (not in skumap) and Amazon's own amzn.gr. bundle SKUs are skipped and counted — the same rule as the import.

THE SIZE HISTORY (utils/amzSizeHistory.js) is written in the same transaction behind a SAVEPOINT when anything changed. The quick read
passes carryInbound: a size not in this read keeps its last known inbound rather than reading 0.

LOCK: 'amz_stock' (transaction advisory lock) — the quick step and the nightly report never write amzfeed stock at the same moment.
bclog section 'Amazon Stock', only when something was written. State: amz_api_sync job 'stock' (migrations/20261109c_amz_api_sync.sql).
=======================================================================================================================================
*/

const { withTransaction } = require('./transaction');
const { query } = require('../database');
const { loadReference } = require('./amzImport');
const sp = require('./amzSpApi');

const STOCK_LOCK = 'amz_stock';
const JOB = 'stock';
const OVERLAP_MS = 60 * 60 * 1000;
const PAGE_PAUSE_MS = 600; // getInventorySummaries allows ~2 requests a second

function isConfigured() {
  return Boolean(process.env.AMZ_SP_CLIENT_ID && process.env.AMZ_SP_CLIENT_SECRET && process.env.AMZ_SP_REFRESH_TOKEN);
}

// NEWLY LISTED SIZES (2026-11-10). A brand-new FBA SKU holding 0 has a BLANK lastUpdatedTime on Amazon, so the quick read ("changed
// since") never returns it — checked on M9502-42-019 the day "List on Amazon (FBA)" (utils/amzListing.js) first ran: FBA, FNSKU, offer
// all done on Amazon, still not in amzfeed. So the quick read also asks Amazon BY SKU for every size SENT in the last PENDING_DAYS
// (skumap.status '1' + sku, stamped by that button — or by the old .xlsm button, harmless: a SKU Amazon doesn't have just isn't
// returned) that isn't in amzfeed yet. Once Amazon has it as FBA it comes back with its FNSKU and is added like any new SKU.
const PENDING_DAYS = 14;
const SKUS_PER_CALL = 50; // getInventorySummaries takes up to 50 sellerSkus

async function pendingSkus(db = { query }) {
  const r = await db.query(
    `SELECT m.sku FROM skumap m LEFT JOIN amzfeed f ON f.code = m.code
      WHERE f.code IS NULL AND COALESCE(m.deleted, 0) = 0 AND m.status = '1' AND NULLIF(TRIM(m.sku), '') IS NOT NULL
        AND m.updated ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND LEFT(m.updated, 10)::date >= CURRENT_DATE - $1::int`,
    [PENDING_DAYS]
  );
  return r.rows.map((x) => x.sku.trim());
}

async function fetchPending(skus) {
  const rows = [];
  for (let i = 0; i < skus.length; i += SKUS_PER_CALL) {
    if (i) await sp.sleep(PAGE_PAUSE_MS);
    rows.push(...await fetchInventorySummaries({ sellerSkus: skus.slice(i, i + SKUS_PER_CALL) }));
  }
  return rows;
}

/** Every inventory summary (changed since startDateTime, or just the given sellerSkus, when given), normalised. */
async function fetchInventorySummaries({ startDateTime, sellerSkus, onPage } = {}) {
  const rows = [];
  let nextToken;
  let page = 0;
  do {
    const q = {
      details: 'true',
      granularityType: 'Marketplace',
      granularityId: sp.marketplaceId(),
      marketplaceIds: sp.marketplaceId(),
    };
    if (sellerSkus) q.sellerSkus = sellerSkus;
    else if (startDateTime) q.startDateTime = startDateTime;
    if (nextToken) q.nextToken = nextToken;
    const res = await sp.spGet('/fba/inventory/v1/summaries', q);
    for (const r of (res && res.payload && res.payload.inventorySummaries) || []) {
      const d = r.inventoryDetails || {};
      const sku = String(r.sellerSku || '').trim();
      if (!sku) continue;
      rows.push({
        sku,
        fnsku: r.fnSku || null,
        asin: r.asin || null,
        live: Number(d.fulfillableQuantity || 0),
        total: Number(r.totalQuantity || 0),
        inbound: Number(d.inboundWorkingQuantity || 0) + Number(d.inboundShippedQuantity || 0) + Number(d.inboundReceivingQuantity || 0),
        isVirtual: sku.startsWith('amzn.gr.'),
      });
    }
    nextToken = res && res.pagination && res.pagination.nextToken;
    page += 1;
    if (onPage) onPage(page, rows.length);
    if (nextToken) await sp.sleep(PAGE_PAUSE_MS);
  } while (nextToken);
  return rows;
}

/** What the read would change, against amzfeed as it is now (read only). */
async function planChanges(db, rows, { full }) {
  const ref = await loadReference(db, rows.filter((r) => !r.isVirtual).map((r) => r.sku));
  const cur = await db.query(`SELECT code, COALESCE(amzlive,0)::int AS live, COALESCE(amztotal,0)::int AS total, fnsku, asin FROM amzfeed`);
  const feed = new Map(cur.rows.map((r) => [r.code, r]));

  const plan = { updates: [], inserts: [], zero: [], unknown: 0, virtual: 0, matched: 0, inbound: new Map() };
  const seen = new Set();
  for (const r of rows) {
    if (r.isVirtual) { plan.virtual += 1; continue; }
    const m = ref.bySku.get(r.sku);
    if (!m) { plan.unknown += 1; continue; }
    if (seen.has(m.code)) continue;
    seen.add(m.code);
    plan.matched += 1;
    plan.inbound.set(m.code, r.inbound);
    const f = feed.get(m.code);
    if (!f) {
      plan.inserts.push({ code: m.code, groupid: m.groupid, sku: r.sku, fnsku: r.fnsku, asin: r.asin, live: r.live, total: r.total });
    } else if (f.live !== r.live || f.total !== r.total
      || (r.fnsku && r.fnsku !== f.fnsku) || (r.asin && r.asin !== f.asin)) {
      plan.updates.push({ code: m.code, live: r.live, total: r.total, fnsku: r.fnsku, asin: r.asin, from: `${f.live}/${f.total}`, stock: f.live !== r.live || f.total !== r.total });
    }
  }
  if (full) {
    for (const f of cur.rows) if (!seen.has(f.code) && (f.live !== 0 || f.total !== 0)) plan.zero.push({ code: f.code, from: `${f.live}/${f.total}` });
  }
  return plan;
}

async function writePlan(client, plan, { full, who }) {
  if (plan.updates.length) {
    await client.query(
      `UPDATE amzfeed a SET amzlive = v.live, amztotal = v.total,
              fnsku = COALESCE(NULLIF(v.fnsku, ''), a.fnsku), asin = COALESCE(NULLIF(v.asin, ''), a.asin)
       FROM (SELECT UNNEST($1::text[]) AS code, UNNEST($2::int[]) AS live, UNNEST($3::int[]) AS total,
                    UNNEST($4::text[]) AS fnsku, UNNEST($5::text[]) AS asin) v
       WHERE a.code = v.code`,
      [plan.updates.map((u) => u.code), plan.updates.map((u) => u.live), plan.updates.map((u) => u.total),
        plan.updates.map((u) => u.fnsku), plan.updates.map((u) => u.asin)]
    );
  }
  if (plan.inserts.length) {
    // No price: this API carries none — the nightly FBA Inventory report fills amzprice.
    await client.query(
      `INSERT INTO amzfeed (code, groupid, sku, fnsku, asin, amzlive, amztotal)
       SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::int[], $7::int[])
       ON CONFLICT (code) DO UPDATE SET amzlive = EXCLUDED.amzlive, amztotal = EXCLUDED.amztotal`,
      [plan.inserts.map((r) => r.code), plan.inserts.map((r) => r.groupid), plan.inserts.map((r) => r.sku),
        plan.inserts.map((r) => r.fnsku), plan.inserts.map((r) => r.asin), plan.inserts.map((r) => r.live), plan.inserts.map((r) => r.total)]
    );
  }
  if (plan.zero.length) {
    await client.query(`UPDATE amzfeed SET amzlive = 0, amztotal = 0 WHERE code = ANY($1::text[])`, [plan.zero.map((z) => z.code)]);
  }

  let history = null;
  if (plan.updates.length || plan.inserts.length || plan.zero.length) {
    await client.query('SAVEPOINT size_history');
    try {
      const { recordSizeHistory } = require('./amzSizeHistory');
      history = await recordSizeHistory(client, { inbound: plan.inbound, who, carryInbound: !full });
      await client.query('RELEASE SAVEPOINT size_history');
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT size_history');
      history = { failed: true, error: e.message };
    }
  }
  return history;
}

async function readState(db = { query }) {
  try {
    const r = await db.query(`SELECT * FROM amz_api_sync WHERE job = $1`, [JOB]);
    return r.rows[0] || null;
  } catch (err) {
    if (/amz_api_sync/.test(err.message)) return null;   // migration not applied yet — the quick step then skips (no starting point)
    throw err;
  }
}

async function recordError(job, message) {
  try {
    await query(
      `INSERT INTO amz_api_sync (job, last_error, last_error_at) VALUES ($1, $2, now())
       ON CONFLICT (job) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = now()`,
      [job, String(message).slice(0, 1000)]
    );
  } catch { /* the table may not exist yet — the error is in the server log anyway */ }
}

/**
 * @param by      'cron' / display name
 * @param full    read every SKU (and zero the ones Amazon no longer reports)
 * @param commit  false = dry run: read Amazon, plan against amzfeed, write NOTHING
 * @returns { mode, since, read, matched, unknown, virtual, updated, stockChanged, inserted, zeroed, examples, history, committed, skipped? }
 */
async function syncAmzStock({ by = 'cron', full = false, commit = true, onPage } = {}) {
  const state = await readState();
  if (!full && !(state && state.cursor_at)) {
    return { skipped: 'no starting point yet — run: node scripts/amz-stock-sync.js --full --commit' };
  }
  const startedAt = new Date();
  const since = full ? null : new Date(new Date(state.cursor_at).getTime() - OVERLAP_MS).toISOString();

  let rows;
  let pending = 0;
  try {
    rows = await fetchInventorySummaries({ startDateTime: since, onPage });
    if (!full) {
      // Newly listed sizes the "changed since" read can't see (see PENDING_DAYS). The full read already has every SKU.
      const have = new Set(rows.map((r) => r.sku));
      const skus = (await pendingSkus()).filter((s) => !have.has(s));
      if (skus.length) {
        const found = await fetchPending(skus);
        pending = found.length;
        rows = rows.concat(found);
      }
    }
  } catch (err) {
    if (commit) await recordError(JOB, err.message);
    throw err;
  }

  const summarise = (plan, history, committed) => ({
    mode: full ? 'full' : 'quick',
    since,
    read: rows.length,
    pendingFound: pending,   // of `read`: newly listed sizes found by asking by SKU
    matched: plan.matched,
    unknown: plan.unknown,
    virtual: plan.virtual,
    updated: plan.updates.length,
    stockChanged: plan.updates.filter((u) => u.stock).length,
    inserted: plan.inserts.length,
    zeroed: plan.zero.length,
    examples: [
      ...plan.updates.filter((u) => u.stock).map((u) => `${u.code} ${u.from} → ${u.live}/${u.total}`),
      ...plan.inserts.map((r) => `${r.code} new → ${r.live}/${r.total}`),
      ...plan.zero.map((z) => `${z.code} ${z.from} → 0/0 (gone from Amazon)`),
    ].slice(0, 15),
    history,
    committed,
  });

  if (!commit) {
    const plan = await planChanges({ query }, rows, { full });
    return summarise(plan, null, false);
  }

  try {
    return await withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [STOCK_LOCK]);
      // Planned INSIDE the transaction, under the lock — against amzfeed as it is now, not as it was when Amazon was read.
      const plan = await planChanges(client, rows, { full });
      const history = await writePlan(client, plan, { full, who: by });
      const out = summarise(plan, history, true);
      const note = `${out.mode}: ${out.read} read, ${out.stockChanged} stock changed, ${out.inserted} new, ${out.zeroed} zeroed`;
      await client.query(
        `INSERT INTO amz_api_sync (job, cursor_at, last_ok_at, last_ok_note, last_error, last_error_at)
         VALUES ($1, $2, now(), $3, NULL, NULL)
         ON CONFLICT (job) DO UPDATE SET cursor_at = EXCLUDED.cursor_at, last_ok_at = now(), last_ok_note = EXCLUDED.last_ok_note,
                                         last_error = NULL, last_error_at = NULL`,
        [JOB, startedAt.toISOString(), note]
      );
      if (out.stockChanged || out.inserted || out.zeroed) {
        await client.query(
          `INSERT INTO bclog (workstation, section, log, date, time, created_at)
           VALUES ($1, 'Amazon Stock', $2, (now() AT TIME ZONE 'Europe/London')::date,
                   to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
          [String(by), `Amazon stock (API ${note})${history && history.failed ? ' — size history FAILED' : ''}`.slice(0, 250)]
        );
      }
      return out;
    });
  } catch (err) {
    await recordError(JOB, err.message);
    throw err;
  }
}

module.exports = { syncAmzStock, fetchInventorySummaries, isConfigured, readState, recordError, STOCK_LOCK };
