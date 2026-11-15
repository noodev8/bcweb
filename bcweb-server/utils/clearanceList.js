/*
=======================================================================================================================================
Util: clearanceList  (THE copy of what the Clearance screen shows — owner 2026-11-15, docs/stock-ladder.md → "The Clearance screen")
=======================================================================================================================================
Purpose: Range's step 5 box (Clearance) opens its own screen (/analytics/slow-sizes/clearance), not the Amazon-only step list. ONE list,
         one row per SKU, the three channels side by side (owner: "yes, one list with the three channels"). This util gathers, for
         every SKU on step 5 (utils/stockLadder.js — THE ladder), what each channel says about it, in one read.

WHO: every SKU on step 5, ANY brand, any place the pairs sit (Decision 1). Nothing is left out — a channel that can't sell a SKU says
         why on the row instead (never hidden).

EACH CHANNEL (independent — changing one never touches another):
  shopify  the style price, the size's own price when one is ACTIVE (utils/sizePrice.js → ACTIVE_SQL, THE copy), the style's review
           date, and whether the style is live on Shopify (skusummary.shopify = 1). The screen's button is ALWAYS a size price
           (Decision 3) — POST /pricing-size-price-set.
  amazon   only with pairs live at FBA (amzfeed.amzlive > 0) — else open:false, and `listed` says why: an amzfeed row with nothing at
           FBA ("listed · none at FBA") or no row at all ("not listed by us"). `listable` = not listed by us AND not Birkenstock (owner,
           2026-11-15, as AMZ loaded) — the sizes the screen may look up and List on Amazon. Price + the size's review date
           (skumap.next_amz_price_review). Read only on this screen: ONE button sends the lot to the step cards (Decision 6).
  ebay     'never' for Birkenstock (brand ILIKE 'birk%' — the eBay rule, as utils/ebayCandidates.js); 'on' when the size is on a LIVE
           BCWEB listing (its own price, else the listing's); 'style' when the style is listed but this size isn't on it (Update
           Orders adds in-stock sizes by itself); else 'could' (List opens the eBay listing form for the whole style — Decision 4).
           No take-off here (Decision 5).

ORDER (Decision 9): longest unsold first, as every Stock ladder list — a style ranks by its longest-waiting size, sizes in size order.

READ ONLY.
=======================================================================================================================================
Exports:
  loadClearanceList() -> { today, rows: [{ code, groupid, size, title, ean, brand, units, idle_days, last_sale,
                                           cost, rrp,
                                           shopify: { live, style_price, size_price, review },
                                           amazon:  { open, listed, listable, fba, price, review },
                                           ebay:    { state: 'never'|'on'|'style'|'could', price, item_id } }] }
=======================================================================================================================================
*/

const { query } = require('../database');
const { readStockLadder } = require('./stockLadder');
const { ACTIVE_SQL } = require('./sizePrice');
const { safeNumeric } = require('./sql');

const CLEARANCE_STEP = 5;

const sizeKey = (code) => {
  const s = code.slice(code.lastIndexOf('-') + 1);
  return /^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : Infinity;
};
const num = (v) => (v === null || v === undefined ? null : Number(v));

