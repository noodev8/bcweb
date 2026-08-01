/*
=======================================================================================================================================
Module: utils/socialPublish.js
=======================================================================================================================================
Purpose: The single implementation of "publish one social_post_target". Used by BOTH scripts/social-publish-sweep.js (the cron path)
         and routes/social-post-publish-now.js (the manual escape hatch).

         THIS IS ON PURPOSE AND MATTERS. The Order Sync module carries a standing warning in CLAUDE.md because the same logic lives in
         two places (utils/orderSync.js and C:\scripts\orders\update_orders.py) and a change to one leaves the DB written under two sets
         of rules. Publishing has exactly the same shape — a cron path and a manual path doing "the same thing" — so it gets one
         implementation from the start rather than a copy the first time someone needs a button.

         publishTarget(targetId)  — claim, publish, record. Safe to call concurrently; see the claim below.
         reclaimStale()           — PUBLISHING rows older than STALE_MINUTES -> FAILED.

THE DOUBLE-POST GUARD
         The worst failure this module has is posting twice: it is public, visible, and not deletable from a customer's memory. The
         defence is a CONDITIONAL claim — UPDATE ... SET status='PUBLISHING' WHERE id=$1 AND status='SCHEDULED' — and a check of the
         row count. Two overlapping sweeps race on that single statement; exactly one wins, the loser sees 0 rows and skips. This is
         why the claim is its own committed transaction rather than part of a longer one: the whole point is that the loser sees the
         winner's committed state immediately.

         The Meta call happens OUTSIDE any transaction — same discipline as W1's Shopify push. A network call must never hold a DB
         transaction open.

RETRY POSTURE
         Three attempts, then FAILED and stop. A failure that is not the third puts the row back to SCHEDULED so the next sweep retries
         it; the third leaves it FAILED and loud in the Queue. There is no infinite retry against Meta — a token that has been revoked
         will not fix itself, and hammering it just buries the real error.
=======================================================================================================================================
*/

// NOTE: no withTransaction here, deliberately. Every write below is a single atomic statement, and the claim in particular MUST commit
// on its own so a competing runner sees it immediately — wrapping these in a transaction would widen the double-post race, not narrow it.
const { query } = require('../database');
const { publishFacebookPhoto } = require('./socialMeta');
const { logActivity } = require('./bclog');
const logger = require('./logger');

const MAX_ATTEMPTS = 3;
const STALE_MINUTES = 15;

/*
 * Publish one target. Returns a small result object rather than throwing, because both callers want to keep going after one failure:
 *   { skipped: true, reason }                     — someone else claimed it, or it wasn't SCHEDULED
 *   { published: true, remoteId }                 — landed
 *   { failed: true, error, willRetry, attempts }  — did not land
 *
 * `who` is who gets the credit in bclog: the operator's name when a human pressed Retry, 'Scheduler' when cron did it. Defaulting to
 * 'Scheduler' means the cron path cannot accidentally attribute an automated post to whoever happened to compose it.
 */
