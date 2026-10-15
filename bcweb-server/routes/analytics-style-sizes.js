/*
=======================================================================================================================================
API Route: analytics_style_sizes
=======================================================================================================================================
Method: GET
Purpose: Slow Sizes -> click a style (its own screen, /analytics/slow-sizes/[groupid]): every size of that style, with its stock and when it last sold. Owner, 2026-10-15: "drill down
         further when clicking on a style size and seeing all of its sizes and the last time each size sold and stock remaining."
         So a stuck size can be read against its neighbours — one dead 46 in a run that sells, or a whole tail that has stopped.

         ALL SIZES: the full range from skumap (one row per variant, CLAUDE.md), 0-stock sizes included — a sold-out neighbour is part
         of the picture. Stock = local #FREE not deleted + amzfeed.amztotal, one number (same as Slow Sizes). Last sale = any channel,
         qty > 0 (a return is not a sale), same as Slow Sizes. Sizes sort numerically (CLAUDE.md: suffix after the last dash).
         On shelf = days since the oldest held pair arrived (utils/onShelf.js, before the log = 31 Dec 2024); null at 0 stock.

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request: GET /analytics-style-sizes?groupid=0034791-MILANO

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0034791-MILANO",
  "title": "Birkenstock Milano …" | null, "brand": "Birkenstock" | null,
  "sizes": [ { "code": "0034791-MILANO-35", "size": "35", "units": 5, "last_sale": "2025-08-02" | null, "idle_days": 439 | null,
               "on_shelf_days": 289 | null,   // null = none held
               "sold_12m": 0 } ]     // sold_12m = this size, last 12 months, net of returns
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"     groupid not given
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const logger = require('../utils/logger');
const { oldestHeldArrival } = require('../utils/onShelf');

router.use(verifyToken);

const SQL = `
  WITH codes AS (
    SELECT DISTINCT code FROM skumap WHERE groupid = $1 AND code IS NOT NULL
  ),
  held AS (
    SELECT code, SUM(q)::int AS units FROM (
      SELECT code, qty AS q FROM localstock
      WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE' AND code IN (SELECT code FROM codes)
      UNION ALL
      SELECT code, amztotal FROM amzfeed WHERE code IN (SELECT code FROM codes)
    ) x GROUP BY code
  ),
  sold AS (
    SELECT code,
           MAX(solddate) FILTER (WHERE qty > 0) AS d,
           COALESCE(SUM(qty) FILTER (WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 365), 0)::int AS sold_12m
    FROM sales WHERE code IN (SELECT code FROM codes)
    GROUP BY code
  )
  SELECT c.code, SUBSTRING(c.code FROM '[^-]*$') AS size,
         GREATEST(COALESCE(h.units, 0), 0) AS units,
         to_char(s.d, 'YYYY-MM-DD') AS last_sale,
         (now() AT TIME ZONE 'Europe/London')::date - s.d AS idle_days,
         to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS today,
         COALESCE(s.sold_12m, 0) AS sold_12m
  FROM codes c
  LEFT JOIN held h ON h.code = c.code
  LEFT JOIN sold s ON s.code = c.code
  ORDER BY CASE WHEN SUBSTRING(c.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$'
                THEN SUBSTRING(c.code FROM '[^-]*$')::numeric END NULLS LAST,
           c.code
`;

router.get('/', async (req, res) => {
  const groupid = String(req.query.groupid || '').trim();
  if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
  try {
    const [r, metaQ] = await Promise.all([
      query(SQL, [groupid]),
      query(`SELECT t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand
             FROM skusummary ss LEFT JOIN title t ON t.groupid = ss.groupid WHERE ss.groupid = $1`, [groupid]),
    ]);
    const meta = metaQ.rows[0] || {};
    const shelf = await oldestHeldArrival(new Map(r.rows.map((x) => [x.code, Number(x.units)])));
    // Whole days between two 'YYYY-MM-DD' strings, in UTC so BST never shifts a day.
    const day = (v) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
    const sizes = r.rows.map((x) => ({
      code: x.code,
      size: x.size,
      units: Number(x.units),
      last_sale: x.last_sale,
      idle_days: x.idle_days === null ? null : Number(x.idle_days),
      on_shelf_days: shelf.has(x.code) ? day(x.today) - day(shelf.get(x.code)) : null,
      sold_12m: Number(x.sold_12m),
    }));
    return res.json({ return_code: 'SUCCESS', groupid, title: meta.title || null, brand: meta.brand || null, sizes });
  } catch (err) {
    logger.error('[analytics-style-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the sizes' });
  }
});

module.exports = router;