async function loadClearanceList() {
  const { today, skus } = await readStockLadder();
  const onStep = skus.filter((s) => s.step === CLEARANCE_STEP);
  if (onStep.length === 0) return { today, rows: [] };

  // One read for every channel. skumap can hold 2+ rows per code — DISTINCT ON keeps one (the review date is per code).
  const r = await query(`
    WITH c AS (SELECT DISTINCT ON (m.code) m.code, m.groupid, m.next_amz_price_review
                 FROM skumap m WHERE m.code = ANY($1::text[]) AND COALESCE(m.deleted, 0) = 0
                ORDER BY m.code, m.next_amz_price_review DESC NULLS LAST)
    SELECT c.code, c.groupid,
           SUBSTRING(c.code FROM '[^-]*$')                              AS size,
           COALESCE(t.shopifytitle, c.groupid)                          AS title,
           ss.brand,
           COALESCE(ss.brand, '') ILIKE 'birk%'                         AS birk,
           ${safeNumeric('ss.cost')}                                    AS cost,
           ${safeNumeric('ss.rrp')}                                     AS rrp,
           ${safeNumeric('ss.shopifyprice')}                            AS style_price,
           COALESCE(ss.shopify, 0) = 1                                  AS shopify_live,
           ss.next_shopify_price_review::text                           AS shopify_review,
           sp.price                                                     AS size_price,
           COALESCE(af.fba, 0)::int                                     AS fba,
           af.amzprice                                                  AS amz_price,
           c.next_amz_price_review::text                                AS amz_review,
           af.listed                                                    AS amz_listed,
           (SELECT MAX(NULLIF(regexp_replace(TRIM(COALESCE(z.ean, '')), 'B$', ''), '')) FROM skumap z WHERE z.code = c.code) AS ean,
           el.item_id                                                   AS ebay_item,
           COALESCE(els.price, el.price)                                AS ebay_price,
           els.code IS NOT NULL                                         AS on_ebay
      FROM c
      LEFT JOIN skusummary ss ON ss.groupid = c.groupid
      LEFT JOIN title t       ON t.groupid  = c.groupid
      LEFT JOIN (${ACTIVE_SQL}) sp ON sp.code = c.code
      LEFT JOIN LATERAL (SELECT MAX(a.amzlive) FILTER (WHERE a.amzlive > 0) AS fba, MAX(${safeNumeric('a.amzprice')}) AS amzprice,
                                COUNT(*) > 0 AS listed
                           FROM amzfeed a WHERE a.code = c.code) af ON true
      LEFT JOIN LATERAL (SELECT e.id, e.item_id, e.price FROM ebay_listing e
                          WHERE e.groupid = c.groupid AND e.ended_at IS NULL ORDER BY e.listed_at DESC LIMIT 1) el ON true
      LEFT JOIN ebay_listing_size els ON els.ebay_listing_id = el.id AND els.code = c.code`,
  [onStep.map((s) => s.code)]);
  const info = new Map(r.rows.map((x) => [x.code, x]));

  const rows = [];
  for (const s of onStep) {
    const x = info.get(s.code);
    if (!x) continue;   // deleted from skumap since the ladder read — nothing to price
    const fba = Number(x.fba) || 0;
    rows.push({
      code: s.code,
      groupid: x.groupid,
      size: x.size,
      title: x.title,
      ean: x.ean || null,
      brand: x.brand || null,
      units: s.units,
      idle_days: s.idle_days,
      last_sale: s.last_sale || null,
      cost: num(x.cost),
      rrp: num(x.rrp),
      shopify: { live: x.shopify_live, style_price: num(x.style_price), size_price: num(x.size_price), review: x.shopify_review },
      // listable: not listed by us yet and not Birkenstock — List on Amazon / Look up / Could go on Amazon (owner, 2026-11-15:
      // "exclude Birkenstock", as AMZ loaded).
      amazon: { open: fba > 0, listed: !!x.amz_listed, listable: !x.amz_listed && !x.birk, fba, price: num(x.amz_price), review: x.amz_review },
      ebay: {
        state: x.birk ? 'never' : x.on_ebay ? 'on' : x.ebay_item ? 'style' : 'could',
        price: x.on_ebay ? num(x.ebay_price) : null,
        item_id: x.ebay_item || null,
      },
    });
  }

  // ORDER: a style's weight = its longest wait; heaviest first; sizes in size order.
  const weight = new Map();
  for (const x of rows) weight.set(x.groupid, Math.max(weight.get(x.groupid) || 0, x.idle_days));
  rows.sort((a, b) => (weight.get(b.groupid) - weight.get(a.groupid)) || a.groupid.localeCompare(b.groupid)
    || (sizeKey(a.code) - sizeKey(b.code)) || a.code.localeCompare(b.code));

  return { today, rows };
}

module.exports = { loadClearanceList };
