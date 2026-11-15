/*
=======================================================================================================================================
Script: scripts/google-jobs.js   (EVERY scheduled Google job — one script, split inside; owner 2026-11-15)
=======================================================================================================================================
Purpose: Owner: "Ideally we would have all google work in one script and split inside it." It replaced three scripts on 2026-11-15:
         scripts/merchant-feed.js, scripts/google-ads-sweep.js and scripts/google-price-sweep.js (their headers are in git history).
         The rules are NOT here — each part only calls its util, so this file is the schedule's way in and nothing more:
           feed     the Merchant Center product feed — utils/merchantFeed.js (THE rules), put on Merchant Center's SFTP drop.
           ads      the Google Ads reports, last 30 days — utils/googleAdsApi.js + utils/googleAdsImport.js (the upload's own plan).
           benchmark  Google's per-size price benchmark → its 12-month change-only history — utils/googleBenchmark.js (THE rules;
                    docs/shopify-cards/PLAN.md decision 5). Added 2026-11-15 for the Shopify price cards.
           prices   un-sent Shopify price changes → Google — utils/googleMerchant.js → pushIfLive.

TWO CRON LINES (docs/crontab.txt is the schedule — don't restate it here): --nightly runs feed, ads, then benchmark; --prices runs
         through the day.
         A cron line can't be both nightly and every two hours, hence two.

EACH PART STANDS ALONE. A part that fails is logged and the next part still runs; the run exits 1 if any part failed. Each keeps the
         bclog section it had as its own script, so the screens reading them don't change: 'Merchant Feed' (the feed, success and
         failure) and 'Google Ads' (google-ads-import-last reads its latest 'Import…' row for the screen's freshness line).
         'Google Benchmark' writes a row each night, success or failure, like the feed.
         'Google Prices' is new: the old price sweep only wrote to the console, which cron drops, so a failing sweep went unseen
         (docs/maintenance-notes.md, "There is no sweep log file"). It writes a bclog row on FAILURE only — every 2 hours of "all
         fine" would bury the log.

--dry: nothing leaves the machine and nothing is written — feed builds the file only, ads prints its plan, benchmark reads Google and
         says what it would write (rolled back), prices lists what's pending.

Usage (from bcweb-server/):
    node scripts/google-jobs.js --nightly                    the nightly cron: feed (upload), ads (write), benchmark (write)
    node scripts/google-jobs.js --prices                     the daytime cron: send un-sent Shopify prices to Google
    node scripts/google-jobs.js --nightly --dry              every nightly part, nothing sent or written
    node scripts/google-jobs.js --only feed|ads|benchmark|prices [--dry]    one part by hand
  feed:  --out <path>                 build the file somewhere else
  ads:   --days N | --from YYYY-MM-DD --to YYYY-MM-DD      a wider window or a back-fill (default: 30 days to yesterday, UK)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const { pool, query } = require('../database');
const config = require('../config/config');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog, logActivity } = require('../utils/bclog');
const { FEED_SQL, buildItems, toTsv } = require('../utils/merchantFeed');
const { fetchReports } = require('../utils/googleAdsApi');
const { buildPlan, applyProduct, applyCampaign } = require('../utils/googleAdsImport');
const googleMerchant = require('../utils/googleMerchant');
const { readBenchmarks, recordBenchmarks } = require('../utils/googleBenchmark');

const WHO = 'Scheduler';
const DRY = process.argv.includes('--dry');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

// ===================================================================================================================================
// FEED — build the Merchant Center product feed and put it on the SFTP drop, which Google fetches as the PRIMARY product data (titles,
// links, stock, RRP, price…). Same file name on the drop as the Python merchant_feed.py it replaced (2026-11-08, byte-for-byte match).
// The file lands in bcweb-server/logs/merchant-feed/ (gitignored; a deploy's rsync --delete may clear it — it is rebuilt every run).
// ===================================================================================================================================
const FEED_SECTION = 'Merchant Feed';
const FEED_REMOTE_FILE = 'GOOGLE-DATA-Merchant.txt';   // the name Merchant Center's SFTP data source expects

async function sftpUpload(file) {
  const { host, port, username, password } = config.merchantSftp;
  const missing = [['MERCHANT_SFTP_HOST', host], ['MERCHANT_SFTP_USERNAME', username], ['MERCHANT_SFTP_PASSWORD', password]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`SFTP not configured — missing ${missing.join(', ')} in .env`);
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host, port, username, password });
    await sftp.put(file, FEED_REMOTE_FILE);   // overwrites the previous night's
  } finally {
    try { await sftp.end(); } catch { /* ignore close errors */ }
  }
}

