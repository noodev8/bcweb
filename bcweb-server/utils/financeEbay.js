/*
=======================================================================================================================================
Util: financeEbay
=======================================================================================================================================
Purpose: Month End's eBay block (docs/finance-month-end-spec.md §3.7). Reads the month's money movements live from eBay's Finances API
         (getTransactions) and turns them into the four accounting figures — Sales, Sales VAT, Refund, Refund VAT — plus Fees. READ
         ONLY: SELECTs our own `sales` rows and the tax flag, writes nothing.

GROSS, NOT eBay's NET (owner, 2026-11-01). eBay's monthly statement shows "Orders (Total minus fees)" — the money left in the eBay
balance after its fees. That is a cash figure, not a sales figure. The books take the SALE at what the buyer paid and the FEES as a cost,
exactly as Amazon is treated: VAT is owed on the full sale (eBay doesn't collect VAT on a UK seller's UK sales), and eBay's VAT on its
fees is reclaimable (owner, 2026-10-31 — see utils/ebayProfit.js) only if the fees go in as a purchase. October 2026, the first month:
two £11.99 sales = £23.98 gross, £4.50 order fees + 10 × £0.36 insertion fees = £8.10 → the statement's £19.48 and −£3.60, £15.88 closing.

HOW EACH TRANSACTION IS READ
  SALE             credit. gross = amount + totalFeeAmount (what reached the balance plus what eBay kept), fees = totalFeeAmount.
  REFUND           debit. Its orderLineItems are the fee CREDITS going back to the seller, so the same identity holds with the signs
                   turned: refund (negative) = −(amount + fee credit), fees = −fee credit.
                   Gross is built from `amount` (what actually moved) and the itemised fees, never from totalFeeBasisAmount alone; the
                   basis is the CROSS-CHECK: for each SALE / REFUND, basis − eBay-collected tax − fees must equal amount. Any that don't
                   are listed and raise a warning — that is what would catch eBay changing what a field means. (No refund had been
                   seen when this was written; the cross-check is how the first one gets verified.)
  NON_SALE_CHARGE  insertion fees, ad fees, subscriptions… — fees (a DEBIT is a cost, a CREDIT one a fee refunded). Broken down by
                   feeType for the screen.
  TRANSFER, WITHDRAWAL, PAYOUT   money moving to the bank, or eBay's own bookkeeping of it — excluded, like Amazon's Transfer rows.
  anything else    (DISPUTE, SHIPPING_LABEL, CREDIT, ADJUSTMENT, LOAN_REPAYMENT…) — NOT put in the files; listed with a warning so
                   the owner books it by hand. None seen so far; guessing their accounting treatment would be worse than saying so.

VAT — from OUR tax flag, as Amazon and Shopify do (spec §3.2). eBay's transactions carry no SKU, so each order is matched to the `sales`
rows Update Orders booked for it (ordernum 'EB' + eBay's order number, channel EBY) → skumap.code → skusummary.tax. All lines
standard-rated (the normal case): VAT = gross ÷ 6. A zero-rated line takes its share of the order's gross (by soldprice) out of the VAT.
An order with no `sales` rows — an order cancelled before posting has them deleted by the order sync — is standard-rated and listed
as unmatched, never silently assumed.

THE MONTH IS UTC (GMT) — eBay's statement is "10/1/26 12:00 AM - 10/31/26 11:59 PM GMT", so the figures tie to the statement the
accountant sees. Shopify's month boundaries are its own; at eBay volumes the hour at each end is immaterial.

THE BALANCE CHECK: `movement` = every non-excluded transaction's signed amount — what the statement's lines between Opening funds and
Payouts add up to (October: 19.48 − 3.60 = 15.88). The screen shows it so it can be ticked against the PDF.

Needs: EBAY_REFRESH_TOKEN with the sell.finances scope (scripts/ebay-token.js since 2026-11-01) and the signing key
(scripts/ebay-signing-key.js) — eBay requires a digital signature on every Finances call for a UK seller (utils/ebaySignature.js).
=======================================================================================================================================
Exports:
  computeEbay(db, month) -> { ok, sales, salesVat, refund, refundVat, fees, ... }   (async; throws on an eBay failure — the route guards)
  monthWindow(month)     -> { start, end }  ISO UTC
=======================================================================================================================================
*/

const { financeToken, dropFinanceToken } = require('./ebayAuth');
const { signatureHeaders } = require('./ebaySignature');

const API = 'https://apiz.ebay.com/sell/finances/v1/transaction';
const PAGE_LIMIT = 1000;     // eBay's maximum
const MAX_PAGES = 20;        // 20,000 transactions a month — far beyond any real month; hitting it sets `truncated`
const TIMEOUT_MS = 30000;

