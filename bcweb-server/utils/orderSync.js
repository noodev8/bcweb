/*
=======================================================================================================================================
Module: utils/orderSync.js
=======================================================================================================================================

        #####################################################################################################################
        ##                                                                                                                 ##
        ##   !!  THIS BUSINESS LOGIC EXISTS IN TWO PLACES.  CHANGE BOTH, OR NEITHER.  !!                                   ##
        ##                                                                                                                 ##
        ##     1. THIS FILE                    C:\bcweb\bcweb-server\utils\orderSync.js      (VPS: /apps/bcweb-server/…)   ##
        ##        driven by  POST /order-sync  <- the "Sync orders" button on Analytics -> Sales                            ##
        ##                                                                                                                 ##
        ##     2. THE PYTHON                   C:\scripts\orders\update_orders.py            (VPS: /apps/scripts/orders/…)  ##
        ##        driven by  cron  — see C:\scripts\crontab.txt (currently 09:00, 12:00, 13:00/13:30/13:45, 14:00/14:10,   ##
        ##        21:00). BOTH ARE LIVE. The cron was NOT switched off when this port shipped.                              ##
        ##                                                                                                                 ##
        ##   They write the SAME rows in the SAME tables — orderstatus, orderstatus_archive, sales, localstock — and they   ##
        ##   are expected to produce the SAME outcome. A change made in one and not the other does not fail loudly; it      ##
        ##   produces a database where some rows were written by one set of rules and some by the other, with nothing       ##
        ##   recording which. That is the failure mode to be afraid of here. It has already happened once on the Amazon     ##
        ##   side with sales.profit (docs/update-amazon-port.md, "Running alongside PowerBuilder").                         ##
        ##                                                                                                                 ##
        ##   The profit formula is doubly duplicated: utils/shopifyProfit.js  <->  update_orders.py::shopify_profit().      ##
        ##                                                                                                                 ##
        ##   Reasoning, the full behaviour inventory, and every deliberate divergence: C:\bcweb\docs\order-sync-port.md     ##
        ##                                                                                                                 ##
        #####################################################################################################################

Purpose: The Shopify order pipeline, ported from update_orders.py. Six phases, all inside ONE transaction (the Python commits once at
         the very end; a run either lands completely or not at all):

    A  SYNC      Shopify unfulfilled orders  ->  orderstatus   (insert new, refresh delivery details on existing)
    B  SALES     each NEWLY inserted orderstatus row           ->  sales (channel 'SHP', with per-unit net profit)
    C  ARCHIVE   orderstatus rows (channel='SHOPIFY') no longer present in Shopify -> orderstatus_archive, then delete
    D  PICKS-GC  only if C archived something: drop that order's now-done picks from localstock
    E  ALLOCATE  pick allocation against free local stock, then AMZ / UKD / other-supplier fallbacks
    F  CLEANUP   six housekeeping statements over orderstatus + localstock

         Every phase takes an explicit `client` so the whole thing can be rehearsed against the live database inside a manual
         BEGIN … ROLLBACK before it is ever allowed to commit — the same discipline the Amazon importer used.

SCOPE NOTE — phases E and F reach outside this module's own data:
    * E considers `ordertype NOT IN (3,5)`, which includes the Order Status module's local rows (ordertype 2). They are excluded in
      practice only because routes/order-status-add.js always sets ukd=1 or othersupplier=1, and the candidate filter requires both to
      be 0. That is load-bearing: if a route ever inserts an ordertype-2 row with both flags at 0, this phase would allocate local
      stock to a supplier order and stamp its orderdate — flipping it from TO PLACE to ON ORDER behind the operator's back.
    * F deletes orderstatus rows with `ordertype <> 1` older than 30 days WITHOUT archiving them. That silently removes Order Status
      ON ORDER cards at 30 days, and it is existing behaviour, not something this port introduced.
=======================================================================================================================================
*/

const { shopifyProfit } = require('./shopifyProfit');
const logger = require('./logger');

