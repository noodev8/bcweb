/*
=======================================================================================================================================
API Route: amz_history
=======================================================================================================================================
Method: GET
Purpose: A reference report for the Amazon drill screen — the PRICE CHANGE HISTORY for one SKU, straight from the audit table
         `amz_price_log` (the same table POST /amz-apply writes to). Shows old->new price, the direction, and the note the operator
         attached — so the person setting a new price can see what has already been tried on this size (the mirror of Shopify's
         pricing-history).

         Lazily loaded (not folded into amz-drill): the drill fetches it only when the operator opens the "Price history" section, keeping
         the initial drill fast. Bounded by MOST-RECENT-N rows, not a date window — price changes are sparse, so a fixed cap always shows
         something. Newest first.

Schema note: amz_price_log is (id, log_date, code, old_price, new_price, notes, changed_by) — old_price/new_price are NUMERIC (no
safeNumeric needed). `changed_by` (added 2026-07-10) is null for legacy rows written before the column existed (e.g. the conversational
`C:\scripts\amz-price` workflow). `log_date` is a DATE, so same-day rows are tie-broken by the ascending surrogate `id`. Requires auth.
=======================================================================================================================================
Request Query Params:
  code  (string, required)
  limit (int, optional)   - max rows to return; default 20, clamped to [1, 100]

Success Response:
{
  "return_code": "SUCCESS",
  "code": "FLE030-IVES-WHITE-38",
  "rows": [
    { "log_date": "2026-07-01", "old_price": 37.69, "new_price": 37.99, "direction": "creep", "notes": "creep 0.30 — 4u/7d", "changed_by": "Andreas" },
    ... // newest first; changed_by null for legacy rows written before the column existed
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

router.get('/', async (req, res) => {
  try {
    const { code } = req.query;
    if (!code) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    }
    // Default 20, clamp so a client can't ask for an unbounded dump.
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 20;
    if (limit > 100) limit = 100;

    // Confirm the SKU exists so a bad code gets NOT_FOUND rather than an empty (but valid) history.
    const exists = await query(`SELECT 1 FROM amzfeed WHERE code = $1`, [code]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'SKU not found in amzfeed' });
    }

    // Fetch limit+1 so we can tell whether more rows exist (truncation) without a separate COUNT query.
    const result = await query(`
      SELECT to_char(log_date, 'YYYY-MM-DD') AS log_date, old_price, new_price,
             CASE WHEN new_price>old_price THEN 'creep' WHEN new_price<old_price THEN 'drop' ELSE 'flat' END AS direction,
             COALESCE(notes,'') AS notes, changed_by
      FROM amz_price_log
      WHERE code = $1
      ORDER BY id DESC
      LIMIT $2::int
    `, [code, limit + 1]);

    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((r) => ({
      log_date: r.log_date,
      old_price: num(r.old_price),
      new_price: num(r.new_price),
      direction: r.direction,
      notes: r.notes || '',
      changed_by: r.changed_by || null,   // null for legacy rows written before the column existed (e.g. the conversational workflow)
    }));

    return res.json({ return_code: 'SUCCESS', code, rows, limit, truncated });
  } catch (err) {
    logger.error('[amz-history] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load price history' });
  }
});

module.exports = router;
