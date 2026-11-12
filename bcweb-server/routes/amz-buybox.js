/*
=======================================================================================================================================
API Route: amz_buybox
=======================================================================================================================================
Method: GET
Purpose: The Buy Box screen (/amz/buybox — owner, 2026-11-12; docs/amz-buybox/PLAN.md). Returns the LAST STORED READING of who holds
         the Buy Box on each Amazon size, grouped by what to do about it (rules in utils/amzBuyBox.js → classify). READ ONLY and it
         NEVER asks Amazon — a read is POST /amz-buybox-read (or the cron); this only shows what the last read stored, with its age.
         Groups are worked out now from the stored reading + today's cost / FBA fee, so a cost change applies without a new read.

Success Response:
{
  "return_code": "SUCCESS",
  "counts": { "can_match": 10, "room": 14, "cant_match": 2, "no_bb": 0, "top": 3, "alone": 1, "unknown": 0, "error": 0 },
  "last_all": { "id": 4, "started_at": "...", "finished_at": "...", "by_name": "cron", "total": 358, "changed": 41, "error": null },
  "last_run": { ...the newest finished run, any scope, incl. "scope" and "status" },
  "running":  { "id": 5, "scope": "all", "started_at": "...", "by_name": "Andreas", "total": 358, "done": 120 } | null,
  "rows": [ { "code": "FLE030-IVES-WHITE-06", "groupid": "FLE030-IVES-WHITE", "title": "...", "brand": "Lunar", "asin": "B07QB8LS24",
              "read_at": "...", "live": 23, "total": 59, "sold30": 10, "weeks_left": 25.3,
              "our_price": 39.49, "set_since": null, "rrp": 45.00,   // set_since = a price set AFTER this reading (amz_price_log), else null
              "holder": "OTHER_MFN", "bb_price": 36.39, "rivals": 6, "rival_price": 36.39, "rival_seller": "A1LS…", "next_up": 39.99,
              "rival_at_our_price": true, "amazon_retail": false, "foep": 31.43, "foep_status": "VALID_FOEP", "competitive_price": 45.00,
              "offers": [ { "seller": "A1LS…", "us": false, "fba": false, "price": 36.39, "bb": true } ], "error": null,
              "group": "can_match", "target": 36.39, "kept": 3.44, "walk": 35.62 } ]
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
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { readScreen } = require('../utils/amzBuyBox');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const d = await readScreen(client);
    return res.json({ return_code: 'SUCCESS', ...d });
  } catch (err) {
    logger.error('[amz-buybox] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Buy Box readings' });
  } finally {
    client.release();
  }
});

module.exports = router;
