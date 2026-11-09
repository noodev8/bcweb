/*
=======================================================================================================================================
Script: scripts/amz-inventory-nightly.js   (cron, nightly — dry run unless --commit)
=======================================================================================================================================
Purpose: Bring the FBA Inventory report in from Amazon by itself every night, instead of it being downloaded from Seller Central and
uploaded on Update Amazon (owner, 2026-11-09: the file came OFF that screen; "next morning is fine" for prices changed by hand).

It is the SAME report (GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA = "Manage FBA Inventory"), read by the SAME parser
(utils/amzReports.js) and planned + written by the SAME code the upload used (utils/amzImport.js → buildPlan,
utils/amzImportApply.js → applyInventoryReport), so it does exactly what the upload did:
  - prices changed by hand in Seller Central -> amz_price_log 'Manual'
  - amzfeed price + stock for every SKU in the report, new FBA SKUs added, SKUs gone from Amazon zeroed (the FULL stock check — the
    quick read inside Update Orders only sees changes)
  - the size history
Under the 'amz_stock' lock, so it never writes amzfeed at the same moment as an Update Orders run.

Preparing the report takes Amazon a few minutes — fine at night, too slow for Update Orders. Runs BEFORE stock-daily.js (01:45),
which reads amztotal. Writes bclog section 'Amazon Stock' and amz_api_sync job 'inventory_report' (an error is kept there too).

Usage (from bcweb-server/):
    node scripts/amz-inventory-nightly.js            dry run — fetch + plan, print what it would do
    node scripts/amz-inventory-nightly.js --commit   the cron line
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { fetchReport } = require('../utils/amzSpReports');
const { parseReport } = require('../utils/amzReports');
const { buildPlan } = require('../utils/amzImport');
const { applyInventoryReport } = require('../utils/amzImportApply');
const { STOCK_LOCK, recordError } = require('../utils/amzStockSync');
const { shapePlan } = require('../utils/amzImportShape');
const logger = require('../utils/logger');

const REPORT = 'GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA';
const JOB = 'inventory_report';
const commit = process.argv.includes('--commit');

(async () => {
  const t = Date.now();
  try {
    console.log(`Amazon FBA Inventory report — ${commit ? 'WRITING' : 'dry run (nothing written)'}`);
    const { text, reportId, waitedSeconds } = await fetchReport(REPORT, {
      onWait: (status, s) => console.log(`  ${s}s: ${status}`),
    });
    console.log(`  report ${reportId} ready after ${waitedSeconds}s`);

    const parsed = parseReport(text);
    if (!parsed.ok) throw new Error(`report not readable: ${parsed.reason}`);
    if (parsed.type !== 'INVENTORY') throw new Error(`expected the FBA Inventory report, got ${parsed.label}`);
    console.log(`  ${parsed.rows.length} rows (${parsed.skipped.length} skipped by the parser)`);

    if (!commit) {
      const plan = await buildPlan({ query }, { INVENTORY: parsed }, []);
      const s = plan.stock;
      console.log(`  matched ${s.matched} · unknown to skumap ${s.unknownSku.length} · Amazon bundles ${s.virtual.length} · gone from Amazon ${s.goneFromAmazon.length}`);
      console.log(`  live units ${s.liveUnits} · total units ${s.totalUnits}`);
      // applyStock zeroes the stock of amzfeed rows the report doesn't mention — only the ones still HOLDING stock change anything.
      const gone = s.goneFromAmazon.map((g) => g.code);
      const holding = await query(
        `SELECT code, COALESCE(amzlive,0) AS live, COALESCE(amztotal,0) AS total FROM amzfeed
         WHERE code = ANY($1::text[]) AND (COALESCE(amzlive,0) <> 0 OR COALESCE(amztotal,0) <> 0) ORDER BY code`, [gone]);
      console.log(`  of those gone from Amazon, ${holding.rows.length} still show stock in amzfeed and would be zeroed`);
      for (const h of holding.rows.slice(0, 15)) console.log(`    ${h.code} ${h.live}/${h.total} → 0/0`);
      console.log(`  prices changed in Seller Central: ${s.manualPrices.length}`);
      for (const m of s.manualPrices.slice(0, 15)) console.log(`    ${m.code} £${m.from.toFixed(2)} → £${m.to.toFixed(2)}`);
      console.log('Nothing written.');
      return;
    }

    const out = await withTransaction(async (client) => {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [STOCK_LOCK]);
      const plan = await buildPlan(client, { INVENTORY: parsed }, []);
      const r = await applyInventoryReport(client, parsed, plan, 'cron', logger);
      // The reconciliation the upload used to show (unknown SKUs + Delete file, bundles, gone from Amazon) — kept for Update Amazon.
      const reconciliation = shapePlan({ INVENTORY: parsed }, plan, { committed: true }).reconciliation;
      const note = `nightly report: ${r.stockResult.upserted} rows, ${r.stockResult.zeroed} zeroed, ${r.manualPrices} Seller Central prices` +
        (r.history ? (r.history.failed ? ', size history FAILED' : `, ${r.history.changed} sizes changed`) : '');
      await client.query(
        `INSERT INTO amz_api_sync (job, last_ok_at, last_ok_note, last_error, last_error_at, detail) VALUES ($1, now(), $2, NULL, NULL, $3)
         ON CONFLICT (job) DO UPDATE SET last_ok_at = now(), last_ok_note = EXCLUDED.last_ok_note, last_error = NULL, last_error_at = NULL,
                                         detail = EXCLUDED.detail`,
        [JOB, note, JSON.stringify({ reconciliation })]
      );
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ('cron', 'Amazon Stock', $1, (now() AT TIME ZONE 'Europe/London')::date,
                 to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [`Amazon stock (API ${note})`.slice(0, 250)]
      );
      return { ...r, note };
    });
    console.log(`  ${out.note}`);
    logger.info(`[amz-inventory-nightly] ${out.note}`);
    console.log(`Written. ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } catch (err) {
    console.error('FAILED:', err.message);
    logger.error(`[amz-inventory-nightly] ${err.message}`);
    if (commit) await recordError(JOB, err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
