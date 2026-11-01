/*
=======================================================================================================================================
Module: utils/ebayOrderSync.js
=======================================================================================================================================
Purpose: The EBAY channel of Update Orders (utils/orderSync.js → runOrderSync — the button and the cron run the same code). Exports
         `channel` in the shape every channel has (utils/orderChannels.js): fetch() is utils/ebayOrders.js (network, outside the
         transaction), write() is syncEbayOrders below, on the run's transaction client. Pick allocation (phase E) runs once after every
         channel has written, so new eBay pairs come off the shelf in the same run (owner, 2026-10-31: one Update Orders button).
         It writes only channel = 'EBAY' rows; Shopify's archive (channel = 'SHOPIFY') and pick clean-up ('BC%') never touch them.

WHAT IT WRITES
  NEW ORDER   one orderstatus row per order + SKU (the table's key), qty = units, every column as phase A writes a Shopify row except:
                ordernum 'EB' + eBay's order number, dashes kept ('EB22-15343-31982') — owner's format, fits varchar(100)
                channel 'EBAY'   ordertype 1 (a customer order — Customer Orders lists it, scan + label work unchanged)
                courier from eBay's postage service: a 24-hour service -> '4' (Tracked 24), anything else -> '5' (Tracked 48)
                created / updated / createddate: eBay sends UTC; written as the Europe/London wall clock, the legacy convention
              plus one ebay_order_buyer row (ordernum -> buyer username), which routes/ebay-account-deletion.js needs.
  SEEN AGAIN  delivery fields refreshed (name, address, phone, email, buyer note) + last_seen — the same fields phase A refreshes.
  POSTED      (eBay says FULFILLED) rows copied to orderstatus_archive and deleted; the order's pick rows deleted from localstock —
              the shoe has left the building. (Phase D only ever clears 'BC%' picks, so this is the only thing that will.)
  CANCELLED   rows archived the same way; the shoe goes BACK to free stock instead:
                pick waiting on the shelf (qty 1)          -> ordernum '#FREE'. Nothing for anyone to do.
                already picked (0) or marked re-stock (-2) -> '#FREE' with qty 1, and a NOTE saying to put it back at its location —
                                                              the system counts it on the shelf from now on, so a person must make that true.
                marked not found (-1)                      -> left as it is (the pair is missing; freeing it would invent stock), NOTE.
  SALE        (2026-11-01, owner: "Do it now") one `sales` row per NEW order line, booked as the row is written — Shopify's phase B
              rule, so a re-press never double-books — channel 'EBY', soldprice = the per-unit ITEM price (postage is not revenue, as
              on Shopify), profit from utils/ebayProfit.js (eBay fees ex VAT, always the Royal Mail figure — owner: no MCF split),
              collectedvat NULL and discount 0 as Shopify writes them, paytype 'EBAY'. A second guard checks `sales` itself for an EBY row
              on the same order + code, so an order archived and seen again still can't book twice. No groupid -> no sale, with a note.
              A CANCELLED order's EBY rows are DELETED: the sale never happened (unlike a return, which is a later event).

REFUSED LINES: a line with no SKU (eBay's "Custom label" left blank) can't be matched to a shoe — skipped with a note; fix the label on
eBay and press again. A SKU we don't know is still written (it has to be posted), with a note — the same as Shopify's sync.
=======================================================================================================================================
*/

const { safe, ARCHIVE_COLS } = require('./orderRows');
const { ebayProfit } = require('./ebayProfit');
const { safeNumeric } = require('./sql');
const { query } = require('../database');
const ebayOrders = require('./ebayOrders');
const ebayFulfil = require('./ebayFulfil');

// '22-15343-31982' -> 'EB22-15343-31982'
const ordernumOf = (orderId) => `EB${orderId}`;

/*
 * londonClock(iso) -> { legacy, date, time } | null
 * eBay timestamps are UTC ('2026-10-30T22:23:24.000Z'). The legacy text stamps are the Europe/London wall clock — the same three shapes
 * utils/orderSync.js → wallClock() produces from Shopify's offset strings, so an EB row's stamps read exactly like a Shopify row's.
 */
