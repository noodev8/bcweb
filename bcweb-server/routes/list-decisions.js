/*
=======================================================================================================================================
API Route: list_decisions
=======================================================================================================================================
Method: GET
Purpose: The hand-chosen decisions of ONE list (Deep sellers or Clearance), for its To decide | All views. The rules live in
         utils/listDecision.js and migrations/20261106b_list_decision.sql. The screen works out what is due (lib/listDecisions.ts →
         isDue) from each row's look_again and measure against the measure it shows, so this route stays a plain read.
         Also returns today and the Spring date, so the screen never works a date out in the browser.
         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: ?list=deep|clearance

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-11-06", "spring": "2027-03-01",
  "decisions": [ { "groupid": "1017721-BEND", "action": "harvest", "look_again": "2027-03-01", "measure": 38,
                   "decided_at": "2026-11-06T14:02:11.000Z", "decided_by": "Andreas" } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_LIST"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { LISTS, springDate, londonToday } = require('../utils/listDecision');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const list = String(req.query.list || '');
  if (!LISTS[list]) return res.json({ return_code: 'BAD_LIST', message: 'Unknown list' });
  try {
    const today = await londonToday();
    // Dates cast to text in SQL (CLAUDE.md: never hand a pg DATE to the JS Date parser).
    const r = await query(
      `SELECT groupid, action, to_char(look_again, 'YYYY-MM-DD') AS look_again, measure, decided_at, decided_by
         FROM list_decision WHERE list = $1`, [list]);
    return res.json({ return_code: 'SUCCESS', today, spring: springDate(today), decisions: r.rows });
  } catch (err) {
    logger.error('[list-decisions] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the decisions' });
  }
});

module.exports = router;
