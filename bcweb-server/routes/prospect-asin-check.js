/*
=======================================================================================================================================
API Route: prospect_asin_check
=======================================================================================================================================
Method: GET
Purpose: Is this ASIN a duplicate? Asked by the Prospects add form the moment an Amazon link is pasted, so the user knows BEFORE saving
         (owner, 2026-10-21: "Replace do we have it with Amazon URL so I can quickly add it. If a duplicate I will then know").
         Two answers: already on the Prospects list (which line, who added it), and already ours — one of our Amazon listings (amzfeed)
         carries it. READ ONLY. Requires auth.
=======================================================================================================================================
Request Query Params:
  asin     (string, required) — 10 characters
  exclude  (int, optional)    — a line's own id, when editing it

Success Response:
{ "return_code": "SUCCESS", "listed": { "id": 4, "name": "Rieker …", "owner": "Summer" } | null, "have": { "groupid": "RIE-…" } | null }
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
const { parseAsin } = require('../utils/prospect');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const asin = parseAsin(String(req.query.asin || ''));
    const exclude = req.query.exclude ? Number(req.query.exclude) : null;
    if (!asin || (exclude !== null && !Number.isInteger(exclude))) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'asin is required' });
    }
    const [listed, have] = await Promise.all([
      query(`SELECT id, name, owner FROM prospect WHERE asin = $1 AND ($2::int IS NULL OR id <> $2) LIMIT 1`, [asin, exclude]),
      // amzfeed.asin is stored as-is, so compare upper-cased (as prospect-list does).
      query(`SELECT groupid FROM amzfeed WHERE UPPER(TRIM(asin)) = $1 ORDER BY groupid LIMIT 1`, [asin]),
    ]);
    return res.json({
      return_code: 'SUCCESS',
      listed: listed.rows[0] || null,
      have: have.rows[0] ? { groupid: have.rows[0].groupid } : null,
    });
  } catch (err) {
    logger.error('[prospect-asin-check] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Check failed' });
  }
});

module.exports = router;
