/*
=======================================================================================================================================
API Route: list_decision_clear
=======================================================================================================================================
Method: POST
Purpose: Take back the hand-chosen decision of one or more styles on Deep sellers or Clearance, so they are To decide again and show
         the screen's suggestion (owner, 2026-11-06: "be able to change our minds"). Rules: utils/listDecision.js.
         WRITES: deletes the list_decision rows, plus one bclog row, in ONE transaction. Requires auth.
=======================================================================================================================================
Request Payload:
{ "list": "deep" | "clearance", "groupids": ["1017721-BEND", ...] }   // 1–500

Success Response:
{ "return_code": "SUCCESS", "cleared": 2 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_LIST"
"NO_STYLES"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const { LISTS } = require('../utils/listDecision');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const { list } = req.body || {};
  const cfg = LISTS[list];
  if (!cfg) return res.json({ return_code: 'BAD_LIST', message: 'Unknown list' });
  const groupids = [...new Set((Array.isArray(req.body.groupids) ? req.body.groupids : [])
    .filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim()))];
  if (!groupids.length || groupids.length > 500) return res.json({ return_code: 'NO_STYLES', message: 'Pick 1–500 styles' });

  try {
    const who = req.user.display_name;
    let cleared = 0;
    await withTransaction(async (client) => {
      const r = await client.query(
        `DELETE FROM list_decision WHERE list = $1 AND groupid = ANY($2::text[]) RETURNING groupid`, [list, groupids]);
      cleared = r.rowCount;
      if (cleared) {
        await writeBcLog(client, {
          who,
          section: cfg.section,
          log: `Decision cleared for ${cleared} style${cleared === 1 ? '' : 's'}: ${r.rows.map((x) => x.groupid).join(', ')}`,
        });
      }
    });
    return res.json({ return_code: 'SUCCESS', cleared });
  } catch (err) {
    logger.error('[list-decision-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to clear the decision' });
  }
});

module.exports = router;
