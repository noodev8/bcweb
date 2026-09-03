/*
=======================================================================================================================================
API Route: goods_in_cancel
=======================================================================================================================================
Method: POST
Purpose: Undo ONE unit booked in by /goods-in-book — the operator scanned the wrong shoe, or scanned one twice. Port of the legacy
         of_cancel-item (docs/goodsin/). Everything /goods-in-book did is reversed, in one withTransaction.

DELETES, NOT SOFT-DELETES, and that is the legacy behaviour for a reason worth keeping. inv-adjust.js soft-deletes because it is
correcting a real-world count and the history is evidence; this is undoing a scan that should never have happened seconds ago. A
soft-deleted row would sit in localstock forever as a unit that arrived and then didn't.

IT ALSO PUTS THE ORDER LINE BACK, WHICH THE LEGACY DOES NOT. of_cancel-item deletes the two rows and stops, leaving `arrived = 1` on
an order line whose unit has just been un-received — so Order Status goes on reporting a delivery that was taken back. That is a
legacy bug, not a legacy decision: nothing else re-opens the line, and the whole point of an undo is that the state afterwards matches
the state before. So `arrived` and `arriveddate` are reset on the exact row /goods-in-book claimed, addressed by (ordernum,
shopifysku) — the table's real primary key. A unit that claimed nothing (free stock the supplier sent unasked) has no line to reopen
and simply skips this step.

IDEMPOTENT-ISH BY CONSTRUCTION. The incoming_stock delete is the guard: if that row is already gone the whole call is a no-op and
returns NOT_FOUND, so a double-tapped undo cannot delete a second localstock row or reopen an order line twice.

The cancel is logged in its own right, with the legacy phrasing ("Goods In Cancel <code> to <target>"). Both the book and the cancel
stay in bclog — an undone scan is a thing that happened, and hiding it would make the log lie about a busy morning.
=======================================================================================================================================
Request Payload:
{
  "incomingId":   16376,                  // required — from the /goods-in-book response
  "localstockId": "WEB-8f2c…",            // required — the shelf row that call created
  "ordernum":     "AMZ-O-WS7-4515",       // optional — the claimed order line; omitted when nothing was on order
  "code":         "FLE030-IVES-BLACKSOLE-06"
}

Success Response:
{ "return_code": "SUCCESS", "code": "…", "target": "C3-Amazon", "reopened": true }
  // reopened = an order line was put back to not-arrived
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"        -- that arrival is already gone; nothing was changed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const incomingId = Number(body.incomingId);
    const localstockId = typeof body.localstockId === 'string' ? body.localstockId.trim() : '';
    const ordernum = typeof body.ordernum === 'string' ? body.ordernum.trim() : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';

    if (!Number.isInteger(incomingId) || incomingId <= 0 || !localstockId) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'incomingId and localstockId are required' });
    }

    const operator = req.user.display_name;

    const outcome = await withTransaction(async (client) => {
      // The arrival row is the guard for the whole operation — see the header. Gone already means a second undo of the same scan.
      const incRes = await client.query(
        `DELETE FROM incoming_stock WHERE id = $1 RETURNING code, target`, [incomingId]
      );
      if (incRes.rows.length === 0) return null;
      const { code: incCode, target } = incRes.rows[0];

      // The shelf row this booking created. Deleted by id alone: it was minted by /goods-in-book seconds ago and nothing else
      // references it.
      await client.query(`DELETE FROM localstock WHERE id = $1`, [localstockId]);

      // Reopen the claimed order line — the step the legacy screen omits. Scoped to arrived=1 so re-running cannot disturb a line
      // that has since been received again for real.
      let reopened = false;
      if (ordernum && code) {
        const upd = await client.query(
          `UPDATE orderstatus SET arrived = 0, arriveddate = NULL
           WHERE ordernum = $1 AND shopifysku = $2 AND COALESCE(arrived,0) = 1`,
          [ordernum, code]
        );
        reopened = upd.rowCount > 0;
      }

      await client.query(`
        INSERT INTO bclog (workstation, section, log, date, time, created_at)
        VALUES ($1, 'Goods In', $2,
                (now() AT TIME ZONE 'Europe/London')::date,
                to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())
      `, [operator, `Goods In Cancel ${incCode} to ${target}`]);

      return { code: incCode, target, reopened };
    });

    if (outcome === null) {
      return res.json({ return_code: 'NOT_FOUND', message: 'That arrival has already been undone' });
    }
    return res.json({ return_code: 'SUCCESS', ...outcome });
  } catch (err) {
    logger.error('[goods-in-cancel] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to undo that unit' });
  }
});

module.exports = router;
