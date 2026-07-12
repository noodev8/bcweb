/*
=======================================================================================================================================
API Route: analytics_stock_position_list
=======================================================================================================================================
Method: GET
Purpose: Analytics module — Stock Position DRILL. The panels show four bucket COUNTS per channel; this returns the actual PRODUCTS
         behind one bucket, so the operator can see (and later act on) what's in it — above all the DORMANT pile (gone quiet: no stock,
         no recent sale) they want to price / restock / remove / park.

         Uses the SAME bucket definitions as the counts (utils/stockPosition.js) so the list length matches the number on the panel:
           - "in stock now": Shopify = localstock #FREE qty>0; Amazon = amzfeed.amzlive > 0.
           - "sold recently": a SHP/AMZ sale within the shared SALES_WINDOW (matched by groupid / code).
           bucket = in_stock_selling | in_stock_no_sale | oos_sold_recently | dormant.

         Grain matches the channel: Shopify = STYLE (groupid), Amazon = SKU (code). Each row carries the human title, current price,
         current stock and the last-sold date (how long it's been quiet — the key fact for the dormant list). Ordered most-stock-first,
         then most-recently-sold — so within dormant (all zero stock) the freshly-quiet float above the long-dead.

Schema landmines respected: stock from localstock #FREE (never stockvariants); price via safeNumeric; human name from title.shopifytitle;
size = RIGHT(code,2). Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, required)  - 'SHP' | 'AMZ'
  bucket  (string, required)  - in_stock_selling | in_stock_no_sale | oos_sold_recently | dormant

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "SHP",
  "bucket": "dormant",
  "count": 34,
  "rows": [
    // Shopify: { "groupid": "...", "title": "...", "price": 36.95, "stock": 0, "last_sold": "2025-11-02" }
    // Amazon:  { "code": "...-38", "groupid": "...", "size": "38", "title": "...", "price": 37.99, "stock": 0, "last_sold": null }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // missing/invalid channel or bucket
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { SALES_WINDOW } = require('../utils/stockPosition');   // shared recency window, so the drill matches the counts exactly
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Format a pg 'date' as YYYY-MM-DD from local components (avoids a UTC day-shift). null-safe.
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Whitelist the bucket -> the boolean condition over the `instock`/`sold` flags computed in the base CTE. Whitelisted (not
// interpolated from user text) so there's no injection surface — an unknown bucket is rejected before any SQL runs.
const BUCKET_COND = {
  in_stock_selling: 'instock AND sold',
  in_stock_no_sale: 'instock AND NOT sold',
  oos_sold_recently: '(NOT instock) AND sold',
  dormant: '(NOT instock) AND NOT sold',
};

router.get('/', async (req, res) => {
  try {
    const channel = String(req.query.channel || '').toUpperCase();
    const bucket = String(req.query.bucket || '');
    if ((channel !== 'SHP' && channel !== 'AMZ') || !BUCKET_COND[bucket]) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'channel (SHP|AMZ) and a valid bucket are required' });
    }
    const cond = BUCKET_COND[bucket];

    let rows;
    if (channel === 'SHP') {
      // Shopify — STYLE grain. Base CTE computes stock, the instock/sold flags and last-sold; the outer WHERE picks the bucket.
      const result = await query(`
        WITH stk AS (
          SELECT groupid, SUM(qty) AS stock FROM localstock
          WHERE ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
          GROUP BY groupid
        ),
        sold6 AS (
          SELECT DISTINCT groupid FROM sales
          WHERE channel='SHP' AND solddate >= CURRENT_DATE - INTERVAL '${SALES_WINDOW}'
        ),
        lastsold AS (
          SELECT groupid, MAX(solddate) AS last_sold FROM sales WHERE channel='SHP' AND qty>0 GROUP BY groupid
        ),
        base AS (
          SELECT ss.groupid,
                 t.shopifytitle AS title,
                 ${safeNumeric('ss.shopifyprice')} AS price,
                 COALESCE(st.stock,0) AS stock,
                 (COALESCE(st.stock,0) > 0) AS instock,
                 (s6.groupid IS NOT NULL) AS sold,
                 ls.last_sold
          FROM skusummary ss
          LEFT JOIN stk st      ON st.groupid = ss.groupid
          LEFT JOIN sold6 s6    ON s6.groupid = ss.groupid
          LEFT JOIN lastsold ls ON ls.groupid = ss.groupid
          LEFT JOIN title t     ON t.groupid  = ss.groupid
          WHERE ss.shopify = 1
        )
        SELECT groupid, title, price, stock, last_sold
        FROM base
        WHERE ${cond}
        ORDER BY stock DESC, last_sold DESC NULLS LAST, groupid
      `);
      rows = result.rows.map((r) => ({
        groupid: r.groupid,
        title: r.title || null,
        price: num(r.price),
        stock: Number(r.stock),
        last_sold: toIsoDate(r.last_sold),
      }));
    } else {
      // Amazon — SKU grain. Universe = every amzfeed row (matches the count). Stock = amzlive.
      const result = await query(`
        WITH sold6 AS (
          SELECT DISTINCT code FROM sales
          WHERE channel='AMZ' AND solddate >= CURRENT_DATE - INTERVAL '${SALES_WINDOW}'
        ),
        lastsold AS (
          SELECT code, MAX(solddate) AS last_sold FROM sales WHERE channel='AMZ' AND qty>0 GROUP BY code
        ),
        base AS (
          SELECT a.code, a.groupid, RIGHT(a.code,2) AS size,
                 t.shopifytitle AS title,
                 ${safeNumeric('a.amzprice')} AS price,
                 COALESCE(a.amzlive,0) AS stock,
                 (COALESCE(a.amzlive,0) > 0) AS instock,
                 (s6.code IS NOT NULL) AS sold,
                 ls.last_sold
          FROM amzfeed a
          LEFT JOIN sold6 s6    ON s6.code = a.code
          LEFT JOIN lastsold ls ON ls.code = a.code
          LEFT JOIN title t     ON t.groupid = a.groupid
        )
        SELECT code, groupid, size, title, price, stock, last_sold
        FROM base
        WHERE ${cond}
        ORDER BY stock DESC, last_sold DESC NULLS LAST, code
      `);
      rows = result.rows.map((r) => ({
        code: r.code,
        groupid: r.groupid,
        size: r.size,
        title: r.title || null,
        price: num(r.price),
        stock: Number(r.stock),
        last_sold: toIsoDate(r.last_sold),
      }));
    }

    return res.json({ return_code: 'SUCCESS', channel, bucket, count: rows.length, rows });
  } catch (err) {
    logger.error('[analytics-stock-position-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load bucket list' });
  }
});

module.exports = router;
