/*
=======================================================================================================================================
Script: scripts/social-publish-sweep.js
=======================================================================================================================================
Purpose: Social module — the scheduler. Finds targets whose post is due, publishes each, records the outcome.

         Runs HOURLY, ON THE HOUR, from the server crontab (owner's call 2026-08-01 — a post a day does not need a sweep every few
         minutes). The crontab on the box is the definitive source for the schedule; don't restate a cadence anywhere else.
         Because of that hourly cadence the Compose screen snaps its time picker to :00, so the time you pick IS the time it goes out
         rather than up to 59 minutes before it.

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

Usage (from bcweb-server/):
  node scripts/social-publish-sweep.js             # publish everything due (this is what cron runs)
  node scripts/social-publish-sweep.js --dry-run   # list what WOULD go out, publish nothing
=======================================================================================================================================
*/

require('dotenv').config();
const { pool } = require('../database');
const { publishTarget, reclaimStale, findDue, STALE_MINUTES } = require('../utils/socialPublish');
const logger = require('../utils/logger');

const DRY = process.argv.includes('--dry-run');

(async () => {
  const started = Date.now();
  let published = 0, failed = 0, skipped = 0;

  try {
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
      return;
    }
    console.log(`${due.length} target(s) due:`);
    for (const t of due) console.log(`  target ${t.id}  post ${t.post_id}  ${t.platform}  scheduled ${t.scheduled_at.toISOString()}`);

    if (DRY) {
      console.log('\nDRY RUN — nothing published.');
      return;
    }

    // 3. Publish each. One failure must never stop the rest of the queue, so nothing here throws out of the loop.
    for (const t of due) {
      const r = await publishTarget(t.id);
      if (r.published) { published++; console.log(`  target ${t.id}: POSTED (${r.remoteId})`); }
      else if (r.skipped) { skipped++; console.log(`  target ${t.id}: skipped — ${r.reason}`); }
      else { failed++; console.log(`  target ${t.id}: FAILED — ${r.error}${r.willRetry ? ' (will retry)' : ' (giving up)'}`); }
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
