/*
=======================================================================================================================================
Module: utils/shopifyOrderSync.js   — the SHOPIFY channel of Update Orders
=======================================================================================================================================
Purpose: Shopify's part of the order run (utils/orderSync.js → runOrderSync). Exports `channel` in the shape every channel has (see
         utils/orderChannels.js): fetch() reads Shopify's open unfulfilled orders (network, outside the transaction), write() puts them
         in the database on the run's transaction client. Pick allocation and housekeeping are NOT here — the run does them once, for
         every channel, after all the writes.

    A  SYNC      Shopify unfulfilled orders  ->  orderstatus   (insert new, refresh delivery details on existing)
    B  SALES     each NEWLY inserted orderstatus row           ->  sales (channel 'SHP', with per-unit net profit)
    C  ARCHIVE   orderstatus rows (channel='SHOPIFY') no longer present in Shopify -> orderstatus_archive, then delete
    D  PICKS-GC  only if C archived something: drop the posted orders' picks ('BC%') from localstock

History: ported 2026-07-28 from C:\scripts\orders\update_orders.py, which ran alongside it from cron until 2026-11-01 and was then
retired — this is now the only copy. The port's deliberate improvements on the Python (duplicate-sale guard, same-SKU lines folded,
the truncated-fetch archive guard) are commented where they live.
=======================================================================================================================================
*/

const { isConfigured, fetchUnfulfilledOrders } = require('./shopifyOrders');
const shopifyFulfil = require('./shopifyFulfil');
const { shopifyProfit } = require('./shopifyProfit');
const { safe, ARCHIVE_COLS } = require('./orderRows');
const { safeNumeric } = require('./sql');
const logger = require('./logger');

// ---------------------------------------------------------------------------------------------------------------------------------
// POSTAGE PRICES — the one place to edit when the shipping prices change.
// ---------------------------------------------------------------------------------------------------------------------------------
/*
 * A customer order's courier is DERIVED from what the customer paid for shipping at checkout, and only ever at INSERT (phase A, and
 * see the "deliberately not refreshed" note there). Pay the NEXT-DAY price -> courier '4' (Royal Mail 24). Pay anything else — the
 * standard price, free shipping, nothing at all -> '5' (Royal Mail 48). Only the next-day price is listed here because '5' is the
 * catch-all: the standard price is never tested and never needs to be.
 *
 * WHEN THE PRICES CHANGE (once or twice a year):
 *   1. If the STANDARD price changed, there is nothing to do — it is not tested.
 *   2. If the NEXT-DAY price changed: put the new price first, move the old price second, delete whatever was second before.
 *
 * KEEP AT MOST TWO — current, and the one immediately before it. The previous price is carried only for the changeover, so an order
 * paid at the old price shortly before the change still gets RM24 when it syncs after. A longer history is a liability: an old
 * next-day price that happens to equal a later STANDARD price would silently upgrade standard customers to RM24.
 *
 * Exact-match comparison: the amount arrives from Shopify as a string like '6.50' and is parsed to the same double as the literal.
 *
 * Current prices for reference (2026-10-23): standard 4.50, next day 6.50. Both Royal Mail.
 */
const NEXT_DAY_POSTAGE = [
  6.50,   // current   — from 2026-10-07 (previous 6.45 dropped 2026-10-23, changeover long done)
];

/*
 * wallClock(iso) -> { legacy, date, time } | null
 *
 * Shopify sends '2026-07-28T08:37:48+01:00' — an instant WITH the shop's UTC offset. Every stamp is the wall clock as printed in THAT
 * offset — a literal field read, NOT `new Date(...)`, which would convert to the server's zone and shift every stamp by an hour for
 * half the year. Confirmed against live rows: order BC18626 arrived '+01:00' and stored '20260728 08:37:48'.
 *
 *   legacy -> '20260728 08:37:48'  (orderstatus.created / .updated, the legacy TEXT convention)
 *   date   -> '2026-07-28'         (sales.solddate, orderstatus.createddate)
 *   time   -> '08:37'              (sales.ordertime)
 *
 * Returns null on anything unparseable; callers substitute ''.
 */
