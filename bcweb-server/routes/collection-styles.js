/*
=======================================================================================================================================
API Route: collection_styles
=======================================================================================================================================
Method: GET
Purpose: Collections screen — EVERY style the screen can work on, once, with its tags, so the browser can filter with the standard
         Contains / Does not contain steps (no `term` parameter — a few hundred rows, shipped once and narrowed client-side, the
         Inventory pattern). Owner, 2026-10-14: "A simple screen where I can tag/untag based on a set of criteria or filters."

         WHICH STYLES: live on Shopify (skusummary.shopify = 1) OR carrying at least one tag. The second half is the point (owner: "if I
         switched shopify OFF I would still have the tag and not be able to remove it"): switching Shopify off only clears our flag,
         the product stays on the store with its tag, so a tagged style must never drop off this list. A tagged groupid no longer in
         skusummary comes back too (in_bcweb false) so its tag can still be removed.

         SLOW and NEW are the Slow screen's own rule (utils/stockSitting.js, 90 days since 2026-10-14) — read from it, never restated:
           slow = held stock, no sale on any channel in 90 days;   new = held, unsold, created under 90 days ago.
         Both are about held stock, so a style with none is neither.

         PAIRS = local #FREE + Amazon (amzfeed.amztotal), one number — the Slow definition, which the owner wants on these lists. The
         screen's STOCK LESS / MORE command compares this same number (what you see is what you filter).
         SOLD30 = units sold in the last 30 days, all channels, positive sales only — the Inventory definition, for SOLD LESS / MORE.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "rows": [
    {
      "groupid": "1019051-ARIZONA",
      "title": "Birkenstock Arizona …",      // title.shopifytitle; null if none
      "brand": "Birkenstock",                 // null if blank
      "segment": "ARIZONA-GENERAL", "supplier": "BIRKENSTOCK",
      "season": "Summer",                     // 'Summer' | 'Winter' | 'Any' | null
      "codes": "1019051-ARIZONA-36 …",        // internal size codes + Amazon SKUs, space-joined (the Inventory haystack); null if none
      "price": 25.00,                         // safeNumeric(shopifyprice); null if junk
      "pairs": 6,                             // local #FREE + Amazon
      "sold30": 0,
      "created": "20260724 11:07:30",         // created_at, Europe/London, sortable text; '' if unstamped
      "shopify": true,                        // skusummary.shopify = 1
      "in_bcweb": true,                       // false = a tagged groupid no longer in skusummary
      "slow": true, "new": false,
      "tags": ["clearance"]                   // alphabetical, 0-3
    }
  ]
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
const { safeNumeric } = require('../utils/sql');
const { verifyToken } = require('../middleware/verifyToken');
const { loadStockSplit } = require('../utils/stockSitting');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // NB: no backticks anywhere in this SQL — it is a JS template literal, and one would end it mid-query.
    const [result, split] = await Promise.all([
      query(`
        WITH base AS (
          -- Live on Shopify, plus anything tagged (see WHICH STYLES in the header).
          SELECT groupid FROM skusummary WHERE shopify = 1
          UNION
          SELECT groupid FROM collection_member
        ),
        local_free AS (
          SELECT groupid, SUM(qty) AS qty FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid
        ),
        amz AS (
          SELECT groupid, SUM(COALESCE(amztotal, 0)) AS qty FROM amzfeed WHERE groupid IS NOT NULL GROUP BY groupid
        ),
        sold AS (
          SELECT groupid, SUM(qty) AS units FROM sales
          WHERE solddate >= CURRENT_DATE - INTERVAL '30 days' AND qty > 0
          GROUP BY groupid
        ),
        codes AS (
          SELECT groupid,
                 string_agg(code, ' ') || COALESCE(' ' || string_agg(sku, ' ') FILTER (WHERE sku IS NOT NULL), '') AS codes
          FROM skumap GROUP BY groupid
        ),
        tags AS (
          SELECT groupid, array_agg(tag ORDER BY tag) AS tags FROM collection_member GROUP BY groupid
        )
        SELECT b.groupid,
               t.shopifytitle                                   AS title,
               NULLIF(TRIM(ss.brand), '')                       AS brand,
               ss.segment, ss.supplier,
               NULLIF(TRIM(ss.season), '')                      AS season,
               codes.codes,
               ${safeNumeric('ss.shopifyprice')}                AS price,
               COALESCE(lf.qty, 0) + COALESCE(a.qty, 0)         AS pairs,
               COALESCE(sold.units, 0)                          AS sold30,
               COALESCE(to_char(ss.created_at AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS'), '') AS created,
               COALESCE(ss.shopify, 0) = 1                      AS shopify,
               ss.groupid IS NOT NULL                           AS in_bcweb,
               COALESCE(tags.tags, ARRAY[]::varchar[])          AS tags
        FROM base b
        LEFT JOIN skusummary ss ON ss.groupid = b.groupid
        LEFT JOIN title t       ON t.groupid  = b.groupid
        LEFT JOIN local_free lf ON lf.groupid = b.groupid
        LEFT JOIN amz a         ON a.groupid  = b.groupid
        LEFT JOIN sold          ON sold.groupid = b.groupid
        LEFT JOIN codes         ON codes.groupid = b.groupid
        LEFT JOIN tags          ON tags.groupid = b.groupid
        ORDER BY ss.created_at DESC NULLS LAST, b.groupid
      `),
      loadStockSplit(),
    ]);

    const slow = new Set(split.styles.map((s) => s.groupid));
    const isNew = new Set(split.new_ids);

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title || null,
      brand: r.brand || null,
      segment: r.segment || null,
      supplier: r.supplier || null,
      season: r.season || null,
      codes: r.codes || null,
      price: r.price === null ? null : Number(r.price),
      pairs: Number(r.pairs) || 0,
      sold30: Number(r.sold30) || 0,
      created: r.created,
      shopify: !!r.shopify,
      in_bcweb: !!r.in_bcweb,
      slow: slow.has(r.groupid),
      new: isNew.has(r.groupid),
      tags: r.tags || [],
    }));

    return res.json({ return_code: 'SUCCESS', rows });
  } catch (err) {
    logger.error('[collection-styles] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load styles' });
  }
});

module.exports = router;
