/*
=======================================================================================================================================
API Route: list_decision_set
=======================================================================================================================================
Method: POST
Purpose: Record an action chosen BY HAND for one or more styles on Deep sellers or Clearance, with a look-again date (owner,
         2026-11-06). Changing your mind = setting again (the row is overwritten). Rules: utils/listDecision.js.

         THE MEASURE is worked out HERE from the live list (utils/listDecision.js → readMeasures), never taken from the screen. It is
         what "has it got deeper?" is compared with later. A style that isn't on the list right now is skipped and named in `skipped`.

         WRITES list_decision only, plus one bclog row (section 'Deep sellers' / 'Clearance'), in ONE transaction. Never a price, never
         a pricing review date: choosing an action records it and does nothing else.
         Requires auth. decided_by = the signed-in user (server-side, never sent).
=======================================================================================================================================
Request Payload:
{
  "list": "deep" | "clearance",
  "groupids": ["1017721-BEND", ...],         // 1–500
  "action": "harvest",                        // one of LISTS[list].actions
  "days": 14                                  // whole days 1–365 ... OR
  "spring": true                              // ... the next 1 March
}

Success Response:
{ "return_code": "SUCCESS", "saved": 3, "look_again": "2027-03-01", "skipped": ["X123"] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_LIST"
"BAD_ACTION"
"BAD_LOOK_AGAIN"
"NO_STYLES"
"NOTHING_ON_LIST"            // none of the styles is on the list right now
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { LISTS, springDate, londonToday, readMeasures } = require('../utils/listDecision');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const { list, action, days, spring } = req.body || {};
  const cfg = LISTS[list];
  if (!cfg) return res.json({ return_code: 'BAD_LIST', message: 'Unknown list' });
  if (!cfg.actions.includes(action)) return res.json({ return_code: 'BAD_ACTION', message: 'Unknown action' });
  const wholeDays = Number.isInteger(days) && days >= 1 && days <= 365;
  if (!spring && !wholeDays) return res.json({ return_code: 'BAD_LOOK_AGAIN', message: 'Pick when to look again' });
  const groupids = [...new Set((Array.isArray(req.body.groupids) ? req.body.groupids : [])
    .filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim()))];
  if (!groupids.length || groupids.length > 500) return res.json({ return_code: 'NO_STYLES', message: 'Pick 1–500 styles' });

  try {
    const who = req.user.display_name;
    const today = await londonToday();
    let lookAgain = spring ? springDate(today) : null;
    if (!lookAgain) {
      const r = await query(`SELECT to_char($1::date + $2::int, 'YYYY-MM-DD') AS d`, [today, days]);
      lookAgain = r.rows[0].d;
    }
    const measures = await readMeasures(list);
    const onList = groupids.filter((g) => measures.has(g));
    const skipped = groupids.filter((g) => !measures.has(g));
    if (!onList.length) return res.json({ return_code: 'NOTHING_ON_LIST', message: 'None of these styles is on the list now', skipped });

    await withTransaction(async (client) => {
      // One statement for every style (no N+1): unnest the two arrays side by side.
      await client.query(
        `INSERT INTO list_decision (list, groupid, action, look_again, measure, decided_at, decided_by)
         SELECT $1, g, $3, $4::date, m, now(), $5
           FROM unnest($2::text[], $6::int[]) AS t(g, m)
         ON CONFLICT (list, groupid) DO UPDATE
           SET action = EXCLUDED.action, look_again = EXCLUDED.look_again, measure = EXCLUDED.measure,
               decided_at = EXCLUDED.decided_at, decided_by = EXCLUDED.decided_by`,
        [list, onList, action, lookAgain, who, onList.map((g) => measures.get(g))]);
      await writeBcLog(client, {
        who,
        section: cfg.section,
        log: `${action} for ${onList.length} style${onList.length === 1 ? '' : 's'}, look again ${lookAgain}: ${onList.join(', ')}`,
      });
    });
    return res.json({ return_code: 'SUCCESS', saved: onList.length, look_again: lookAgain, skipped });
  } catch (err) {
    logger.error('[list-decision-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the decision' });
  }
});

module.exports = router;
