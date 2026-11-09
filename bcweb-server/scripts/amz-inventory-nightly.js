/*
=======================================================================================================================================
Script: scripts/amz-inventory-nightly.js   (cron 01:15, nightly — dry run unless --commit)   THE AMAZON NIGHTLY JOB
=======================================================================================================================================
Purpose: Bring Amazon's report-based data in by itself every night, instead of the team downloading files from Seller Central and
uploading them on Update Amazon (owner, 2026-11-09 — the uploads all came off that screen; it is now a status page). The name is
kept from its first job (inventory) so the crontab line didn't change.

THREE STEPS, one after another, EACH ITS OWN TRANSACTION AND STATUS (amz_api_sync job) — a failure in one never stops the others:
  1 INVENTORY  GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA ("Manage FBA Inventory") -> utils/amzImportApply.applyInventoryReport:
               prices changed in Seller Central -> amz_price_log 'Manual' (seen next morning — owner OK'd), amzfeed price + stock,
               new FBA SKUs, zeros, the size history — the FULL stock check (Update Orders' quick read only sees changes).
               Keeps the reconciliation (unknown SKUs + Delete file) for the status page.                  job 'inventory_report'
  2 RETURNS    GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA, the last 30 days EVERY night -> planReturns + insertSales: negative sales
               rows with the real cost of the return (utils/amzProfit.js → returnProfit). Keyed on Amazon's license-plate-number,
               so a return read on 30 nights is booked ONCE.                                              job 'returns_report'
  3 FEES       GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA (Fee Preview) — ONLY when the last good read is 28+ days old (owner: "only really
               needed once a month. why waste time and bother the amazon api"; a SKU with no fee yet uses the £3.39 fallback, so
               nothing is missed meanwhile), or with --fees. -> planFees + applyFees: skumap.fbafee where it changed; a SKU
               missing from the report keeps its fee. A failed monthly read is simply tried again the next night.  job 'fees_report'

Every step reads its report through the SAME parser (utils/amzReports.js) and writes through the SAME code the upload used
(utils/amzImport.js → buildPlan, utils/amzImportApply.js). Inventory takes the 'amz_stock' lock (never at the same moment as Update
Orders' stock step); returns take the Update Orders lock (they read the sales the Amazon orders channel books). One bclog row a
night (section 'Amazon Nightly'). Runs BEFORE stock-daily.js (01:45), which reads amztotal.

Usage (from bcweb-server/):
    node scripts/amz-inventory-nightly.js                   dry run — fetch + plan every due step, print what it would do
    node scripts/amz-inventory-nightly.js --commit          the cron line
    node scripts/amz-inventory-nightly.js --commit --fees   force the fee read (e.g. after Amazon changes its fee rates)
    --only=inventory|returns|fees                           run one step
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { fetchReport } = require('../utils/amzSpReports');
const { parseReport } = require('../utils/amzReports');
const { buildPlan } = require('../utils/amzImport');
const { applyInventoryReport, insertSales, applyFees } = require('../utils/amzImportApply');
const { STOCK_LOCK, recordError } = require('../utils/amzStockSync');
const { shapePlan } = require('../utils/amzImportShape');
const logger = require('../utils/logger');

const commit = process.argv.includes('--commit');
const forceFees = process.argv.includes('--fees');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.split('=')[1] : null;

const RETURNS_DAYS = 30;
const FEES_EVERY_DAYS = 28;

async function saveOk(client, job, note, detail) {
  await client.query(
    `INSERT INTO amz_api_sync (job, last_ok_at, last_ok_note, last_error, last_error_at, detail) VALUES ($1, now(), $2, NULL, NULL, $3)
     ON CONFLICT (job) DO UPDATE SET last_ok_at = now(), last_ok_note = EXCLUDED.last_ok_note, last_error = NULL, last_error_at = NULL,
                                     detail = COALESCE(EXCLUDED.detail, amz_api_sync.detail)`,
    [job, note, detail ? JSON.stringify(detail) : null]
  );
}

async function getReport(type, label, type2, opts) {
  const { text, reportId, waitedSeconds } = await fetchReport(type, opts);
  const parsed = parseReport(text);
  if (!parsed.ok) throw new Error(`${label} report not readable: ${parsed.reason}`);
  if (parsed.type !== type2) throw new Error(`expected the ${label} report, got ${parsed.label}`);
  console.log(`  ${label}: report ${reportId} ready after ${waitedSeconds}s, ${parsed.rows.length} rows`);
  return parsed;
}

// ---- 1. INVENTORY ---------------------------------------------------------------------------------------------------------------
async function stepInventory() {
  const parsed = await getReport('GET_FBA_MYI_UNSUPPRESSED_INVENTORY_DATA', 'FBA Inventory', 'INVENTORY');
  if (!commit) {
    const s = (await buildPlan({ query }, { INVENTORY: parsed }, [])).stock;
    return `inventory (dry): matched ${s.matched}, unknown ${s.unknownSku.length}, gone ${s.goneFromAmazon.length}, ${s.manualPrices.length} Seller Central prices`;
  }
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [STOCK_LOCK]);
    const plan = await buildPlan(client, { INVENTORY: parsed }, []);
    const r = await applyInventoryReport(client, parsed, plan, 'cron', logger);
    const reconciliation = shapePlan({ INVENTORY: parsed }, plan, { committed: true }).reconciliation;
    const note = `${r.stockResult.upserted} rows, ${r.stockResult.zeroed} zeroed, ${r.manualPrices} Seller Central prices` +
      (r.history ? (r.history.failed ? ', size history FAILED' : `, ${r.history.changed} sizes changed`) : '');
    await saveOk(client, 'inventory_report', note, { reconciliation });
    return `inventory: ${note}`;
  });
}

// ---- 2. RETURNS -----------------------------------------------------------------------------------------------------------------
async function stepReturns() {
  const dataStartTime = new Date(Date.now() - RETURNS_DAYS * 24 * 3600 * 1000).toISOString();
  const parsed = await getReport('GET_FBA_FULFILLMENT_CUSTOMER_RETURNS_DATA', 'FBA Returns', 'RETURNS', { dataStartTime });
  const describe = (p) => `${p.insert.length} new returns (${p.units} units, ${p.duplicate} already booked` +
    (p.unmatchedSale ? `, ${p.unmatchedSale} without their sale` : '') + (p.unknownSku.length ? `, ${p.unknownSku.length} SKUs unknown` : '') +
    (p.writeOffUnits ? `, ${p.writeOffUnits} unsellable` : '') + ')';
  if (!commit) return `returns (dry): ${describe((await buildPlan({ query }, { RETURNS: parsed }, [])).returns)}`;
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('bcweb_order_sync'))`);
    const plan = await buildPlan(client, { RETURNS: parsed }, []);
    await insertSales(client, plan.returns.insert);
    const note = describe(plan.returns);
    await saveOk(client, 'returns_report', note, null);
    return `returns: ${note}`;
  });
}

// ---- 3. FEES (every 28 days) ----------------------------------------------------------------------------------------------------
async function feesDue() {
  if (forceFees || only === 'fees') return true;
  const r = await query(`SELECT last_ok_at FROM amz_api_sync WHERE job = 'fees_report'`);
  const last = r.rows[0] && r.rows[0].last_ok_at;
  return !last || (Date.now() - new Date(last).getTime()) >= FEES_EVERY_DAYS * 24 * 3600 * 1000;
}

async function stepFees() {
  if (!(await feesDue())) return null;
  const parsed = await getReport('GET_FBA_ESTIMATED_FBA_FEES_TXT_DATA', 'FBA Fee Preview', 'FEES');
  if (!commit) {
    const f = (await buildPlan({ query }, { FEES: parsed }, [])).fees;
    return `fees (dry): ${f.update.length} fees would change`;
  }
  return withTransaction(async (client) => {
    const plan = await buildPlan(client, { FEES: parsed }, []);
    const updated = await applyFees(client, plan.fees);
    const note = `${updated} fees changed of ${parsed.rows.length} SKUs`;
    await saveOk(client, 'fees_report', note, null);
    return `fees: ${note}`;
  });
}

(async () => {
  const t = Date.now();
  console.log(`Amazon nightly — ${commit ? 'WRITING' : 'dry run (nothing written)'}`);
  const steps = [['inventory', 'inventory_report', stepInventory], ['returns', 'returns_report', stepReturns], ['fees', 'fees_report', stepFees]];
  const lines = [];
  let failed = 0;
  for (const [name, job, run] of steps) {
    if (only && only !== name) continue;
    try {
      const line = await run();
      if (line) { lines.push(line); console.log(`  ${line}`); }
      else console.log(`  ${name}: not due`);
    } catch (err) {
      failed += 1;
      lines.push(`${name} FAILED: ${err.message}`);
      console.error(`  ${name} FAILED: ${err.message}`);
      logger.error(`[amz-nightly] ${name} failed: ${err.message}`);
      if (commit) await recordError(job, err.message);
    }
  }
  try {
    if (commit && lines.length) {
      await query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ('cron', 'Amazon Nightly', $1, (now() AT TIME ZONE 'Europe/London')::date,
                 to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [lines.join(' · ').slice(0, 250)]
      );
    }
    logger.info(`[amz-nightly] ${lines.join(' · ')}`);
    console.log(`${commit ? 'Done' : 'Nothing written'}${failed ? ` — ${failed} step(s) FAILED` : ''}. ${((Date.now() - t) / 1000).toFixed(0)}s`);
  } finally {
    if (failed) process.exitCode = 1;
    await pool.end();
  }
})();