// The 44 columns an inserted orderstatus row carries, and the 44 that get copied into the archive. Written out rather than using
// `SELECT *` (which is what the Python does) so that adding a column to either table can never silently shift the mapping.
const ARCHIVE_COLS = [
  'ordernum', 'shopifysku', 'qty', 'updated', 'created', 'batch', 'supplier', 'title', 'shippingname',
  'postcode', 'address1', 'address2', 'company', 'city', 'county', 'country', 'phone', 'shippingnotes',
  'orderdate', 'ukd', 'localstock', 'amz', 'othersupplier', 'fnsku', 'weight', 'pickedqty', 'email',
  'courier', 'courierfixed', 'customerwaiting', 'notorderamz', 'alloworder', 'searchalt', 'channel',
  'picknotfound', 'fbaordered', 'notes', 'shopcustomer', 'shippingcost', 'ordertype', 'ponumber',
  'createddate', 'arrived', 'arriveddate'
].join(', ');

// ---------------------------------------------------------------------------------------------------------------------------------
// Faithful ports of the Python's small helpers. These look trivial; they are not, and two of them encode real quirks.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * safe(value, maxLength) — port of update_orders.py::safe().
 *
 * QUIRK, REPRODUCED ON PURPOSE: the Python tests `isinstance(value, str)`, so ANY non-string — a float, an int, None — comes back as
 * an empty string, not as its text form. That is why every orderstatus row ever written has `shippingcost = ''`: the caller passes a
 * float through safe(). Verified against the live table (13 of 13 ordertype-1 rows are ''). Reproducing it keeps the two systems in
 * step; "fixing" it here alone would make bcweb-written rows differ from cron-written ones for no benefit to anyone.
 */
function safe(value, maxLength = null) {
  let result = (value && typeof value === 'string') ? value.trim() : '';
  if (maxLength && result.length > maxLength) result = result.slice(0, maxLength);
  return result;
}

/*
 * wallClock(iso) -> { legacy, date, time } | null
 *
 * Shopify sends '2026-07-28T08:37:48+01:00' — an instant WITH the shop's UTC offset. Every stamp the Python writes is the wall clock
 * as printed in THAT offset (fromisoformat keeps the tzinfo, strftime prints the local fields; it never converts). So the correct
 * port is a literal field read, NOT `new Date(...)` — which would convert to the server's zone and shift every stamp by an hour for
 * half the year. Confirmed against live rows: order BC18626 arrived '+01:00' and stored '20260728 08:37:48'.
 *
 *   legacy -> '20260728 08:37:48'  (orderstatus.created / .updated, the legacy TEXT convention)
 *   date   -> '2026-07-28'         (sales.solddate, orderstatus.createddate)
 *   time   -> '08:37'              (sales.ordertime)
 *
 * Returns null on anything unparseable; callers substitute '' exactly as the Python's format_datetime does.
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
 * lineItemsBySku(order) -> [{ sku, qty, price, title }]
 *
 * DIVERGENCE (approved): the Python iterates line items one at a time, so an order carrying the SAME sku on two lines writes the
 * first line and then treats the second as an "existing row" — losing its quantity AND its sale row entirely (the orderstatus primary
 * key is (ordernum, shopifysku), so there is nowhere for the second line to go). Zero occurrences in the live data, but it is silent
 * when it happens. Here the lines are folded first and the QUANTITIES SUM.
 *
 * Price and title are taken from the first line of a folded group. Two lines of one sku at different unit prices would therefore
 * record the first price against the combined quantity — vanishingly unlikely (it needs a line-level discount on one of two identical
 * lines) and still strictly better than dropping the line on the floor.
 */
