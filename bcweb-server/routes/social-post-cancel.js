/*
=======================================================================================================================================
API Route: social_post_cancel
=======================================================================================================================================
Method: POST
Purpose: Social module — remove a queued post. A post that never went out is DELETED outright; the audit trail lives in `bclog`, not as
         a dead row in the queue.

WHY DELETE RATHER THAN A CANCELLED STATUS (changed 2026-08-01, owner's call)
         The original design parked cancelled posts as status='CANCELLED' forever. In use that just silts up the Queue with rows nobody
         will ever look at again — the queue is a worklist, not an archive. So: if nothing was ever published, the post and its targets
         are deleted, and one `bclog` row records who removed what. `bclog` is where "who did what" already lives for Inventory, Order
         Sync and the Amazon import, so Social joins the same log rather than inventing a private one.

WHY A POST THAT HAS PUBLISHED ANYWHERE IS NEVER DELETED
         A POSTED target records something publicly visible on Facebook. Deleting it here would not un-publish anything — it would only
         destroy the record of what went out. So when ANY target is POSTED the post stays and only the still-SCHEDULED targets are moved
         to CANCELLED. (In v1, FB-only, that case cannot arise; it exists for Phase 3, where a post can succeed on FB and still be
         pending on IG.)

WHY IT REFUSES WHILE PUBLISHING
         PUBLISHING means the sweep has claimed that row and may be mid-call to Meta. Deleting underneath it would race: we would report
         "deleted" while the post lands anyway, leaving something live with no record of it at all. The sweep's own 15-minute
         stale-claim rule frees a genuinely stuck row.

THE IMAGE
         When a post is deleted, its one.com image is deleted too — but ONLY if no other post still references that asset. The file was
         never public in any published post, so nothing is being torn out from under Meta. This is best-effort and happens AFTER the DB
         work commits: an orphaned file is harmless, whereas failing the request over a cleanup would not be.

         Requires auth.
=======================================================================================================================================
Request Payload:
{ "post_id": 12, "platform": "FB" }     // platform optional; omitted = every cancellable target on the post

Success Response:
{ "return_code": "SUCCESS", "deleted": true, "cancelled": 0 }    // deleted=true means the post is gone entirely
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // no post_id
"NOT_FOUND"        // no such post, or no matching target
"IN_FLIGHT"        // a candidate target is PUBLISHING right now
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const { deleteImage } = require('../utils/sftp');
const config = require('../config/config');
const logger = require('../utils/logger');

router.use(verifyToken);

// Keep the log line short and scannable — this sits alongside "Inv Remove: ..." and "Order Sync: +2 orders" in one list.
const summarise = (caption) => {
  const flat = String(caption || '').replace(/\s+/g, ' ').trim();
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat;
};

router.post('/', async (req, res) => {
  try {
    const postId = parseInt(req.body?.post_id, 10);
    const platform = typeof req.body?.platform === 'string' ? req.body.platform.toUpperCase() : '';
    if (!Number.isInteger(postId)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'post_id is required' });
    }

    const outcome = await withTransaction(async (client) => {
      // Lock the post's targets so the sweep cannot claim one between our read and our write.
      const { rows: targets } = await client.query(
        `SELECT id, platform, status FROM social_post_target WHERE post_id = $1 FOR UPDATE`,
        [postId]
      );
      if (targets.length === 0) return { notFound: true };

      const scoped = platform ? targets.filter((t) => t.platform === platform) : targets;
      if (scoped.length === 0) return { notFound: true };
      if (scoped.some((t) => t.status === 'PUBLISHING')) return { inFlight: true };

      const { rows: postRows } = await client.query(
        'SELECT caption, asset_id FROM social_post WHERE id = $1', [postId]
      );
      if (postRows.length === 0) return { notFound: true };
      const post = postRows[0];

      // Has this post EVER gone out, on any platform? That is what decides delete vs. cancel — not the platform being asked about.
      const everPublished = targets.some((t) => t.status === 'POSTED');

      if (!everPublished) {
        // Nothing was ever published: remove it entirely. Targets go first — the FK is ON DELETE CASCADE, but being explicit keeps
        // the intent obvious and does not rely on the constraint's behaviour.
        await client.query('DELETE FROM social_post_target WHERE post_id = $1', [postId]);
        await client.query('DELETE FROM social_post WHERE id = $1', [postId]);

        // Is the asset now an orphan? Only then is it safe to drop. (An asset is normally attached to exactly one post, but this
        // makes the cleanup correct rather than merely usually-correct.)
        const { rows: still } = await client.query(
          'SELECT 1 FROM social_post WHERE asset_id = $1 LIMIT 1', [post.asset_id]
        );
        let orphanFile = null;
        if (still.length === 0) {
          const { rows: assetRows } = await client.query(
            'DELETE FROM social_asset WHERE id = $1 RETURNING filename', [post.asset_id]
          );
          orphanFile = assetRows[0]?.filename || null;
        }

        await writeBcLog(client, {
          who: req.user.display_name,
          section: 'Social',
          log: `Social Delete: "${summarise(post.caption)}"`
        });

        return { deleted: true, cancelled: 0, orphanFile };
      }

      // Published somewhere: keep the post, cancel only what is still pending.
      const cancellable = scoped.filter((t) => t.status === 'SCHEDULED');
      if (cancellable.length === 0) {
        return { nothingToDo: true, statuses: scoped.map((t) => ({ platform: t.platform, status: t.status })) };
      }
      await client.query(
        `UPDATE social_post_target SET status = 'CANCELLED' WHERE id = ANY($1::int[])`,
        [cancellable.map((t) => t.id)]
      );
      await client.query('UPDATE social_post SET updated_at = now() WHERE id = $1', [postId]);
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Social',
        log: `Social Cancel: ${cancellable.map((t) => t.platform).join('+')} on "${summarise(post.caption)}"`
      });

      return { deleted: false, cancelled: cancellable.length };
    });

    if (outcome.notFound) return res.json({ return_code: 'NOT_FOUND', message: 'No such post or platform' });
    if (outcome.inFlight) {
      return res.json({ return_code: 'IN_FLIGHT', message: 'That post is being published right now — try again in a minute' });
    }
    if (outcome.nothingToDo) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Nothing left to remove on that post', statuses: outcome.statuses });
    }

    // Best-effort remote cleanup, AFTER the commit. An orphaned file costs nothing; a failed request over cleanup would cost the user.
    if (outcome.orphanFile) {
      try {
        await deleteImage(outcome.orphanFile, config.social.remoteDir);
      } catch (delErr) {
        logger.error(`[social-post-cancel] could not delete orphan image ${outcome.orphanFile}:`, delErr.message);
      }
    }

    logger.info(`[social-post-cancel] post ${postId} ${outcome.deleted ? 'DELETED' : `cancelled x${outcome.cancelled}`} by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', deleted: !!outcome.deleted, cancelled: outcome.cancelled });
  } catch (err) {
    logger.error('[social-post-cancel] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to remove post' });
  }
});

module.exports = router;
