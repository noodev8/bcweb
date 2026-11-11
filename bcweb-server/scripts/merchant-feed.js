/*
=======================================================================================================================================
Script: scripts/merchant-feed.js   (builds the Google Merchant feed file; with --upload, sends it to Merchant Center — THE live feed)
=======================================================================================================================================
Purpose: Build the Google Merchant Center product feed (GOOGLE-DATA-Merchant.txt) from the database and, with --upload, put it on Merchant
         Center's SFTP drop, which Google fetches as the PRIMARY product data (titles, links, stock, RRP, price…). The rules are in
         utils/merchantFeed.js. Runs nightly from the VPS crontab (docs/crontab.txt is the schedule — don't restate it).

MOVED FROM PYTHON (owner, 2026-11-08): replaces the scripts repo's merchant-feed/merchant_feed.py (now in its archive/). Before the switch
the two files were compared against the same data — 2,020 lines, identical byte for byte. Same file name on the SFTP drop, same
MERCHANT_SFTP_* settings (config.merchantSftp).

How the day's prices stay right between feeds: a Shopify price change is pushed to Google as a supplemental salePrice override by the
2-hourly sweep (scripts/google-price-sweep.js → utils/googleMerchant.js); this feed re-asserts everything nightly.

Output: bcweb-server/logs/merchant-feed/GOOGLE-DATA-Merchant.txt (logs/ is gitignored; a deploy's rsync --delete may clear it — it is
rebuilt every run), or the path given with --out. No crontab entry redirects output, so the run writes its own bclog row
(section 'Merchant Feed', who 'Scheduler') on success AND failure. Exits 0 on success, 1 on failure (a failed upload included).

Usage (from bcweb-server/):
    node scripts/merchant-feed.js                 build the file only (safe — nothing leaves the machine)
    node scripts/merchant-feed.js --upload        build + upload (the nightly cron)
    node scripts/merchant-feed.js --out <path>    build to another file
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const SftpClient = require('ssh2-sftp-client');
const { pool, query } = require('../database');
const config = require('../config/config');
const { logActivity } = require('../utils/bclog');
const { FEED_SQL, buildItems, toTsv } = require('../utils/merchantFeed');

const WHO = 'Scheduler';
const SECTION = 'Merchant Feed';
const REMOTE_FILE = 'GOOGLE-DATA-Merchant.txt';   // the name Merchant Center's SFTP data source expects (same as the Python sent)

function outPath() {
  const i = process.argv.indexOf('--out');
  if (i > -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.join(__dirname, '..', 'logs', 'merchant-feed', REMOTE_FILE);
}

// Put the file on Merchant Center's SFTP drop (overwrites the previous night's). Throws on any failure — the caller logs it.
async function upload(file) {
  const { host, port, username, password } = config.merchantSftp;
  const missing = [['MERCHANT_SFTP_HOST', host], ['MERCHANT_SFTP_USERNAME', username], ['MERCHANT_SFTP_PASSWORD', password]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`SFTP not configured — missing ${missing.join(', ')} in .env`);
  const sftp = new SftpClient();
  try {
    await sftp.connect({ host, port, username, password });
    await sftp.put(file, REMOTE_FILE);
  } finally {
    try { await sftp.end(); } catch { /* ignore close errors */ }
  }
}

async function main() {
  const doUpload = process.argv.includes('--upload');
  const { rows } = await query(FEED_SQL);
  const { items, badNumber } = buildItems(rows);
  const file = outPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toTsv(items), 'utf8');

  // Just the total sent (owner, 2026-11-11). The sizes left out for no barcode aren't mentioned: they are placeholder sizes with
  // no stock (77 on 2026-11-11, every one blank / NULL), so the count was noise. A price or cost that isn't a number is still
  // named, and only when it happens: that one is a data error someone has to fix.
  const summary = `${items.length} sizes sent`
    + `${badNumber ? ` (${badNumber} left out: a price or cost that isn't a number)` : ''}`;
  console.log(summary);
  console.log(`Feed file: ${file}`);
  if (!doUpload) { console.log('Built only — add --upload to send it to Google.'); return; }

  await upload(file);
  console.log('Uploaded to Google Merchant Center');
  await logActivity({ who: WHO, section: SECTION, log: `Uploaded: ${summary}` });
}

main()
  .catch(async (err) => {
    console.error('[merchant-feed] failed:', err.message);
    if (process.argv.includes('--upload')) await logActivity({ who: WHO, section: SECTION, log: `FAILED: ${err.message}` });
    process.exitCode = 1;
  })
  .finally(() => pool.end());
