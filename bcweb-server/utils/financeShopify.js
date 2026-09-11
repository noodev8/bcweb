/*
=======================================================================================================================================
Util: financeShopify
=======================================================================================================================================
Purpose: The Shopify side of the month end, straight from the API: sales, refunds, VAT and Shopify Payments fees, plus a rebuild of
         the "Shopify Transaction" report the owner files each year. Spec: docs/finance-month-end-spec.md §3.3.

         This is a PORT of C:\scripts\month-end\month-export.py + shopify_fees.py. That code works and has been producing the owner's
         accounts for months, so the rules below are reproduced rather than re-derived — the CSV this builds is intended to be
         line-for-line identical to the Python's, and that equivalence is the acceptance test for Phase 2. Where this differs at all,
         it is noted inline and for a stated reason. The Python stays in place until two months have been closed from here.

TWO PASSES OVER ORDERS, AND WHY THE SECOND ONE EXISTS
  1. Orders CREATED in the month  -> the sale and shipping rows.
  2. Orders created in the 90 days BEFORE it but UPDATED during it -> refunds against older orders, which belong to this month even
     though the order does not.
A refund is dated by the refund, a sale by the order. Miss pass 2 and every refund of a prior-month order silently vanishes from the
accounts — which is the whole reason the Python does it, and the easiest thing to drop in a port.

TWO DIFFERENT TOKENS, ON PURPOSE (both verified against the live shop, 2026-09-11)
  orders               -> SHOPIFY_ORDERS_ACCESS_TOKEN (read_orders). SHOPIFY_ACCESS_TOKEN also happens to work, which is why the
                          Python accepts either, but the orders token is the one that is *meant* to read orders.
  balance transactions -> SHOPIFY_ACCESS_TOKEN, which carries read_shopify_payments_payouts. The orders token returns
                          403 "requires merchant approval for read_shopify_payments_payouts scope" — they are NOT interchangeable.

VAT IS NOT IN THE SHOPIFY DATA AT ALL — WE DERIVE IT
Every tax line this shop returns reads `{"rate": 0.2, "title": "GB VAT", "price": "0.00"}`, and every order's `total_tax` is 0.00.
So the Taxes column of the rebuilt report is ~nil (£8.99 across the whole of August 2026) and cannot be the VAT that gets declared on
£32,820 of sales. Shopify is simply not calculating it for this shop.

VAT is therefore derived the same way the Amazon side does it, from OUR OWN flag: `skusummary.tax` (1 = standard, 0 = zero-rated
children's footwear). A standard-rated row's VAT is a sixth of its VAT-inclusive total; a zero-rated row's is nil. That is the
owner's stated method and it keeps one definition of "is this VATable" across both channels.

THE TWO SKU COLUMNS ARE NOT THE SAME COLUMN — this is the landmine to remember here.
    Shopify's "Product variant SKU"  ->  skumap.CODE   ('1005294-ARIZONA-39')
    Amazon's  "sku"                  ->  skumap.SKU    ('FLE030-IVES-KHAKI-04-2601')
Matching Shopify SKUs against skumap.sku looks like it works — it is a text column full of plausible values — and silently misses
595 of 1,118 rows. Against skumap.code it misses none.

MONEY IS INTEGER PENCE, as everywhere else in this module. The Python uses Decimal for the same reason: an accounts total that is a
penny out is a penny someone has to go and explain.
=======================================================================================================================================
Exports:
  monthRange(month)          -> { start, end }  ('YYYY-MM' -> first/last day, as 'YYYY-MM-DD')
  computeShopify(db, month)  -> { ok, sales, salesVat, refund, refundVat, fees, csv, rowCount, ... }  (async; SELECTs only)
=======================================================================================================================================
*/

const config = require('../config/config');
const logger = require('./logger');

// The API version the Python pins. Kept identical deliberately: the two implementations must see the same payload shapes, and a
// newer version that renames or restructures a field would diverge them silently.
const API_VERSION = '2025-04';

