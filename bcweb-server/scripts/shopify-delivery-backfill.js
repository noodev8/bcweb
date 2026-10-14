/*
=======================================================================================================================================
Script: shopify-delivery-backfill
=======================================================================================================================================
Purpose: ONE-OFF (re-runnable). Fill shopify_delivery with every Shopify order since 1 Oct 2024 (or a date given) — the delivery
         each customer paid — for Reports → Revenue (2026-10-14). After this, "Update now" on Repricing keeps it current.

             node scripts/shopify-delivery-backfill.js               # orders created since 2024-10-01
             node scripts/shopify-delivery-backfill.js 2025-01-01    # since a given day

         Run AFTER migrations/20261014b_shopify_delivery.sql. Read-only against Shopify; upserts one row per order.
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { topUpDelivery } = require('../utils/shopifyDelivery');

(async () => {
  const from = process.argv[2] || '2024-10-01';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`Start must be YYYY-MM-DD, got '${from}'`);
  const r = await topUpDelivery(`${from}T00:00:00Z`);
  console.log(`Stored ${r.orders} orders since ${from}: £${r.charged.toFixed(2)} of delivery charged, net of refunds (inc. VAT).`);
})()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