function wallClock(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  return { legacy: `${y}${mo}${d} ${h}:${mi}:${s}`, date: `${y}-${mo}-${d}`, time: `${h}:${mi}` };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE A + B — order sync, and the sale row that rides along with a genuinely new order line.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * lineItemsBySku(order) -> [{ sku, qty, price, title, folded }]
 *
 * orderstatus is keyed (ordernum, shopifysku), so an order carrying the SAME sku on two lines has nowhere to put the second line. The
 * lines are folded first and the QUANTITIES SUM (the Python dropped the second line and its sale). Price and title come from the first
 * line of a folded group — two identical lines at different unit prices would record the first price against the combined quantity,
 * which needs a line-level discount on one of them and is still strictly better than dropping a line.
 */
function lineItemsBySku(order) {
  const byKey = new Map();
  for (const item of order.line_items || []) {
    const sku = safe(item.sku);
    if (!sku) continue; // no SKU = nothing we can match to skumap; skipped and counted by the caller
    const qty = Number(item.quantity) || 0;
    const existing = byKey.get(sku);
    if (existing) {
      existing.qty += qty;
      existing.folded += 1;
    } else {
      byKey.set(sku, { sku, qty, price: item.price, title: item.title, folded: 0 });
    }
  }
  return [...byKey.values()];
}

/*
 * insertSale(client, order, line, ordernum) -> 'inserted' | 'no-groupid' | 'duplicate'
 *
 * Phase B. Called ONLY when phase A actually inserted a new orderstatus row — that is the first dedupe, and it is why a re-synced
 * order does not double-book its sale.
 *
 * THE SECOND GUARD: an order archived (phase C) and later handed back by Shopify — a partial refund, an un-fulfilment — gets a fresh
 * orderstatus row and would book its sale AGAIN (38 such duplicates were found in the live table at the port). So before inserting we
 * check `sales` directly for a positive-qty SHP row on the same (ordernum, code). Served by idx_sales_channel_ordernum_code.
 */
async function insertSale(client, order, line, ordernum) {
  // groupid drives everything downstream. No groupid -> no sale, but the orderstatus row stays: the order still has to be picked and
  // posted, and an unmatched SKU must not invent a groupid.
  const g = await client.query(`SELECT groupid FROM skumap WHERE code = $1 LIMIT 1`, [line.sku]);
  const groupid = g.rows[0] ? g.rows[0].groupid : null;
  if (!groupid) return 'no-groupid';

  // qty > 0 scopes the guard to sale rows, never return reversals (Amazon writes negative rows into the same table).
  const dup = await client.query(
    `SELECT 1 FROM sales WHERE channel = 'SHP' AND ordernum = $1 AND code = $2 AND qty > 0 LIMIT 1`,
    [ordernum, line.sku]
  );
  if (dup.rows.length) return 'duplicate';

  // rrp is stamped onto the sale (2026-09-26, migrations/20260926b_sales_rrp.sql) so it survives the style being deleted or re-priced.
  const meta = await client.query(
    `SELECT brand, cost, ${safeNumeric('rrp')} AS rrp FROM skusummary WHERE groupid = $1 LIMIT 1`, [groupid]
  );
  const brand = meta.rows[0] ? meta.rows[0].brand : null;
  const rrp = meta.rows[0] ? meta.rows[0].rrp : null;
  const costRaw = meta.rows[0] ? meta.rows[0].cost : null;

  const soldprice = Number(line.price) || 0;
  // NULL rather than a wrong figure when cost is missing or junk (skusummary.cost is a legacy VARCHAR). See utils/shopifyProfit.js.
  const profit = shopifyProfit(soldprice, costRaw);

  const when = wallClock(order.created_at);
  // paytype is truncated to 20 even though the column holds 100 — the legacy limit, kept so old and new rows read alike.
  const paytype = ((order.payment_gateway_names || []).join(',') || 'UNKNOWN').slice(0, 20);

  await client.query(
    `INSERT INTO sales (code, solddate, groupid, ordernum, ordertime, qty, soldprice, channel, paytype,
                        collectedvat, productname, brand, profit, discount, rrp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'SHP', $8, NULL, $9, $10, $11, 0, $12)`,
    [
      safe(line.sku, 50), when ? when.date : null, safe(groupid, 50), safe(ordernum, 50), when ? when.time.slice(0, 20) : '',
      line.qty, soldprice, paytype, safe(line.title, 200), safe(brand, 50), profit, rrp
    ]
  );
  return 'inserted';
}

/*
 * syncOrders(client, orders) — PHASES A + B.
 * Returns counts plus `currentKeys`, the Set of 'ordernum\u0000sku' pairs Shopify currently knows about. Phase C archives everything
 * not in that Set, so it must contain every line we saw — including ones whose sale could not be booked.
 */
async function syncOrders(client, orders) {
  const currentKeys = new Set();
  const notes = [];
  let inserted = 0, updated = 0, skippedNoSku = 0, salesInserted = 0, salesNoGroupid = 0, salesDuplicate = 0, folded = 0;
  // Distinct ORDERS that got at least one new row. `inserted` counts orderstatus rows (one per order line), so a 3-line order is 3
  // there but 1 here — and "how many new orders" is the question the button's headline answers.
  const newOrders = new Set();

  for (const order of orders) {
    // Every open unfulfilled order is fetched and filtered HERE, so that BOTH 'paid' and 'partially_refunded' get through.
    // partially_refunded is what an order becomes when the shipping is refunded — it still has to be picked and posted.
    // cancel_reason is belt-and-braces on top of status=open.
    const fin = order.financial_status;
    const ful = order.fulfillment_status;
    if ((fin !== 'paid' && fin !== 'partially_refunded') ||
        (ful !== 'unfulfilled' && ful !== null && ful !== undefined) ||
        (order.cancel_reason !== null && order.cancel_reason !== undefined)) {
      continue;
    }

    const ordernum = order.name;
    const shipping = order.shipping_address || {};
    const shippingCostStr = order.total_shipping_price_set?.shop_money?.amount;
    const shippingCost = shippingCostStr ? Number(shippingCostStr) : null;
    const shippingNotes = safe(order.note);
    // Courier is decided ONLY at insert, from what was paid for shipping. 4 = next day (RM24), 5 = everything else (RM48).
    // The prices live in NEXT_DAY_POSTAGE at the top of this file — change them there, not here.
    const courier = String(NEXT_DAY_POSTAGE.includes(shippingCost) ? 4 : 5);

    const createdAt = wallClock(order.created_at);
    const updatedAt = wallClock(order.updated_at);

    const lines = lineItemsBySku(order);
    const withSku = (order.line_items || []).filter((i) => safe(i.sku)).length;
    skippedNoSku += (order.line_items || []).length - withSku;
    folded += lines.reduce((n, l) => n + l.folded, 0);

    for (const line of lines) {
      // Tracked BEFORE anything can go wrong with this line: a line we saw but failed to write must NOT then be archived as "gone".
      currentKeys.add(`${ordernum}\u0000${line.sku}`);

      // supplier: skumap.code -> groupid -> skusummary.supplier (first non-blank). '' when unknown, never NULL.
      const sup = await client.query(
        `SELECT ss.supplier
           FROM skumap sm
           JOIN skusummary ss ON ss.groupid = sm.groupid
          WHERE sm.code = $1 AND ss.supplier IS NOT NULL AND TRIM(ss.supplier) <> ''
          LIMIT 1`,
        [line.sku]
      );
      const supplier = sup.rows[0] ? sup.rows[0].supplier : '';

      const exists = await client.query(
        `SELECT 1 FROM orderstatus WHERE ordernum = $1 AND shopifysku = $2`, [ordernum, line.sku]
      );

      if (exists.rows.length) {
        // RE-SYNC PATH — this is what makes "change the delivery address in Shopify, then press Update orders" work. Every delivery
        // field is overwritten from the live Shopify order on every run, so a corrected address, postcode, phone, company, email or
        // order note lands immediately, whatever stage the order has reached locally.
        //
        // DELIBERATELY NOT REFRESHED: qty, title, supplier, createddate, shippingcost, and `courier`. courier is decided once, at
        // insert, from the shipping charge — so changing the DELIVERY METHOD in Shopify after the fact will not move it.
        await client.query(
          `UPDATE orderstatus SET
              shippingname = $1, postcode = $2, address1 = $3, address2 = $4, company = $5, city = $6,
              county = $7, country = $8, phone = $9, shippingnotes = $10, email = $11,
              last_seen = CURRENT_TIMESTAMP
            WHERE ordernum = $12 AND shopifysku = $13`,
          [
            safe(shipping.name), safe(shipping.zip), safe(shipping.address1), safe(shipping.address2),
            safe(shipping.company), safe(shipping.city), safe(shipping.province_code), safe(shipping.country_code),
            safe(shipping.phone), shippingNotes, safe(order.email),
            ordernum, line.sku
          ]
        );
        updated += 1;
        continue;
      }

      // NEW ROW. Every constant below is the legacy one, including the ones that look like mistakes — other screens read them:
      //   batch '0'        orderdate ''      ukd/localstock/amz/othersupplier 0     fnsku ''      weight ''
      //   pickedqty 0      courierfixed 0    customerwaiting 0    notorderamz NULL  alloworder NULL   searchalt ''
      //   channel 'SHOPIFY'  picknotfound NULL  fbaordered NULL   notes ''          shopcustomer 0
      //   shippingcost ''  <- see safe(): the number never survives the type test. ALWAYS '' in live data.
      //   ordertype 1      <- customer order. The Order Status module (types 2 and 3) never touches these rows.
      //   ponumber ''      arrived 0         arriveddate NULL
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
            $19, 0, 0, NULL, NULL, '', 'SHOPIFY',
            NULL, NULL, '', 0, '', 1, '',
            $20, 0, NULL
         )`,
        [
          safe(ordernum, 100), safe(line.sku, 50), line.qty,
          updatedAt ? updatedAt.legacy : '', createdAt ? createdAt.legacy : '',
          safe(supplier, 50), safe(line.title, 200), safe(shipping.name, 100),
          safe(shipping.zip, 20), safe(shipping.address1, 200), safe(shipping.address2, 200),
          safe(shipping.company, 100), safe(shipping.city, 100), safe(shipping.province_code, 100),
          safe(shipping.country_code, 100), safe(shipping.phone, 50), safe(shippingNotes, 200),
          safe(order.email, 100), safe(courier, 100),
          createdAt ? createdAt.date : null
        ]
      );
      inserted += 1;
      newOrders.add(ordernum);

      // PHASE B rides on a genuinely new row only.
      const saleResult = await insertSale(client, order, line, ordernum);
      if (saleResult === 'inserted') salesInserted += 1;
      else if (saleResult === 'duplicate') {
        salesDuplicate += 1;
        notes.push(`${ordernum} / ${line.sku}: order re-appeared in Shopify — sale already booked, not double-counted`);
      } else {
        salesNoGroupid += 1;
        notes.push(`${ordernum} / ${line.sku}: no groupid in skumap — order recorded, sale NOT booked`);
      }
    }
  }

  return {
    inserted, newOrders: newOrders.size, updated, skippedNoSku, salesInserted, salesNoGroupid, salesDuplicate, folded, currentKeys, notes
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE C + D — archive what Shopify no longer has, then drop the picks those orders were holding.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * archiveMissing(client, currentKeys) -> { archived, picksRemoved }
 *
 * "No longer in Shopify" means fulfilled, cancelled, or otherwise off the open-unfulfilled list. Scoped to channel = 'SHOPIFY', which
 * keeps every other channel's rows (EBAY, the Order Status module's MANUAL rows) out of reach of this phase.
 *
 * THE DANGEROUS PHASE. Absence from `currentKeys` is the whole test, so a fetch that returned less than the truth would archive live
 * orders wholesale. That is why write() below never calls this on a truncated fetch.
 *
 * archivedate is set from `last_seen`, NOT from now() — the column has always held "when this order was last seen in Shopify" for
 * archived customer orders. Note routes/order-status-archive.js writes CURRENT_DATE into the same column for supplier orders, so the
 * column carries two meanings; that is old.
 */
async function archiveMissing(client, currentKeys) {
  const existing = await client.query(`SELECT ordernum, shopifysku FROM orderstatus WHERE channel = 'SHOPIFY'`);

  const gone = existing.rows.filter((r) => !currentKeys.has(`${r.ordernum}\u0000${r.shopifysku}`));
  if (gone.length === 0) return { archived: 0, picksRemoved: 0 };

  const nums = gone.map((r) => r.ordernum);
  const skus = gone.map((r) => r.shopifysku);

  // Set-based: the unnest join pairs each ordernum with its own sku, so it can never archive a different line of the same order.
  const ins = await client.query(
    `INSERT INTO orderstatus_archive (${ARCHIVE_COLS}, archivedate)
     SELECT ${ARCHIVE_COLS.split(', ').map((c) => `o.${c}`).join(', ')}, o.last_seen
       FROM orderstatus o
       JOIN unnest($1::text[], $2::text[]) AS k(ordernum, shopifysku)
         ON k.ordernum = o.ordernum AND k.shopifysku = o.shopifysku`,
    [nums, skus]
  );
  await client.query(
    `DELETE FROM orderstatus o
      USING unnest($1::text[], $2::text[]) AS k(ordernum, shopifysku)
      WHERE k.ordernum = o.ordernum AND k.shopifysku = o.shopifysku`,
    [nums, skus]
  );

  // PHASE D — only when something was archived. Any localstock row still holding a pick for a Shopify ('BC') order that no longer
  // exists in orderstatus is a pick that has already been packed and posted. (Other channels clear their own picks in their own write.)
  // NOT IN is safe here only because orderstatus.ordernum is NOT NULL; a single NULL would make the whole predicate match nothing.
  const del = await client.query(
    `DELETE FROM localstock
      WHERE ordernum IS NOT NULL
        AND ordernum LIKE 'BC%'
        AND ordernum NOT IN (SELECT DISTINCT ordernum FROM orderstatus)`
  );

  return { archived: ins.rowCount || 0, picksRemoved: del.rowCount || 0 };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE CHANNEL — what utils/orderSync.js runs. Shape documented in utils/orderChannels.js.
// ---------------------------------------------------------------------------------------------------------------------------------
const channel = {
  name: 'Shopify',
  code: 'SHOPIFY',          // orderstatus.channel
  isConfigured,
  setupHint: 'SHOPIFY_SHOP and SHOPIFY_ORDERS_ACCESS_TOKEN in bcweb-server/.env',

  // -> { orders, pages, truncated }
  fetch: () => fetchUnfulfilledOrders(),

  async write(client, fetched) {
    const sync = await syncOrders(client, fetched.orders);

    // The truncated-fetch guard: archiving is decided by absence, so a fetch that didn't finish must never archive.
    let archive = { archived: 0, picksRemoved: 0, skipped: false };
    if (fetched.truncated) {
      archive.skipped = true;
      logger.error('[shopifyOrderSync] fetch was truncated — ARCHIVE PHASE SKIPPED to avoid archiving orders that were never read');
    } else {
      archive = { ...(await archiveMissing(client, sync.currentKeys)), skipped: false };
    }

    const notes = [...sync.notes];
    if (archive.skipped) notes.push('Shopify had more open orders than one read could hold — archiving was skipped this run');

    return {
      newOrders: sync.newOrders,
      notes,
      log: `${sync.newOrders} new, ${sync.salesInserted} sales, ${archive.archived} archived${archive.skipped ? ' (archive skipped)' : ''}`,
      detail: {
        fetched: fetched.orders.length, pages: fetched.pages, truncated: fetched.truncated,
        inserted: sync.inserted, updated: sync.updated, linesWithoutSku: sync.skippedNoSku, linesFolded: sync.folded,
        sales: { inserted: sync.salesInserted, skippedNoGroupid: sync.salesNoGroupid, skippedDuplicate: sync.salesDuplicate },
        archive
      }
    };
  },

  // FULFIL — mark a packed order fulfilled on Shopify (routes/order-status-customer-fulfil.js works out the tracking first).
  // Royal Mail: the Click & Drop number. FBA: the 'AMZCourier' literal, no number (owner, 2026-10-19). Shopify emails the customer.
  fulfil: {
    isConfigured: shopifyFulfil.isConfigured,
    setupHint: 'SHOPIFY_FULFIL_CLIENT_ID and SHOPIFY_FULFIL_CLIENT_SECRET in bcweb-server/.env (the "bcweb fulfil" Dev Dashboard app)',
    async run({ ordernum, fba, tracking }) {
      const order = await shopifyFulfil.findOrder(ordernum);
      if (!order) return { outcome: 'failed', reason: 'Not found on Shopify' };
      if (order.cancelled) return { outcome: 'skipped', reason: 'Cancelled on Shopify' };
      if (!order.openFulfillmentOrderIds.length) {
        return order.fulfillmentStatus === 'FULFILLED'
          ? { outcome: 'already', reason: 'Already fulfilled on Shopify' }
          : { outcome: 'skipped', reason: `Nothing open to fulfill on Shopify (${order.fulfillmentStatus})` };
      }
      await shopifyFulfil.fulfil(order.openFulfillmentOrderIds, fba ? shopifyFulfil.FBA_TRACKING : shopifyFulfil.royalMailTracking(tracking));
      return { outcome: 'fulfilled', reason: null };
    }
  }
};

module.exports = { channel, syncOrders, archiveMissing, wallClock, lineItemsBySku, NEXT_DAY_POSTAGE };
