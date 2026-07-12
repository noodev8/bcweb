/*
=======================================================================================================================================
API Route: analytics_scratchpad
=======================================================================================================================================
Method: GET
Purpose: Analytics module — New Additions "Scratchpad" READ. Returns every scratchpad note, newest first. The scratchpad is a tiny,
         free-form notepad on the New Additions screen: while researching what to order, the owner jots loose product notes here, and
         they're waiting when the product arrives and set-up begins. Shared across all logged-in users (small internal team).

         Deliberately unstructured — one text `body` per note, plus who wrote it and when. No pagination (the list is always small; the
         owner deletes notes once a product is ordered/loaded). Requires auth.
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "count": 3,
  "rows": [
    { "id": 12, "body": "Arizona Taupe suede — check EU stock, ~£55 landed?", "created_by": "Andreas", "created_at": "2026-07-12T09:14:00.000Z" }
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
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT id, body, created_by, created_at
       FROM scratchpad_note
       ORDER BY created_at DESC, id DESC`
    );
    const rows = result.rows.map((r) => ({
      id: Number(r.id),
      body: r.body,
      created_by: r.created_by || null,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    }));
    return res.json({ return_code: 'SUCCESS', count: rows.length, rows });
  } catch (err) {
    logger.error('[analytics-scratchpad] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load scratchpad' });
  }
});

module.exports = router;
