/*
=======================================================================================================================================
API Route: prospect_note_add
=======================================================================================================================================
Method: POST
Purpose: Add a note to a Prospects line — the team's thread on it ("38 is the one selling", "order core 39/40 only"), each note with
         who wrote it. Replaces emailing finds back and forth. WRITES prospect_note (and touches prospect.updated_at). Requires auth.
=======================================================================================================================================
Request Payload:
{ "prospect_id": 4, "body": "38 is the one selling" }   // body up to 10,000 chars — free text, any length

Success Response:
{ "return_code": "SUCCESS", "id": 2 }
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
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const prospectId = Number(body.prospect_id);
    const text = typeof body.body === 'string' ? body.body.trim().slice(0, 10000) : '';
    if (!Number.isInteger(prospectId) || prospectId < 1 || !text) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Write a note first' });
    }

    const out = await withTransaction(async (client) => {
      const p = await client.query(`UPDATE prospect SET updated_at = now() WHERE id = $1`, [prospectId]);
      if (p.rowCount === 0) return { error: 'NOT_FOUND', message: 'That line has been deleted' };
      const ins = await client.query(
        `INSERT INTO prospect_note (prospect_id, body, created_by) VALUES ($1, $2, $3) RETURNING id`,
        [prospectId, text, req.user.display_name]
      );
      return { id: ins.rows[0].id };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id: out.id });
  } catch (err) {
    logger.error('[prospect-note-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the note' });
  }
});

module.exports = router;
