/*
=======================================================================================================================================
Script: scripts/amz-order-sync.js   (dry run by default — --commit writes)
=======================================================================================================================================
Purpose: Run the Amazon channel of Update Orders (utils/amzOrderSync.js — THE copy) on its own, to see it working. Update Orders runs
it every time (button + cron), under its lock and inside its transaction; this is for checking by hand.

  --days=N   look back N days instead of from the cursor. With the dry run, every sale already booked by the old Orders upload must
             come back as "already booked" — the proof that keys, prices and dates line up (--compare prints the API's price /
             date beside the booked row for those).
  --compare  for orders already booked, fetch their lines anyway and compare price / date / time / qty with the sales row.
  --commit   write (sales + cancellations + the cursor), in its own transaction under the Update Orders lock.

Usage (from bcweb-server/):
    node scripts/amz-order-sync.js --days=7 --compare     dry run, last 7 days, compared with what is booked
    node scripts/amz-order-sync.js --commit               as Update Orders does
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool, query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const sp = require('../utils/amzSpApi');
const { fetchAmazonOrders, writeAmazonOrders, londonDateTime } = require('../utils/amzOrderSync');

const commit = process.argv.includes('--commit');
const compare = process.argv.includes('--compare');
const daysArg = process.argv.find((a) => a.startsWith('--days='));
const since = daysArg ? new Date(Date.now() - Number(daysArg.split('=')[1]) * 24 * 3600 * 1000) : undefined;

async function compareBooked(sinceDate) {
  // Re-read the orders and fetch lines for the BOOKED ones too, then line them up with the sales rows by source_key.
  const res = await sp.spGet('/orders/v0/orders', { MarketplaceIds: sp.marketplaceId(), LastUpdatedAfter: sinceDate.toISOString() });
  const orders = ((res && res.payload && res.payload.Orders) || []).filter((o) => ['Unshipped', 'PartiallyShipped', 'Shipped'].includes(o.OrderStatus));
  let same = 0;
  const diffs = [];
  const missing = [];
  for (const o of orders.slice(0, 40)) {
    await sp.sleep(600);
    const it = await sp.spGet(`/orders/v0/orders/${encodeURIComponent(o.AmazonOrderId)}/orderItems`);
    const { date, time } = londonDateTime(o.PurchaseDate);
    for (const i of (it && it.payload && it.payload.OrderItems) || []) {
      const key = `AMZ:O:${o.AmazonOrderId}:${i.OrderItemId}`;
      const r = await query(`SELECT qty, soldprice::numeric AS soldprice, solddate::text AS solddate, ordertime FROM sales WHERE source_key = $1`, [key]);
      const b = r.rows[0];
      const qty = Number(i.QuantityOrdered || 0);
      const unit = i.ItemPrice ? Math.round((Number(i.ItemPrice.Amount) / qty) * 100) / 100 : null;
      if (!b) { missing.push(`${o.AmazonOrderId} ${i.SellerSKU} (${o.OrderStatus})`); continue; }
      const d = [];
      if (Number(b.qty) !== qty) d.push(`qty ${b.qty}→${qty}`);
      if (unit !== null && Math.abs(Number(b.soldprice) - unit) > 0.005) d.push(`price £${Number(b.soldprice).toFixed(2)}→£${unit.toFixed(2)}`);
      if (b.solddate !== date) d.push(`date ${b.solddate}→${date}`);
      if (b.ordertime && time && b.ordertime !== time) d.push(`time ${b.ordertime}→${time}`);
      if (d.length) diffs.push(`${o.AmazonOrderId} ${i.SellerSKU}: ${d.join(', ')}`); else same += 1;
    }
  }
  console.log(`\nCompare (first ${Math.min(orders.length, 40)} confirmed orders): ${same} lines identical to the booked row, ${diffs.length} differ, ${missing.length} not booked yet`);
  for (const d of diffs.slice(0, 20)) console.log(`  differs: ${d}`);
  for (const m of missing.slice(0, 20)) console.log(`  not booked: ${m}`);
}

(async () => {
  const t = Date.now();
  try {
    console.log(`Amazon orders — ${commit ? 'WRITING' : 'dry run (nothing written)'}${since ? `, since ${since.toISOString()}` : ', from the cursor'}`);
    const fetched = await fetchAmazonOrders({ since });
    console.log(`  orders read ${fetched.ordersRead} · already booked ${fetched.alreadyBooked} · lines fetched for ${fetched.fetchedOrders} · cancelled ${fetched.cancellations.length}`);

    let out;
    if (commit) {
      out = await withTransaction(async (client) => {
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('bcweb_order_sync'))`);
        return writeAmazonOrders(client, fetched, { commit: true });
      });
    } else {
      out = await writeAmazonOrders({ query }, fetched, { commit: false });
    }
    console.log(`  ${out.log}`);
    for (const l of out.detail.lines.slice(0, 30)) console.log(`    ${l}`);
    for (const n of out.notes.slice(0, 30)) console.log(`  note: ${n}`);
    if (compare && since) await compareBooked(since);
    console.log(`${commit ? 'Written.' : 'Nothing written.'} ${((Date.now() - t) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error('FAILED:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
