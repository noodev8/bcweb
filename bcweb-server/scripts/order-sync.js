/*
=======================================================================================================================================
Script: scripts/order-sync.js   (cron: Update Orders on a timer — WRITES)
=======================================================================================================================================
Purpose: Exactly what pressing Update Orders does, without anyone pressing it: every sales channel read and written (Shopify, eBay, …
         — utils/orderChannels.js), picks allocated, housekeeping, one bclog row (workstation 'cron'). It calls the same function the
         button does — utils/orderSync.js → runOrderSync() — so there is no second copy of any rule here.

         Replaced, 2026-11-01: the Python C:\scripts\orders\update_orders.py (Shopify) and scripts/ebay-order-sync.js (eBay), which ran as
         two cron jobs 5 minutes apart because the Python took no lock. Now one job; the button and this script share the run's advisory
         lock, so if they meet, one waits for the other.

SCHEDULE: crontab.txt in the scripts repo is the definitive source — it isn't restated here.

A channel that can't be read is skipped and the rest still run (logged below and in the bclog row). Exit 1 only when nothing could be
read or the write rolled back — nothing is written in that case.

Usage:
    node scripts/order-sync.js
=======================================================================================================================================
*/

// Load .env by absolute path, so cron can run it with a plain absolute path and no cd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { runOrderSync } = require('../utils/orderSync');

async function main() {
  const r = await runOrderSync({ by: 'cron' });
  console.log(`[order-sync] ${r.log}`);
  for (const c of r.channels) if (!c.checked) console.log(`[order-sync] ${c.name} NOT CHECKED: ${c.error}`);
  for (const n of r.notes) console.log(`[order-sync] note: ${n}`);
  // eBay stock (runOrderSync step 3 — after the orders are saved; never fails the run).
  const e = r.ebayStock;
  if (e && e.error) console.log(`[order-sync] eBay stock sync failed: ${e.error}`);
  else if (e && (e.updated.length || e.failed.length)) {
    console.log(`[order-sync] eBay stock: ${e.updated.map((u) => `${u.code} ${u.from}->${u.to}`).join(', ') || 'nothing updated'}${e.failed.length ? ` · failed: ${e.failed.map((f) => f.code).join(', ')}` : ''}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[order-sync] fatal:', err.message); process.exit(1); });
