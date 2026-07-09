/*
=======================================================================================================================================
API Route: pricing_history
=======================================================================================================================================
Method: GET
Purpose: A reference report for the drill-down decision screen — the Shopify PRICE CHANGE HISTORY for one style, straight from the
         audit table `price_change_log` (the same table pricing-apply W1 and product-price write to). Shows old->new price, the note the
         user attached, who changed it, and when — so the person setting a new price can see what has already been tried.

         This is a SEPARATE, lazily-loaded endpoint (not folded into pricing-drill): the drill screen fetches it only when the user opens
         the "Price history" section, keeping the initial drill fast (owner decision). It is bounded by MOST-RECENT-N rows, not a date
         window (owner decision) — price changes are sparse, so a fixed cap always shows something and a date window could come back empty.

         Bounding: we fetch limit+1 rows and, if we got more than `limit`, return exactly `limit` and set truncated=true so the UI can say
         "showing last N". Newest first (most recent decision at the top). Shopify channel only ('SHP'), matching the rest of the module.

         Schema note: `change_date` is a DATE (no time), so same-day changes are tie-broken by `id` (an ascending surrogate key) to keep a
         stable, real chronological order. old_price/new_price are NUMERIC here (unlike the VARCHAR price columns on skusummary), so no
         safeNumeric needed. Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required)
  limit   (int, optional)   - max rows to return; default 20, clamped to [1, 100]

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "ABC123",
  "rows": [
    { "change_date": "2026-07-01", "old_price": 34.95, "new_price": 36.95, "note": "harvest — pace held", "changed_by": "Andreas" },
    ... // newest first
  ],
  "limit": 20,
  "truncated": false        // true when more than `limit` rows exist (UI shows "showing last N")
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

// Format a pg 'date' as YYYY-MM-DD from local components (avoids a UTC day-shift). null-safe.
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
    // Default 20, clamp to a sane range so a client can't ask for an unbounded dump.
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 20;
    if (limit > 100) limit = 100;

    // Confirm the style exists so a bad groupid gets NOT_FOUND rather than an empty (but valid) history.
    const exists = await query(`SELECT 1 FROM skusummary WHERE groupid = $1`, [groupid]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    // Fetch limit+1 so we can tell whether more rows exist (truncation) without a second COUNT query.
    const result = await query(`
      SELECT change_date, old_price, new_price, reason_notes, changed_by
      FROM price_change_log
      WHERE groupid = $1 AND channel = 'SHP'
      ORDER BY change_date DESC, id DESC
      LIMIT $2::int
    `, [groupid, limit + 1]);

    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((r) => ({
      change_date: toIsoDate(r.change_date),
      old_price: num(r.old_price),
      new_price: num(r.new_price),
      note: r.reason_notes || '',
      changed_by: r.changed_by || null
    }));

    return res.json({ return_code: 'SUCCESS', groupid, rows, limit, truncated });
  } catch (err) {
    logger.error('[pricing-history] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load price history' });
  }
});

module.exports = router;
