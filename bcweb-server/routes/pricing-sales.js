/*
=======================================================================================================================================
API Route: pricing_sales
=======================================================================================================================================
Method: GET
Purpose: A reference report for the drill-down decision screen — the RAW Shopify SALES of one style, one row per sale line, each with the
         price it actually SOLD at (`soldprice`). The drill's pricing timeline AGGREGATES sales by distinct price; this is the granular
         view underneath it, so the person setting a price can see the individual recent sales (date, size, qty, sold price) rather than
         only the grouped pace figures.

         Like pricing-history, this is a SEPARATE, lazily-loaded endpoint (fetched only when the user opens the "Recent sales" section on
         the drill screen — keeps the initial drill fast, owner decision) and is bounded by MOST-RECENT-N rows, not a date window (owner
         decision): sales are dense on a hot style, so a fixed cap gives a predictable payload and always shows the latest activity.

         Bounding: fetch limit+1 rows; if we got more than `limit`, return exactly `limit` and set truncated=true so the UI can say
         "showing last N". Newest first. Shopify channel only ('SHP'), positive lines only (qty>0, soldprice>0) — matching the drill
         timeline (this excludes returns / zero-price lines).

         Schema notes (CLAUDE.md): size = RIGHT(code,2) (EU size). `solddate` is a DATE, `ordertime` a 'HH:MM' VARCHAR — we order by
         solddate then ordertime then id for a stable newest-first sequence. `soldprice` is NUMERIC (per unit). Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required)
  limit   (int, optional)   - max rows to return; default 50, clamped to [1, 200]

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "rows": [
    { "solddate": "2026-07-08", "ordertime": "14:32", "size": "38", "qty": 1, "soldprice": 36.95, "profit": 2.38 },  // profit read straight from sales.profit (computed downstream); null if not set
    ... // newest first
  ],
  "limit": 50,
  "truncated": true         // true when more than `limit` rows exist (UI shows "showing last N")
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const { groupid } = req.query;
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }
    // Default 50, clamp so a client can't request an unbounded dump of a busy style's history.
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 50;
    if (limit > 200) limit = 200;

    // Confirm the style exists so we can return a clean NOT_FOUND rather than an empty sales list for a bogus groupid.
    const exists = await query('SELECT 1 FROM skusummary WHERE groupid = $1', [groupid]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    // Fetch limit+1 to detect truncation without a separate COUNT. Newest first (solddate, then time, then surrogate id).
    // `profit` is read straight from the sales table: it's now computed downstream (by the owner's own P&L pipeline) and
    // populated per sale line, so we no longer re-derive it app-side — this row just surfaces what the table already holds.
    const result = await query(`
      SELECT solddate, ordertime, RIGHT(code, 2) AS size, qty, soldprice, profit
      FROM sales
      WHERE groupid = $1 AND channel = 'SHP' AND qty > 0 AND soldprice > 0
      ORDER BY solddate DESC, ordertime DESC NULLS LAST, id DESC
      LIMIT $2::int
    `, [groupid, limit + 1]);

    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((r) => {
      return {
        solddate: toIsoDate(r.solddate),
        ordertime: r.ordertime || null,
        size: r.size || null,
        qty: Number(r.qty),
        soldprice: num(r.soldprice),
        // Net profit for this sale line, straight from sales.profit (downstream-calculated). null -> UI shows "—".
        profit: num(r.profit)
      };
    });

    return res.json({ return_code: 'SUCCESS', groupid, rows, limit, truncated });
  } catch (err) {
    logger.error('[pricing-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sales' });
  }
});

module.exports = router;
