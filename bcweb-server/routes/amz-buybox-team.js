/*
=======================================================================================================================================
API Route: amz_buybox_team
=======================================================================================================================================
Method: GET
Purpose: The Buy Box screen's "Team week" panel (owner, 2026-11-12; docs/amz-buybox/PLAN.md point 12). For this week and last:
         per person, what their Amazon price changes did to the Buy Box (won back, raises kept and the extra profit on pairs sold
         at the raised price), plus the "moves to look at together" the system would have done otherwise. Seen by everyone
         (owner: "A, seen by everyone"). READ ONLY. The rules (and why) are utils/amzBuyBoxTeam.js, THE copy.

Success Response:
{
  "return_code": "SUCCESS",
  "this_start": "2026-11-09T00:00:00.000Z", "last_start": "2026-11-02T00:00:00.000Z",
  "history_from": "2026-11-12 00:39:49+00",          // the first Buy Box reading — moves before it are never judged
  "weeks": {
    "this": {
      "people": [ { "name": "Summer", "changes": 242, "cuts": 207, "raises": 35, "holds": 102, "won_back": 10, "raises_kept": 4,
                    "kept_pairs": 0, "kept_profit": 0, "to_look": 32, "waiting": 0, "superseded": 0, "not_judged": 194 } ],
      "look": [ { "id": 3458, "code": "JLH950-BLAZE-NAVY-08", "title": "...", "by": "Summer", "changed_at": "...",
                  "old_price": 31.99, "new_price": 31.69, "why": ["held"], "walk": 31.21, "result": null,
                  "before": { "share": 100, "holder": "US", "lead_price": 31.99, "our_price": 31.99 }, "after": { "share": 100 } } ]
    },
    "last": { ... }
  }
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
const { readTeamWeek } = require('../utils/amzBuyBoxTeam');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const d = await readTeamWeek(client);
    return res.json({ return_code: 'SUCCESS', ...d });
  } catch (err) {
    logger.error('[amz-buybox-team] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the team week' });
  } finally {
    client.release();
  }
});

module.exports = router;
