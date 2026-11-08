/*
=======================================================================================================================================
Script: scripts/birk-swatches.js   (WRITES Shopify metafields — only with --commit)
=======================================================================================================================================
Purpose: Run the Birkenstock colour-swatch sync (utils/birkSwatches.js — the rule and the metafields are described there) by hand:
         the first fill, or a check. The same sync runs by itself after a Birkenstock product is saved, made live or deleted.
         --families prints every family and its colours per width, so the grouping can be checked by eye.

Usage (from bcweb-server/):
    node scripts/birk-swatches.js --families        dry run + the families
    node scripts/birk-swatches.js --commit          write the differences to Shopify
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { syncSwatches, ensureDefinitions } = require('../utils/birkSwatches');

async function main() {
  const commit = process.argv.includes('--commit');
  if (commit) {
    const made = await ensureDefinitions();
    if (made.length) console.log(`Metafield definitions created: ${made.join(', ')}`);
  }
  const r = await syncSwatches({ commit });
  if (process.argv.includes('--families')) {
    for (const [k, colours] of [...r.families].sort()) console.log(`${k.padEnd(52)} ${colours.length}  ${colours.sort().join(' · ')}`);
  }
  const count = (a) => r.changes.filter((c) => c.action === a).length;
  console.log(`${r.products} Birkenstock products on Shopify — ${count('add')} to add, ${count('change')} to change, ${count('remove')} to remove`
    + (commit ? ' — WRITTEN' : ' — DRY RUN (add --commit to write)'));
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
