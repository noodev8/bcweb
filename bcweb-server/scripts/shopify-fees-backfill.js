/*
=======================================================================================================================================
Script: shopify-fees-backfill
=======================================================================================================================================
Purpose: ONE-OFF (re-runnable). Fill fee_daily with Shopify Payments fees from 1 Sep 2024 (or a date given) to today, for Reports →
         Revenue (2026-10-14). After this, "Update now" on Repricing's Status tab keeps it current (utils/feeDaily.js).

             node scripts/shopify-fees-backfill.js               # from 2024-09-01
             node scripts/shopify-fees-backfill.js 2025-01-01    # from a given day

         Run AFTER migrations/20261014_finance_expenses.sql. Read-only against Shopify; replaces that span of SHOPIFY_PAYMENTS rows.
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');
const { topUpShopifyFees, SHOPIFY_FEES_FROM } = require('../utils/feeDaily');

(async () => {
  const from = process.argv[2] || SHOPIFY_FEES_FROM;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error(`Start must be YYYY-MM-DD, got '${from}'`);
  const r = await topUpShopifyFees(from);
  console.log(`Stored ${r.days} days ${r.from} .. ${r.to}: £${r.fees.toFixed(2)} of fees (${r.pages} API pages).`);
})()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
