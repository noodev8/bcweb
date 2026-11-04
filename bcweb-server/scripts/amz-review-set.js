/*
=======================================================================================================================================
Script: scripts/amz-review-set.js   (WRITES — Amazon review dates, only with --commit; the /amz-pricing skill's "leave" step)
=======================================================================================================================================
Purpose: Mark Amazon sizes the standard checked and LEFT ("leave") as reviewed, so they leave the Amazon Due list and the next
         `amz-pricing-check.js --due` moves on to other sizes — the same rotation as the team's manual Due list (owner, 2026-11-04:
         "same system as our manual due dates ... use smaller windows"). Built so a less capable AI agent can run it safely.

WHAT IT WRITES — through THE shared W-A2 write (utils/amzReviewWrite.js, the same as the Amazon screens' "mark reviewed"):
  skumap.next_amz_price_review = today + --days (default SETTINGS.REVIEW_AFTER_LEAVE_DAYS = 3), KEEPING a later date already set
  (a size parked longer on purpose stays parked), and one HOLD row per size in amz_price_log (new = old price — shows on Price
  Changes; never goes into the upload file as a change). No price change, no Shopify, never amzfeed.

GUARDS:
  - Dry run by default; --commit writes.
  - --by <name> (the OWNER, e.g. "Andreas") and --note <text> required.
  - Exact codes only, each must be on Amazon (amzfeed); at most 50 per run.
  - --days 1–14 only (owner: short windows; a long park is a person's call on the screens).

Usage:
    node scripts/amz-review-set.js <CODE> [CODE ...] --by "Andreas" --note "leave — in line with sisters (amz-pricing)"           dry run
    node scripts/amz-review-set.js <CODE> [CODE ...] --by "Andreas" --note "..." --commit                                        write
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { writeAmzReview } = require('../utils/amzReviewWrite');
const { SETTINGS } = require('../utils/amzPricingStandard');

const MAX_CODES = 50;
const MAX_DAYS = 14;

function args(argv) {
  const o = { codes: [], days: SETTINGS.REVIEW_AFTER_LEAVE_DAYS, by: null, note: null, commit: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--by') o.by = argv[(i += 1)];
    else if (a === '--note') o.note = argv[(i += 1)];
    else if (a === '--days') o.days = Number(argv[(i += 1)]);
    else if (a === '--commit') o.commit = true;
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
    else o.codes.push(a.trim());
  }
  o.codes = [...new Set(o.codes.filter(Boolean))];
  if (!o.codes.length) throw new Error('Usage: amz-review-set.js <CODE> [CODE ...] --by "<name>" --note "<why>" [--days N] [--commit]');
  if (o.codes.length > MAX_CODES) throw new Error(`At most ${MAX_CODES} codes per run`);
  if (!Number.isInteger(o.days) || o.days < 1 || o.days > MAX_DAYS) throw new Error(`--days must be a whole number 1–${MAX_DAYS}`);
  if (!o.by || !o.by.trim()) throw new Error('--by "<name>" is required (the owner who agreed it)');
  if (!o.note || !o.note.trim()) throw new Error('--note "<short why>" is required');
  o.by = o.by.trim();
  o.note = o.note.trim().slice(0, 500);
  return o;
}

async function main() {
  const o = args(process.argv.slice(2));
  const f = await pool.query(
    `SELECT a.code, m.next_amz_price_review::text AS next_review, (CURRENT_DATE + $2::int)::text AS target
     FROM amzfeed a JOIN skumap m ON m.code = a.code WHERE a.code = ANY($1::text[]) ORDER BY a.code`,
    [o.codes, o.days]
  );
  const found = new Set(f.rows.map((r) => r.code));
  const missing = o.codes.filter((c) => !found.has(c));
  if (missing.length) {
    console.log(`REFUSED — nothing written: not on Amazon (use exact codes): ${missing.join(' ')}`);
    process.exitCode = 2;
    return;
  }
  for (const r of f.rows) {
    const keep = r.next_review && r.next_review > r.target;
    console.log(`  ${r.code}  review ${r.next_review || 'none'} → ${keep ? `${r.next_review} (later date kept)` : r.target}`);
  }
  console.log(`  by ${o.by} · note "${o.note}"`);
  if (!o.commit) {
    console.log('DRY RUN — nothing written. Run again with --commit once the owner has agreed.');
    return;
  }
  const w = await withTransaction((client) => writeAmzReview(client, {
    codes: o.codes, reviewDays: o.days, note: o.note, changedBy: o.by, keepLater: true,
  }));
  console.log(`WRITTEN — ${w.rowCount} sizes reviewed, ${w.logged} hold rows logged.`);
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[amz-review-set] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
