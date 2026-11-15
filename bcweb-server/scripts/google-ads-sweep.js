/*
=======================================================================================================================================
Script: scripts/google-ads-sweep.js   (the nightly Google Ads pull → google_product_daily + google_campaign_daily)
=======================================================================================================================================
Purpose: Fetch both Google Ads reports from the API (utils/googleAdsApi.js) and write them through the SAME plan and upserts as the
         screen's CSV upload (utils/googleAdsImport.js). Replaces downloading bcweb_product_30 / adcost_summary_30 by hand; the upload
         panel was removed from the screen (2026-11-15) and its routes left unused. Back-fill a range with --from/--to.

WHY IT RE-PULLS 30 DAYS EVERY NIGHT
Google revises conversions upward for weeks after the click, so the last 30 days keep changing. The upsert takes the later figure and
counts an identical row as `unchanged`, so re-reading the window is cheap and keeps every recent day current. It also means one or two
missed nights cost nothing — the next run covers them. `to` is YESTERDAY (UK): today is a part day.

Dry run by default — prints the plan (write / unchanged / skipped per report) and writes nothing. --commit writes, in ONE transaction,
with a bclog row (section 'Google Ads', who 'Scheduler') inside it. A failure writes its own bclog row and exits 1; nothing is
half-written. Reads the API twice (two operations of the 2,880 a day Explorer allows).

Usage:
    node scripts/google-ads-sweep.js                      dry run, last 30 days to yesterday
    node scripts/google-ads-sweep.js --commit             the cron job
    node scripts/google-ads-sweep.js --days 90 --commit   wider window
    node scripts/google-ads-sweep.js --from 2025-11-01 --to 2026-10-31 --commit   back-fill a range
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { withTransaction } = require('../utils/transaction');
const { fetchReports } = require('../utils/googleAdsApi');
const { buildPlan, applyProduct, applyCampaign } = require('../utils/googleAdsImport');
const { writeBcLog, logActivity } = require('../utils/bclog');

const WHO = 'Scheduler';
const SECTION = 'Google Ads';
const DEFAULT_DAYS = 30;

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

/** Today's date in the UK, as 'YYYY-MM-DD' (the VPS runs UTC; the Ads account reports UK days). */
function ukToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function windowFromArgs() {
  const to = arg('--to') || addDays(ukToday(), -1);
  const days = Number(arg('--days') || DEFAULT_DAYS);
  const from = arg('--from') || addDays(to, -(days - 1));
  return { from, to };
}

/** One line per report for the console and bclog. */
function describe(name, side, written) {
  if (!side) return `${name} none`;
  const w = side.window ? `${side.window.from}..${side.window.to}` : 'no rows';
  const n = written === undefined ? `${side.counts.write} to write` : `${written} written`;
  return `${name} ${n}, ${side.counts.unchanged} unchanged, ${side.counts.skipped} skipped (${w})`;
}

async function main() {
  const commit = process.argv.includes('--commit');
  const { from, to } = windowFromArgs();
  const parsed = await fetchReports({ from, to });

  if (!commit) {
    const plan = await withTransaction(async (client) => buildPlan(client, parsed));
    for (const side of [plan.product, plan.campaign]) {
      if (!side.counts.balances) console.warn(`[google-ads-sweep] ${side.type}: counts do not balance`);
      if (side.skipped.length) console.log(`[google-ads-sweep] ${side.type} skipped:`, JSON.stringify(side.skipped));
    }
    console.log(`[google-ads-sweep] DRY RUN ${from}..${to}: ${describe('product', plan.product)}; ${describe('campaign', plan.campaign)}`);
    console.log(`[google-ads-sweep] spend £${plan.product.totals.cost} product / £${plan.campaign.totals.cost} campaign. Add --commit to write.`);
    return;
  }

  const msg = await withTransaction(async (client) => {
    // Built inside the transaction, from the database as it is now — the same rule as google-ads-import-commit.
    const plan = await buildPlan(client, parsed);
    const p = await applyProduct(client, plan.product.write, WHO);
    const c = await applyCampaign(client, plan.campaign.write);
    // "Import (API)" — google-ads-import-last reads the latest 'Import…' row as the last import.
    const log = `Import (API): ${describe('product', plan.product, p.written)}; ${describe('campaign', plan.campaign, c.written)}`;
    await writeBcLog(client, { who: WHO, section: SECTION, log });
    return log;
  });
  console.log(`[google-ads-sweep] ${msg}`);
}

main()
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('[google-ads-sweep] FAILED:', err.message);
    if (process.argv.includes('--commit')) {
      await logActivity({ who: WHO, section: SECTION, log: `Import (API) FAILED — nothing written: ${err.message}` });
    }
    process.exit(1);
  });
