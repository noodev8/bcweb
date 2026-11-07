/*
=======================================================================================================================================
Script: scripts/shopify-sessions-backfill.js   (fill shopify_sessions_daily from Shopify's sessions report — DRY RUN by default)
=======================================================================================================================================
Purpose: Shopify's visits per day by source (utils/shopifySessions.js — THE rule and the read) for past days, a month at a time.
         Update Orders keeps the last 3 days current from then on; this is the one-off for history. Defaults to the full 2 years the
         table keeps (anything older would be purged on the next run anyway).

         DRY RUN by default: prints visits per month and by came_from, writes nothing. --commit writes (each month REPLACES its days —
         safe to run again). Needs migrations/20261107b_shopify_sessions_daily.sql applied first.

Usage:
    node scripts/shopify-sessions-backfill.js                        (dry run, last 2 years)
    node scripts/shopify-sessions-backfill.js --since 2026-01-01
    node scripts/shopify-sessions-backfill.js --commit
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { parseArgs } = require('util');
const { recordSessions } = require('../utils/shopifySessions');
const { KEEP_YEARS } = require('../utils/orderSource');

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function main() {
  const { values: args } = parseArgs({ options: { since: { type: 'string' }, commit: { type: 'boolean', default: false } } });
  const now = new Date();
  const start = args.since ? new Date(`${args.since}T00:00:00`) : new Date(now.getFullYear() - KEEP_YEARS, now.getMonth(), now.getDate());
  console.log(`${args.commit ? 'WRITING' : 'DRY RUN (add --commit to write)'} — Shopify sessions from ${ymd(start)}\n`);

  const tally = {}; let total = 0;
  // Month windows: [start, end of that month], then each following month, the last one up to today.
  for (let from = start; from <= now;) {
    const monthEnd = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    const to = monthEnd < now ? monthEnd : null;   // null = up to today
    const r = await recordSessions({ since: ymd(from), until: to ? ymd(to) : undefined, write: args.commit });
    console.log(`  ${ymd(from).slice(0, 7)}  ${String(r.sessions).padStart(6)} visits  ${String(r.days).padStart(2)} days  ${r.rows} rows`);
    for (const [k, n] of Object.entries(r.tally)) tally[k] = (tally[k] || 0) + n;
    total += r.sessions;
    from = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  }
  console.log('\n  by where they came from:');
  for (const [k, n] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(24)} ${String(n).padStart(7)}  ${Math.round((n / total) * 100)}%`);
  }
  console.log(`\n  ${total} visits${args.commit ? ' recorded' : ' — nothing written'}.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[shopify-sessions-backfill] failed:', err.message); process.exit(1); });
