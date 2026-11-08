/*
=======================================================================================================================================
Script: scripts/merchant-feed.js   (READ ONLY — builds the Google Merchant feed file; uploading comes in a later step)
=======================================================================================================================================
Purpose: Build the Google Merchant Center product feed (GOOGLE-DATA-Merchant.txt) from the database. The rules are in
         utils/merchantFeed.js.

STEP 1 of moving merchant_feed.py (scripts repo, nightly on the VPS) into BCWEB (owner, 2026-11-08): this builds the SAME file the Python
does, so the two can be compared line by line. It does NOT upload — the Python's nightly --upload stays the live feed until the files
match, then the cron line is switched to this script (with SFTP upload added) and the Python is archived.

Output: bcweb-server/logs/merchant-feed/GOOGLE-DATA-Merchant.txt (logs/ is gitignored), or the path given with --out.

Usage (from bcweb-server/):
    node scripts/merchant-feed.js
    node scripts/merchant-feed.js --out D:/somewhere/feed.txt
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../database');
const { FEED_SQL, buildItems, toTsv } = require('../utils/merchantFeed');

function outPath() {
  const i = process.argv.indexOf('--out');
  if (i > -1 && process.argv[i + 1]) return path.resolve(process.argv[i + 1]);
  return path.join(__dirname, '..', 'logs', 'merchant-feed', 'GOOGLE-DATA-Merchant.txt');
}

async function main() {
  const { rows } = await query(FEED_SQL);
  const { items, noGtin, badNumber } = buildItems(rows);
  const file = outPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, toTsv(items), 'utf8');
  console.log(`${rows.length} sizes read — ${items.length} in the feed, ${noGtin} left out (no valid barcode)`
    + (badNumber ? `, ${badNumber} left out (a price or cost that isn't a number)` : ''));
  console.log(`Feed file: ${file}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
