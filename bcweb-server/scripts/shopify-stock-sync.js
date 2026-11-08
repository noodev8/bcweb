/*
=======================================================================================================================================
Script: scripts/shopify-stock-sync.js   (READ ONLY — sends stock to Shopify only with --commit)
=======================================================================================================================================
Purpose: Run the Shopify stock sync (utils/shopifyStockSync.js — the rule is described there) by hand: see what it would change, or
         send it. The same sync runs at the end of Update Orders.

Usage (from bcweb-server/):
    node scripts/shopify-stock-sync.js            dry run — every size that would change, and why
    node scripts/shopify-stock-sync.js --commit   send the changes to Shopify
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { syncShopifyStock } = require('../utils/shopifyStockSync');

async function main() {
  const commit = process.argv.includes('--commit');
  const r = await syncShopifyStock({ commit });
  console.log(`${r.checked} live sizes checked — ${r.changes.length} differ`
    + ` · unfulfilled Shopify orders not yet in BCWEB: ${r.ordersRead ? `${r.pendingOrders} pair(s)` : 'COULD NOT READ (decreases only)'}`
    + (r.notOnShopify ? ` · ${r.notOnShopify} not on Shopify` : '') + (r.noLevel ? ` · ${r.noLevel} with no stock record at the location` : ''));
  for (const c of r.changes) {
    console.log(`  ${c.code.padEnd(22)} Shopify ${c.shopify} → ${c.want}   (local ${c.local}, FBA ${c.fba}${c.pending ? `, on unimported orders ${c.pending}` : ''})`);
  }
  if (!commit) { if (r.changes.length) console.log('DRY RUN — add --commit to send.'); return; }
  console.log(`Sent ${r.sent.length}, Shopify moved meanwhile ${r.stale.length} (next run), failed ${r.failed.length}`);
  for (const f of r.failed) console.log(`  FAILED ${f.code}: ${f.error}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
