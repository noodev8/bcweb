/*
=======================================================================================================================================
Module: utils/socialAssets.js
=======================================================================================================================================
Purpose: Housekeeping for Social image assets. Removes uploads that were never attached to a post — the residue of "picked an image,
         then changed my mind or swapped it before saving".

         sweepOrphanAssets({ dryRun })  — delete orphaned assets (DB row + the file on one.com), and REPORT untracked files.

WHERE THIS RUNS, AND WHY THERE
         Called from scripts/social-publish-sweep.js, gated to the 15th at 03:00 — see that file. It deliberately does NOT get its own
         cron entry or its own script: a standalone tool that has to be remembered is a tool that silently stops being run. Folding it
         into a job that already runs hourly, and that you would notice failing (posts stop going out), means there is nothing new to
         remember and nothing new to maintain.

WHAT COUNTS AS AN ORPHAN
         A `social_asset` row that no `social_post` references, older than GRACE_DAYS. Assets attached to ANY post are untouchable,
         including POSTED ones: Facebook serves its own copy by then so the file is not needed for the post to display, but it is our
         record of what actually went out.

         The grace period is what stops us deleting an image somebody uploaded ten minutes ago and is still writing a caption for.
         Seven days is deliberately generous — Compose holds the asset in React state, so even a page reload already abandons it.

DELETE ORDER: FILE FIRST, THEN ROW  (the important bit)
         The opposite of the upload path, on purpose. If the row went first and the SFTP delete then failed, the file would become
         permanently UNTRACKED — no row points at it, so no future run could ever find it, and we would have manufactured exactly the
         mess we were clearing. Removing the file first means a failure simply leaves the row in place and next month's run retries.
         Self-healing.

         `deleteImage` treats "already gone" as success, so a file removed by hand still lets its row be cleaned up.

UNTRACKED FILES ARE REPORTED, NEVER DELETED
         Files on the host with no `social_asset` row at all should not exist — we always insert the row after a successful upload. If
         one appears (a crash between the two, a hand-copied file), it is logged loudly and left alone. Deleting something we cannot
         explain, unsupervised, on a marketing image host, is not a trade worth making.
=======================================================================================================================================
*/

const { query } = require('../database');
const { deleteImage, listImages } = require('./sftp');
const { logActivity } = require('./bclog');
const config = require('../config/config');
const logger = require('./logger');

// How long an unattached upload is left alone before it counts as abandoned.
const GRACE_DAYS = 7;

/*
 * Returns { checked, deleted, failed, untracked, skipped } — `skipped: true` when image hosting isn't configured.
 * Never throws: this is housekeeping riding along on the publish sweep, and it must never be able to take that down.
 */
async function sweepOrphanAssets({ dryRun = false } = {}) {
  const summary = { checked: 0, deleted: 0, failed: 0, untracked: 0, skipped: false };

  if (!config.social.remoteDir) {
    logger.error('[socialAssets] ONECOM_SOCIAL_REMOTE_DIR not set — skipping asset cleanup');
    summary.skipped = true;
    return summary;
  }

  try {
    // ---- 1. Orphaned rows -------------------------------------------------------------------------------------------------------
    const { rows: orphans } = await query(
      `SELECT a.id, a.filename, a.bytes, a.created_at
         FROM social_asset a
        WHERE NOT EXISTS (SELECT 1 FROM social_post p WHERE p.asset_id = a.id)
          AND a.created_at < now() - ($1 || ' days')::interval
        ORDER BY a.created_at`,
      [String(GRACE_DAYS)]
    );
    summary.checked = orphans.length;

    for (const o of orphans) {
      if (dryRun) {
        logger.info(`[socialAssets] would delete ${o.filename} (${o.bytes}B, uploaded ${o.created_at.toISOString().slice(0, 10)})`);
        summary.deleted++;
        continue;
      }
      try {
        // File first — see the banner. A failure here leaves the row for next time rather than orphaning the file forever.
        await deleteImage(o.filename, config.social.remoteDir);
        await query('DELETE FROM social_asset WHERE id = $1', [o.id]);
        summary.deleted++;
        logger.info(`[socialAssets] deleted orphan ${o.filename}`);
      } catch (err) {
        // One bad file must not stop the rest.
        summary.failed++;
        logger.error(`[socialAssets] could not delete orphan ${o.filename}:`, err.message);
      }
    }

    // ---- 2. Untracked files (report only) ---------------------------------------------------------------------------------------
    // Only done here, in the monthly pass — unlike the query above, this opens an SFTP connection, which is not free.
    try {
      const files = await listImages(config.social.remoteDir);
      const { rows: known } = await query('SELECT filename FROM social_asset');
      const knownSet = new Set(known.map((r) => r.filename));
      const untracked = files.filter((f) => !knownSet.has(f.name));
      summary.untracked = untracked.length;
      if (untracked.length) {
        // error level so it survives LOG_LEVEL=error in production — this is the only place it would ever surface.
        logger.error(
          `[socialAssets] ${untracked.length} file(s) on the host with no social_asset row (NOT deleted, listed for a human): ` +
          untracked.slice(0, 20).map((f) => f.name).join(', ') + (untracked.length > 20 ? ', …' : '')
        );
      }
    } catch (err) {
      logger.error('[socialAssets] could not list the asset host (orphan-row cleanup above still ran):', err.message);
    }

    // ---- 3. Record it, but only if it actually did something --------------------------------------------------------------------
    // A monthly "cleaned nothing" row would be pure noise in a log the owner reads for real activity.
    if (!dryRun && (summary.deleted > 0 || summary.failed > 0 || summary.untracked > 0)) {
      const bits = [`${summary.deleted} removed`];
      if (summary.failed) bits.push(`${summary.failed} failed`);
      if (summary.untracked) bits.push(`${summary.untracked} untracked`);
      await logActivity({ who: 'Scheduler', section: 'Social', log: `Social Cleanup: ${bits.join(', ')}` });
    }
  } catch (err) {
    logger.error('[socialAssets] cleanup failed:', err.message);
  }

  return summary;
}

module.exports = { sweepOrphanAssets, GRACE_DAYS };