const LONDON = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
});
function londonClock(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(LONDON.formatToParts(d).map((x) => [x.type, x.value]));
  return { legacy: `${p.year}${p.month}${p.day} ${p.hour}:${p.minute}:${p.second}`, date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

// eBay's postage service code -> our courier. '4' = Royal Mail Tracked 24, '5' = Tracked 48 (and the catch-all, as on Shopify).
function courierOf(serviceCode) {
  return /24|NextDay/i.test(String(serviceCode || '')) ? '4' : '5';
}

// Fold an order's lines by SKU (orderstatus is keyed ordernum + SKU) — same reason as shopifyOrderSync.js → lineItemsBySku. eBay's
// lineItemCost and deliveryCost are LINE totals (all units), so they're summed here and divided per unit when the sale is booked.
const money = (m) => (m && m.value !== undefined ? Number(m.value) || 0 : 0);
function linesBySku(order) {
  const bySku = new Map();
  let noSku = 0;
  for (const li of order.lineItems || []) {
    const sku = safe(li.sku);
    if (!sku) { noSku += 1; continue; }
    const qty = Number(li.quantity) || 0;
    const itemTotal = money(li.lineItemCost);
    const postageTotal = money(li.deliveryCost && li.deliveryCost.shippingCost);
    const had = bySku.get(sku);
    if (had) { had.qty += qty; had.itemTotal += itemTotal; had.postageTotal += postageTotal; }
    else bySku.set(sku, { sku, qty, title: li.title, itemTotal, postageTotal });
  }
  return { lines: [...bySku.values()], noSku };
}

/*
 * bookSale(client, order, line, ordernum, created) -> 'inserted' | 'no-groupid' | 'duplicate'
 * The eBay counterpart of shopifyOrderSync.js → insertSale (phase B). One row per order line, per-unit price and profit, qty = units.
 */
async function bookSale(client, order, line, ordernum, created) {
  const g = await client.query(
    `SELECT sm.groupid, ss.brand, ss.cost, ${safeNumeric('ss.rrp')} AS rrp
       FROM skumap sm LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      WHERE sm.code = $1 LIMIT 1`,
    [line.sku]
  );
  const meta = g.rows[0];
  if (!meta || !meta.groupid) return 'no-groupid';

  const dup = await client.query(
    `SELECT 1 FROM sales WHERE channel = 'EBY' AND ordernum = $1 AND code = $2 AND qty > 0 LIMIT 1`, [ordernum, line.sku]
  );
  if (dup.rows.length) return 'duplicate';

  const units = Math.max(line.qty, 1);
  const price = Math.round((line.itemTotal / units) * 100) / 100;
  const orderUnits = (order.lineItems || []).reduce((n, li) => n + (Number(li.quantity) || 0), 0);
  const profit = ebayProfit({
    price, postage: line.postageTotal / units, cost: meta.cost,
    orderTotal: money(order.pricingSummary && order.pricingSummary.total), orderUnits
  });

  await client.query(
    `INSERT INTO sales (code, solddate, groupid, ordernum, ordertime, qty, soldprice, channel, paytype,
                        collectedvat, productname, brand, profit, discount, rrp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'EBY', 'EBAY', NULL, $8, $9, $10, 0, $11)`,
    [safe(line.sku, 50), created ? created.date : null, safe(meta.groupid, 50), safe(ordernum, 50), created ? created.time : '',
     line.qty, price, safe(line.title, 200), safe(meta.brand, 50), profit, meta.rrp]
  );
  return 'inserted';
}

async function archiveOrder(client, ordernum) {
  const ins = await client.query(
    `INSERT INTO orderstatus_archive (${ARCHIVE_COLS}, archivedate)
     SELECT ${ARCHIVE_COLS}, last_seen FROM orderstatus WHERE ordernum = $1 AND channel = 'EBAY'`,
    [ordernum]
  );
  await client.query(`DELETE FROM orderstatus WHERE ordernum = $1 AND channel = 'EBAY'`, [ordernum]);
  return ins.rowCount || 0;
}

/*
 * syncEbayOrders(client, fetched) -> summary
 * fetched = utils/ebayOrders.js → fetchEbayOrders() result. Runs inside the order run's transaction, under its lock.
 */
async function syncEbayOrders(client, fetched) {
  const out = { open: fetched.open.length, newOrders: 0, inserted: 0, updated: 0, salesBooked: 0, salesRemoved: 0, posted: 0, cancelled: 0,
                picksRemoved: 0, picksFreed: 0, linesWithoutSku: 0, unresolved: fetched.unresolved.length, truncated: fetched.truncated,
                attention: false, notes: [] };

  // ---- open orders: insert or refresh ---------------------------------------------------------------------------------------
  for (const order of fetched.open) {
    const ordernum = ordernumOf(order.orderId);
    const step = (order.fulfillmentStartInstructions && order.fulfillmentStartInstructions[0] &&
                  order.fulfillmentStartInstructions[0].shippingStep) || {};
    const shipTo = step.shipTo || {};
    const addr = shipTo.contactAddress || {};
    const phone = shipTo.primaryPhone ? shipTo.primaryPhone.phoneNumber : '';
    const note = safe(order.buyerCheckoutNotes);
    const created = londonClock(order.creationDate);
    const updated = londonClock(order.lastModifiedDate) || created;
    const courier = courierOf(step.shippingServiceCode);

    const { lines, noSku } = linesBySku(order);
    if (noSku) {
      out.linesWithoutSku += noSku;
      out.attention = true;
      out.notes.push(`${ordernum}: ${noSku} line(s) have no Custom label on eBay — not imported. Add our code as the Custom label, then Update orders again`);
    }
    if (order.cancelStatus && order.cancelStatus.cancelState === 'IN_PROGRESS') {
      out.attention = true;
      out.notes.push(`${ordernum}: the buyer has asked to cancel — check eBay before posting`);
    }
    if (addr.countryCode && addr.countryCode !== 'GB') {
      out.notes.push(`${ordernum}: delivery country ${addr.countryCode} — the label screen only prints UK addresses`);
    }

    let isNew = false;
    for (const line of lines) {
      const exists = await client.query(`SELECT 1 FROM orderstatus WHERE ordernum = $1 AND shopifysku = $2`, [ordernum, line.sku]);
      if (exists.rows.length) {
        await client.query(
          `UPDATE orderstatus SET
              shippingname = $1, postcode = $2, address1 = $3, address2 = $4, company = $5, city = $6,
              county = $7, country = $8, phone = $9, shippingnotes = $10, email = $11, last_seen = CURRENT_TIMESTAMP
            WHERE ordernum = $12 AND shopifysku = $13 AND channel = 'EBAY'`,
          [safe(shipTo.fullName, 100), safe(addr.postalCode, 20), safe(addr.addressLine1, 200), safe(addr.addressLine2, 200),
           safe(shipTo.companyName, 100), safe(addr.city, 100), safe(addr.stateOrProvince, 100), safe(addr.countryCode, 100),
           safe(phone, 50), safe(note, 200), safe(shipTo.email, 100), ordernum, line.sku]
        );
        out.updated += 1;
        continue;
      }

      // supplier and "do we know this code" in one read — the same skumap -> skusummary path phase A uses for supplier.
      const known = await client.query(
        `SELECT COALESCE(NULLIF(TRIM(ss.supplier), ''), '') AS supplier
           FROM skumap sm LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
          WHERE sm.code = $1
          ORDER BY (COALESCE(TRIM(ss.supplier), '') = '') LIMIT 1`,
        [line.sku]
      );
      if (!known.rows.length) {
        out.attention = true;
        out.notes.push(`${ordernum} / ${line.sku}: Custom label doesn't match any of our codes — order written, but scan won't find it. Fix the label on eBay`);
      }
      const supplier = known.rows[0] ? known.rows[0].supplier : '';

      // Every constant is phase A's (see the NEW ROW comment in utils/shopifyOrderSync.js) except channel 'EBAY'.
      await client.query(
        `INSERT INTO orderstatus (
            ordernum, shopifysku, qty, updated, created, batch, supplier, title, shippingname,
            postcode, address1, address2, company, city, county, country, phone, shippingnotes,
            orderdate, ukd, localstock, amz, othersupplier, fnsku, weight, pickedqty, email,
            courier, courierfixed, customerwaiting, notorderamz, alloworder, searchalt, channel,
            picknotfound, fbaordered, notes, shopcustomer, shippingcost, ordertype, ponumber,
            createddate, arrived, arriveddate
         ) VALUES (
            $1, $2, $3, $4, $5, '0', $6, $7, $8,
            $9, $10, $11, $12, $13, $14, $15, $16, $17,
            '', 0, 0, 0, 0, '', '', 0, $18,
            $19, 0, 0, NULL, NULL, '', 'EBAY',
            NULL, NULL, '', 0, '', 1, '',
            $20, 0, NULL
         )`,
        [safe(ordernum, 100), safe(line.sku, 50), line.qty,
         updated ? updated.legacy : '', created ? created.legacy : '',
         safe(supplier, 50), safe(line.title, 200), safe(shipTo.fullName, 100),
         safe(addr.postalCode, 20), safe(addr.addressLine1, 200), safe(addr.addressLine2, 200),
         safe(shipTo.companyName, 100), safe(addr.city, 100), safe(addr.stateOrProvince, 100),
         safe(addr.countryCode, 100), safe(phone, 50), safe(note, 200),
         safe(shipTo.email, 100), courier,
         created ? created.date : null]
      );
      out.inserted += 1;
      isNew = true;

      // The sale rides on a genuinely new row only (Shopify's phase B rule).
      const sale = await bookSale(client, order, line, ordernum, created);
      if (sale === 'inserted') out.salesBooked += 1;
      else if (sale === 'no-groupid') out.notes.push(`${ordernum} / ${line.sku}: no groupid for that code — order written, sale NOT booked`);
      else out.notes.push(`${ordernum} / ${line.sku}: sale already booked — not booked again`);
    }
    if (isNew) out.newOrders += 1;

    // Who bought it — for the account-deletion endpoint. Refreshed every press (cheap) so a row is never missing.
    const username = order.buyer && typeof order.buyer.username === 'string' ? order.buyer.username : '';
    if (username && lines.length) {
      await client.query(
        `INSERT INTO ebay_order_buyer (ordernum, buyer_username) VALUES ($1, $2)
         ON CONFLICT (ordernum) DO UPDATE SET buyer_username = EXCLUDED.buyer_username`,
        [ordernum, username]
      );
    }
  }

  // ---- closed orders: posted or cancelled ----------------------------------------------------------------------------------
  for (const { orderId, outcome } of fetched.closed) {
    const ordernum = ordernumOf(orderId);
    const archived = await archiveOrder(client, ordernum);
    if (!archived) continue;   // already gone (a second press, or archived by hand)

    if (outcome === 'shipped') {
      const del = await client.query(`DELETE FROM localstock WHERE ordernum = $1`, [ordernum]);
      out.picksRemoved += del.rowCount || 0;
      out.posted += 1;
      continue;
    }

    // Cancelled — the sale never happened, and the shoe goes back. See the header for the cases.
    out.cancelled += 1;
    const unbooked = await client.query(`DELETE FROM sales WHERE channel = 'EBY' AND ordernum = $1`, [ordernum]);
    out.salesRemoved += unbooked.rowCount || 0;
    const picks = await client.query(
      `SELECT id, code, location, qty FROM localstock WHERE ordernum = $1 AND COALESCE(deleted, 0) = 0`, [ordernum]
    );
    for (const p of picks.rows) {
      const q = Number(p.qty);
      if (q === -1) {
        out.attention = true;
        out.notes.push(`${ordernum} was cancelled on eBay. ${p.code} was marked NOT FOUND at ${p.location} — left as it is`);
        continue;
      }
      await client.query(`UPDATE localstock SET ordernum = '#FREE', qty = 1, updated = CURRENT_TIMESTAMP WHERE id = $1`, [p.id]);
      out.picksFreed += 1;
      if (q !== 1) {
        out.attention = true;
        out.notes.push(`${ordernum} was cancelled on eBay. ${p.code} had already been picked — put it back at ${p.location}`);
      }
    }
    if (!picks.rows.length) out.notes.push(`${ordernum} was cancelled on eBay — archived (no pick was held)`);
  }

  if (fetched.truncated) out.notes.push('eBay had more open orders than one read could hold — posted/cancelled orders were not archived this run');
  if (fetched.unresolved.length) {
    out.notes.push(`${fetched.unresolved.length} eBay order(s) have left the open list but eBay didn't confirm posted or cancelled — left in place, will retry next press`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE CHANNEL — what utils/orderSync.js runs. Shape documented in utils/orderChannels.js.
// ---------------------------------------------------------------------------------------------------------------------------------
const channel = {
  name: 'eBay',
  code: 'EBAY',             // orderstatus.channel
  isConfigured: ebayOrders.isConfigured,
  setupHint: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN in bcweb-server/.env',

  // The EB orders we hold now go with the read, so ebayOrders can ask eBay what happened to any that left its open list. A plain read
  // outside the transaction — at worst an order archived by hand a second ago gets looked up for nothing (archiveOrder then finds 0 rows).
  async fetch() {
    const held = await query(`SELECT DISTINCT ordernum FROM orderstatus WHERE channel = 'EBAY'`);
    return ebayOrders.fetchEbayOrders(held.rows.map((r) => String(r.ordernum).replace(/^EB/, '')));
  },

  async write(client, fetched) {
    const out = await syncEbayOrders(client, fetched);
    return {
      newOrders: out.newOrders,
      notes: out.notes,
      log: `${out.newOrders} new, ${out.salesBooked} sales, ${out.posted} posted, ${out.cancelled} cancelled${out.attention ? ' · see notes' : ''}`,
      detail: out
    };
  },

  // FULFIL — mark a packed order shipped on eBay with its Royal Mail tracking (utils/ebayFulfil.js has the guards). eBay emails the
  // buyer. FBA (MCF) orders are NOT sent: we don't hold Amazon's tracking, and eBay counts uploaded tracking towards seller standards —
  // the owner marks those by hand (2026-11-01).
  fulfil: {
    isConfigured: ebayFulfil.isConfigured,
    setupHint: 'EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN in bcweb-server/.env',
    async run({ ordernum, fba, tracking, codes }) {
      if (fba) return { outcome: 'skipped', reason: 'Sent by Amazon — mark it shipped on eBay by hand with Amazon’s tracking' };
      return ebayFulfil.markShipped(ordernum, tracking, codes);
    }
  }
};

module.exports = { channel, syncEbayOrders, londonClock, courierOf, linesBySku, ordernumOf };
