/*
=======================================================================================================================================
API Route: images_missing
=======================================================================================================================================
Method: GET
Purpose: The Missing Images screen (Back Office) — every product live on Shopify with how many images WE hold (product_images), so staff
         can work through the single-image ones. Plan + rules: docs/product-images-plan.md (owner, 2026-10-13).

         "Done" = >= MIN_IMAGES (2) images. Main size is NOT part of it: low_res_main (main < 1500 px) is an optional filter only —
         existing 800 mains stay live and are replaced only when someone sources new pictures anyway. The whole list is returned
         (~300 rows) and filtered client-side; the counts in `summary` cover the whole list.

         shopify_count = media on the live Shopify product (one cheap products query). shopify_count > image_count means images were
         added in the Shopify UI that we don't hold ("Added in Shopify") — a push keeps them, but they belong in BCWEB; re-running
         scripts/import-shopify-galleries.js brings them in. If Shopify can't be reached the screen still works (shopify_count null).
         Requires auth.
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "min_images": 2,
  "min_main_side": 1500,
  "summary": { "products": 294, "single": 229, "single_in_stock": 173, "done_today": 3, "added_in_shopify": 0, "shopify_ok": true },
  "rows": [
    { "groupid": "0051791-ARIZONA", "title": "Birkenstock Arizona …", "brand": "Birkenstock", "imagename": "….jpg",
      "status": "WINNERS", "stock": 12, "image_count": 1, "main_side": 800, "low_res_main": true, "done": false,
      "added_today": false, "shopify_count": 1 }
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
const { verifyToken } = require('../middleware/verifyToken');
const { shopifyGraphQL, isConfigured } = require('../utils/shopify');
const { isDone, isLowResMain, MIN_IMAGES, MIN_MAIN_SIDE } = require('../utils/productImage');
const logger = require('../utils/logger');

// Media count per handle, straight from Shopify (250 a page — the store is ~300 products, so two calls). null on any failure.
async function shopifyMediaCounts() {
  if (!isConfigured()) return null;
  try {
    const counts = new Map();
    let after = null;
    do {
      const d = await shopifyGraphQL(`
        query($after: String) { products(first: 250, after: $after) {
          pageInfo { hasNextPage endCursor } nodes { handle mediaCount { count } } } }
      `, { after });
      for (const p of d.products.nodes) counts.set(p.handle, p.mediaCount.count);
      after = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
    } while (after);
    return counts;
  } catch (err) {
    logger.error('[images-missing] Shopify media counts failed:', err.message);
    return null;
  }
}

router.get('/', verifyToken, async (req, res) => {
  try {
    // added_today: a staff-added extra image today (London date) — the "done today" counter. Import rows don't count.
    const [db, counts] = await Promise.all([
      query(`
        SELECT ss.groupid, ss.handle, t.shopifytitle AS title, ss.brand, ss.imagename, ss.portfolio_status AS status,
               COALESCE(st.units, 0)::int AS stock,
               COALESCE(pi.n, 0)::int AS image_count,
               GREATEST(m.width, m.height) AS main_side,
               COALESCE(pi.added_today, false) AS added_today
        FROM skusummary ss
        LEFT JOIN title t ON t.groupid = ss.groupid
        LEFT JOIN (
          SELECT groupid, SUM(qty) AS units FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0 GROUP BY groupid
        ) st ON st.groupid = ss.groupid
        LEFT JOIN (
          SELECT groupid, COUNT(*) AS n,
                 BOOL_OR(position > 1 AND COALESCE(created_by, '') <> 'import'
                         AND (created_at AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date) AS added_today
          FROM product_images GROUP BY groupid
        ) pi ON pi.groupid = ss.groupid
        LEFT JOIN product_images m ON m.groupid = ss.groupid AND m.position = 1
        WHERE ss.shopify = 1
        ORDER BY ss.groupid
      `),
      shopifyMediaCounts()
    ]);

    const rows = db.rows.map((r) => {
      // A product with a main file but no rows yet (not seeded) still has one image.
      const imageCount = r.image_count || (r.imagename ? 1 : 0);
      const shopifyCount = counts ? (counts.has(r.handle) ? counts.get(r.handle) : null) : null;
      return {
        groupid: r.groupid, title: r.title, brand: r.brand, imagename: r.imagename, status: r.status, stock: r.stock,
        image_count: imageCount,
        main_side: r.main_side === null ? null : Number(r.main_side),
        low_res_main: isLowResMain(r.main_side),
        done: isDone(imageCount),
        added_today: r.added_today,
        shopify_count: shopifyCount
      };
    });

    const summary = {
      products: rows.length,
      single: rows.filter((r) => !r.done).length,
      single_in_stock: rows.filter((r) => !r.done && r.stock > 0).length,
      done_today: rows.filter((r) => r.added_today && r.done).length,
      added_in_shopify: rows.filter((r) => r.shopify_count !== null && r.shopify_count > r.image_count).length,
      shopify_ok: counts !== null
    };

    return res.json({ return_code: 'SUCCESS', min_images: MIN_IMAGES, min_main_side: MIN_MAIN_SIDE, summary, rows });
  } catch (err) {
    logger.error('[images-missing] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the missing images list' });
  }
});

module.exports = router;
