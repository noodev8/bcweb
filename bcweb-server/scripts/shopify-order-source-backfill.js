/*
=======================================================================================================================================
Script: scripts/shopify-order-source-backfill.js   (fill shopify_order_source for past orders — DRY RUN by default)
=======================================================================================================================================
Purpose: Where each past Shopify order's buyer came from, through THE rule (utils/orderSource.js → cameFrom), into
         shopify_order_source. Update Orders keeps it current from then on (the last 3 days, every run); this is the one-off for history.
         Shopify serves every order (the token has read_all_orders), so any start date works.

         DRY RUN by default: reads Shopify and prints the tally by came_from (orders and £), writes nothing. --commit writes (an upsert —
         safe to run again; it refreshes the rows). Needs migrations/20261107_shopify_order_source.sql applied first.

Usage:
    node scripts/shopify-order-source-backfill.js                         (dry run, last 60 days)
    node scripts/shopify-order-source-backfill.js --since 2025-01-01      (dry run from a date)
    node scripts/shopify-order-source-backfill.js --since 2025-01-01 --commit
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { parseArgs } = require('util');
const { recordOrderSources } = require('../utils/orderSource');

async function main() {
  const { values: args } = parseArgs({
    options: { since: { type: 'string' }, until: { type: 'string' }, commit: { type: 'boolean', default: false } },
  });
  const since = args.since || new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  console.log(`${args.commit ? 'WRITING' : 'DRY RUN (add --commit to write)'} — Shopify orders from ${since}${args.until ? ` to ${args.until}` : ''}\n`);

  const r = await recordOrderSources({ since, until: args.until, write: args.commit });
  const rows = Object.entries(r.tally).sort((a, b) => b[1].orders - a[1].orders);
  const web = rows.filter(([k]) => k !== 'Not online').reduce((a, [, t]) => a + t.orders, 0);
  console.log(`  ${'came from'.padEnd(26)} ${'orders'.padStart(7)} ${'% web'.padStart(6)} ${'£'.padStart(9)}`);
  for (const [k, t] of rows) {
    const share = k === 'Not online' ? '' : `${Math.round((t.orders / web) * 100)}%`;
    console.log(`  ${k.padEnd(26)} ${String(t.orders).padStart(7)} ${share.padStart(6)} ${Math.round(t.total).toLocaleString('en-GB').padStart(9)}`);
  }
  console.log(`\n  ${r.read} orders read${args.commit ? `, ${r.recorded} recorded` : ' — nothing written'}.\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[shopify-order-source-backfill] failed:', err.message); process.exit(1); });
