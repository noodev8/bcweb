/*
=======================================================================================================================================
API Route: slider_remove
=======================================================================================================================================
Method: POST
Purpose: Take chosen products out of a Pricing Slider group, LEAVING THEIR PRICE AS IT IS (to put a product back to full price, use
         Reset to RRP — POST /slider-reset). The member row stays as history with state 'removed'; the product loses its slider badge
         and can join another slider. Only live members (sliding / found / at floor) of THIS group are touched — an id that already
         left, or belongs to another group, is skipped and reported.
         WRITES slider_member in one transaction, and one bclog line, section 'Slider'. Requires auth.
=======================================================================================================================================
Request Payload:
{ "groupId": 3, "memberIds": [11, 12] }      // 1-500

Success Response:
{ "return_code": "SUCCESS", "removed": [11, 12], "skipped": [] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
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

const MAX_IDS = 500;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupId = Number(body.groupId);
    const ids = Array.isArray(body.memberIds)
      ? Array.from(new Set(body.memberIds.map(Number).filter((n) => Number.isInteger(n) && n > 0)))
      : [];
    if (!Number.isInteger(groupId) || groupId < 1 || ids.length === 0 || ids.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupId and memberIds (1-${MAX_IDS}) are required` });
    }
    const who = req.user.display_name;

    const out = await withTransaction(async (client) => {
      const g = await client.query(`SELECT name FROM slider_group WHERE id = $1 FOR UPDATE`, [groupId]);
      if (g.rows.length === 0) return { error: 'NOT_FOUND', message: 'Slider not found' };

      const upd = await client.query(`
        UPDATE slider_member SET state = 'removed', ended_by = $3, ended_at = now()
         WHERE group_id = $1 AND id = ANY($2::int[]) AND state = ANY($4::text[])
        RETURNING id, last_price
      `, [groupId, ids, who, LIVE_STATES]);

      if (upd.rows.length > 0) {
        await writeBcLog(client, { who, section: 'Slider', log: `Removed ${upd.rows.length} from slider "${g.rows[0].name}"` });
      }

      const removed = upd.rows.map((r) => r.id);
      const done = new Set(removed);
      return { removed, skipped: ids.filter((id) => !done.has(id)) };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', removed: out.removed, skipped: out.skipped });
  } catch (err) {
    logger.error('[slider-remove] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to remove products from the slider' });
  }
});

module.exports = router;
