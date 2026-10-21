/*
=======================================================================================================================================
API Route: prospect_delete
=======================================================================================================================================
Method: POST
Purpose: Delete from Prospects — a whole line, or one check / note typed by mistake. A REAL delete (owner, 2026-10-21: "when I delete
         items, I want them deleted rather than hanging around — like deleting a line from google docs"): the row is gone, and a line's
         checks and notes go with it (ON DELETE CASCADE). Nothing is kept or logged. Anyone logged in can delete anything — the list
         is shared, like a shared doc. Requires auth.
=======================================================================================================================================
Request Payload:
{ "kind": "prospect", "id": 4 }     // kind: 'prospect' | 'check' | 'note'

Success Response:
{ "return_code": "SUCCESS" }        // also SUCCESS if it was already gone — the outcome the user wanted
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
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

// Table per kind — a fixed map, so the table name in the SQL never comes from the request.
const TABLES = { prospect: 'prospect', check: 'prospect_check', note: 'prospect_note' };

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const table = TABLES[body.kind];
    const id = Number(body.id);
    if (!table || !Number.isInteger(id) || id < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'kind and id are required' });
    }
    // One statement (the cascade is part of it), so no transaction wrapper is needed.
    await query(`DELETE FROM ${table} WHERE id = $1`, [id]);
    return res.json({ return_code: 'SUCCESS' });
  } catch (err) {
    logger.error('[prospect-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete' });
  }
});

module.exports = router;
