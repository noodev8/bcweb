/*
=======================================================================================================================================
Util: amzImport
=======================================================================================================================================
Purpose: Turn a set of uploaded Amazon reports into a PLAN — a complete, inspectable description of every row that would be written,
         updated, skipped or retracted, with a reason attached to each. The preview route renders the plan; the commit route builds
         the SAME plan again inside its transaction and executes it.

WHY PREVIEW AND COMMIT SHARE THIS
If preview and commit each did their own reasoning they would drift, and the operator would be approving one thing and getting
another. Here there is exactly one implementation, so "what the preview said" and "what the commit did" cannot disagree about
anything except genuine data changes between the two calls — and commit re-reads the database inside its transaction, so even that
is accounted for rather than assumed.

WHY THE PLAN IS SO EXPLICIT ABOUT SKIPS
The whole reason this module exists is that the legacy import discarded rows invisibly: a missing file loaded as zero rows with no
message, unmatched SKUs vanished, and dedupe collisions silently dropped real sales. Every row this import does NOT write is
therefore accounted for by name and reason, and the preview shows the arithmetic: rows in file = written + already there + skipped.

ORDER OF WORK (design doc §3.2) — ingest, then derive, then project:
  PHASE 1  ingest    orders + returns -> sales | fees -> skumap.fbafee | inventory -> amzfeed stock columns
  PHASE 2  derive    two grouped queries over sales (a fixed 30-day window, plus 7 days)
  PHASE 3  project   write the derived values onto amzfeed for PowerBuilder, which still reads them (decision D1)
Phase 3 exists ONLY for PowerBuilder. When PB is retired, delete projectDerivedToAmzfeed() and its call site; nothing else changes.
=======================================================================================================================================
*/

const { safeNumeric } = require('./sql');
const { amzProfit, returnProfit } = require('./amzProfit');
const { parseReport, parseCancellations } = require('./amzReports');

// The `amzsold` / `amzsold7` window. FIXED at 30 days, deliberately (decision O2): the owner compares this number across SKUs by eye,
// so it must mean the same thing on every run. Deriving it from the uploaded file's window — which is what the legacy code effectively
// did — would silently change its meaning the day a longer report was downloaded.
const SOLD_WINDOW_DAYS = 30;
const SOLD_RECENT_DAYS = 7;

const round2 = (n) => (n === null || n === undefined ? null : Math.round(Number(n) * 100) / 100);

// ---------------------------------------------------------------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Load everything the plan needs to resolve Amazon SKUs into our own product rows, in a handful of set-based queries.
 * Deliberately NOT one query per row — the legacy import's per-SKU Find loop is the thing that made it slow.
 */
