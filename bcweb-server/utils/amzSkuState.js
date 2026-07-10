/*
=======================================================================================================================================
Module: utils/amzSkuState.js
=======================================================================================================================================
Purpose: The single shared "per-SKU state" query for the Amazon Pricing module. Both read endpoints use it:
  - GET /amz-skus     — one SKU per row for the chosen segment (or all managed), classified into a suggested move.
  - GET /amz-segments — runs it across ALL managed SKUs to count 🟢+🟡 per segment for the chip badges.
Keeping the SQL in one place means the list and the chip counts can never drift apart.

This is a direct adaptation of AMZ_FULL_REVIEW.md Step-1 query A. Schema landmines respected:
  - amzfeed is FBA-only and READ ONLY (refreshed nightly from Amazon — never write it). amzprice/fbafee are `character varying` junk-
    prone columns → read via safeNumeric (a bare ::numeric throws on rows like 'RRP'). amzlive/amztotal are real integers.
  - Current sellable FBA stock = amzlive; inbound = amztotal - amzlive.
  - "Managed" = an amzfeed row whose skusummary.segment is a real (non-empty) segment. The junk NULL/'' segment rows are excluded.
  - Sales are channel='AMZ' only; qty<0 is a return; last-sold ignores returns (qty>0).
  - Size = RIGHT(code,2) (EU size, by design).
=======================================================================================================================================
*/

const { query } = require('../database');
const { safeNumeric } = require('./sql');

// segment: a specific skusummary.segment to scope to, or null/undefined for every managed SKU.
// Returns raw DB rows (numeric columns come back as strings — the caller coerces before classifying).
async function getSkuState(segment) {
  const seg = segment || null;

  const sql = `
    WITH sales_7d AS (
      SELECT code, SUM(CASE WHEN qty>0 THEN qty ELSE 0 END)::int AS sold_7d
      FROM sales WHERE channel='AMZ' AND solddate >= CURRENT_DATE - 7
      GROUP BY code
    ),
    sales_14d AS (
      SELECT code,
             SUM(CASE WHEN qty>0 THEN qty ELSE 0 END)::int AS sold_14d,
             SUM(CASE WHEN qty<0 THEN ABS(qty) ELSE 0 END)::int AS returns_14d
      FROM sales WHERE channel='AMZ' AND solddate >= CURRENT_DATE - 14
      GROUP BY code
    ),
    last_sale AS (
      SELECT code, MAX(solddate) AS last_sold
      FROM sales WHERE channel='AMZ' AND qty>0
      GROUP BY code
    ),
    last_change AS (   -- most recent price move per SKU, with its direction
      SELECT DISTINCT ON (code) code, log_date, old_price, new_price,
             CASE WHEN new_price>old_price THEN 'creep'
                  WHEN new_price<old_price THEN 'drop' ELSE 'flat' END AS last_direction
      FROM amz_price_log ORDER BY code, id DESC
    ),
    sold_since_change AS (   -- units sold AFTER that last change (0 = the move didn't move anything → REVERT candidate)
      SELECT s.code, SUM(CASE WHEN s.qty>0 THEN s.qty ELSE 0 END)::int AS sold_post
      FROM sales s JOIN last_change lc ON s.code = lc.code
      WHERE s.channel='AMZ' AND s.solddate > lc.log_date
      GROUP BY s.code
    )
    SELECT
      a.code, a.groupid, sk.segment, a.sku AS amz_sku,
      RIGHT(a.code, 2) AS size,
      t.shopifytitle AS title,
      ${safeNumeric('a.amzprice')} AS current_price,
      ${safeNumeric('sk.cost')}    AS cost,
      ${safeNumeric('sk.rrp')}     AS rrp,
      ${safeNumeric('a.fbafee')}   AS fbafee,
      COALESCE(a.amzlive, 0)  AS fba_live,
      COALESCE(a.amztotal, 0) AS fba_total,
      GREATEST(COALESCE(a.amztotal, 0) - COALESCE(a.amzlive, 0), 0) AS fba_inbound,
      COALESCE(s7.sold_7d, 0)      AS sold_7d,
      COALESCE(s14.sold_14d, 0)    AS sold_14d,
      COALESCE(s14.returns_14d, 0) AS returns_14d,
      to_char(ls.last_sold, 'YYYY-MM-DD') AS last_sold,   -- format in SQL so the client gets a clean ISO string, not a JS Date
      (CURRENT_DATE - ls.last_sold)::int AS days_since_sale,
      lc.log_date AS last_change_date,
      (CURRENT_DATE - lc.log_date)::int  AS days_since_change,
      lc.last_direction,
      lc.old_price AS pre_change_price,
      COALESCE(scc.sold_post, 0) AS sold_since_change
    FROM amzfeed a
    JOIN skusummary sk ON a.groupid = sk.groupid
    LEFT JOIN title t              ON t.groupid  = a.groupid
    LEFT JOIN sales_7d  s7         ON a.code = s7.code
    LEFT JOIN sales_14d s14        ON a.code = s14.code
    LEFT JOIN last_sale ls         ON a.code = ls.code
    LEFT JOIN last_change lc        ON a.code = lc.code
    LEFT JOIN sold_since_change scc ON a.code = scc.code
    WHERE sk.segment IS NOT NULL AND sk.segment <> ''
      AND ($1::text IS NULL OR sk.segment = $1)
    ORDER BY sk.segment, a.code
  `;

  const result = await query(sql, [seg]);
  return result.rows;
}

// Coerce one raw DB row's numeric text columns to Number|null, ready for classify(). Integer columns are already numbers.
function num(v) {
  return v == null ? null : Number(v);
}
function coerce(r) {
  return {
    code: r.code,
    groupid: r.groupid,
    segment: r.segment,
    amz_sku: r.amz_sku,
    size: r.size,
    title: r.title || null,
    current_price: num(r.current_price),
    cost: num(r.cost),
    rrp: num(r.rrp),
    fbafee: num(r.fbafee),
    fba_live: Number(r.fba_live),
    fba_total: Number(r.fba_total),
    fba_inbound: Number(r.fba_inbound),
    sold_7d: Number(r.sold_7d),
    sold_14d: Number(r.sold_14d),
    returns_14d: Number(r.returns_14d),
    last_sold: r.last_sold || null,   // already 'YYYY-MM-DD' from to_char (or null)
    days_since_sale: r.days_since_sale == null ? null : Number(r.days_since_sale),
    days_since_change: r.days_since_change == null ? null : Number(r.days_since_change),
    last_direction: r.last_direction || null,
    pre_change_price: num(r.pre_change_price),
    sold_since_change: Number(r.sold_since_change),
  };
}

module.exports = { getSkuState, coerce };
