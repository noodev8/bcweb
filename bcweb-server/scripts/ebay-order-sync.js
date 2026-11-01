/*
=======================================================================================================================================
Script: scripts/ebay-order-sync.js   (cron: eBay orders in without anyone pressing Update Orders — WRITES)
=======================================================================================================================================
Purpose: The eBay half of the Update Orders press, on a timer. The Shopify half already runs from cron as the Python update_orders.py;
         this is what makes eBay orders arrive on the same schedule rather than only when someone presses the button (owner, 2026-11-01).

         It runs THE SAME CODE as the button — utils/ebayOrders.js (read eBay) then utils/ebayOrderSync.js (write: new orders + their
         sales, posted orders archived, cancelled orders archived with the shoe handed back) — followed by orderSync.js's pick
         allocation (phase E) so the new pairs are taken off the shelf straight away. No Shopify fetch: the Python does that.

         There is no second copy of any rule here, so the "change both, or neither" warning in utils/orderSync.js doesn't apply to it.

SCHEDULE: crontab.txt in the scripts repo is the definitive source. It runs a few minutes BEFORE each Python order run, never at the
same minute: both allocate shelf stock (phase E), the Python takes no lock, and two allocations interleaving could hand one shelf row
to two orders. The button can't collide with this script — both take the same advisory lock.

AUDIT: one bclog row per run that changed something, section 'eBay Sync' (NOT 'Order Sync' — /order-sync-last reads that section as
"when the button was last pressed"). A quiet run writes nothing.

Usage:
    node scripts/ebay-order-sync.js
Exit code 1 on failure (eBay unreadable, or the write rolled back) — nothing is written in that case.
=======================================================================================================================================
*/

// Load .env by absolute path, so cron can run it with a plain absolute path and no cd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const ebayOrders = require('../utils/ebayOrders');
const { syncEbayOrders } = require('../utils/ebayOrderSync');
const { allocatePicks } = require('../utils/orderSync');

async function main() {
  if (!ebayOrders.isConfigured()) throw new Error('eBay is not set up (EBAY_CLIENT_ID / _SECRET / EBAY_REFRESH_TOKEN in .env)');

  // Fetch first, outside the transaction (same shape as the button).
  const held = await query(`SELECT DISTINCT ordernum FROM orderstatus WHERE channel = 'EBAY'`);
  const fetched = await ebayOrders.fetchEbayOrders(held.rows.map((r) => String(r.ordernum).replace(/^EB/, '')));

  const result = await withTransaction(async (client) => {
    const ebay = await syncEbayOrders(client, fetched);
    // Phase E on its own — the rule the button and the Python both run. Only worth it when there's a new eBay line to place, but it is
    // harmless otherwise (it's idempotent: already-allocated lines are skipped).
    const picks = ebay.inserted ? await allocatePicks(client) : null;

    const changed = ebay.newOrders || ebay.posted || ebay.cancelled;
    if (changed) {
      const log = `eBay Sync (cron): ${ebay.newOrders} new, ${ebay.salesBooked} sales, ${ebay.posted} posted, ${ebay.cancelled} cancelled` +
        `${picks ? `, ${picks.picksTaken} picks` : ''}${ebay.attention ? ' · see notes' : ''}`;
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ('cron', 'eBay Sync', $1,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [log.slice(0, 500)]
      );
    }
    return { ebay, picks };
  });

  const { ebay, picks } = result;
  console.log(`[ebay-order-sync] open=${ebay.open} new=${ebay.newOrders} rows=${ebay.inserted} refreshed=${ebay.updated} ` +
    `sales=${ebay.salesBooked} posted=${ebay.posted} cancelled=${ebay.cancelled} picksTaken=${picks ? picks.picksTaken : 0} ` +
    `picksRemoved=${ebay.picksRemoved} picksFreed=${ebay.picksFreed} unresolved=${ebay.unresolved}${ebay.truncated ? ' TRUNCATED' : ''}`);
  for (const n of ebay.notes) console.log(`[ebay-order-sync] note: ${n}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[ebay-order-sync] fatal:', err.message); process.exit(1); });
