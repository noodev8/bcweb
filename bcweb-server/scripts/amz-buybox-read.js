/*
=======================================================================================================================================
Script: scripts/amz-buybox-read.js   — the Buy Box read, from the command line or cron (2026-11-12, docs/amz-buybox/PLAN.md)
=======================================================================================================================================
The same read as the Buy Box screen's "Read all now" (utils/amzBuyBox.js): who holds the Buy Box on every Amazon size with FBA stock
live or inbound, stored in amz_buybox_now / _history (change-only, 12 months) / _run. Writes ONLY those tables — never a price.
If a read is already running (a press on the screen) it says so and stops; the next scheduled read picks up.

Usage (from bcweb-server/):
  node scripts/amz-buybox-read.js                     the whole list (run by 'cron')
  node scripts/amz-buybox-read.js FLE030-IVES-WHITE   one style
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { startRun, executeRun } = require('../utils/amzBuyBox');

async function main() {
  const groupid = (process.argv[2] || '').trim() || null;
  const r = await startRun({ by: 'cron', groupid });
  if (r.busy) { console.log(`A read is already running (#${r.busy.id}, ${r.busy.done}/${r.busy.total}) — skipped`); return; }
  console.log(`Read #${r.run.id}: ${r.run.sizes.length} sizes…`);
  const out = await executeRun(r.run);
  if (!out.ok) { console.error(`Failed: ${out.error}`); process.exitCode = 1; return; }
  console.log(`Done: ${out.sizes} sizes, ${out.changed} history rows${out.failed ? `, ${out.failed} could not be read` : ''}`);
}

main()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => pool.end());
