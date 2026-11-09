/*
=======================================================================================================================================
Script: scripts/amz-stock-sync.js   (dry run by default — --commit writes)
=======================================================================================================================================
Purpose: Run the SP-API FBA stock read (utils/amzStockSync.js — THE copy of the rules) by hand. Update Orders runs the QUICK read
every time (button + cron); this script is for:
  --full     every SKU Amazon holds (~2.5 min). Sets the starting point the FIRST time (the quick step skips until one exists) and
             zeroes amzfeed rows Amazon no longer reports.
  (no flag)  the quick read, changed since the last good run — the same as Update Orders does, to see it working.

Usage (from bcweb-server/):
    node scripts/amz-stock-sync.js                    quick, dry run
    node scripts/amz-stock-sync.js --full             full, dry run — what it WOULD change against amzfeed
    node scripts/amz-stock-sync.js --full --commit    full, written (amzfeed stock + size history + amz_api_sync starting point)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { syncAmzStock } = require('../utils/amzStockSync');

const full = process.argv.includes('--full');
const commit = process.argv.includes('--commit');

(async () => {
  const t = Date.now();
  try {
    console.log(`Amazon FBA stock — ${full ? 'FULL' : 'quick'} read, ${commit ? 'WRITING' : 'dry run (nothing written)'}`);
    const out = await syncAmzStock({
      by: process.env.USERNAME || 'script',
      full,
      commit,
      onPage: (page, n) => process.stdout.write(`\r  page ${page}: ${n} SKUs`),
    });
    process.stdout.write('\n');
    if (out.skipped) { console.log(`Skipped: ${out.skipped}`); return; }
    console.log(`  since: ${out.since || 'everything'}`);
    console.log(`  read ${out.read} · matched ${out.matched} · unknown to skumap ${out.unknown} · Amazon bundles ${out.virtual}`);
    console.log(`  stock changed ${out.stockChanged} · new amzfeed rows ${out.inserted} · zeroed ${out.zeroed}` +
      (out.updated > out.stockChanged ? ` · barcode/ASIN only ${out.updated - out.stockChanged}` : ''));
    for (const e of out.examples) console.log(`    ${e}`);
    if (out.history) {
      console.log(out.history.failed ? `  size history FAILED: ${out.history.error}` : `  size history: ${out.history.changed} sizes changed today`);
    }
    console.log(`${out.committed ? 'Written.' : 'Nothing written.'} ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('\nFAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
