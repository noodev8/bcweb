/*
=======================================================================================================================================
Util: utils/amzOrderSync.js   — the AMAZON channel of Update Orders (SP-API Orders API -> sales, channel 'AMZ')
=======================================================================================================================================
Purpose: Book Amazon sales on every Update Orders (button + cron) instead of from the Orders report uploaded on Update Amazon (owner,
2026-11-09: no cross-check week — the Orders file came off that screen the same day; Amazon orders COUNT in the button's "n new
orders" — "Even though we dont have to pack them, its good to see").

A CHANNEL like Shopify and eBay (utils/orderChannels.js), so it shares the run's lock, its transaction, the headline and the
"not checked" rule (Amazon unreadable -> the other channels still run). It writes NO orderstatus rows — FBA orders aren't picked or
packed here — so pick allocation, housekeeping and the Fulfil buttons never see it.

THE RULES ARE THE IMPORT'S OWN — this file only turns the API's answer into the rows the Orders report parser made
(utils/amzReports.js → parseOrderRow) and hands them to the SAME planner and writes:
  utils/amzImport.js → planSales          duplicate guard, profit (utils/amzProfit.js), discount vs RRP, unknown SKUs
  utils/amzImportApply.js → insertSales   ON CONFLICT (source_key) DO NOTHING
  planCancellations + retractCancelled    a Canceled order's sale rows DELETED (the sale never happened), as the upload did
THE KEY is the report's: 'AMZ:O:<AmazonOrderId>:<OrderItemId>' — the API carries the same two numbers, so a sale the old upload
booked is "already there", never a second row.

DIFFERENCES FROM THE REPORT (known, accepted):
  - Pending orders carry no price in the API, so they are booked on the first run after Amazon confirms them (Unshipped / Shipped —
    for FBA usually within the hour). The report booked them while Pending.
  - Dates: the API gives UTC; converted here to the Europe/London date + HH:MM the report gave (an order at 00:30 BST is that day).
  - Amazon.co.uk only, as the report's sales-channel filter — multi-channel (MCF) orders for eBay / Shopify pairs never appear.

CURSOR: amz_api_sync job 'orders' — orders LAST UPDATED since the last good run less an hour (Amazon needs the time to be at least
2 minutes ago). First run: 7 days back — everything there should already be booked, so it books nothing and proves the match.
Updated inside the run's transaction, so a rolled-back run asks again from the same point.
Speed: one getOrders call (+ pages of 100) and one getOrderItems per order NOT already booked — a few seconds a run.
=======================================================================================================================================
*/

const sp = require('./amzSpApi');
const { query } = require('../database');
const { loadReference, planSales, planCancellations } = require('./amzImport');
const { insertSales, retractCancelled } = require('./amzImportApply');

const JOB = 'orders';
const OVERLAP_MS = 60 * 60 * 1000;
const FIRST_RUN_DAYS = 7;
const BOOK_STATUSES = new Set(['Unshipped', 'PartiallyShipped', 'Shipped']);

const londonParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
/** UTC ISO -> { date: 'YYYY-MM-DD', time: 'HH:MM' } in Europe/London. */
function londonDateTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: null, time: null };
  const p = Object.fromEntries(londonParts.formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function isConfigured() {
  return Boolean(process.env.AMZ_SP_CLIENT_ID && process.env.AMZ_SP_CLIENT_SECRET && process.env.AMZ_SP_REFRESH_TOKEN);
}

async function readCursor() {
  try {
    const r = await query(`SELECT cursor_at FROM amz_api_sync WHERE job = $1`, [JOB]);
    return r.rows[0] && r.rows[0].cursor_at ? new Date(r.rows[0].cursor_at) : null;
  } catch (err) {
    if (/amz_api_sync/.test(err.message)) return null;
    throw err;
  }
}

/**
 * NETWORK READ (before the run's transaction). Returns the order lines in the report parser's shape, plus cancellations.
 * @param since optional Date — override the cursor (scripts/amz-order-sync.js)
 */
async function fetchAmazonOrders({ since: sinceOverride } = {}) {
  const startedAt = new Date();
  const cursor = await readCursor();
  let since = sinceOverride
    || (cursor ? new Date(cursor.getTime() - OVERLAP_MS) : new Date(Date.now() - FIRST_RUN_DAYS * 24 * 3600 * 1000));
  const latest = new Date(Date.now() - 3 * 60 * 1000);          // Amazon: LastUpdatedAfter must be 2+ minutes ago
  if (since > latest) since = latest;

  // 1. Orders updated since then (100 a page).
  const orders = [];
  let next;
  do {
    const q = next
      ? { MarketplaceIds: sp.marketplaceId(), NextToken: next }
      : { MarketplaceIds: sp.marketplaceId(), LastUpdatedAfter: since.toISOString() };
    const res = await sp.spGet('/orders/v0/orders', q);
    const p = (res && res.payload) || {};
    orders.push(...(p.Orders || []));
    next = p.NextToken;
    if (next) await sp.sleep(1100);
  } while (next);

  const uk = orders.filter((o) => (o.SalesChannel || 'Amazon.co.uk') === 'Amazon.co.uk');
  const cancellations = uk.filter((o) => o.OrderStatus === 'Canceled').map((o) => ({ orderId: o.AmazonOrderId, sku: '' }));
  const toBook = uk.filter((o) => BOOK_STATUSES.has(o.OrderStatus));

  // 2. Skip orders already booked (by the API or the old upload) — no need to fetch their lines.
  const ids = toBook.map((o) => o.AmazonOrderId);
  const booked = new Set(ids.length
    ? (await query(`SELECT DISTINCT ordernum FROM sales WHERE channel = 'AMZ' AND ordernum = ANY($1::text[])`, [ids])).rows.map((r) => r.ordernum)
    : []);
  const fresh = toBook.filter((o) => !booked.has(o.AmazonOrderId));

  // 3. Their lines (getOrderItems: burst 30, then ~1 every 2 s).
  const rows = [];
  const skipped = [];
  let calls = 0;
  for (const o of fresh) {
    if (calls > 0) await sp.sleep(calls < 25 ? 300 : 2100);
    calls += 1;
    const items = [];
    let itemNext;
    do {
      const res = await sp.spGet(`/orders/v0/orders/${encodeURIComponent(o.AmazonOrderId)}/orderItems`, itemNext ? { NextToken: itemNext } : undefined);
      const p = (res && res.payload) || {};
      items.push(...(p.OrderItems || []));
      itemNext = p.NextToken;
    } while (itemNext);

    const { date, time } = londonDateTime(o.PurchaseDate);
    for (const it of items) {
      const qty = Number(it.QuantityOrdered || 0);
      const amount = it.ItemPrice ? Number(it.ItemPrice.Amount) : NaN;
      if (!it.SellerSKU || !it.OrderItemId || qty <= 0 || !Number.isFinite(amount) || !date) {
        skipped.push(`${o.AmazonOrderId} / ${it.SellerSKU || '?'}: ${qty <= 0 ? 'no quantity' : !Number.isFinite(amount) ? 'no price yet' : 'incomplete'}`);
        continue;
      }
      rows.push({
        kind: 'SALE',
        orderId: o.AmazonOrderId,
        orderItemId: it.OrderItemId,
        sku: String(it.SellerSKU).trim(),
        qty,
        // ItemPrice is the LINE total (price x quantity, VAT included), as the report's item-price — sales.soldprice is per unit.
        unitPrice: Math.round((amount / qty) * 100) / 100,
        date,
        time,
        status: o.OrderStatus,
        sourceKey: `AMZ:O:${o.AmazonOrderId}:${it.OrderItemId}`,
      });
    }
  }

  return { startedAt, since, ordersRead: uk.length, alreadyBooked: booked.size, fetchedOrders: fresh.length, rows, cancellations, skipped };
}

/** DATABASE WRITE on the run's transaction client. Also the dry run's planner (commit = false writes nothing). */
async function writeAmazonOrders(client, fetched, { commit = true } = {}) {
  const ref = await loadReference(client, fetched.rows.map((r) => r.sku));
  const plan = await planSales(client, fetched.rows, ref);
  const cancelPlan = await planCancellations(client, fetched.cancellations);

  let inserted = 0;
  let retracted = 0;
  if (commit) {
    inserted = await insertSales(client, plan.insert);
    retracted = await retractCancelled(client, cancelPlan);
    await client.query(
      `INSERT INTO amz_api_sync (job, cursor_at, last_ok_at, last_ok_note, last_error, last_error_at)
       VALUES ($1, $2, now(), $3, NULL, NULL)
       ON CONFLICT (job) DO UPDATE SET cursor_at = EXCLUDED.cursor_at, last_ok_at = now(), last_ok_note = EXCLUDED.last_ok_note,
                                       last_error = NULL, last_error_at = NULL`,
      [JOB, fetched.startedAt.toISOString(), `${fetched.ordersRead} read, ${plan.insert.length} sales booked, ${cancelPlan.rows} cancelled`]
    );
  }

  const newOrders = new Set(plan.insert.map((r) => r.ordernum)).size;
  const notes = [
    ...plan.unknownSku.map((u) => `SKU not in BCWEB: ${u.sku} (${u.units} unit${u.units === 1 ? '' : 's'}) — not booked`),
    ...(plan.noProfit ? [`${plan.noProfit} sale${plan.noProfit === 1 ? '' : 's'} booked without a profit (cost or FBA fee missing)`] : []),
    ...cancelPlan.orders.map((o) => `Cancelled on Amazon: ${o.ordernum} ${o.code} — sale removed`),
    ...fetched.skipped.map((s) => `Not booked yet: ${s}`),
  ];
  return {
    newOrders,
    notes,
    log: `${newOrders} new, ${plan.insert.length} sales, ${cancelPlan.rows} cancelled`,
    detail: {
      ordersRead: fetched.ordersRead, alreadyBooked: fetched.alreadyBooked, sales: plan.insert.length, inserted,
      duplicate: plan.duplicate, unknownSku: plan.unknownSku.length, cancelled: cancelPlan.rows, retracted,
      lines: plan.insert.map((r) => `${r.ordernum} ${r.code} x${r.qty} £${r.soldprice.toFixed(2)} ${r.solddate} ${r.ordertime}`),
    },
  };
}

const channel = {
  name: 'Amazon',
  code: 'AMAZON',            // never on an orderstatus row (FBA — nothing to pick), so the Fulfil buttons never pick this channel
  isConfigured,
  setupHint: 'AMZ_SP_CLIENT_ID / AMZ_SP_CLIENT_SECRET / AMZ_SP_REFRESH_TOKEN in bcweb-server/.env',
  fetch: () => fetchAmazonOrders(),
  write: (client, fetched) => writeAmazonOrders(client, fetched),
};

module.exports = { channel, fetchAmazonOrders, writeAmazonOrders, londonDateTime };