async function feed() {
  try {
    const { rows } = await query(FEED_SQL);
    const { items, badNumber } = buildItems(rows);
    const file = arg('--out') ? path.resolve(arg('--out')) : path.join(__dirname, '..', 'logs', 'merchant-feed', FEED_REMOTE_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, toTsv(items), 'utf8');

    // Just the total sent (owner, 2026-11-11). Sizes left out for no barcode aren't mentioned (placeholder sizes with no stock — noise);
    // a price or cost that isn't a number is named, only when it happens: that is a data error someone has to fix.
    const summary = `${items.length} sizes sent${badNumber ? ` (${badNumber} left out: a price or cost that isn't a number)` : ''}`;
    console.log(`[feed] ${summary} — file ${file}`);
    if (DRY) { console.log('[feed] DRY RUN — built only, not sent to Google.'); return; }

    await sftpUpload(file);
    console.log('[feed] uploaded to Google Merchant Center');
    await logActivity({ who: WHO, section: FEED_SECTION, log: `Uploaded: ${summary}` });
  } catch (err) {
    if (!DRY) await logActivity({ who: WHO, section: FEED_SECTION, log: `FAILED: ${err.message}` });
    throw err;
  }
}

// ===================================================================================================================================
// ADS — the Google Ads reports from the API, written through the SAME plan and upserts as the screen's old CSV upload.
// WHY IT RE-READS 30 DAYS EVERY NIGHT: Google revises conversions upward for weeks after the click, so the last 30 days keep changing.
// The upsert takes the later figure and counts an identical row as `unchanged`, so re-reading is cheap, keeps every recent day current,
// and a missed night (or a run before Google has finished yesterday) costs nothing — the next run covers it. `to` is YESTERDAY (UK).
// Writes in ONE transaction with its bclog row inside it; a failure writes its own row and nothing else. Two API operations a run.
// ===================================================================================================================================
const ADS_SECTION = 'Google Ads';
const ADS_DEFAULT_DAYS = 30;

/** Today's date in the UK, as 'YYYY-MM-DD' (the VPS runs UTC; the Ads account reports UK days). */
function ukToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function adsWindow() {
  const to = arg('--to') || addDays(ukToday(), -1);
  const days = Number(arg('--days') || ADS_DEFAULT_DAYS);
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

async function ads() {
  try {
    const { from, to } = adsWindow();
    const parsed = await fetchReports({ from, to });

    if (DRY) {
      const plan = await withTransaction(async (client) => buildPlan(client, parsed));
      for (const side of [plan.product, plan.campaign]) {
        if (!side.counts.balances) console.warn(`[ads] ${side.type}: counts do not balance`);
        if (side.skipped.length) console.log(`[ads] ${side.type} skipped:`, JSON.stringify(side.skipped));
      }
      console.log(`[ads] DRY RUN ${from}..${to}: ${describe('product', plan.product)}; ${describe('campaign', plan.campaign)}`);
      console.log(`[ads] spend £${plan.product.totals.cost} product / £${plan.campaign.totals.cost} campaign — nothing written.`);
      return;
    }

    const msg = await withTransaction(async (client) => {
      // Built inside the transaction, from the database as it is now — the same rule as google-ads-import-commit.
      const plan = await buildPlan(client, parsed);
      const p = await applyProduct(client, plan.product.write, WHO);
      const c = await applyCampaign(client, plan.campaign.write);
      // "Import (API)" — google-ads-import-last reads the latest 'Import…' row as the last import.
      const log = `Import (API): ${describe('product', plan.product, p.written)}; ${describe('campaign', plan.campaign, c.written)}`;
      await writeBcLog(client, { who: WHO, section: ADS_SECTION, log });
      return log;
    });
    console.log(`[ads] ${msg}`);
  } catch (err) {
    if (!DRY) await logActivity({ who: WHO, section: ADS_SECTION, log: `Import (API) FAILED — nothing written: ${err.message}` });
    throw err;
  }
}

// ===================================================================================================================================
// BENCHMARK — Google's per-size price benchmark into its change-only, 12-month history. The rules are utils/googleBenchmark.js; this
// only reads, writes in ONE transaction with its bclog row inside it, and logs a failure on its own. --dry does the same work and
// rolls it back, so the counts it prints are exactly what a real run would write.
// ===================================================================================================================================
const BENCHMARK_SECTION = 'Google Benchmark';

class DryRunRollback extends Error {
  constructor(result) { super('dry run — rolled back'); this.result = result; }
}

async function benchmark() {
  try {
    const benchmarks = await readBenchmarks();
    const describeRun = (r) => `${r.offers} benchmarks, ${r.sizes} of our sizes, ${r.changed} changed, ${r.trimmed} trimmed (${r.day})`;
    if (DRY) {
      try {
        await withTransaction(async (client) => { throw new DryRunRollback(await recordBenchmarks(client, benchmarks)); });
      } catch (e) {
        if (!(e instanceof DryRunRollback)) throw e;
        console.log(`[benchmark] DRY RUN — would write: ${describeRun(e.result)}; rolled back.`);
      }
      return;
    }
    const msg = await withTransaction(async (client) => {
      const log = `Read: ${describeRun(await recordBenchmarks(client, benchmarks))}`;
      await writeBcLog(client, { who: WHO, section: BENCHMARK_SECTION, log });
      return log;
    });
    console.log(`[benchmark] ${msg}`);
  } catch (err) {
    if (!DRY) await logActivity({ who: WHO, section: BENCHMARK_SECTION, log: `FAILED — nothing written: ${err.message}` });
    throw err;
  }
}

// ===================================================================================================================================
// PRICES — push recent Shopify price changes to Google as the supplemental salePrice override, in one deduped pass. pricing-apply (W1)
// doesn't touch Google; it logs to price_change_log and this sends the un-sent ones. The nightly feed is the backstop.
//   1. DISTINCT Google-live styles with an un-sent change = automatic dedup: a style repriced 10x since the last run is pushed ONCE,
//      at its CURRENT price.
//   2. pushIfLive(groupid) for each — the same in-process push the app uses (a supplemental override for every size's googleid).
//   3. Stamp google_pushed_at only on styles that CLEANLY landed or were legit no-ops; a style with any failure stays queued and the
//      next run retries it.
// Idempotent, a no-op when nothing is pending, never writes skusummary.
// ===================================================================================================================================
const PRICES_SECTION = 'Google Prices';

async function prices() {
  try {
    // NO-OP GUARD (2026-08-31): skip rows where the price didn't move — the HOLD rows the park routes write (new = old, born
    // pre-stamped anyway, docs/hold-logging-spec.md) and the occasional apply of the price a style already had. IS DISTINCT FROM, not
    // <>: a legacy row with a NULL price is a real change we can't characterise, so it stays queued rather than dropped by NULL logic.
    // SIZE PRICES (2026-11-08, utils/sizePrice.js): every un-sent shopify_size_price_log row queues its style too — the ENDS matter as
    // much as the sets, or the supplemental override would keep the old size price on Google. One push sends every size as it is now.
    // (Add / Modify logs here AND pushes Google inline, so its change is sent twice — harmless, the override is a repeatable write.)
    const pending = await query(`
      SELECT l.groupid
      FROM price_change_log l
      JOIN skusummary sm ON sm.groupid = l.groupid
      WHERE l.channel = 'SHP'
        AND l.google_pushed_at IS NULL
        AND l.new_price IS DISTINCT FROM l.old_price
        AND sm.googlestatus = 1 AND sm.shopify = 1
      UNION
      SELECT s.groupid
      FROM shopify_size_price_log s
      JOIN skusummary sm ON sm.groupid = s.groupid
      WHERE s.google_pushed_at IS NULL
        AND sm.googlestatus = 1 AND sm.shopify = 1
    `);
    const groupids = pending.rows.map((r) => r.groupid);

    if (groupids.length === 0) { console.log('[prices] nothing pending'); return; }
    if (DRY) { console.log(`[prices] DRY RUN — ${groupids.length} style(s) pending, nothing sent: ${groupids.join(', ')}`); return; }

    let pushed = 0, noop = 0, failed = 0, absent = 0;
    const done = [];   // groupids whose pending rows may be stamped (cleanly pushed OR a legit no-op)

    // Sequential per style — each pushIfLive already fires its sizes concurrently, and a cron job needn't hammer the Merchant API.
    for (const groupid of groupids) {
      const res = await googleMerchant.pushIfLive(groupid);
      if (res === null) {
        // Not live on Google / no googleid (raced with a de-list since the change) — nothing to push; stamp so it doesn't linger.
        done.push(groupid);
        noop += 1;
      } else if (res.pushed === true && res.failed === 0) {
        // `absent` (Google 404 — no such product) is NOT a failure: a retry can never succeed, so the row is still stamped. Counted
        // only so a run that quietly skipped some sizes still says so.
        absent += res.absent || 0;
        done.push(groupid);
        pushed += 1;
      } else {
        // Partial or wholesale failure (incl. GOOGLE_NOT_CONFIGURED) — left queued so the next run retries it.
        failed += 1;
        absent += res.absent || 0;
        console.error(`[prices] ${groupid} not stamped: ${res.error || 'partial failure'}${res.message ? ` (${res.message})` : ''}`);
      }
    }

    if (done.length) {
      await query(`
        UPDATE price_change_log SET google_pushed_at = now()
         WHERE channel = 'SHP' AND google_pushed_at IS NULL AND groupid = ANY($1::text[])
      `, [done]);
      await query(`
        UPDATE shopify_size_price_log SET google_pushed_at = now()
         WHERE google_pushed_at IS NULL AND groupid = ANY($1::text[])
      `, [done]);
    }

    const line = `pending=${groupids.length} pushed=${pushed} noop=${noop} absent=${absent} failed=${failed} stamped=${done.length}`;
    console.log(`[prices] ${line}`);
    // A style left queued is retried next run, so it isn't a FAILED run — but it is worth a line where someone will see it.
    if (failed) await logActivity({ who: WHO, section: PRICES_SECTION, log: `${failed} style(s) not sent, retried next run: ${line}` });
  } catch (err) {
    if (!DRY) await logActivity({ who: WHO, section: PRICES_SECTION, log: `FAILED: ${err.message}` });
    throw err;
  }
}

// ===================================================================================================================================
// RUN
// ===================================================================================================================================
const PARTS = { feed, ads, benchmark, prices };

function partsToRun() {
  const only = arg('--only');
  if (only) {
    if (!PARTS[only]) throw new Error(`--only takes ${Object.keys(PARTS).join(' | ')}, not "${only}"`);
    return [only];
  }
  if (process.argv.includes('--nightly')) return ['feed', 'ads', 'benchmark'];
  if (process.argv.includes('--prices')) return ['prices'];
  throw new Error('say what to run: --nightly, --prices or --only <part> (see the header)');
}

async function main() {
  let failed = 0;
  for (const name of partsToRun()) {
    try {
      await PARTS[name]();
    } catch (err) {
      // Logged by the part itself (bclog); the next part still runs.
      failed += 1;
      console.error(`[${name}] FAILED: ${err.message}`);
    }
  }
  return failed;
}

main()
  .then((failed) => { process.exitCode = failed ? 1 : 0; })
  .catch((err) => { console.error(`[google-jobs] ${err.message}`); process.exitCode = 1; })
  .finally(async () => {
    await pool.end().catch(() => {});
    process.exit();   // exits with process.exitCode — and doesn't wait on an SFTP socket that hasn't let go
  });