const PAGE_SIZE = 250;
// 250 orders/page x 40 = 10,000 orders in a month, far beyond anything this business sees. It exists only so a pathological response
// or a Link-header loop cannot spin forever inside a request. Hitting it sets `truncated`, and the caller must not trust the figures.
const MAX_PAGES = 40;

// How far back pass 2 looks for orders that were refunded during the month. 90 days, from the Python.
const REFUND_LOOKBACK_DAYS = 90;

/** A coded error the route maps to a return_code — same pattern as utils/shopify.js and utils/shopifyOrders.js. */
function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------------------------------------------

/** Shopify sends money as decimal STRINGS ('36.95', '-4.10', null). -> integer pence. */
function pence(value) {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

const pounds = (p) => Math.round(p) / 100;

/**
 * Format pence for the CSV, matching the Python's format_num EXACTLY — including the one quirk that makes the files diffable: zero
 * is written as the single character '0', never '0.00'. Change this and every row of the rebuilt report stops matching.
 */
function formatNum(p) {
  if (p === 0) return '0';
  const sign = p < 0 ? '-' : '';
  const abs = Math.abs(p);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------------------

/** 'YYYY-MM' -> { start: 'YYYY-MM-01', end: 'YYYY-MM-<last>' }. Built from parts; no Date arithmetic, so no timezone can shift it. */
function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw coded('BAD_MONTH', `month must be YYYY-MM, got '${month}'`);
  const year = Number(m[1]);
  const mon = Number(m[2]);
  if (mon < 1 || mon > 12) throw coded('BAD_MONTH', `month must be 01-12, got '${month}'`);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();   // day 0 of the next month = last day of this one
  return { start: `${m[1]}-${m[2]}-01`, end: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

/** 'YYYY-MM-DD' shifted by N days, via UTC so no local-midnight/BST shift can creep in. */
function shiftDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

/**
 * A Shopify timestamp ('2026-08-14T09:31:02+01:00') -> its LOCAL calendar date, textually.
 *
 * Taken as the first 10 characters, exactly as the Python does. NOT parsed to a Date and re-formatted — that would re-interpret the
 * instant in the server's zone and shift the day for anything near midnight, which is the class of bug CLAUDE.md warns about for
 * pg DATE -> toISOString(). Two implementations that disagree about which day an 11pm order belongs to would disagree about which
 * MONTH it belongs to, twelve times a year.
 */
const dayOf = (ts) => String(ts || '').slice(0, 10);

// ---------------------------------------------------------------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------------------------------------------------------------

function requireConfig(which) {
  const { shop, accessToken, ordersAccessToken } = config.shopify;
  const token = which === 'payments' ? accessToken : (ordersAccessToken || accessToken);
  const missing = [];
  if (!shop) missing.push('SHOPIFY_SHOP');
  if (!token) missing.push(which === 'payments' ? 'SHOPIFY_ACCESS_TOKEN' : 'SHOPIFY_ORDERS_ACCESS_TOKEN');
  if (missing.length) {
    throw coded('SHOPIFY_NOT_CONFIGURED', `Shopify month-end not configured — missing ${missing.join(', ')} in bcweb-server/.env`);
  }
  return { shop, token };
}

/** The RFC-5988 `next` link, matched on the rel rather than position (a `previous` link may come first). */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of String(linkHeader).split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/** One authenticated GET with 429 backoff. Anything thrown means "the fetch failed" — the caller reports, never guesses. */
async function get(url, which) {
  const { token } = requireConfig(which);
  const headers = { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      throw coded('SHOPIFY_FETCH_FAILED', `Shopify request failed: ${err.message}`);
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 2;
      logger.info(`[financeShopify] rate limited (429), retrying in ${retryAfter}s (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // The single most likely first-run failure on each endpoint, named rather than left as a raw Shopify body.
      let hint = '';
      if (res.status === 401 || res.status === 403) {
        hint = which === 'payments'
          ? ' — the fees call needs SHOPIFY_ACCESS_TOKEN with the read_shopify_payments_payouts scope'
          : ' — check SHOPIFY_ORDERS_ACCESS_TOKEN is the read_orders token';
      }
      throw coded('SHOPIFY_FETCH_FAILED', `Shopify HTTP ${res.status}${hint}: ${text.slice(0, 300)}`);
    }

    return { body: await res.json(), linkHeader: res.headers.get('Link') || res.headers.get('link') };
  }
  throw coded('SHOPIFY_FETCH_FAILED', 'Shopify rate limit retries exhausted');
}

// Only the fields the rows are built from. Same list as the Python — a narrower payload is faster and, more to the point, makes it
// obvious what this depends on.
const ORDER_FIELDS = 'id,name,created_at,taxes_included,line_items,shipping_lines,refunds,discount_applications,tax_lines';

/** One filtered, paginated sweep of the orders endpoint. */
async function fetchOrderPage({ createdMin, createdMax, updatedMin }) {
  const { shop } = requireConfig('orders');
  const params = new URLSearchParams({
    created_at_min: createdMin,
    created_at_max: createdMax,
    status: 'any',
    limit: String(PAGE_SIZE),
    fields: ORDER_FIELDS,
  });
  if (updatedMin) params.set('updated_at_min', updatedMin);

  let url = `https://${shop}.myshopify.com/admin/api/${API_VERSION}/orders.json?${params.toString()}`;
  const orders = [];
  let pages = 0;
  let truncated = false;

  while (url) {
    const { body, linkHeader } = await get(url, 'orders');
    orders.push(...((body && body.orders) || []));
    pages += 1;

    const next = parseNextLink(linkHeader);
    if (!next) break;
    if (pages >= MAX_PAGES) { truncated = true; break; }
    url = next;   // the Link URL already carries page_info; params must NOT be re-applied to it
  }

  return { orders, pages, truncated };
}

/** Both passes, de-duplicated by order id. */
async function fetchAllOrders(start, end) {
  const pass1 = await fetchOrderPage({
    createdMin: `${start}T00:00:00+00:00`,
    createdMax: `${end}T23:59:59+00:00`,
  });

  const pass2 = await fetchOrderPage({
    createdMin: `${shiftDays(start, -REFUND_LOOKBACK_DAYS)}T00:00:00+00:00`,
    createdMax: `${shiftDays(start, -1)}T23:59:59+00:00`,
    updatedMin: `${start}T00:00:00+00:00`,
  });

  const seen = new Set(pass1.orders.map((o) => o.id));
  const orders = [...pass1.orders];
  for (const o of pass2.orders) {
    if (!seen.has(o.id)) { orders.push(o); seen.add(o.id); }
  }

  return {
    orders,
    truncated: pass1.truncated || pass2.truncated,
    counts: { created: pass1.orders.length, lookback: pass2.orders.length, unique: orders.length },
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Rows — the Shopify Transaction report, rebuilt
// ---------------------------------------------------------------------------------------------------------------------------------

const CSV_COLUMNS = [
  'Day', 'Order name', 'Product title at time of sale', 'Product variant SKU', 'Gross sales', 'Discounts', 'Returns',
  'Net sales', 'Shipping charges', 'Taxes', 'Total sales',
];

/** Shopify puts the variant in its own field; the report wants one title. Same join rule as the Python. */
function itemTitle(item) {
  const title = item.title || '';
  const variant = item.variant_title || '';
  return variant && !title.includes(variant) ? `${title} ${variant}` : title;
}

/**
 * Build the report rows for one month. A faithful port of month-export.py's build_rows().
 *
 * Sale and shipping rows exist only for orders CREATED in the month. Refund rows are included for ANY order whose refund falls in the
 * month — which is why pass 2 exists.
 */
function buildRows(orders, start, end) {
  const rows = [];
  const inRange = (day) => day >= start && day <= end;

  for (const order of orders) {
    const orderName = order.name;
    const orderDay = dayOf(order.created_at);
    const orderInRange = inRange(orderDay);
    const taxesIncluded = Boolean(order.taxes_included);
    const refunds = order.refunds || [];

    // --- Shipping refunds, pre-scanned ------------------------------------------------------------------------------------
    // A refunded delivery charge offsets the ORIGINAL shipping row rather than appearing as a separate return, which is how the
    // Shopify report itself presents it. So it has to be known before the shipping row is written.
    let shippingRefund = 0;
    let shippingRefundTax = 0;
    for (const refund of refunds) {
      if (!inRange(dayOf(refund.created_at))) continue;
      for (const adj of refund.order_adjustments || []) {
        if (adj.kind === 'shipping_refund') {
          shippingRefund += pence(adj.amount);
          shippingRefundTax += pence(adj.tax_amount);
        }
      }
    }

    if (orderInRange) {
      // --- Line items -------------------------------------------------------------------------------------------------
      for (const item of order.line_items || []) {
        const qty = Number(item.quantity) || 1;
        const lineTotal = pence(item.price) * qty;

        let tax = 0;
        for (const tl of item.tax_lines || []) tax += pence(tl.price);

        // With tax-inclusive pricing (this shop's setting), the quoted price already contains the VAT, so gross is net of it.
        const gross = taxesIncluded ? lineTotal - tax : lineTotal;

        let discount = 0;
        for (const alloc of item.discount_allocations || []) discount += pence(alloc.amount);

        const net = gross - discount;
        rows.push({
          Day: orderDay,
          'Order name': orderName,
          'Product title at time of sale': itemTitle(item),
          'Product variant SKU': item.sku || '',
          'Gross sales': gross,
          Discounts: discount ? -discount : 0,
          Returns: 0,
          'Net sales': net,
          'Shipping charges': 0,
          Taxes: tax,
          'Total sales': net + tax,
          _refund: false,
        });
      }

      // --- Shipping ---------------------------------------------------------------------------------------------------
      // One row for the order's delivery charge, net of any refund of it. A fully refunded delivery nets to zero and the row is
      // omitted entirely — matching the Python, and matching Shopify's own report.
      let shipping = 0;
      let shippingTax = 0;
      for (const sl of order.shipping_lines || []) {
        let slTax = 0;
        for (const tl of sl.tax_lines || []) slTax += pence(tl.price);
        shipping += taxesIncluded ? pence(sl.price) - slTax : pence(sl.price);
        shippingTax += slTax;
      }
      shipping += shippingRefund;         // the adjustment amounts are negative, so these ADD
      shippingTax += shippingRefundTax;

      if (shipping !== 0 || shippingTax !== 0) {
        rows.push({
          Day: orderDay,
          'Order name': orderName,
          'Product title at time of sale': '',
          'Product variant SKU': '',
          'Gross sales': 0,
          Discounts: 0,
          Returns: 0,
          'Net sales': 0,
          'Shipping charges': shipping,
          Taxes: shippingTax,
          'Total sales': shipping + shippingTax,
          _refund: false,
        });
      }
    }

    // --- Refunds, for ANY order, dated by the refund -------------------------------------------------------------------
    for (const refund of refunds) {
      const refundDay = dayOf(refund.created_at);
      if (!inRange(refundDay)) continue;

      for (const refItem of refund.refund_line_items || []) {
        const lineItem = refItem.line_item || {};
        const subtotal = pence(refItem.subtotal);
        const totalTax = pence(refItem.total_tax);
        const exclTax = taxesIncluded ? subtotal - totalTax : subtotal;
        const returns = -exclTax;
        const tax = -totalTax;

        rows.push({
          Day: refundDay,
          'Order name': orderName,
          'Product title at time of sale': itemTitle(lineItem),
          'Product variant SKU': lineItem.sku || '',
          'Gross sales': 0,
          Discounts: 0,
          Returns: returns,
          'Net sales': returns,
          'Shipping charges': 0,
          Taxes: tax,
          'Total sales': returns + tax,
          _refund: true,
        });
      }

      // Non-shipping adjustments (restocking fees, discrepancies) as ONE netted row. The API can hand back cancelling pairs — a
      // real example is +71.39 / -71.39 for "Pending refund discrepancy" — so they are summed rather than written individually.
      let adj = 0;
      let adjTax = 0;
      for (const a of refund.order_adjustments || []) {
        if (a.kind === 'shipping_refund') continue;   // already folded into the shipping row above
        adj += pence(a.amount);
        adjTax += pence(a.tax_amount);
      }
      const netAdj = adj + adjTax;
      if (netAdj !== 0) {
        rows.push({
          Day: refundDay,
          'Order name': orderName,
          'Product title at time of sale': '',
          'Product variant SKU': '',
          'Gross sales': 0,
          Discounts: 0,
          Returns: netAdj,
          'Net sales': netAdj,
          'Shipping charges': 0,
          Taxes: 0,
          'Total sales': netAdj,
          _refund: true,
        });
      }
    }
  }

  // Sorted by day then order name, as the Python writes it — so the two files can be diffed line for line.
  rows.sort((a, b) => (a.Day === b.Day
    ? String(a['Order name']).localeCompare(String(b['Order name']))
    : a.Day.localeCompare(b.Day)));

  return rows;
}

/** Rows -> the CSV text, QUOTE_ALL and CRLF, matching Python's csv.writer defaults. */
function buildTransactionCsv(rows) {
  const quote = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;
  const numeric = new Set(['Gross sales', 'Discounts', 'Returns', 'Net sales', 'Shipping charges', 'Taxes', 'Total sales']);

  const lines = [CSV_COLUMNS.map(quote).join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => quote(numeric.has(c) ? formatNum(row[c]) : row[c])).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Fees
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Shopify Payments fees for the month, from the Balance Transactions API — a port of shopify_fees.py.
 *
 * The endpoint is not filterable by date, so it is walked newest-first and stopped once a page contains anything older than the
 * month. Only charge / refund / dispute transactions carry a fee worth counting.
 */
async function fetchFees(start, end) {
  const { shop } = requireConfig('payments');
  let url = `https://${shop}.myshopify.com/admin/api/${API_VERSION}/shopify_payments/balance/transactions.json?limit=${PAGE_SIZE}`;

  let total = 0;
  const types = new Map();
  let pages = 0;

  while (url) {
    const { body, linkHeader } = await get(url, 'payments');
    const txns = (body && body.transactions) || [];
    if (txns.length === 0) break;
    pages += 1;

    for (const t of txns) {
      const day = dayOf(t.processed_at);
      if (day >= start && day <= end && ['charge', 'refund', 'dispute'].includes(t.type)) {
        total += pence(t.fee);
        types.set(t.type, (types.get(t.type) || 0) + 1);
      }
    }

    // Stop once this page has reached back past the start of the month — everything beyond is older still.
    const earliest = txns.reduce((min, t) => {
      const d = dayOf(t.processed_at);
      return min === null || d < min ? d : min;
    }, null);
    if (earliest !== null && earliest < start) break;

    const next = parseNextLink(linkHeader);
    if (!next || pages >= MAX_PAGES) break;
    url = next;
  }

  return {
    // NEGATIVE, matching this module's convention that a fee is a cost (financeQuickFile flips it back to a positive purchase).
    // Shopify reports the fee on a charge as a POSITIVE deduction, so the raw sum is positive and is negated here exactly once.
    // The Python prints that raw positive sum — "£646.16" — which is the same number said the other way round.
    fees: pounds(-total),
    breakdown: [...types.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The month
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Everything the Shopify side of the month end needs.
 *
 * THE FOUR ACCOUNTING FIGURES, and how they are cut from the rows. The report has no "is this a refund" column, so the split is made
 * where the rows are built (`_refund`) rather than inferred afterwards from a sign:
 *
 *   sales     = Total sales over NON-refund rows   (VAT-inclusive, which is the gross QuickFile wants)
 *   salesVat  = derived VAT over NON-refund rows   (a sixth of each standard-rated row; see the header note on why not Shopify's)
 *   refund    = Total sales over refund rows       (negative)
 *   refundVat = derived VAT over refund rows       (negative)
 *
 * So sales + refund is the report's own grand total, and the sign convention financeQuickFile documents is satisfied by
 * construction: the two refund figures are negative, so the file's single Shopify line is simply the sum of both pairs.
 *
 * Note a refunded DELIVERY charge lands in `sales`, not `refund` — it offsets the original shipping row rather than becoming a
 * return. That is Shopify's own presentation and the Python's, and the netted total is identical either way.
 */
async function computeShopify(db, month) {
  const { start, end } = monthRange(month);

  const { orders, truncated, counts } = await fetchAllOrders(start, end);
  const rows = buildRows(orders, start, end);

  // VAT is derived from our own flag, not from Shopify (see the header note). One set-based lookup for every SKU in the month —
  // matched on skumap.CODE, which is the column Shopify's SKU corresponds to.
  const skus = [...new Set(rows.map((r) => r['Product variant SKU']).filter(Boolean))];
  const taxByCode = new Map();
  if (skus.length > 0) {
    const res = await db.query(
      `SELECT sm.code, ss.tax
         FROM skumap sm
         LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
        WHERE sm.code = ANY($1::text[])`,
      [skus]
    );
    for (const r of res.rows) taxByCode.set(r.code, r.tax);
  }

  let sales = 0;
  let salesVat = 0;
  let refund = 0;
  let refundVat = 0;
  let zeroRatedRows = 0;
  let zeroRatedValue = 0;
  const unmatched = new Map();

  for (const r of rows) {
    const total = r['Total sales'];
    const sku = r['Product variant SKU'];

    // Standard-rated unless our flag says otherwise. The two cases that carry no SKU at all — the shipping row and the netted
    // adjustment row — are treated as standard: UK delivery follows the liability of the goods it carries, and this shop's goods
    // are standard-rated but for the occasional pair of children's shoes.
    let standard = true;
    if (sku) {
      if (!taxByCode.has(sku)) {
        const u = unmatched.get(sku) || { sku, rows: 0, value: 0 };
        u.rows += 1;
        u.value += total;
        unmatched.set(sku, u);
      } else if (taxByCode.get(sku) === 0) {
        standard = false;
        zeroRatedRows += 1;
        zeroRatedValue += total;
      }
    }

    // A sixth of the VAT-inclusive total. Rounded per row rather than on the month's total, so the VAT on the file is the sum of
    // the VAT on the rows behind it and a drill-down can never fail to add up.
    const vat = standard ? Math.round(total / 6) : 0;

    if (r._refund) { refund += total; refundVat += vat; }
    else { sales += total; salesVat += vat; }
  }

  // Fees are guarded separately: they use a different token and a different scope, so a fee failure must not cost the operator the
  // sales figures as well. A null `fees` with a reason is honest; a silent 0 is the legacy behaviour this module exists to end.
  let fees = null;
  let feesError = null;
  let feeBreakdown = [];
  try {
    const f = await fetchFees(start, end);
    fees = f.fees;
    feeBreakdown = f.breakdown;
  } catch (err) {
    feesError = err.message;
    logger.error('[financeShopify] fees failed:', err.message);
  }

  return {
    ok: true,
    source: 'api',
    window: { start, end },
    sales: pounds(sales),
    salesVat: pounds(salesVat),
    refund: pounds(refund),
    refundVat: pounds(refundVat),
    fees,
    feesError,
    feeBreakdown,
    // The VAT evidence, mirroring the Amazon block: what was excluded as zero-rated, and anything we could not resolve.
    vatSource: 'skusummary.tax',
    zeroRated: { rows: zeroRatedRows, value: pounds(zeroRatedValue) },
    unmatched: [...unmatched.values()].map((u) => ({ ...u, value: pounds(u.value) })).sort((a, b) => b.value - a.value),
    rowCount: rows.length,
    orderCount: counts.unique,
    orderCounts: counts,
    truncated,
    csv: buildTransactionCsv(rows),
  };
}

module.exports = { computeShopify, monthRange, buildRows, buildTransactionCsv, formatNum, pence, pounds, shiftDays };
