/*
=======================================================================================================================================
Script: scripts/social-publish-sweep.js
=======================================================================================================================================
Purpose: Social module — the scheduler. Finds targets whose post is due, publishes each, records the outcome.

         Runs FOUR TIMES A DAY from the server crontab — 04:00 / 09:00 / 13:00 / 19:00 local (owner's call 2026-08-01; it was briefly
         hourly, cut down because at one or two posts a day the other 20 runs did nothing). The crontab on the box is the definitive
         source for the schedule; don't restate a cadence anywhere else.

         Because this is the ONLY thing that publishes, those four slots are the only times a post can go out — so the Compose screen
         offers a date plus those four slots rather than a free time field. SLOT_HOURS in bcweb-web/src/components/SocialCompose.tsx
         MUST match the crontab; if one changes, change the other in the same commit or the screen starts promising times nothing will
         honour.

         Same shape as scripts/google-price-sweep.js: cron -> find due rows -> act -> stamp.

NO OUTPUT REDIRECTION, ON PURPOSE
         The cron entry has no `>>` — matching every other entry on the box. That is deliberate here rather than an oversight: this
         script's durable record is in the DATABASE. Every publish and every permanent failure writes a `bclog` row, the target row
         keeps Meta's exact error text, and the Queue shows failures in red. docs/maintenance-notes.md flags "every sweep failure so
         far has been invisible" as an open gap for google-price-sweep.js and says the fix is scripts self-logging rather than bolting
         a redirect onto the schedule file — this script is built that way from the start.

WHY WE SCHEDULE AT ALL, GIVEN FACEBOOK CAN
         Facebook will hold a scheduled post for us. Instagram will not — IG publishing is two calls that must both fire at post time.
         Leaning on FB's native scheduling in v1 would have to be unpicked in Phase 3, and it would make Meta rather than bcweb the
         truth about what is queued. One code path, one queue, whatever the platform.

ALL THE ACTUAL LOGIC IS IN utils/socialPublish.js
         Deliberately. routes/social-post-publish-now.js is the manual escape hatch and calls the SAME publishTarget(). This module is
         a loop and some logging. See the banner in utils/socialPublish.js for why that separation is non-negotiable here.

MONTHLY ASSET CLEANUP RIDES ALONG
         On the 15th at 03:00 this sweep also runs utils/socialAssets.js -> sweepOrphanAssets(), which deletes uploads that were never
         attached to a post. It has no cron entry of its own on purpose: a standalone housekeeping script that has to be remembered is
         one that quietly stops being run. This job already runs hourly and its failure is obvious (posts stop going out), so hanging
         the cleanup off it means nothing new to remember.

         The gate is server-local time and the box runs GMT, so this pairs with the `0 3 * * *` crontab entry — the 04:00 local slot.
         KEEPING THOSE TWO IN STEP MATTERS: move that cron line to a different hour and the cleanup silently never runs again, while
         publishing carries on working perfectly and hides it.

         If the sweep happens not to run in that hour (reboot, failed deploy), cleanup simply waits for next month. Accepted: worst
         case a handful of ~150KB files sit around 30 days longer.

Usage (from bcweb-server/):
  node scripts/social-publish-sweep.js             # publish everything due (this is what cron runs)
  node scripts/social-publish-sweep.js --dry-run   # list what WOULD go out (and what cleanup WOULD remove); changes nothing
  node scripts/social-publish-sweep.js --gc        # force the asset cleanup now, ignoring the 15th/03:00 gate
=======================================================================================================================================
*/

require('dotenv').config();
const { pool } = require('../database');
const { publishTarget, reclaimStale, findDue, STALE_MINUTES } = require('../utils/socialPublish');
const { sweepOrphanAssets, GRACE_DAYS } = require('../utils/socialAssets');
const logger = require('../utils/logger');

const DRY = process.argv.includes('--dry-run');
const FORCE_GC = process.argv.includes('--gc');

// Monthly asset cleanup gate. Server-local time, and the box is GMT (see header).
const GC_DAY = 15;
const GC_HOUR = 3;

// Publish everything due. Returns the tallies. Kept separate from the main body so that "nothing due" can return early from HERE
// without also skipping the monthly cleanup below — the cleanup's whole point is that it runs on a quiet hour when nothing is due.
async function runPublish() {
  const counts = { published: 0, failed: 0, skipped: 0 };

  // 1. Free anything stranded mid-publish by a killed run or a restart. Do this FIRST so a stuck row from the previous sweep is
  //    surfaced now rather than sitting invisible for another cycle.
  if (!DRY) {
    const stale = await reclaimStale();
    if (stale.length) console.log(`reclaimed ${stale.length} stale PUBLISHING row(s) (older than ${STALE_MINUTES}m) -> FAILED`);
  }

  // 2. What is due?
  const due = await findDue();
  if (due.length === 0) {
    console.log('nothing due.');
    return counts;
  }
  console.log(`${due.length} target(s) due:`);
  for (const t of due) console.log(`  target ${t.id}  post ${t.post_id}  ${t.platform}  scheduled ${t.scheduled_at.toISOString()}`);

  if (DRY) {
    console.log('\nDRY RUN — nothing published.');
    return counts;
  }

  // 3. Publish each. One failure must never stop the rest of the queue, so nothing here throws out of the loop.
  for (const t of due) {
    const r = await publishTarget(t.id);
    if (r.published) { counts.published++; console.log(`  target ${t.id}: POSTED (${r.remoteId})`); }
    else if (r.skipped) { counts.skipped++; console.log(`  target ${t.id}: skipped — ${r.reason}`); }
    else { counts.failed++; console.log(`  target ${t.id}: FAILED — ${r.error}${r.willRetry ? ' (will retry)' : ' (giving up)'}`); }
  }
  return counts;
}

(async () => {
  const started = Date.now();

  try {
    const { published, failed, skipped } = await runPublish();

    // ---- Monthly asset cleanup (see header) --------------------------------------------------------------------------------------
    // Runs AFTER publishing and outside runPublish(), so a quiet hour with nothing due still gets here. sweepOrphanAssets() never
    // throws — housekeeping riding along must not be able to take the publisher down.
    const now = new Date();
    const gcDue = FORCE_GC || (now.getDate() === GC_DAY && now.getHours() === GC_HOUR);
    if (gcDue) {
      console.log(`\nasset cleanup (orphans older than ${GRACE_DAYS} days)${FORCE_GC ? ' — forced' : ''}:`);
      const gc = await sweepOrphanAssets({ dryRun: DRY });
      if (gc.skipped) console.log('  skipped — image hosting not configured');
      else console.log(`  ${gc.checked} orphan(s) found, ${gc.deleted} ${DRY ? 'would be removed' : 'removed'}` +
        `${gc.failed ? `, ${gc.failed} failed` : ''}${gc.untracked ? `, ${gc.untracked} untracked file(s) reported` : ''}`);
    }

    const summary = `published ${published}, failed ${failed}, skipped ${skipped} in ${Date.now() - started}ms`;
    console.log(`\n${summary}`);
    // Failures are the thing a human needs to notice, so they go to the error log as well as the Queue's red rows.
    if (failed > 0) logger.error(`[social-publish-sweep] ${summary}`);
    else logger.info(`[social-publish-sweep] ${summary}`);
  } catch (err) {
    // A throw here means the sweep itself broke (DB down, config missing) — not a single post failing. That is exactly the silent
    // death the spec warns about, so it is logged as an error and exits non-zero for cron to notice.
    logger.error('[social-publish-sweep] sweep failed:', err.message);
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
