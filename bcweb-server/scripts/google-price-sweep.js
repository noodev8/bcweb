/*
=======================================================================================================================================
Script: scripts/google-price-sweep.js   (Google Merchant price sync — the periodic sweep)
=======================================================================================================================================
Purpose: Push recent Shopify price changes to Google Merchant Center in one batched, deduped pass. This is the cron-driven replacement
         for the old per-apply Google push: pricing-apply (W1) no longer touches Google — it just logs the change to price_change_log —
         and THIS job, run every ~2h through the working day by the VPS scheduler, sends the pending ones.

How it works:
  1. Find DISTINCT groupids with a SHP price change not yet sent (price_change_log.google_pushed_at IS NULL) that are LIVE on Google
     (skusummary.googlestatus=1 AND shopify=1). Distinct groupid = automatic DEDUP: a style repriced 10x since the last sweep is pushed
     ONCE, at its CURRENT price.
  2. For each, call utils/googleMerchant.pushIfLive(groupid) — the same proven in-process Node push the app uses; it reads the current
     shopifyprice and writes a supplemental price override for every size's googleid.
  3. Stamp google_pushed_at = now() on that style's pending SHP rows so they leave the queue. Only stamp styles that CLEANLY landed
     (pushed with 0 failed) or that were legit no-ops (not live / no googleid); a style with any push failure is LEFT queued so the next
     sweep retries it. The nightly full-feed upload is the ultimate backstop for anything that never lands.

Safe to run any time and as often as you like: idempotent (the supplemental override is a repeatable write), a no-op when nothing is
pending, and it never writes skusummary or Google truth beyond the price override. Exits 0 on success, 1 on a fatal error.

Usage (VPS scheduler — every 2h through the day, no point at night):
    node scripts/google-price-sweep.js
=======================================================================================================================================
*/

// Load .env by ABSOLUTE path (relative to this file), not the process cwd — so the script can be run from anywhere (e.g. cron, whose cwd
// is '/') with a plain absolute path, no `cd` needed. dotenv's default is cwd-relative, which is the only reason a cd was ever required.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../database');
const googleMerchant = require('../utils/googleMerchant');

async function main() {
  // The work queue: distinct Google-live styles with an un-sent SHP change. (Add/Modify doesn't log here, so it's out of scope by design.)
  const pending = await query(`
    SELECT DISTINCT l.groupid
    FROM price_change_log l
    JOIN skusummary sm ON sm.groupid = l.groupid
    WHERE l.channel = 'SHP'
      AND l.google_pushed_at IS NULL
      AND sm.googlestatus = 1 AND sm.shopify = 1
  `);
  const groupids = pending.rows.map((r) => r.groupid);

  if (groupids.length === 0) {
    console.log('[google-sweep] nothing pending');
    return;
  }

  let pushed = 0, noop = 0, failed = 0;
  const done = []; // groupids whose pending rows we may stamp (cleanly pushed OR a legit no-op)

  // Sequential per style — each pushIfLive already fires its sizes concurrently, and a cron job needn't hammer the Merchant API.
  for (const groupid of groupids) {
    const res = await googleMerchant.pushIfLive(groupid);
    if (res === null) {
      // Not live on Google / no googleid (raced with a de-list since the change) — nothing to push; stamp so it doesn't linger forever.
      done.push(groupid);
      noop += 1;
    } else if (res.pushed === true && res.failed === 0) {
      done.push(groupid);
      pushed += 1;
    } else {
      // Partial or wholesale failure (incl. GOOGLE_NOT_CONFIGURED) — leave queued so the next sweep retries. Log for visibility.
      failed += 1;
      console.error(`[google-sweep] ${groupid} not stamped: ${res.error || 'partial failure'}${res.message ? ` (${res.message})` : ''}`);
    }
  }

  if (done.length) {
    await query(`
      UPDATE price_change_log
         SET google_pushed_at = now()
       WHERE channel = 'SHP'
         AND google_pushed_at IS NULL
         AND groupid = ANY($1::text[])
    `, [done]);
  }

  console.log(`[google-sweep] pending=${groupids.length} pushed=${pushed} noop=${noop} failed=${failed} stamped=${done.length}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[google-sweep] fatal:', err.message); process.exit(1); });
