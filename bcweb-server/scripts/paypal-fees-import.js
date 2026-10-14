/*
=======================================================================================================================================
Script: paypal-fees-import
=======================================================================================================================================
Purpose: Load a PayPal "All transactions" export into fee_daily (source PAYPAL), for Reports → Revenue's Shopify expenses
         (2026-10-14). PayPal fees only ever arrive in this export; the first load was the owner's Sep 2025 – Aug 2026 file.

             node scripts/paypal-fees-import.js <path-to-csv>            # dry run — prints the span and total, writes nothing
             node scripts/paypal-fees-import.js <path-to-csv> --apply    # replaces PAYPAL rows for the export's first..last day

         Parsed by utils/financePayPal.js → payPalFeesByDay (the Month End parser's header check; DD/MM/YYYY dates or it refuses).
         Every day in the export's span gets a row (£0 if no fee), so the Revenue page knows exactly which days are real.
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { pool } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { payPalFeesByDay } = require('../utils/financePayPal');
const { storeDays } = require('../utils/feeDaily');

(async () => {
  const file = process.argv[2];
  const apply = process.argv.includes('--apply');
  if (!file) throw new Error('Usage: node scripts/paypal-fees-import.js <csv> [--apply]');
  const r = payPalFeesByDay(fs.readFileSync(file, 'utf8'));
  if (!r.ok) throw new Error(r.reason);
  const total = r.days.reduce((a, d) => a + d.fees, 0);
  console.log(`${r.first} .. ${r.last}: ${r.days.length} days with fees, £${total.toFixed(2)}.`);
  if (!apply) { console.log('Dry run — nothing written. Add --apply to store.'); return; }
  const n = await withTransaction((client) => storeDays(client, 'PAYPAL', r.first, r.last, r.days));
  console.log(`Stored ${n} PAYPAL days.`);
})()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