async function loadReference(db, skus) {
  const list = [...new Set(skus.filter(Boolean))];
  if (list.length === 0) return { bySku: new Map(), byGroup: new Map() };

  // sku -> code/groupid. skumap.sku is 1:1 with code (verified: 0 duplicate skus across 537 rows), so a Map is safe.
  const map = await db.query(
    `SELECT sku, code, groupid, ${safeNumeric('fbafee')} AS fbafee FROM skumap WHERE sku = ANY($1::text[])`,
    [list]
  );

  const bySku = new Map();
  for (const r of map.rows) bySku.set(r.sku, { code: r.code, groupid: r.groupid, fbafee: r.fbafee === null ? null : Number(r.fbafee) });

  // groupid -> the economics + naming a sales row needs. cost/rrp are legacy varchars that can hold junk ('RRP' is a real value in
  // this database), so they go through safeNumeric and degrade to NULL rather than throwing.
  const groups = [...new Set([...bySku.values()].map((v) => v.groupid).filter(Boolean))];
  const byGroup = new Map();
  if (groups.length > 0) {
    const sum = await db.query(
      `SELECT ss.groupid,
              ${safeNumeric('ss.cost')} AS cost,
              ${safeNumeric('ss.rrp')}  AS rrp,
              ss.tax,
              ss.brand,
              t.shopifytitle
       FROM skusummary ss
       LEFT JOIN title t ON t.groupid = ss.groupid
       WHERE ss.groupid = ANY($1::text[])`,
      [groups]
    );
    for (const r of sum.rows) {
      byGroup.set(r.groupid, {
        cost: r.cost === null ? null : Number(r.cost),
        rrp: r.rrp === null ? null : Number(r.rrp),
        tax: r.tax,
        brand: r.brand,
        title: r.shopifytitle,
      });
    }
  }

  return { bySku, byGroup };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan: sales (orders)
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Decide, for every usable order line, whether it will insert and with what profit.
 *
 * Two independent duplicate guards, for two different populations:
 *   1. `source_key` — our own rows. A true unique key, so re-uploading the same file is a genuine no-op and an overlapping window
 *      converges instead of duplicating.
 *   2. the LEGACY shape (channel, ordernum, code, qty > 0) restricted to `source_key IS NULL` — rows PowerBuilder wrote. While both
 *      systems run in parallel (decision D1) PB keeps inserting unkeyed rows, and without this guard BCWEB would insert its own copy
 *      of every sale PB had already recorded. Restricting it to unkeyed rows means we reproduce the legacy dedupe for legacy rows
 *      WITHOUT re-introducing its bug (two units of one sku in one order collapsing into one) for ours.
 */
async function planSales(db, orderRows, ref) {
  const out = { insert: [], duplicate: 0, legacyDuplicate: 0, unknownSku: [], noProfit: 0, units: 0, value: 0 };
  if (orderRows.length === 0) return out;

  const keys = orderRows.map((r) => r.sourceKey);
  const existing = new Set(
    (await db.query(`SELECT source_key FROM sales WHERE source_key = ANY($1::text[])`, [keys])).rows.map((r) => r.source_key)
  );

  // Legacy-shaped rows for the orders in this file, so we can spot sales PowerBuilder already recorded.
  const orderIds = [...new Set(orderRows.map((r) => r.orderId))];
  const legacy = new Set(
    (await db.query(
      `SELECT ordernum, code FROM sales WHERE channel = 'AMZ' AND source_key IS NULL AND qty > 0 AND ordernum = ANY($1::text[])`,
      [orderIds]
    )).rows.map((r) => `${r.ordernum}|${r.code}`)
  );

  const unknown = new Map();
  for (const row of orderRows) {
    if (existing.has(row.sourceKey)) { out.duplicate += 1; continue; }

    const m = ref.bySku.get(row.sku);
    if (!m) {
      // Amazon sold something we have no record of. Collected by sku (not per line) so the operator sees N products, not N sales.
      if (!unknown.has(row.sku)) unknown.set(row.sku, { sku: row.sku, lines: 0, units: 0 });
      const u = unknown.get(row.sku);
      u.lines += 1; u.units += row.qty;
      continue;
    }

    if (legacy.has(`${row.orderId}|${m.code}`)) { out.legacyDuplicate += 1; continue; }

    const g = ref.byGroup.get(m.groupid) || {};
    const { profit } = amzProfit({ price: row.unitPrice, cost: g.cost, fbafee: m.fbafee, tax: g.tax });
    if (profit === null) out.noProfit += 1;

    // Discount vs RRP, as the legacy import recorded it (of_amzsalesload:219-223). Null rather than 0 when RRP is unknown or junk,
    // so "no RRP on file" and "sold at full price" stay distinguishable.
    let discount = null;
    if (g.rrp !== null && g.rrp !== undefined && g.rrp > 0) {
      discount = Math.round(((g.rrp - row.unitPrice) / g.rrp) * 100);
    }

    out.insert.push({
      sourceKey: row.sourceKey,
      code: m.code,
      groupid: m.groupid,
      solddate: row.date,
      ordernum: row.orderId,
      ordertime: row.time,
      qty: row.qty,
      soldprice: row.unitPrice,
      productname: g.title || null,
      brand: g.brand || null,
      // sales.profit is stored for the WHOLE line, matching the legacy column's meaning (the return reversal divides it back out
      // by qty). amzProfit() returns a per-unit figure, so multiply.
      profit: profit === null ? null : round2(profit * row.qty),
      discount,
    });
    out.units += row.qty;
    out.value += row.unitPrice * row.qty;
  }

  out.unknownSku = [...unknown.values()].sort((a, b) => b.units - a.units);
  out.value = round2(out.value);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan: returns
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Returns become negative `sales` rows. NOT a bare reversal of the sale (which is all the legacy code did, and which models a return
 * as free) — the real cost of a return is worked out by utils/amzProfit.js -> returnProfit(): the reversed margin, plus the refund
 * admin fee Amazon keeps, plus the unrecovered FBA fee, plus the whole cost of goods when the unit comes back unsellable.
 *
 * The key is `license-plate-number`, Amazon's per-unit id. The legacy code read that value into a variable at line 259 and then
 * never used it, keying on (solddate, code, ordernum, qty) instead — which is why two units of the same sku returned on one order
 * collapsed into one row. Using it fixes that.
 */
async function planReturns(db, returnRows, ref) {
  const out = {
    insert: [], duplicate: 0, legacyDuplicate: 0, unknownSku: [], unmatchedSale: 0, units: 0,
    // Stock lost to damage/defect, reported in its own right: it is the largest unmodelled cost the old formula had, and burying it
    // inside a profit total would hide exactly the thing worth watching.
    writeOffValue: 0, writeOffUnits: 0, dispositions: {},
  };
  if (returnRows.length === 0) return out;

  const keys = returnRows.map((r) => r.sourceKey);
  const existing = new Set(
    (await db.query(`SELECT source_key FROM sales WHERE source_key = ANY($1::text[])`, [keys])).rows.map((r) => r.source_key)
  );

  const orderIds = [...new Set(returnRows.map((r) => r.orderId))];

  // The original sale for each (ordernum, code). `soldprice` is needed as well as profit/qty: the refund admin fee Amazon keeps is
  // a percentage of the referral fee, which is a percentage of what the customer actually paid.
  const sales = await db.query(
    `SELECT ordernum, code, profit, qty, soldprice FROM sales WHERE channel = 'AMZ' AND qty > 0 AND ordernum = ANY($1::text[])`,
    [orderIds]
  );
  const originals = new Map();
  for (const r of sales.rows) originals.set(`${r.ordernum}|${r.code}`, { profit: r.profit, qty: r.qty, price: r.soldprice });

  // Legacy-shaped reversal rows (unkeyed, negative qty) already written by PowerBuilder for these orders.
  const legacyRev = new Set(
    (await db.query(
      `SELECT ordernum, code, solddate::text AS solddate, qty FROM sales
       WHERE channel = 'AMZ' AND source_key IS NULL AND qty < 0 AND ordernum = ANY($1::text[])`,
      [orderIds]
    )).rows.map((r) => `${r.solddate}|${r.code}|${r.ordernum}|${r.qty}`)
  );

  const unknown = new Map();
  for (const row of returnRows) {
    if (existing.has(row.sourceKey)) { out.duplicate += 1; continue; }

    const m = ref.bySku.get(row.sku);
    if (!m) {
      if (!unknown.has(row.sku)) unknown.set(row.sku, { sku: row.sku, lines: 0, units: 0 });
      const u = unknown.get(row.sku);
      u.lines += 1; u.units += Math.abs(row.qty);
      continue;
    }

    // Exactly the legacy dedupe key, applied only to unkeyed rows — same reasoning as planSales.
    if (legacyRev.has(`${row.date}|${m.code}|${row.orderId}|${row.qty}`)) { out.legacyDuplicate += 1; continue; }

    const orig = originals.get(`${row.orderId}|${m.code}`);
    if (!orig) out.unmatchedSale += 1;

    const g = ref.byGroup.get(m.groupid) || {};
    const { profit, writeOff } = returnProfit({
      originalProfit: orig ? orig.profit : null,
      originalQty: orig ? orig.qty : null,
      cost: g.cost,
      disposition: row.disposition,
    });

    // Tally the damage separately from the money, so the screen can say "12 units, £181 of stock" rather than only moving a total.
    const dispo = row.disposition || 'UNKNOWN';
    out.dispositions[dispo] = (out.dispositions[dispo] || 0) + 1;
    if (writeOff > 0) { out.writeOffValue = round2(out.writeOffValue + writeOff); out.writeOffUnits += 1; }

    out.insert.push({
      sourceKey: row.sourceKey,
      code: m.code,
      groupid: m.groupid,
      solddate: row.date,
      ordernum: row.orderId,
      ordertime: row.time,
      qty: row.qty,                       // already negative
      soldprice: 0,                       // legacy convention: the reversal carries no price, only the profit effect
      productname: g.title || null,
      brand: g.brand || null,
      profit,
      discount: null,
    });
    out.units += Math.abs(row.qty);
  }

  out.unknownSku = [...unknown.values()].sort((a, b) => b.units - a.units);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan: cancellations
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * A Pending order that later cancels was inserted as a sale and then never revisited — the legacy dedupe key guaranteed it would
 * never be looked at again, so the sale stayed on the books forever (bug 2.7.1). The sample window has 10 Pending and 17 Cancelled,
 * so this fires regularly and invisibly.
 *
 * A cancellation is NOT a return: the sale never happened, so the row is DELETED rather than reversed with a negative row. Scoped to
 * channel='AMZ' and to the order ids present in the uploaded file, and always shown in the preview before it happens — deletes are
 * the one thing here that destroys data, so they are never silent.
 */
async function planCancellations(db, cancellations) {
  const out = { orders: [], rows: 0, units: 0, value: 0 };
  if (cancellations.length === 0) return out;

  const orderIds = [...new Set(cancellations.map((c) => c.orderId))];
  const hits = await db.query(
    `SELECT id, ordernum, code, qty, soldprice, solddate::text AS solddate
     FROM sales WHERE channel = 'AMZ' AND qty > 0 AND ordernum = ANY($1::text[])`,
    [orderIds]
  );

  for (const r of hits.rows) {
    out.rows += 1;
    out.units += r.qty || 0;
    out.value += Number(r.soldprice || 0) * (r.qty || 0);
    out.orders.push({ id: r.id, ordernum: r.ordernum, code: r.code, qty: r.qty, solddate: r.solddate, soldprice: Number(r.soldprice || 0) });
  }
  out.value = round2(out.value);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan: fees
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Fee report -> skumap.fbafee.
 *
 * A SKU absent from the file KEEPS its last known fee (owner's rule for D3: "if you see it, process it. If not, use what is already
 * there"). That is not a shortcut — the fee preview only covers SKUs with FBA inventory (202 of the 204 live-stock SKUs in the
 * sample; the ~371 absent are zero-stock listings), so absence means "nothing in FBA", never "fee withdrawn".
 */
async function planFees(db, feeRows, ref) {
  const out = { update: [], unchanged: 0, unknownSku: [], newlyReal: 0, biggestMoves: [] };
  if (feeRows.length === 0) return out;

  const moves = [];
  for (const row of feeRows) {
    const m = ref.bySku.get(row.sku);
    if (!m) { out.unknownSku.push(row.sku); continue; }

    const current = m.fbafee;
    if (current !== null && Math.abs(current - row.fee) < 0.005) { out.unchanged += 1; continue; }

    if (current === null) out.newlyReal += 1;
    out.update.push({ code: m.code, sku: row.sku, from: current, to: row.fee });
    if (current !== null) moves.push({ sku: row.sku, from: current, to: row.fee, delta: round2(row.fee - current) });
  }

  // Surfaced in the preview because a fee that moves by more than a few pence is the interesting case — it is exactly what the
  // report is for, and a big jump is worth an eyeball before it silently changes every margin on that SKU.
  out.biggestMoves = moves.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 10);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan: stock
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Inventory report -> the `amzfeed` stock columns.
 *
 * Also produces the reconciliation buckets (design doc 3.7 / 2.8). Three of them, not two, because lumping them together would
 * present ~108 rows as ~108 problems when most are nothing of the sort:
 *   unknownSku    — Amazon holds stock/a listing we have no skumap record of. The only bucket that is a to-do list.
 *   virtual       — 'amzn.gr.*', Amazon's own generated bundle/group SKUs. Expected, never matchable, hidden by default.
 *   goneFromAmazon— in amzfeed today but absent from this report: the listing has gone.
 */
async function planStock(db, stockRows, ref) {
  const out = { rows: stockRows.length, matched: 0, unknownSku: [], virtual: [], goneFromAmazon: [], liveUnits: 0, totalUnits: 0 };
  if (stockRows.length === 0) return out;

  const seenCodes = new Set();
  for (const row of stockRows) {
    if (row.isVirtual) { out.virtual.push({ sku: row.sku, live: row.live, total: row.total }); continue; }
    const m = ref.bySku.get(row.sku);
    if (!m) {
      out.unknownSku.push({ sku: row.sku, fnsku: row.fnsku, asin: row.asin, live: row.live, total: row.total });
      continue;
    }
    out.matched += 1;
    out.liveUnits += row.live;
    out.totalUnits += row.total;
    seenCodes.add(m.code);
  }

  const current = await db.query(`SELECT code, sku FROM amzfeed`);
  for (const r of current.rows) {
    if (!seenCodes.has(r.code)) out.goneFromAmazon.push({ code: r.code, sku: r.sku });
  }

  // Most stock first — a listing that vanished while holding units is the one worth looking at.
  out.unknownSku.sort((a, b) => b.total - a.total);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Build the full plan from already-parsed files. `parsed` is a map of type -> parseReport() result; any subset may be present, which
 * is what makes partial runs work (design doc §3.2): each phase reads only what it needs and leaves everything else alone.
 */
async function buildPlan(db, parsed, cancellations) {
  const orders = parsed.ORDERS ? parsed.ORDERS.rows : [];
  const returns = parsed.RETURNS ? parsed.RETURNS.rows : [];
  const fees = parsed.FEES ? parsed.FEES.rows : [];
  const stock = parsed.INVENTORY ? parsed.INVENTORY.rows : [];

  const allSkus = [
    ...orders.map((r) => r.sku),
    ...returns.map((r) => r.sku),
    ...fees.map((r) => r.sku),
    ...stock.map((r) => r.sku),
  ];
  const ref = await loadReference(db, allSkus);

  // Orders must be planned before returns: a return in the same upload may reverse a sale that is only just arriving, and the
  // reversal's profit is read from the original sale row. Handled at execution time by inserting sales first; the PLAN reads only
  // what is already committed, so a same-run pairing shows as `unmatchedSale` here and resolves correctly on commit.
  const salesPlan = await planSales(db, orders, ref);
  const returnsPlan = await planReturns(db, returns, ref);
  const cancelPlan = await planCancellations(db, cancellations || []);
  const feesPlan = await planFees(db, fees, ref);
  const stockPlan = await planStock(db, stock, ref);

  return { ref, sales: salesPlan, returns: returnsPlan, cancellations: cancelPlan, fees: feesPlan, stock: stockPlan };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Upload classification
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Identify and parse every uploaded file. Shared by the preview and commit routes so both classify an upload set identically — if
 * they could disagree, the operator would approve one thing and get another.
 *
 * @param {Array} files  multer memory-storage files ({ originalname, buffer })
 * @returns {{ parsed: object, cancellations: Array, rejected: Array, duplicate: string|null }}
 *   duplicate is set when two files fingerprint as the SAME report (two orders reports, say). Always an operator mistake, and it
 *   must stop the run rather than silently letting one of them win.
 */
function readUploads(files) {
  const parsed = {};
  let cancellations = [];
  const rejected = [];
  let duplicate = null;

  for (const f of files) {
    const text = f.buffer.toString('utf8');
    const result = parseReport(text);

    if (!result.ok) {
      // identify() has already produced the precise reason, including the "this looks like the Returns report but
      // license-plate-number has been renamed" case — the failure most likely to actually happen.
      rejected.push({ filename: f.originalname, reason: result.reason });
      continue;
    }
    if (parsed[result.type]) { duplicate = result.label; break; }

    parsed[result.type] = result;
    // Cancellations come off the SAME orders file but are a different concern (a retraction, not a sale), so they are extracted
    // here and carried alongside rather than mixed into the parsed rows.
    if (result.type === 'ORDERS') cancellations = parseCancellations(text);
  }

  return { parsed, cancellations, rejected, duplicate };
}

module.exports = {
  SOLD_WINDOW_DAYS,
  SOLD_RECENT_DAYS,
  loadReference,
  buildPlan,
  readUploads,
};
