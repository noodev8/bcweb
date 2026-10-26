/*
=======================================================================================================================================
API Route: amz_loaded_list
=======================================================================================================================================
Method: GET
Purpose: The AMZ loaded screen (owner, 2026-10-26 — Daily on the dashboard): every style held locally that has NOT been loaded to
         Amazon — no size of it in amzfeed (no SKU / FNSKU there; amzfeed carries every FBA listing, 0-stock ones included) — so the
         team can decide whether to list it. Birkenstock is left out ("obvs dont include birk" — it can't go on Amazon).

         Membership: skusummary style with sellable local stock (localstock #FREE — CLAUDE.md, never stockvariants), brand not
         Birkenstock, and NOT EXISTS an amzfeed row for its groupid.

         Each row: the style, its local stock (units / sizes held), Shopify price and RRP, Shopify units sold in 90 days (how it does
         where it is), and its review date — skusummary.next_amz_load_review, stamped by POST /amz-loaded-review ("looked at").
         SIZES (2026-10-26, owner: "easy able to check amz ranking ... drop down with the sizes and their barcodes"): every size of
         the style from skumap (deleted ones left out), with its barcode — skumap.ean with the trailing B stripped (CLAUDE.md) — and
         its local stock, sorted numerically by size. The screen searches Amazon by that barcode. Aggregated per style in the same query.
         A future review date = PARKED: dropped unless ?parked=include (the Due switch filters client-side). No limit — the list is
         small (21 styles on 2026-10-26) and is the whole job.

         Order: most local stock first, then groupid.

Requires auth.
=======================================================================================================================================
Request: GET /amz-loaded-list[?parked=include]

Success Response:
{
  "return_code": "SUCCESS",
  "total": 21,
  "rows": [ { "groupid": "…", "title": "…", "brand": "…", "units": 14, "sizes": 6, "price": 59.95, "rrp": 70, "u90": 3,
              "next_review": null, "parked": false,
              "sizes_list": [ { "code": "…-38", "size": "38", "ean": "4066707223001", "local": 2 }, ... ] }, ... ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const includeParked = req.query.parked === 'include';

    const result = await query(`
      WITH stk AS (
        SELECT groupid, SUM(qty) AS units, COUNT(DISTINCT code) AS sizes FROM localstock
        WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY groupid
      ),
      sz AS (
        -- Every live size of the listed styles, its barcode (trailing B stripped) and local stock — one row per style.
        SELECT m.groupid,
               json_agg(json_build_object(
                 'code', m.code,
                 'size', SUBSTRING(m.code FROM '[^-]*$'),
                 'ean', NULLIF(regexp_replace(COALESCE(m.ean, ''), 'B$', ''), ''),
                 'local', COALESCE(l.qty, 0)
               ) ORDER BY
                 CASE WHEN SUBSTRING(m.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN SUBSTRING(m.code FROM '[^-]*$')::numeric END NULLS LAST,
                 m.code) AS sizes_list
        FROM skumap m
        LEFT JOIN (
          SELECT code, SUM(qty) AS qty FROM localstock
          WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
          GROUP BY code
        ) l ON l.code = m.code
        WHERE COALESCE(m.deleted, 0) = 0 AND m.groupid IN (SELECT groupid FROM stk)
        GROUP BY m.groupid
      ),
      sold AS (
        SELECT groupid, SUM(qty) AS u90 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 90
        GROUP BY groupid
      )
      SELECT ss.groupid,
             t.shopifytitle AS title,
             NULLIF(TRIM(ss.brand), '') AS brand,
             st.units, st.sizes,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,
             COALESCE(s.u90, 0) AS u90,
             ss.next_amz_load_review::text AS next_review,                     -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_amz_load_review > CURRENT_DATE, false) AS parked,
             COALESCE(z.sizes_list, '[]'::json) AS sizes_list
      FROM skusummary ss
      JOIN stk st       ON st.groupid = ss.groupid
      LEFT JOIN sold s  ON s.groupid  = ss.groupid
      LEFT JOIN title t ON t.groupid  = ss.groupid
      LEFT JOIN sz z    ON z.groupid  = ss.groupid
      WHERE COALESCE(ss.brand, '') NOT ILIKE 'birk%'
        AND NOT EXISTS (SELECT 1 FROM amzfeed a WHERE a.groupid = ss.groupid)
        AND ($1::boolean OR ss.next_amz_load_review IS NULL OR ss.next_amz_load_review <= CURRENT_DATE)
      ORDER BY st.units DESC, ss.groupid
    `, [includeParked]);

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title || null,
      brand: r.brand || null,
      units: Number(r.units),
      sizes: Number(r.sizes),
      price: num(r.price),
      rrp: num(r.rrp),
      u90: Number(r.u90),
      next_review: r.next_review || null,
      parked: r.parked === true,
      sizes_list: (r.sizes_list || []).map((x) => ({ code: x.code, size: x.size, ean: x.ean || null, local: Number(x.local) || 0 })),
    }));

    return res.json({ return_code: 'SUCCESS', total: rows.length, rows });
  } catch (err) {
    logger.error('[amz-loaded-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the AMZ loaded list' });
  }
});

module.exports = router;
