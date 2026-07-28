/*
=======================================================================================================================================
API Route: amz_import_last
=======================================================================================================================================
Method: GET
Purpose: Update Amazon module — tell the operator when this was last run. Reads the bclog row written by amz-import-commit (section
         'Amazon Update'), most recent first. bclog.created_at is UTC (timestamptz); formatted server-side to Europe/London so the
         front end never has to think about the BST offset.

         No row found (never run, or bclog predates this feature) -> lastRun: null. The page shows "unknown" rather than guessing.
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "lastRun": "28 Jul 2026, 14:32", "by": "Andreas" }
{ "return_code": "SUCCESS", "lastRun": null, "by": null }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
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
      `SELECT to_char(created_at AT TIME ZONE 'Europe/London', 'DD Mon YYYY, HH24:MI') AS last_run, workstation
       FROM bclog WHERE section = 'Amazon Update' ORDER BY created_at DESC LIMIT 1`
    );
    const row = result.rows[0];
    return res.json({ return_code: 'SUCCESS', lastRun: row?.last_run || null, by: row?.workstation || null });
  } catch (err) {
    logger.error('[amz-import-last] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the last import time' });
  }
});

module.exports = router;
