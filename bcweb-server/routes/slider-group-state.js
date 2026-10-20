/*
=======================================================================================================================================
API Route: slider_group_state
=======================================================================================================================================
Method: POST
Purpose: Pause, resume, end or delete a Pricing Slider group.
           pause   nothing in the group is due until it's resumed. Its products stay IN the slider (and keep their badge) — pausing is
                   "don't move these for now", not "let them go".
           resume  back to active. A move that came due while paused is due straight away.
           end     the group is finished: every live product leaves (state 'ended') at whatever price it has — nothing is re-priced.
                   The group and its log stay as history under the Ended tab. Final: make a new group to slide again.
           delete  only a group that has NEVER written a price (no move, no reset to RRP) — i.e. a mistake. Its rows go entirely. Once
                   the slider has set a price, price_change_log / amz_price_log carry its notes, so the group must stay: end it instead.
         WRITES slider_group (+ slider_member on end) in one transaction, and one bclog line, section 'Slider'.
         Requires auth.
=======================================================================================================================================
Request Payload:
{ "id": 3, "action": "pause" }        // 'pause' | 'resume' | 'end' | 'delete'

Success Response:
{ "return_code": "SUCCESS", "id": 3, "state": "paused", "left": 0 }   // state null after delete; left = products that left on 'end'
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"GROUP_ENDED"       // an ended group can't be paused, resumed or ended again
"ALREADY_PRICED"    // delete refused: the slider has written prices — end it instead
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LIVE_STATES } = require('../utils/slider');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

const ACTIONS = ['pause', 'resume', 'end', 'delete'];

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    const action = typeof body.action === 'string' ? body.action : '';
    if (!Number.isInteger(id) || id < 1 || !ACTIONS.includes(action)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'id and action (pause, resume, end or delete) are required' });
    }
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      const cur = await client.query(`SELECT name, state FROM slider_group WHERE id = $1 FOR UPDATE`, [id]);
      if (cur.rows.length === 0) return { error: 'NOT_FOUND', message: 'Slider not found' };
      const { name, state } = cur.rows[0];

      if (action === 'delete') {
        const priced = await client.query(`
          SELECT EXISTS (SELECT 1 FROM slider_member WHERE group_id = $1 AND last_log_id IS NOT NULL) AS priced
        `, [id]);
        if (priced.rows[0].priced) {
          return { error: 'ALREADY_PRICED', message: 'This slider has changed prices, so it stays as history — end it instead' };
        }
        // ON DELETE CASCADE takes its members with it.
        await client.query(`DELETE FROM slider_group WHERE id = $1`, [id]);
        await writeBcLog(client, { who, section: 'Slider', log: `Deleted slider "${name}"` });
        return { state: null, left: 0 };
      }

      if (state === 'ended') return { error: 'GROUP_ENDED', message: 'This slider has already ended' };

      if (action === 'pause' || action === 'resume') {
        const next = action === 'pause' ? 'paused' : 'active';
        if (next === state) return { state, left: 0 };   // already there: nothing to write
        await client.query(`UPDATE slider_group SET state = $2, updated_by = $3, updated_at = now() WHERE id = $1`, [id, next, who]);
        await writeBcLog(client, { who, section: 'Slider', log: `${action === 'pause' ? 'Paused' : 'Resumed'} slider "${name}"` });
        return { state: next, left: 0 };
      }

      // end — every live product leaves at the price it has (the member rows' state + ended_at record it).
      const left = await client.query(`
        UPDATE slider_member SET state = 'ended', ended_by = $2, ended_at = now()
         WHERE group_id = $1 AND state = ANY($3::text[])
      `, [id, who, LIVE_STATES]);
      await client.query(
        `UPDATE slider_group SET state = 'ended', ended_at = now(), updated_by = $2, updated_at = now() WHERE id = $1`,
        [id, who]
      );
      await writeBcLog(client, { who, section: 'Slider', log: `Ended slider "${name}" (${left.rowCount} left)` });
      return { state: 'ended', left: left.rowCount };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id, state: out.state, left: out.left });
  } catch (err) {
    logger.error('[slider-group-state] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update the slider' });
  }
});

module.exports = router;