async function publishTarget(targetId, who = 'Scheduler') {
  // ---- 1. Claim ---------------------------------------------------------------------------------------------------------------
  // Its own transaction, committed before we call out. If this returns 0 rows another runner already has it — skip, do not publish.
  const claim = await query(
    `UPDATE social_post_target
        SET status = 'PUBLISHING', claimed_at = now(), attempts = attempts + 1
      WHERE id = $1 AND status = 'SCHEDULED'
      RETURNING id, post_id, platform, attempts`,
    [targetId]
  );
  if (claim.rowCount === 0) {
    return { skipped: true, reason: 'not SCHEDULED (already claimed, cancelled, or posted)' };
  }
  const target = claim.rows[0];

  try {
    // ---- 2. Load what we need to post ------------------------------------------------------------------------------------------
    const { rows } = await query(
      `SELECT p.caption, p.link_url, p.campaign, a.public_url
         FROM social_post p JOIN social_asset a ON a.id = p.asset_id
        WHERE p.id = $1`,
      [target.post_id]
    );
    if (rows.length === 0) throw new Error(`post ${target.post_id} or its asset has gone missing`);
    const post = rows[0];

    if (target.platform !== 'FB') {
      // IG is Phase 3. Reaching here means something queued a target the publisher cannot fire — fail it loudly rather than looping.
      throw new Error(`platform ${target.platform} has no publisher yet (Phase 3)`);
    }

    // ---- 3. Publish (outside any transaction) ----------------------------------------------------------------------------------
    const { remoteId } = await publishFacebookPhoto({
      imageUrl: post.public_url,
      caption: post.caption,
      linkUrl: post.link_url,
      campaign: post.campaign
    });

    // ---- 4. Record success -----------------------------------------------------------------------------------------------------
    await query(
      `UPDATE social_post_target
          SET status = 'POSTED', remote_id = $2, published_at = now(), error = NULL, claimed_at = NULL
        WHERE id = $1`,
      [target.id, remoteId]
    );
    logger.info(`[socialPublish] target ${target.id} (post ${target.post_id}, ${target.platform}) POSTED as ${remoteId}`);
    // Best-effort audit — never inside a transaction and never able to fail the publish, which has already happened and cannot be undone.
    const flat = String(post.caption || '').replace(/\s+/g, ' ').trim();
    await logActivity({
      who,
      section: 'Social',
      log: `Social Posted: ${target.platform} "${flat.length > 50 ? `${flat.slice(0, 47)}...` : flat}"`
    });
    return { published: true, remoteId, targetId: target.id, postId: target.post_id };
  } catch (err) {
    // ---- 5. Record failure -----------------------------------------------------------------------------------------------------
    // attempts was already incremented by the claim, so it reflects this try.
    const willRetry = target.attempts < MAX_ATTEMPTS;
    await query(
      `UPDATE social_post_target
          SET status = $2, error = $3, claimed_at = NULL
        WHERE id = $1`,
      [target.id, willRetry ? 'SCHEDULED' : 'FAILED', String(err.message).slice(0, 2000)]
    );
    logger.error(
      `[socialPublish] target ${target.id} attempt ${target.attempts}/${MAX_ATTEMPTS} failed: ${err.message}` +
      (willRetry ? ' — will retry next sweep' : ' — giving up, marked FAILED')
    );
    // Only the FINAL give-up goes to bclog. Logging every retry would bury the shared activity log in noise for something the Queue
    // already shows loudly; a post that has permanently failed to go out is genuinely worth seeing next to the day's other events.
    if (!willRetry) {
      await logActivity({
        who,
        section: 'Social',
        log: `Social FAILED: ${target.platform} after ${target.attempts} tries — ${String(err.message).slice(0, 120)}`
      });
    }
    return { failed: true, error: err.message, willRetry, attempts: target.attempts, targetId: target.id };
  }
}

/*
 * Free rows stranded in PUBLISHING — a sweep that was killed mid-call, a VPS restart, a crash between the Meta call and the status
 * write. They go to FAILED, not back to SCHEDULED, and that asymmetry is deliberate: we genuinely do not know whether the post landed,
 * and surfacing a stuck post for a human to check is safer than retrying one that may already be live on the Page.
 */
async function reclaimStale() {
  const { rows } = await query(
    `UPDATE social_post_target
        SET status = 'FAILED',
            error = COALESCE(error || ' | ', '') || 'interrupted — claimed but never completed; check the Page before retrying',
            claimed_at = NULL
      WHERE status = 'PUBLISHING'
        AND claimed_at IS NOT NULL
        AND claimed_at < now() - ($1 || ' minutes')::interval
      RETURNING id, post_id`,
    [String(STALE_MINUTES)]
  );
  if (rows.length) {
    logger.error(`[socialPublish] reclaimed ${rows.length} stale PUBLISHING row(s): ${rows.map((r) => r.id).join(', ')}`);
  }
  return rows;
}

/* Targets that are due to go out now. Ordered oldest-first so a backlog drains in the order it was queued. */
async function findDue() {
  const { rows } = await query(
    `SELECT t.id, t.post_id, t.platform, p.scheduled_at
       FROM social_post_target t JOIN social_post p ON p.id = t.post_id
      WHERE t.status = 'SCHEDULED' AND p.scheduled_at <= now()
      ORDER BY p.scheduled_at ASC`
  );
  return rows;
}

module.exports = { publishTarget, reclaimStale, findDue, MAX_ATTEMPTS, STALE_MINUTES };
