/*
=======================================================================================================================================
Util: utils/amzPricePush.js   — send logged Amazon prices to Amazon (SP-API), in place of the Seller Central upload file
=======================================================================================================================================
Purpose: THE one copy of the live Amazon price push (2026-11-11, owner: "price on bcweb and it updates amz automatically"). A price is
         still written the same way (utils/priceWrite.js → writeAmzPrice, W-A1: one amz_price_log row); this sends it.

WHAT IS SENT: the same set the upload basket shows (routes/amz-basket.js) — the LATEST pending row per SKU (uploaded_at IS NULL) from the
last 72 hours whose price isn't already Amazon's. Optionally narrowed to some codes (an Apply sends its own SKU).

HOW (checked against Amazon's real replies on 2026-11-11 — scripts/amz-price-probe.js, live test on FLE030-IVES-WHITE-05):
  getListingsItem (summaries + attributes) for the product type and the current purchasable_offer, then patchListingsItem replacing
  purchasable_offer with the SAME entries and only our_price changed on the consumer ("ALL") entry — so the min / max seller price, any
  Sale price and a B2B entry stay exactly as they are. Amazon answers ACCEPTED (live within minutes) or INVALID with its reason, e.g.
  "Your Price 47 is not ≤ Maximum Seller Allowed Price 45" (536 of 652 listings carry a min / max; the old file wrote max = RRP).

SENT = the rows are stamped uploaded_at = now(), uploaded_by = who (the same stamp "I've uploaded" made — every older pending row of that
SKU too), so they leave the basket and the screens read the price as current (utils/amzNow.js). The nightly FBA Inventory report then
sees the new price, finds it is our latest log row, and logs nothing (amzImport.planManualPrices).

NOT SENT = nothing stored (owner, 2026-11-11: "just show the result on the screen if it goes wrong — doesn't need storing"). The row stays
pending — it keeps counting on the Send to Amazon button and is tried again by that button and by Update Orders (utils/orderSync.js).

Rate: getListingsItem and patchListingsItem each allow ~5 a second — sent 5 SKUs at a time, with a pause.
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');
const sp = require('./amzSpApi');
const { isConfigured } = require('./amzStockSync');
const { AMZ_PENDING_HOURS } = require('./amzNow');
const logger = require('./logger');

const BATCH = 5;

/** The latest pending price per SKU (the basket's own rule), optionally only these codes. */
async function pendingRows(codes) {
  const res = await query(`
    SELECT DISTINCT ON (l.code) l.id, l.code, a.sku AS amz_sku, l.new_price
      FROM amz_price_log l
      LEFT JOIN amzfeed a ON a.code = l.code
     WHERE l.uploaded_at IS NULL
       AND l.changed_at >= now() - make_interval(hours => $1::int)
       AND ROUND(l.new_price, 2) IS DISTINCT FROM ROUND(${safeNumeric('a.amzprice')}, 2)
       AND ($2::text[] IS NULL OR l.code = ANY($2::text[]))
     ORDER BY l.code, l.id DESC`, [AMZ_PENDING_HOURS, codes && codes.length ? codes : null]);
  return res.rows.map((r) => ({ id: r.id, code: r.code, amzSku: r.amz_sku, price: Math.round(Number(r.new_price) * 100) / 100 }));
}

/** One SKU: read the offer, replace only our_price. Returns { ok, message }. */
async function sendOne(row) {
  if (!row.amzSku) return { ok: false, message: 'No Amazon SKU for this size' };
  const mkt = sp.marketplaceId();
  const path = `/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(row.amzSku)}`;
  try {
    const item = await sp.spGet(path, { marketplaceIds: mkt, includedData: 'summaries,attributes' });
    const productType = ((item.summaries || [])[0] || {}).productType;
    if (!productType) return { ok: false, message: 'Amazon has no listing for this SKU' };
    const offers = (item.attributes && item.attributes.purchasable_offer) || [];
    const consumer = offers.find((o) => !o.audience || o.audience === 'ALL');
    const ourPrice = [{ schedule: [{ value_with_tax: row.price }] }];
    const value = consumer
      ? offers.map((o) => (o === consumer ? { ...o, our_price: ourPrice } : o))
      : [...offers, { marketplace_id: mkt, currency: 'GBP', audience: 'ALL', our_price: ourPrice }];
    const res = await sp.spPatch(path, { productType, patches: [{ op: 'replace', path: '/attributes/purchasable_offer', value }] },
      { marketplaceIds: mkt });
    const errors = (res.issues || []).filter((x) => x.severity === 'ERROR');
    if (res.status === 'ACCEPTED' && errors.length === 0) return { ok: true };
    return { ok: false, message: errors.map((x) => x.message).join(' · ') || `Amazon: ${res.status}` };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

/**
 * Send pending Amazon prices. codes = only these SKUs (null = everything pending). who = the operator, or 'cron'.
 * Returns { sent: [{ code, price }], failed: [{ code, price, message }], skipped } — skipped = 'not configured'.
 * Never throws for a refused price; a DB failure stamping the sent rows does throw.
 */
async function pushAmzPrices({ codes = null, who }) {
  if (!isConfigured()) return { sent: [], failed: [], skipped: 'Amazon API not configured' };
  const rows = await pendingRows(codes);
  const sent = [];
  const failed = [];
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(sendOne));
    batch.forEach((r, k) => {
      if (results[k].ok) sent.push(r);
      else failed.push({ code: r.code, price: r.price, message: results[k].message });
    });
    if (i + BATCH < rows.length) await sp.sleep(1100);
  }

  if (sent.length) {
    // The sent row and every OLDER pending row of the same SKU — the same stamp as routes/amz-mark-uploaded.js.
    await query(`
      UPDATE amz_price_log u SET uploaded_at = now(), uploaded_by = $3
        FROM (SELECT UNNEST($1::text[]) AS code, UNNEST($2::int[]) AS max_id) f
       WHERE u.code = f.code AND u.id <= f.max_id AND u.uploaded_at IS NULL`,
      [sent.map((r) => r.code), sent.map((r) => r.id), String(who || 'cron')]);
  }
  if (failed.length) logger.error(`[amzPricePush] not sent: ${failed.map((f) => `${f.code} £${f.price.toFixed(2)}: ${f.message}`).join(' | ')}`);
  return { sent: sent.map((r) => ({ code: r.code, price: r.price })), failed, skipped: null };
}

module.exports = { pushAmzPrices };