function lineItemsBySku(order) {
  const byKey = new Map();
  for (const item of order.line_items || []) {
    const sku = safe(item.sku);
    if (!sku) continue; // no SKU = nothing we can match to skumap; the Python warns and skips, so do we (counted by the caller)
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
 * insertSale(client, order, line, supplierless) -> 'inserted' | 'no-groupid' | 'duplicate'
 *
 * Phase B. Called ONLY when phase A actually inserted a new orderstatus row — that is the Python's dedupe mechanism, and it is why a
 * re-synced order does not double-book its sale.
 *
 * DIVERGENCE (approved, fix #1): that mechanism has a hole. When an order is archived (phase C) and Shopify later hands it back —
 * a partial refund, an un-fulfilment — phase A sees no orderstatus row, inserts one, and books the sale AGAIN. There are 38 such
 * duplicate rows in the live table right now (BC17908 / 0129443-ARIZONA-39 and friends: identical price, identical minute, ids ~65
 * apart, i.e. a later run). They inflate the Analytics revenue and profit totals. So before inserting we check `sales` directly for a
 * positive-qty SHP row on the same (ordernum, code) — a guard that holds whichever system booked the original, which the source_key
 * mechanism used by the Amazon importer would not (the Python writes NULL source_keys).
 */
async function insertSale(client, order, line, ordernum) {
  // groupid drives everything downstream. No groupid -> the Python logs a warning and books NO sale, leaving the orderstatus row in
  // place. Faithful: an unmatched SKU must not invent a groupid, and the order still has to be picked and posted.
  const g = await client.query(`SELECT groupid FROM skumap WHERE code = $1 LIMIT 1`, [line.sku]);
  const groupid = g.rows[0] ? g.rows[0].groupid : null;
  if (!groupid) return 'no-groupid';

  // Fix #1 — the duplicate guard. qty > 0 scopes it to sale rows, never return reversals (Amazon writes negative rows into the same
  // table). Served by idx_sales_channel_ordernum_code.
  const dup = await client.query(
    `SELECT 1 FROM sales WHERE channel = 'SHP' AND ordernum = $1 AND code = $2 AND qty > 0 LIMIT 1`,
    [ordernum, line.sku]
  );
  if (dup.rows.length) return 'duplicate';

  const meta = await client.query(`SELECT brand, cost FROM skusummary WHERE groupid = $1 LIMIT 1`, [groupid]);
  const brand = meta.rows[0] ? meta.rows[0].brand : null;
  const costRaw = meta.rows[0] ? meta.rows[0].cost : null;

  const soldprice = Number(line.price) || 0;
  // NULL rather than a wrong figure when cost is missing or junk (skusummary.cost is a legacy VARCHAR). See utils/shopifyProfit.js.
  const profit = shopifyProfit(soldprice, costRaw);

  const when = wallClock(order.created_at);
  // paytype is truncated to 20 even though the column holds 100 — the Python's own limit, kept so the two write identical values.
  const paytype = ((order.payment_gateway_names || []).join(',') || 'UNKNOWN').slice(0, 20);

  await client.query(
    `INSERT INTO sales (code, solddate, groupid, ordernum, ordertime, qty, soldprice, channel, paytype,
                        collectedvat, productname, brand, profit, discount)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'SHP', $8, NULL, $9, $10, $11, 0)`,
    [
      safe(line.sku, 50), when ? when.date : null, safe(groupid, 50), safe(ordernum, 50), when ? when.time.slice(0, 20) : '',
      line.qty, soldprice, paytype, safe(line.title, 200), safe(brand, 50), profit
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

  for (const order of orders) {
    // The Python fetches every open unfulfilled order and filters HERE rather than in the query, so that BOTH 'paid' and
    // 'partially_refunded' get through. partially_refunded is what an order becomes when the shipping is refunded — it still has to be
    // picked and posted, so excluding it would drop real work. cancel_reason is belt-and-braces on top of status=open.
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
    // Courier is decided ONLY at insert, from an exact 5.95 shipping charge. 4 = the paid/tracked service, 5 = everything else.
    const courier = String(shippingCost === 5.95 ? 4 : 5);

    const createdAt = wallClock(order.created_at);
    const updatedAt = wallClock(order.updated_at);

    const lines = lineItemsBySku(order);
    const withSku = (order.line_items || []).filter((i) => safe(i.sku)).length;
    skippedNoSku += (order.line_items || []).length - withSku;
    folded += lines.reduce((n, l) => n + l.folded, 0);

    for (const line of lines) {
      // Tracked BEFORE anything can go wrong with this line: a line we saw but failed to write must NOT then be archived as "gone
      // from Shopify". Same ordering as the Python.
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
        // RE-SYNC PATH — this is what makes "change the delivery address in Shopify, then press Sync" work. Every delivery field is
        // overwritten from the live Shopify order on every single run, so a corrected address, postcode, phone, company, email or
        // order note lands immediately, whatever stage the order has reached locally.
        //
        // DELIBERATELY NOT REFRESHED (same as the Python): qty, title, supplier, createddate, shippingcost, and `courier`. courier is
        // decided once, at insert, from the shipping charge — so changing the DELIVERY METHOD in Shopify after the fact will not move
        // it. Nothing else about the row is frozen. Say the word and it becomes one more line in this UPDATE.
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

      // NEW ROW. Every constant below is the Python's, including the ones that look like mistakes:
      //   batch '0'        orderdate ''      ukd/localstock/amz/othersupplier 0     fnsku ''      weight ''
      //   pickedqty 0      courierfixed 0    customerwaiting 0    notorderamz NULL  alloworder NULL   searchalt ''
      //   channel 'SHOPIFY'  picknotfound NULL  fbaordered NULL   notes ''          shopcustomer 0
      //   shippingcost ''  <- see safe(): the float never survives the type test. ALWAYS '' in live data.
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

  return { inserted, updated, skippedNoSku, salesInserted, salesNoGroupid, salesDuplicate, folded, currentKeys, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE C + D — archive what Shopify no longer has, then drop the picks those orders were holding.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * archiveMissing(client, currentKeys) -> { archived, picksRemoved }
 *
 * "No longer in Shopify" means fulfilled, cancelled, or otherwise off the open-unfulfilled list. Scoped to channel = 'SHOPIFY', which
 * is what keeps the Order Status module's rows (channel 'MANUAL') out of reach of this phase.
 *
 * THE DANGEROUS PHASE. Absence from `currentKeys` is the whole test, so a fetch that returned less than the truth would archive live
 * orders wholesale. That is why routes/order-sync.js refuses to call this at all on a truncated fetch (fix #2) — the Python has no
 * such guard and would happily do it.
 *
 * archivedate is set from `last_seen`, NOT from now(). That is what the Python's `INSERT ... SELECT *` does positionally (orderstatus
 * has last_seen as its 45th column, orderstatus_archive has archivedate as its 45th), so the column has always held "when this order
 * was last seen in Shopify" for cron-archived rows. Kept identical. Note routes/order-status-archive.js writes CURRENT_DATE into the
 * same column for supplier orders, so the column already carries two meanings; that predates this port.
 */
async function archiveMissing(client, currentKeys) {
  const existing = await client.query(`SELECT ordernum, shopifysku FROM orderstatus WHERE channel = 'SHOPIFY'`);

  const gone = existing.rows.filter((r) => !currentKeys.has(`${r.ordernum}\u0000${r.shopifysku}`));
  if (gone.length === 0) return { archived: 0, picksRemoved: 0 };

  const nums = gone.map((r) => r.ordernum);
  const skus = gone.map((r) => r.shopifysku);

  // Set-based rather than the Python's row-at-a-time loop — same rows, one round trip. The unnest join pairs each ordernum with its
  // own sku, so it can never archive a different line that happens to share an order number.
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

  // PHASE D — only reached when something was archived, exactly as the Python gates it. Any localstock row still holding a pick for
  // an order that no longer exists in orderstatus is a pick that has already been packed and posted.
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
// PHASE E — pick allocation.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * newFreeRowId(client, ordernum) -> string
 *
 * When a shelf row holds more than one unit, one unit is taken for the order and the remainder becomes a NEW '#FREE' row, which needs
 * an id. The Python mints it as digits(ordernum) + a random 100-999 — so order BC18624 produces ids like '18624325'. The live table is
 * full of them ('18624325', '18620407', '18618629'), which is how we know this path runs and works.
 *
 * localstock.id is a VARCHAR primary key with no sequence, so a collision is possible — and the Python has no guard, meaning one
 * unlucky number raises a unique violation that unwinds the ENTIRE run (all six phases, every order) with nothing but "Unexpected
 * error" in the log. DIVERGENCE (approved, fix #4): retry on a taken id, and widen the random suffix if the 900-value space is
 * somehow exhausted. Same id shape, no run-ending failure.
 */
async function newFreeRowId(client, ordernum) {
  const digits = String(ordernum).replace(/\D/g, '') || '0';
  for (let attempt = 0; attempt < 40; attempt++) {
    // First 30 attempts keep the exact legacy shape (3 random digits); after that widen to 5, which stays numeric and unique-ish.
    const width = attempt < 30 ? 3 : 5;
    const min = Math.pow(10, width - 1);
    const rand = Math.floor(Math.random() * (Math.pow(10, width) - min)) + min;
    const id = String(Number(`${digits}${rand}`));
    const clash = await client.query(`SELECT 1 FROM localstock WHERE id = $1`, [id]);
    if (clash.rows.length === 0) return id;
  }
  throw new Error(`could not mint a free localstock id for ${ordernum} after 40 attempts`);
}

/*
 * allocatePicks(client) — PHASE E.
 *
 * Candidates are order lines that still need picking: not Amazon (3) or type 5, not marked "do not order", and with none of the four
 * allocation flags set yet.
 *
 * DIVERGENCE (approved, fix #3): the Python writes `batch::int != -1`, which THROWS on a blank or non-numeric batch and takes the
 * whole run down with it. Here a batch that isn't a plain integer is simply treated as "not -1" (i.e. included, which is what every
 * real value except '-1' resolves to anyway). Fail-soft instead of run-ending. Phase F deletes batch='-1' rows regardless.
 */
async function allocatePicks(client) {
  const stats = { considered: 0, fullyAllocated: 0, partiallyAllocated: 0, alreadyAllocated: 0,
                  picksTaken: 0, splits: 0, amzMarked: 0, ukdMarked: 0, ukdToOrder: 0, otherMarked: 0, unfulfillable: 0 };
  const notes = [];

  const candidates = await client.query(`
    SELECT ordernum, shopifysku, qty
      FROM orderstatus
     WHERE ordertype NOT IN (3, 5)
       AND (batch IS NULL OR TRIM(batch) !~ '^-0*1$')
       AND COALESCE(amz, 0) = 0
       AND COALESCE(localstock, 0) = 0
       AND COALESCE(ukd, 0) = 0
       AND COALESCE(othersupplier, 0) = 0
       AND (orderdate IS NULL OR LOWER(orderdate) NOT LIKE '%do not order%')
  `);

  for (const row of candidates.rows) {
    const { ordernum, shopifysku } = row;
    const orderQty = Number(row.qty) || 0;
    if (orderQty <= 0) {
      notes.push(`${ordernum} / ${shopifysku}: skipped — quantity is ${row.qty}`);
      continue;
    }
    stats.considered += 1;

    // Picks already sitting against this order (a previous run that only got part way, or a hand-allocated pick).
    const already = Number((await client.query(
      `SELECT COUNT(*) AS n FROM localstock WHERE code = $1 AND ordernum = $2 AND deleted = 0`,
      [shopifysku, ordernum]
    )).rows[0].n);

    if (already >= orderQty) {
      // Nothing to do but record it, so the row drops out of the candidate set next run and can't be picked twice.
      await client.query(
        `UPDATE orderstatus SET orderdate = created, localstock = $1 WHERE ordernum = $2 AND shopifysku = $3`,
        [already, ordernum, shopifysku]
      );
      stats.alreadyAllocated += 1;
      continue;
    }

    const needed = orderQty - already;

    // Free shelf stock for this exact SKU. ORDER BY location, id — id is a VARCHAR so this sorts lexicographically; every live id is
    // 8 digits, so that happens to equal numeric order. Kept as-is because which row gets picked determines which SHELF gets picked.
    const freeSql = `
      SELECT id, qty, location, groupid, supplier, brand
        FROM localstock
       WHERE code = $1 AND ordernum = '#FREE' AND (deleted = 0 OR deleted IS NULL) AND allocated = 'unallocated'
       ORDER BY location, id`;

    let available = (await client.query(freeSql, [shopifysku])).rows;

    if (available.length === 0) {
      // ---- No shelf stock. Three fallbacks, in the Python's order: Amazon FBA, then UKD, then "some other supplier". ----
      // None of these stamp orderdate: the line is flagged for sourcing, not picked.
      const amz = await client.query(`SELECT SUM(amzlive) AS n FROM amzfeed WHERE code = $1 AND amzlive > 0`, [shopifysku]);
      const amzAvailable = Number(amz.rows[0].n) || 0;

      if (amzAvailable > 0) {
        const take = Math.min(needed, amzAvailable);
        await client.query(`UPDATE orderstatus SET amz = $1 WHERE ordernum = $2 AND shopifysku = $3`, [take, ordernum, shopifysku]);
        stats.amzMarked += 1;
        continue;
      }

      const sup = await client.query(
        `SELECT ss.supplier
           FROM skumap sm
           JOIN skusummary ss ON ss.groupid = sm.groupid
          WHERE sm.code = $1 AND ss.supplier IS NOT NULL AND TRIM(ss.supplier) <> ''
          LIMIT 1`,
        [shopifysku]
      );
      const supplier = sup.rows[0] ? sup.rows[0].supplier : null;

      if (supplier && supplier.toLowerCase() === 'ukd') {
        const ukd = await client.query(`SELECT SUM(stock) AS n FROM ukdstock WHERE code = $1 AND stock > 0`, [shopifysku]);
        const ukdAvailable = Number(ukd.rows[0].n) || 0;
        if (ukdAvailable > 0) {
          const take = Math.min(needed, ukdAvailable);
          await client.query(`UPDATE orderstatus SET ukd = $1 WHERE ordernum = $2 AND shopifysku = $3`, [take, ordernum, shopifysku]);
          stats.ukdMarked += 1;
        } else {
          // No UKD stock either — still flag the full quantity so it lands on the order-from-UKD list rather than disappearing.
          await client.query(`UPDATE orderstatus SET ukd = $1 WHERE ordernum = $2 AND shopifysku = $3`, [needed, ordernum, shopifysku]);
          stats.ukdToOrder += 1;
          notes.push(`${ordernum} / ${shopifysku}: nothing on the shelf and none at UKD — flagged to order (${needed})`);
        }
      } else {
        await client.query(`UPDATE orderstatus SET othersupplier = $1 WHERE ordernum = $2 AND shopifysku = $3`, [needed, ordernum, shopifysku]);
        stats.otherMarked += 1;
        notes.push(`${ordernum} / ${shopifysku}: no stock anywhere — flagged to ${supplier || 'an unknown supplier'} (${needed})`);
      }
      continue;
    }

    // ---- Shelf stock exists. Take one unit at a time. ----
    let taken = 0;
    while (taken < needed) {
      // Re-read every iteration: splitting a multi-unit row CREATES a new '#FREE' row that this loop may need to see.
      available = (await client.query(freeSql, [shopifysku])).rows;
      if (available.length === 0) break;

      const pick = available[0];
      const pickQty = Number(pick.qty) || 0;

      if (pickQty > 1) {
        // Split: this row becomes the single allocated unit, and the remainder moves to a brand-new free row on the same shelf.
        await client.query(`UPDATE localstock SET qty = 1, ordernum = $1 WHERE id = $2`, [ordernum, pick.id]);
        const remainderId = await newFreeRowId(client, ordernum);
        await client.query(
          `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, allocated, deleted)
           VALUES ($1, CURRENT_TIMESTAMP, '#FREE', $2, $3, $4, $5, $6, $7, 'unallocated', 0)`,
          [remainderId, pick.location, pick.groupid, shopifysku, pick.supplier, pickQty - 1, pick.brand]
        );
        stats.splits += 1;
      } else {
        await client.query(`UPDATE localstock SET ordernum = $1 WHERE id = $2`, [ordernum, pick.id]);
      }
      taken += 1;
      stats.picksTaken += 1;
    }

    const total = already + taken;
    if (taken > 0) {
      // Stamped even on a PARTIAL allocation — deliberate in the original: the stamp is what stops the line being picked again, and a
      // half-picked line must not be re-swept next run. The warning below is the only signal that it went out short.
      await client.query(
        `UPDATE orderstatus SET orderdate = created, localstock = $1 WHERE ordernum = $2 AND shopifysku = $3`,
        [total, ordernum, shopifysku]
      );
      if (total === orderQty) stats.fullyAllocated += 1;
      else {
        stats.partiallyAllocated += 1;
        notes.push(`${ordernum} / ${shopifysku}: PARTIALLY picked — ${total} of ${orderQty}`);
      }
    } else {
      stats.unfulfillable += 1;
      notes.push(`${ordernum} / ${shopifysku}: no picks allocated`);
    }
  }

  return { ...stats, notes };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// PHASE F — housekeeping. Six statements, always run, whatever the earlier phases did.
// ---------------------------------------------------------------------------------------------------------------------------------

/*
 * cleanup(client) -> counts
 *
 * Ported statement for statement. Two of these deliberately reach beyond Shopify orders — see the SCOPE NOTE at the top of the file —
 * and the comments on the 30-day and 7-day deletes are the Python author's reasoning, carried over rather than re-derived.
 */
async function cleanup(client) {
  const out = {};

  // Soft-deleted stock rows are cleared once per run; nothing reads deleted=1 after this point.
  out.localstockDeleted = (await client.query(`DELETE FROM localstock WHERE deleted = 1`)).rowCount || 0;

  // batch '-1' is the legacy "discard this line" marker.
  out.batchMinusOne = (await client.query(`DELETE FROM orderstatus WHERE batch = '-1'`)).rowCount || 0;

  // 30-day window. Real supplier lead time is ~10 days typical, 20 days the longest legitimate arrival observed — 30d is the ceiling
  // plus buffer. This ignores `arrived` on purpose, so it also clears arrived=1 rows with a NULL arriveddate that the 7-day purge
  // below would miss. NOTE it takes Order Status rows (ordertype 2 and 3) with it, unarchived.
  out.oldOrderStatus = (await client.query(
    `DELETE FROM orderstatus WHERE ordertype <> 1 AND createddate < NOW() - INTERVAL '30 days'`
  )).rowCount || 0;

  // Received Amazon rows are purged after a 7-day reconciliation window. This replaced an INSTANT arrived=1 delete that erased the
  // order trail the moment stock was received — the root cause of the '#FREE-leak' incident.
  out.arrivedAmazon = (await client.query(
    `DELETE FROM orderstatus WHERE ordertype = 3 AND arrived = 1 AND arriveddate < CURRENT_DATE - INTERVAL '7 days'`
  )).rowCount || 0;

  // Empty free rows serve no purpose and clutter the pick query's ORDER BY.
  out.emptyFree = (await client.query(`DELETE FROM localstock WHERE qty = 0 AND ordernum = '#FREE'`)).rowCount || 0;

  // Anything sitting on the C3-Amazon shelf belongs to FBA, not to the pick pool — re-flag it so phase E can never allocate it.
  out.amzShelf = (await client.query(
    `UPDATE localstock SET allocated = 'amz' WHERE location = 'C3-Amazon' AND allocated = 'unallocated'`
  )).rowCount || 0;

  return out;
}

/*
 * runFullSync(client, orders, { truncated }) -> summary
 *
 * The whole job, in order, on one client. Call it inside withTransaction (route) or inside a manual BEGIN … ROLLBACK (rehearsal).
 *
 * `truncated` comes from utils/shopifyOrders.js and is the ONLY thing that can switch phase C off: archiving is decided by absence
 * from the fetched set, so a fetch that didn't finish must never be allowed to archive. Phases A, B, E and F are unaffected — they
 * only ever act on what was actually seen.
 */
async function runFullSync(client, orders, { truncated = false } = {}) {
  // Serialise concurrent runs (two operators, or a double-click). Transaction-scoped, so it releases on COMMIT or ROLLBACK.
  // CAVEAT WORTH KNOWING: this only serialises bcweb against bcweb. The cron Python takes no such lock, so a button press landing in
  // the same second as a cron run is still theoretically able to interleave — the inserts are safe either way (both guard on the
  // orderstatus primary key), but two overlapping phase-C runs could each archive rows the other had just inserted. Adding the same
  // one-line advisory lock to update_orders.py would close it completely.
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('bcweb_order_sync'))`);

  const sync = await syncOrders(client, orders);

  let archive = { archived: 0, picksRemoved: 0, skipped: false };
  if (truncated) {
    // Fix #2's other half. Without this, a partial fetch archives every order it failed to read.
    archive.skipped = true;
    logger.error('[orderSync] fetch was truncated — ARCHIVE PHASE SKIPPED to avoid archiving orders that were never read');
  } else {
    archive = { ...(await archiveMissing(client, sync.currentKeys)), skipped: false };
  }

  const picks = await allocatePicks(client);
  const housekeeping = await cleanup(client);

  return {
    orders: { inserted: sync.inserted, updated: sync.updated, linesWithoutSku: sync.skippedNoSku, linesFolded: sync.folded },
    sales: { inserted: sync.salesInserted, skippedNoGroupid: sync.salesNoGroupid, skippedDuplicate: sync.salesDuplicate },
    archive,
    picks: {
      considered: picks.considered, fullyAllocated: picks.fullyAllocated, partiallyAllocated: picks.partiallyAllocated,
      alreadyAllocated: picks.alreadyAllocated, picksTaken: picks.picksTaken, splits: picks.splits,
      amzMarked: picks.amzMarked, ukdMarked: picks.ukdMarked, ukdToOrder: picks.ukdToOrder,
      otherMarked: picks.otherMarked, unfulfillable: picks.unfulfillable
    },
    housekeeping,
    // Everything the Python would have written to its log as a WARNING, surfaced to the operator instead of buried in a file on the
    // VPS. Capped so a pathological run can't return a novel.
    notes: [...sync.notes, ...picks.notes].slice(0, 50)
  };
}

module.exports = { runFullSync, syncOrders, archiveMissing, allocatePicks, cleanup, safe, wallClock, lineItemsBySku };
