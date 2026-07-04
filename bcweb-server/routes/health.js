/*
=======================================================================================================================================
API Route: health_check
=======================================================================================================================================
Method: GET
Purpose: Liveness + database-connectivity probe. Runs a trivial `SELECT NOW()` through the shared pool so we can confirm the server
         is up AND can reach PostgreSQL. Used during Milestone 1 to verify the DB_* credentials are wired correctly, and afterwards
         as a monitoring endpoint. No auth required (it exposes nothing sensitive — just the DB clock).
=======================================================================================================================================
Request Payload: none

Success Response:
{
  "return_code": "SUCCESS",
  "db_time": "2026-07-03T10:00:00.000Z"   // string, timestamp returned by the database
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const logger = require('../utils/logger');

router.get('/', async (req, res) => {
  try {
    // Round-trip to the DB. If credentials/network are wrong this throws and we report SERVER_ERROR (still HTTP 200 per API-RULES).
    const result = await query('SELECT NOW() AS now');
    return res.json({ return_code: 'SUCCESS', db_time: result.rows[0].now });
  } catch (err) {
    logger.error('[health] DB check failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Database connectivity check failed' });
  }
});

module.exports = router;
