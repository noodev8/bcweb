/*
=======================================================================================================================================
API Route: analytics_stock_position
=======================================================================================================================================
Method: GET
Purpose: Analytics module — Stock Position. A "living catalogue" gauge, tracked over time: how many products are commercially ALIVE
         right now, kept SEPARATELY for Shopify (style grain) and Amazon (SKU grain). See utils/stockPosition.js for the definition
         (four buckets: in_stock_selling / in_stock_no_sale / oos_sold_recently / dormant; ALIVE = total - dormant; 6-month window).

         READ-ONLY (mirrors the Birk Tracker split): this GET never writes. It computes TODAY's LIVE figures for both channels (so the
         panels are always fresh, never stale) and returns them as `today`, plus the stored `history` for the trend. Recording a trend
         point is a DELIBERATE act via the "Update now" button -> POST /analytics-stock-position-update (which upserts + prunes). So
         merely viewing the page costs nothing and never appends a snapshot.

         Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional integer >= 1 — trailing window of history to return (default 90). Cap 730 (the 2-year retention).

Success Response:
{
  "return_code": "SUCCESS",
  "days": 90,
  "today": {
    "shp": { "date": "2026-07-11", "in_stock_selling": 166, "in_stock_no_sale": 22, "oos_sold_recently": 43, "dormant": 34,
             "alive": 231, "total": 265 },
    "amz": { ... same shape ... }
  },
  "history": {
    "shp": [ { "date": "...", "in_stock_selling": .., "in_stock_no_sale": .., "oos_sold_recently": .., "dormant": .., "alive": ..,
               "total": .. }, ... ],   // oldest -> newest
    "amz": [ ... ]
  }
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
const { computeStockPosition } = require('../utils/stockPosition');
const logger = require('../utils/logger');

router.use(verifyToken);

// pg DATE -> 'YYYY-MM-DD' without timezone drift.
function toIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// Add the derived `alive` (= total - dormant) to a raw counts row, and normalise the date.
function shape(r) {
  const in_stock_selling = Number(r.in_stock_selling) || 0;
  const in_stock_no_sale = Number(r.in_stock_no_sale) || 0;
  const oos_sold_recently = Number(r.oos_sold_recently) || 0;
  const dormant = Number(r.dormant) || 0;
  const total = Number(r.total) || 0;
  return {
    date: r.snapshot_date ? toIso(r.snapshot_date) : undefined,
    in_stock_selling,
    in_stock_no_sale,
    oos_sold_recently,
    dormant,
    alive: in_stock_selling + in_stock_no_sale + oos_sold_recently,
    total,
  };
}

router.get('/', async (req, res) => {
  try {
    // Window: default 90 days, clamp to [1, 730] (730 = the 2-year retention cap the upsert-and-prune enforces).
    let days = parseInt(req.query.days, 10);
    if (!Number.isInteger(days) || days < 1) days = 90;
    if (days > 730) days = 730;

    // 1) Compute today's live figures for both channels (read-only — the panels stay fresh without storing anything).
    const { shp, amz } = await computeStockPosition();

    // 2) Read the stored history for both channels (oldest -> newest) for the trend.
    const hist = await query(
      `SELECT snapshot_date, channel, in_stock_selling, in_stock_no_sale, oos_sold_recently, dormant, total
         FROM stock_position_snapshot
        WHERE snapshot_date >= CURRENT_DATE - ($1::int - 1)
        ORDER BY snapshot_date ASC`,
      [days]
    );

    const history = { shp: [], amz: [] };
    for (const row of hist.rows) {
      const bucket = row.channel === 'AMZ' ? history.amz : history.shp;
      bucket.push(shape(row));
    }

    // shape() leaves `date` undefined for the live rows (no snapshot_date column) — spread first, then stamp today's date.
    const date = toIso(new Date());
    const today = {
      shp: { ...shape(shp), date },
      amz: { ...shape(amz), date },
    };

    return res.json({ return_code: 'SUCCESS', days, today, history });
  } catch (err) {
    logger.error('[analytics-stock-position] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Stock Position' });
  }
});

module.exports = router;
