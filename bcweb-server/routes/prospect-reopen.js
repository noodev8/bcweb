/*
=======================================================================================================================================
API Route: prospect_reopen
=======================================================================================================================================
Method: POST
Purpose: Bring an archived line back onto Prospects (owner, 2026-10-26: when a tested style is found again, REOPEN it rather than add a
         second line — one line per style, the new checks sitting next to the old ones). Offered by the add form's "Tested before"
         warning and by the archived line itself. The outcome goes; the comment that recorded it stays in the thread, so the earlier
         decision is still readable. Archiving it again starts a fresh 6 months. WRITES prospect. Requires auth.
=======================================================================================================================================
Request Payload:
{ "id": 4 }

Success Response:
{ "return_code": "SUCCESS" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"          // deleted (or aged out of the archive), or already reopened
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

router.post('/', async (req, res) => {
  try {
    const id = Number((req.body || {}).id);
    if (!Number.isInteger(id) || id < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'id is required' });
    }
    // One statement, so no transaction wrapper is needed.
    const upd = await query(`
      UPDATE prospect SET archived_at = NULL, archived_by = NULL, outcome = NULL, updated_at = now()
       WHERE id = $1 AND archived_at IS NOT NULL
    `, [id]);
    if (upd.rowCount === 0) return res.json({ return_code: 'NOT_FOUND', message: 'That line is not in the archive any more' });
    return res.json({ return_code: 'SUCCESS' });
  } catch (err) {
    logger.error('[prospect-reopen] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to reopen' });
  }
});

module.exports = router;
