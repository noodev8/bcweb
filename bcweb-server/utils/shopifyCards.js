/*
=======================================================================================================================================
Util: shopifyCards   (what a SHOPIFY PRICE CARD shows, beyond its list row — owner 2026-11-15, docs/shopify-cards/PLAN.md)
=======================================================================================================================================
Purpose: The Shopify price cards walk the Shopify pricing list one STYLE at a time (decision 4: Shopify prices per style). The list row
         already has the price, RRP, stock, 30-day units and the review date; this adds the rest of the card, for MANY styles in a
         fixed number of queries (no N+1). Called by routes/pricing-all-list.js ?cards=1 — the same membership as the list, so the
         cards can never walk a different set from the one on screen.

What it adds per style:
  imagename, handle            the picture, and the Shopify product link (brookfieldcomfort.com/products/<handle>)
  profit_line                  profit a pair = per_pound * price + at_zero (utils/shopifyProfit.js → profitLine — the one formula)
  amazon_highest               Amazon's DEAREST LIVE size (amzlive > 0) — the owner's floor, SHOWN, never obeyed (CLAUDE.md). The
                               same figure as the drill's amazon_highest.
  last_change                  the last real Shopify price MOVE (holds skipped — new = old), who, and Shopify units sold since that
                               day. Same shape as the Amazon cards' (utils/amzBuyBoxDeck.js → lastChanges), so the card reuses the
                               Amazon "Last change" line. changed_at is NULL on old rows: change_date stands in.
  sizes[]                      every live size (skumap, not deleted), size order: code, size, stock (local free), fba (Amazon live),
                               benchmark (Google's, utils/googleBenchmark.js → CURRENT_SQL; null = none), own_price (a size price in
                               force — utils/sizePrice.js → ACTIVE_SQL; decision 4: always shown on the card), own_kind
                               ('clearance' | 'overstock' — where it was set, docs/overstock/PLAN.md decision 2).
  benchmark_day                the day of the last benchmark read (google_benchmark_run) — one value, on the response, not per row.

Units sold use the list's rule (pricing-all-list: SHP, qty > 0, soldprice > 0) so "sold since" and "sold in 30 days" agree.
=======================================================================================================================================
*/

const { safeNumeric } = require('./sql');
const { profitLine } = require('./shopifyProfit');
const { CURRENT_SQL } = require('./googleBenchmark');
const { ACTIVE_SQL } = require('./sizePrice');

const num = (v) => (v === null || v === undefined ? null : Number(v));

/**
 * @param db        pool query wrapper or a client
 * @param groupids  the styles on the cards
 * @returns { byGroup: { [groupid]: card }, benchmarkDay: 'YYYY-MM-DD' | null }
 */
async function cardDetails(db, groupids) {
  if (!groupids.length) return { byGroup: {}, benchmarkDay: null };

  const [styles, sizes, changes, run] = await Promise.all([
    db.query(
      `SELECT ss.groupid, ss.imagename, NULLIF(TRIM(ss.handle), '') AS handle, ${safeNumeric('ss.cost')} AS cost,
              (SELECT MAX(${safeNumeric('a.amzprice')}) FROM amzfeed a
                WHERE a.groupid = ss.groupid AND COALESCE(a.amzlive, 0) > 0) AS amazon_highest
       FROM skusummary ss WHERE ss.groupid = ANY($1::text[])`, [groupids]),
    db.query(
      `WITH loc AS (
         SELECT code, SUM(qty)::int AS stock FROM localstock
         WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0 AND groupid = ANY($1::text[])
         GROUP BY code
       ),
       fba AS (
         SELECT code, MAX(COALESCE(amzlive, 0))::int AS live FROM amzfeed WHERE groupid = ANY($1::text[]) GROUP BY code
       )
       SELECT m.groupid, m.code, SUBSTRING(m.code FROM '[^-]*$') AS size,
              COALESCE(l.stock, 0) AS stock, COALESCE(f.live, 0) AS fba,
              b.benchmark, sp.price AS own_price, sp.kind AS own_kind
       FROM skumap m
       LEFT JOIN loc l ON l.code = m.code
       LEFT JOIN fba f ON f.code = m.code
       LEFT JOIN (${CURRENT_SQL}) b ON b.code = m.code
       LEFT JOIN (${ACTIVE_SQL}) sp ON sp.code = m.code
       WHERE m.groupid = ANY($1::text[]) AND COALESCE(m.deleted, 0) = 0
       ORDER BY m.groupid,
                CASE WHEN SUBSTRING(m.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN SUBSTRING(m.code FROM '[^-]*$')::numeric END NULLS LAST,
                m.code`, [groupids]),
    db.query(
      `WITH last AS (
         SELECT DISTINCT ON (groupid) groupid, COALESCE(changed_at, change_date::timestamptz) AS changed_at, changed_by,
                old_price::float8 AS old_price, new_price::float8 AS new_price
         FROM price_change_log
         WHERE channel = 'SHP' AND groupid = ANY($1::text[]) AND abs(new_price - old_price) >= 0.005
         ORDER BY groupid, COALESCE(changed_at, change_date::timestamptz) DESC NULLS LAST, id DESC)
       SELECT l.groupid, l.changed_at::text AS changed_at, l.changed_by, l.old_price, l.new_price,
              (SELECT COALESCE(SUM(s.qty), 0) FROM sales s
                WHERE s.channel = 'SHP' AND s.groupid = l.groupid AND s.qty > 0 AND s.soldprice > 0
                  AND s.solddate >= (l.changed_at AT TIME ZONE 'Europe/London')::date)::int AS sold_since
       FROM last l`, [groupids]),
    db.query(`SELECT MAX(day)::text AS day FROM google_benchmark_run`),
  ]);

  const byGroup = {};
  for (const s of styles.rows) {
    byGroup[s.groupid] = {
      imagename: s.imagename || null,
      handle: s.handle || null,
      profit_line: profitLine(s.cost),
      amazon_highest: num(s.amazon_highest),
      last_change: null,
      sizes: [],
    };
  }
  for (const z of sizes.rows) {
    const c = byGroup[z.groupid];
    if (!c) continue;
    c.sizes.push({
      code: z.code, size: z.size, stock: Number(z.stock), fba: Number(z.fba),
      benchmark: num(z.benchmark), own_price: num(z.own_price), own_kind: z.own_kind ?? null,
    });
  }
  for (const x of changes.rows) {
    const c = byGroup[x.groupid];
    if (c) c.last_change = { at: x.changed_at, by: x.changed_by, old_price: x.old_price, new_price: x.new_price, sold_since: x.sold_since };
  }
  return { byGroup, benchmarkDay: run.rows[0]?.day || null };
}

module.exports = { cardDetails };