const EXCLUDED = new Set(['TRANSFER', 'WITHDRAWAL', 'PAYOUT']);

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** eBay money { value: '11.99', currency: 'GBP' } -> integer pence (0 when absent). */
function pence(m) {
  if (!m || m.value === undefined || m.value === null) return 0;
  const n = Number(m.value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const pounds = (p) => Math.round(p) / 100;

function monthWindow(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error(`monthWindow: month must be YYYY-MM, got '${month}'`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = new Date(Date.UTC(y, mo - 1, 1));
  const end = new Date(Date.UTC(y, mo, 1) - 1);   // last millisecond of the month
  return { start: start.toISOString(), end: end.toISOString() };
}

// One signed GET. A 401 drops the cached finance token and retries once.
async function financeGet(url) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await financeToken()}`,
          Accept: 'application/json',
          'Accept-Language': 'en-GB',
          'X-EBAY-C-MARKETPLACE-ID': 'EBAY_GB',
          ...signatureHeaders('GET', url)
        },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      if (err.code) throw err;   // token / signing problems arrive already coded
      throw coded('EBAY_ERROR', `eBay request failed: ${err.message}`);
    }
    if (res.status === 401 && attempt === 1) { dropFinanceToken(); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = Array.isArray(body.errors) && body.errors[0] ? ` — ${body.errors[0].message}` : '';
      throw coded('EBAY_ERROR', `eBay Finances answered HTTP ${res.status}${first}`);
    }
    return body;
  }
  throw coded('EBAY_ERROR', 'eBay rejected the finance token twice — run scripts/ebay-token.js again');
}

async function fetchTransactions(start, end) {
  const filter = encodeURIComponent(`transactionDate:[${start}..${end}]`);
  const all = [];
  let offset = 0;
  let pages = 0;
  let more = true;
  while (more && pages < MAX_PAGES) {
    const body = await financeGet(`${API}?filter=${filter}&sort=transactionDate&limit=${PAGE_LIMIT}&offset=${offset}`);
    pages += 1;
    const batch = Array.isArray(body.transactions) ? body.transactions : [];
    all.push(...batch);
    offset += batch.length;
    more = Boolean(body.next) && batch.length > 0;
  }
  return { transactions: all, truncated: more };
}

/**
 * The `sales` rows Update Orders booked for these eBay orders, with each code's tax flag — one query for the month.
 * Map: orderId -> [{ code, soldprice (pence), qty, tax (1|0|null) }]
 */
async function salesLines(db, orderIds) {
  const byOrder = new Map();
  if (orderIds.length === 0) return byOrder;
  const res = await db.query(
    `SELECT s.ordernum, s.code, s.qty, s.soldprice, ss.tax
       FROM sales s
       LEFT JOIN skumap sm ON sm.code = s.code
       LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      WHERE s.channel = 'EBY' AND s.qty > 0 AND s.ordernum = ANY($1::text[])`,
    [orderIds.map((id) => `EB${id}`)]
  );
  for (const r of res.rows) {
    const id = String(r.ordernum).slice(2);
    const list = byOrder.get(id) || [];
    const price = Number(r.soldprice);
    list.push({
      code: r.code,
      qty: Number(r.qty) || 1,
      value: Number.isFinite(price) ? Math.round(price * 100) * (Number(r.qty) || 1) : 0,
      tax: r.tax === null || r.tax === undefined ? null : Number(r.tax)
    });
    byOrder.set(id, list);
  }
  return byOrder;
}

/**
 * The VAT in `gross` pence for one order: a sixth of the standard-rated share. Returns { vat, zeroRated (pence of gross), matched }.
 * The share is split by the lines' soldprice, so postage rides with the goods it carried (UK delivery follows the goods' liability).
 */
function orderVat(gross, lines) {
  if (!lines || lines.length === 0) return { vat: Math.round(gross / 6), zeroRated: 0, matched: false, codes: [] };
  const total = lines.reduce((s, l) => s + l.value, 0);
  const zero = lines.filter((l) => l.tax === 0).reduce((s, l) => s + l.value, 0);
  const zeroShare = total > 0 ? Math.round(gross * (zero / total)) : 0;
  return {
    vat: Math.round((gross - zeroShare) / 6),
    zeroRated: zeroShare,
    matched: true,
    codes: lines.map((l) => l.code),
    // A code with no skumap/skusummary match reads as standard (tax null) — surfaced like an unmatched order.
    unmatchedCodes: lines.filter((l) => l.tax === null).map((l) => l.code)
  };
}

async function computeEbay(db, month) {
  const { start, end } = monthWindow(month);
  const { transactions, truncated } = await fetchTransactions(start, end);

  let sales = 0; let salesVat = 0; let refund = 0; let refundVat = 0;
  let fees = 0;          // pence, a COST (positive = paid to eBay)
  let movement = 0;      // signed pence, what the balance moved by (excluded types left out)
  let zeroRated = 0;
  const feeBreakdown = new Map();   // label -> pence
  const addFee = (label, p) => { fees += p; feeBreakdown.set(label, (feeBreakdown.get(label) || 0) + p); };

  const counts = { sale: 0, refund: 0, charge: 0, excluded: 0, other: 0 };
  const orders = [];        // the drill: one row per SALE / REFUND
  const mismatches = [];    // basis cross-check failures
  const other = [];         // types not booked
  const unmatched = [];

  const orderIds = [...new Set(transactions
    .filter((t) => t.transactionType === 'SALE' || t.transactionType === 'REFUND')
    .map((t) => t.orderId).filter(Boolean))];
  const lines = await salesLines(db, orderIds);

  for (const t of transactions) {
    const type = t.transactionType;
    const amount = Math.abs(pence(t.amount));
    const credit = t.bookingEntry === 'CREDIT';
    const signed = credit ? amount : -amount;

    if (EXCLUDED.has(type)) { counts.excluded += 1; continue; }
    movement += signed;

    if (type === 'SALE' || type === 'REFUND') {
      const fee = Math.abs(pence(t.totalFeeAmount));
      const isSale = type === 'SALE';
      // A SALE credits (amount = gross − fees); a REFUND debits (amount = refund − fee credit). Same identity, signs turned.
      const sign = isSale ? 1 : -1;
      const gross = sign * (amount + fee);
      const { vat, zeroRated: z, matched, codes, unmatchedCodes } = orderVat(gross, lines.get(t.orderId));

      if (isSale) { counts.sale += 1; sales += gross; salesVat += vat; addFee('Selling fees', fee); } else { counts.refund += 1; refund += gross; refundVat += vat; addFee('Selling fees credited', -fee); }
      zeroRated += z;

      // The cross-check: basis − eBay-collected tax − fees should equal what moved.
      const basis = Math.abs(pence(t.totalFeeBasisAmount));
      const collected = Math.abs(pence(t.ebayCollectedTaxAmount || t.eBayCollectedTaxAmount));
      if (basis > 0 && basis - collected - fee !== amount) {
        mismatches.push({ orderId: t.orderId, type, amount: pounds(amount), fees: pounds(fee), basis: pounds(basis), collectedTax: pounds(collected) });
      }
      if (!matched) unmatched.push({ orderId: t.orderId, type, value: pounds(gross), reason: 'no eBay sale booked for this order' });
      else if (unmatchedCodes && unmatchedCodes.length) unmatched.push({ orderId: t.orderId, type, value: pounds(gross), reason: `code not in skumap: ${unmatchedCodes.join(', ')}` });

      orders.push({
        orderId: t.orderId, type, date: String(t.transactionDate || '').slice(0, 10),
        gross: pounds(gross), vat: pounds(vat), fees: pounds(sign * fee), net: pounds(signed), codes: codes || [], status: t.transactionStatus || ''
      });
      continue;
    }

    if (type === 'NON_SALE_CHARGE') {
      counts.charge += 1;
      addFee(feeLabel(t.feeType), -signed);   // a DEBIT is a cost; a CREDIT here is a fee given back
      continue;
    }

    counts.other += 1;
    other.push({ type, date: String(t.transactionDate || '').slice(0, 10), amount: pounds(signed), orderId: t.orderId || '', memo: t.transactionMemo || '' });
  }

  return {
    ok: true,
    source: 'api',
    window: { start, end },
    sales: pounds(sales),
    salesVat: pounds(salesVat),
    refund: pounds(refund),
    refundVat: pounds(refundVat),
    fees: pounds(-fees),            // NEGATIVE, the same convention as Amazon and Shopify — financeQuickFile flips it
    feeBreakdown: [...feeBreakdown.entries()].filter(([, p]) => p !== 0).map(([label, p]) => ({ label, amount: pounds(p) })),
    movement: pounds(movement),
    vatSource: 'skusummary.tax',
    zeroRated: pounds(zeroRated),
    counts,
    transactionCount: transactions.length,
    orders,
    mismatches,
    other,
    unmatched,
    truncated
  };
}

// eBay's feeType enum -> words for the screen. Unknown values fall back to the enum tidied up.
const FEE_LABELS = {
  INSERTION_FEE: 'Insertion fees',
  AD_FEE: 'Promoted listings',
  SUBSCRIPTION_FEE: 'Shop subscription',
  FINAL_VALUE_FEE: 'Final value fees',
  FINAL_VALUE_FEE_FIXED_PER_ORDER: 'Fixed per-order fees',
  REGULATORY_OPERATING_FEE: 'Regulatory operating fees',
  INTERNATIONAL_FEE: 'International fees'
};
function feeLabel(feeType) {
  if (!feeType) return 'Other fees';
  if (FEE_LABELS[feeType]) return FEE_LABELS[feeType];
  const s = String(feeType).toLowerCase().replace(/_/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

module.exports = { computeEbay, monthWindow, orderVat };
