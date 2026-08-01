/*
=======================================================================================================================================
API Route: social_post_publish_now
=======================================================================================================================================
Method: POST
Purpose: Social module — the escape hatch. Publish one target immediately, ignoring its scheduled time. This is what the Queue's
         "Retry" button on a failed row calls, and what you use when the sweep has died and you want today's post out anyway.

         It calls the SAME utils/socialPublish.js -> publishTarget() that the cron sweep calls. There is deliberately no second
         implementation of publishing in this codebase (see the banner in that module).

WHY A FAILED ROW HAS TO BE RESET FIRST
         publishTarget() only acts on a SCHEDULED row — that conditional claim is the double-post guard. A FAILED row is therefore
         invisible to it. So a retry explicitly moves FAILED -> SCHEDULED (clearing the error and the attempt count) and then publishes.
         That reset is itself conditional on the row still being FAILED, so two people hitting Retry at once cannot both get through.

         A POSTED row is never re-published — that is how you end up posting twice.

         Requires auth.
=======================================================================================================================================
Request Payload:
{ "target_id": 30 }

Success Response:
{ "return_code": "SUCCESS", "remote_id": "103119731391855_1636..." }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // no target_id
"NOT_FOUND"         // no such target
"ALREADY_POSTED"    // target is POSTED — refusing to publish twice
"IN_FLIGHT"         // the sweep has it right now
"CANCELLED"         // target was cancelled; un-cancel by composing again
"PUBLISH_FAILED"    // Meta rejected it — `message` carries Meta's own error
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { publishTarget } = require('../utils/socialPublish');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const targetId = parseInt(req.body?.target_id, 10);
    if (!Number.isInteger(targetId)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'target_id is required' });
    }

    const { rows } = await query('SELECT id, status FROM social_post_target WHERE id = $1', [targetId]);
    if (rows.length === 0) return res.json({ return_code: 'NOT_FOUND', message: 'No such target' });

    const status = rows[0].status;
    if (status === 'POSTED') {
      return res.json({ return_code: 'ALREADY_POSTED', message: 'That post has already gone out' });
    }
    if (status === 'PUBLISHING') {
      return res.json({ return_code: 'IN_FLIGHT', message: 'The scheduler is publishing that right now' });
    }
    if (status === 'CANCELLED') {
      return res.json({ return_code: 'CANCELLED', message: 'That post was cancelled' });
    }

    // FAILED -> SCHEDULED so publishTarget()'s conditional claim can see it. Conditional on still being FAILED, so a double-click
    // cannot produce two publishes. attempts resets because this is a fresh, human-initiated try.
    if (status === 'FAILED') {
      const reset = await query(
        `UPDATE social_post_target SET status = 'SCHEDULED', error = NULL, attempts = 0
          WHERE id = $1 AND status = 'FAILED' RETURNING id`,
        [targetId]
      );
      if (reset.rowCount === 0) {
        return res.json({ return_code: 'IN_FLIGHT', message: 'That post changed state — reload the queue' });
      }
    }

    // Pass the operator so bclog credits the person who pressed Retry, not the 'Scheduler' default the cron path uses.
    const result = await publishTarget(targetId, req.user.display_name);

    if (result.published) {
      logger.info(`[social-post-publish-now] target ${targetId} published by ${req.user.display_name}`);
      return res.json({ return_code: 'SUCCESS', remote_id: result.remoteId });
    }
    if (result.skipped) {
      return res.json({ return_code: 'IN_FLIGHT', message: `Could not claim that post — ${result.reason}` });
    }
    return res.json({ return_code: 'PUBLISH_FAILED', message: result.error });
  } catch (err) {
    logger.error('[social-post-publish-now] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to publish' });
  }
});

module.exports = router;
