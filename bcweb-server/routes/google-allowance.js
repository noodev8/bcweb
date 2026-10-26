/*
=======================================================================================================================================
API Route: google_allowance
=======================================================================================================================================
Method: GET
Purpose: The Google allowance IN FORCE — the newest accepted google_allowance row — for the Google Ads screen's allowance line, with
         when it falls due for its quarterly re-measure. Rules: utils/googleAllowance.js. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "allowance": { "perUnit": 7.77, "spend": 6653.26, "units": 856, "windowFrom": "2026-07-24", "windowTo": "2026-10-21",
                 "acceptedBy": "Andreas", "acceptedOn": "2026-10-25", "dueOn": "2027-01-23", "due": false } | null
}
  - null only if the table is empty (the migration seeds a first row).
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
const { readAllowance } = require('../utils/googleAllowance');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    return res.json({ return_code: 'SUCCESS', allowance: await readAllowance(query) });
  } catch (err) {
    logger.error('[google-allowance] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the Google allowance' });
  }
});

module.exports = router;
