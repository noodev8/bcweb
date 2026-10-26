/*
=======================================================================================================================================
API Route: prospect_archive
=======================================================================================================================================
Method: POST
Purpose: Take a decided line off Prospects into the Archive (owner, 2026-10-26: "so that colleagues know a decision for a prospect and
         check if we've tested this style"). The line keeps its checks and comments, gets an outcome — Ordered or Dropped — and who /
         when. The outcome and the optional reason go in as the line's LAST COMMENT ("Dropped — rank too low"), so the thread reads in
         order and the decision survives a Reopen. Archived lines are kept 6 months, then removed for good: this write purges any older
         than that (utils/prospect.js → purgeOldArchive — no cron). Delete (prospect-delete) is still there for a line added by mistake.
         WRITES prospect + prospect_note, one transaction. Requires auth.
=======================================================================================================================================
Request Payload:
{ "id": 4, "outcome": "dropped", "reason": "rank too low" }    // outcome: 'ordered' | 'dropped'; reason optional

Success Response:
{ "return_code": "SUCCESS" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"          // deleted, or already archived by someone else
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { OUTCOMES, textOrNull, purgeOldArchive } = require('../utils/prospect');
const logger = require('../utils/logger');

router.use(verifyToken);

const OUTCOME_LABEL = { ordered: 'Ordered', dropped: 'Dropped' };

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const id = Number(body.id);
    const outcome = body.outcome;
    if (!Number.isInteger(id) || id < 1 || !OUTCOMES.includes(outcome)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Pick Ordered or Dropped' });
    }
    const reason = textOrNull(body.reason, 2000);

    const out = await withTransaction(async (client) => {
      // archived_at IS NULL: two people archiving at once — the second gets NOT_FOUND rather than a second outcome comment.
      const upd = await client.query(`
        UPDATE prospect SET archived_at = now(), archived_by = $2, outcome = $3, updated_at = now()
         WHERE id = $1 AND archived_at IS NULL
      `, [id, req.user.display_name, outcome]);
      if (upd.rowCount === 0) return { error: 'NOT_FOUND', message: 'That line has already been archived or deleted' };
      await client.query(
        `INSERT INTO prospect_note (prospect_id, body, created_by) VALUES ($1, $2, $3)`,
        [id, reason ? `${OUTCOME_LABEL[outcome]} — ${reason}` : OUTCOME_LABEL[outcome], req.user.display_name]
      );
      await purgeOldArchive(client);
      return {};
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS' });
  } catch (err) {
    logger.error('[prospect-archive] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to archive' });
  }
});

module.exports = router;
