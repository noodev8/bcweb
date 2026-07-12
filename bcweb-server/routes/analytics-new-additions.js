/*
=======================================================================================================================================
API Route: analytics_new_additions
=======================================================================================================================================
Method: GET
Purpose: Analytics module — New Additions. The catalogue-GROWTH pulse: which Shopify styles were CREATED recently (default: added in the
         last 30 days) and how each new addition is performing — units, revenue and profit of its sales so far. Loading this "now and
         again" tells the owner at a glance whether the month brought a lot of new product or a little, and whether the new lines are
         actually selling.

         Grain: Shopify STYLE (skusummary.groupid, live = shopify=1). Creation date lives on skusummary — there is no equivalent for
         Amazon (amzfeed is rebuilt nightly with no birth date), so this is a Shopify-catalogue view by nature.

         Created date: prefer the going-forward `created_at timestamptz` (added for real date logic); fall back to the legacy `created`
         TEXT stamp ('YYYYMMDD HH24:MI:SS', Europe/London) for rows written before created_at existed. A 30-day window only ever catches
         freshly-added rows, which all have created_at — the COALESCE is belt-and-braces so a wider window still behaves.

         Sales figures are LIFETIME (all sales for that style to date). Because these are brand-new products, lifetime ≈ "since it was
         added" — the truest read of how the new line has done. Shopify channel only, positive lines (qty>0, soldprice>0). Matched by
         groupid, aggregated in one grouped join (no N+1). `profit` is the downstream-computed per-line profit summed up. Current stock =
         localstock #FREE (schema landmine: never stockvariants). Human name from title.shopifytitle; price via safeNumeric.

         Ordered newest-created first (the monitoring order). Requires auth.
=======================================================================================================================================
Request Query Params:
  days   optional integer >= 1 — trailing window of creation dates to include (default 30). Clamp [1, 365].

Success Response:
{
  "return_code": "SUCCESS",
  "days": 30,
  "count": 17,
  "rows": [
    { "groupid": "ABC123", "title": "...", "created": "2026-07-08", "price": 36.95, "stock": 12,
      "units": 4, "revenue": 147.80, "profit": 22.40 },   // newest-created first; sales are lifetime
    ...
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
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// pg date/timestamp -> 'YYYY-MM-DD' from local components (no UTC day-shift). null-safe.
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    // Fixed 30-day creation window (owner decision — no lens toggle).
    const days = 30;

    // Effective creation date = created_at, else parse the legacy text stamp.
    //   stk  = current sellable stock across BOTH channels per style: localstock #FREE (Shopify/local warehouse) PLUS amzfeed.amzlive
    //          (live FBA stock). amzfeed carries groupid, so it sums straight onto the style. Summed together = total stock in hand.
    //   sold = lifetime sales aggregate per style across ALL channels (Shopify, Amazon, anything else) — just the sales table, no
    //          channel filter. LEFT JOINed so a brand-new style with no sales yet still shows (units/revenue/profit = 0).
    const result = await query(
      `
      WITH created AS (
        SELECT ss.groupid,
               COALESCE(ss.created_at, to_timestamp(NULLIF(ss.created, ''), 'YYYYMMDD HH24:MI:SS')) AS created_ts
        FROM skusummary ss
        WHERE ss.shopify = 1
      ),
      stk AS (
        SELECT groupid, SUM(qty) AS stock FROM (
          SELECT groupid, SUM(qty) AS qty FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid
          UNION ALL
          SELECT groupid, SUM(COALESCE(amzlive, 0)) AS qty FROM amzfeed
          WHERE COALESCE(amzlive, 0) > 0
          GROUP BY groupid
        ) chan
        GROUP BY groupid
      ),
      sold AS (
        SELECT groupid,
               SUM(qty)::int              AS units,
               SUM(qty * soldprice)       AS revenue,
               SUM(profit)                AS profit
        FROM sales
        WHERE qty > 0 AND soldprice > 0
        GROUP BY groupid
      )
      SELECT c.groupid,
             t.shopifytitle              AS title,
             c.created_ts,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')}          AS rrp,
             COALESCE(st.stock, 0)       AS stock,
             COALESCE(s.units, 0)        AS units,
             COALESCE(s.revenue, 0)      AS revenue,
             COALESCE(s.profit, 0)       AS profit
      FROM created c
      JOIN skusummary ss ON ss.groupid = c.groupid
      LEFT JOIN stk   st ON st.groupid = c.groupid
      LEFT JOIN sold  s  ON s.groupid  = c.groupid
      LEFT JOIN title t  ON t.groupid  = c.groupid
      WHERE c.created_ts >= CURRENT_DATE - ($1::int - 1)
      ORDER BY c.created_ts DESC, c.groupid
      `,
      [days]
    );

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title || null,
      created: toIsoDate(r.created_ts),
      price: num(r.price),
      rrp: num(r.rrp),
      stock: Number(r.stock),
      units: Number(r.units) || 0,
      revenue: num(r.revenue) ?? 0,
      profit: num(r.profit) ?? 0,
    }));

    return res.json({ return_code: 'SUCCESS', days, count: rows.length, rows });
  } catch (err) {
    logger.error('[analytics-new-additions] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load New Additions' });
  }
});

module.exports = router;
