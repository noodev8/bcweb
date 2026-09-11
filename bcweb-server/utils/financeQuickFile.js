/*
=======================================================================================================================================
Util: financeQuickFile
=======================================================================================================================================
Purpose: Build the two CSVs the owner imports into QuickFile — the sales invoice file and the purchase invoice file. Spec:
         docs/finance-month-end-spec.md §4. This is the output contract of the whole module: everything else exists to get the
         numbers right, and this is where they become the files.

         Replaces the PowerBuilder cb_quickfileinvoice / cb_quickfileexpense buttons.

THE COLUMN LAYOUTS AND NOMINAL CODES ARE NOT OURS TO IMPROVE
Every column name, client name, description, nominal code and bank code below is reproduced from the PowerBuilder generators, because
they are what QuickFile's importer and the owner's chart of accounts expect. A "tidier" description is a reconciliation someone has to
do by hand. Changing one is an accounting decision, not a code one.

THE JANUARY BUG, FIXED BY MOVING THE DECISION (spec §9.1)
PowerBuilder derived the period as `month(today) - 1` and then decremented the year only `IF ls_month = "12"` — which in January is
"00", never "12". So a January run produced `28/00/2026` in both files, with the wrong year. The fix here is not better arithmetic:
the month is CHOSEN on the screen and passed in as 'YYYY-MM', so there is no derivation left to get wrong, and re-running an older
month becomes possible as a side effect.

ZERO ROWS ARE OMITTED, NOT WRITTEN AS ZERO
PowerBuilder skipped a line whose value was null or zero, and so does this. A £0.00 invoice in QuickFile is a row someone has to go
and delete.
=======================================================================================================================================
Exports:
  buildSalesCsv(figures, month)     -> { csv, rows }
  buildPurchaseCsv(figures, month)  -> { csv, rows }
  invoiceDate(month)                -> '28/08/2026'
=======================================================================================================================================
*/

// Bank account nominal codes, per channel. From the PowerBuilder generators — see the header note.
const BANK = {
  AMAZON: '1251',
  SHOPIFY: '1253',
  PAYPAL: '1254',
  SUMUP: '1258',
  CASH: '1230',
};

// Purchase nominal codes. 6003 is the general fees account; 7400 is travel.
const NOMINAL = {
  FEES: '6003',
  TRAVEL: '7400',
};

// The VAT fraction on a VAT-inclusive gross at 20%: gross / 6. Used for the shop/SumUp sales and for Amazon's fees.
const VAT_DIVISOR = 6;

const SALES_HEADER = [
  'Issue Date', 'Client name', 'Description', 'Total gross amount', 'VAT Rate', 'VAT Amount', 'Paid Date',
  'Paid bank account nominal code',
];

const PURCHASE_HEADER = [
  'Receipt Date', 'Supplier name', 'Description', 'Total gross amount', 'VAT Rate', 'VAT Total', 'Purchase Nominal Code',
  'Paid Date', 'Paid bank account nominal',
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * 'YYYY-MM' -> '28/MM/YYYY'.
 *
 * The 28th is the owner's convention for a month-end invoice date and is kept deliberately: it is a date every month has, so it never
 * needs a "what about February" rule, and it is what every prior month in QuickFile already carries.
 */
function invoiceDate(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) throw new Error(`invoiceDate: month must be YYYY-MM, got '${month}'`);
  return `28/${m[2]}/${m[1]}`;
}

/** A money value for the file: always 2dp, never exponential, never a bare integer. */
const money = (n) => (Math.round(Number(n || 0) * 100) / 100).toFixed(2);

/** Round to 2dp as a NUMBER (for the derived VAT figures, before they are formatted). */
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/** Is this figure worth a row? Mirrors PowerBuilder's null/zero skip. */
const present = (n) => Number.isFinite(Number(n)) && Math.abs(Number(n)) >= 0.005;

/** One CSV cell. QuickFile accepts quoted fields, and quoting everything means a description with a comma can never shift a column. */
const quote = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;

/** Rows (arrays) -> CSV text. CRLF, matching what PowerBuilder's saveas produced and what QuickFile has always been fed. */
function toCsv(rows) {
  return `${rows.map((r) => r.map(quote).join(',')).join('\r\n')}\r\n`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Sales invoices
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The sales invoice file: money coming in.
 *
 * `figures` is the shape /finance-calculate returns plus the typed figures, i.e.
 *   { amazon: { gross, vatDeclared, reimbursements }, shopify: { sales, salesVat, refund, refundVat }, manual: { sumupSales, cashSales } }
 * Anything absent is simply skipped, which is how a partial month (no Shopify yet, say) still produces a usable file.
 */
function buildSalesCsv(figures, month) {
  const date = invoiceDate(month);
  const rows = [SALES_HEADER];
  const detail = [];

  const add = (client, description, gross, vatRate, vat, bank) => {
    rows.push([date, client, description, money(gross), String(vatRate), money(vat), date, bank]);
    detail.push({ client, description, gross: round2(gross), vatRate, vat: round2(vat), bank });
  };

  const amazon = figures.amazon || {};
  const shopify = figures.shopify || {};
  const manual = figures.manual || {};

  // --- AMAZON ---------------------------------------------------------------------------------------------------------------
  // Gross is what customers paid INCLUDING the VAT charged on zero-rated items; the declared VAT excludes it (financeAmazon's
  // header note explains why those two differ). VAT Rate stays "20" as a label — QuickFile takes the gross and the VAT amount
  // explicitly, so the label drives nothing, and the effective rate is under 20% in any month with zero-rated sales.
  if (present(amazon.gross)) {
    add('Amazon UK', 'Amazon Sales', amazon.gross, 20, amazon.vatDeclared || 0, BANK.AMAZON);
  }

  // FBA reimbursements for lost or damaged stock. NEW — PowerBuilder netted this against fees (spec §5.1). Income, and it carries
  // no VAT, so it cannot ride on the sales row above.
  if (present(amazon.reimbursements)) {
    add('Amazon UK', 'FBA Reimbursements', amazon.reimbursements, 0, 0, BANK.AMAZON);
  }

  // --- SHOPIFY --------------------------------------------------------------------------------------------------------------
  // One row, refunds netted into it.
  //
  // SIGN CONVENTION, and the Phase 2 port must honour it: `sales` and `salesVat` are POSITIVE, `refund` and `refundVat` are
  // NEGATIVE. So both simply ADD, and a month with no refunds needs no special case. PowerBuilder reached the same place by a more
  // confusing route — it stored the two VAT figures already negated (`* -1`) and then added them, which is why its code reads
  // "remove refund from sales" while performing an addition.
  // Nothing here silently corrects a wrong sign: a negative Shopify VAT would mean the port inverted something, and that is a fault
  // to see on the screen's checks, not to paper over in the file.
  const shopifyGross = Number(shopify.sales || 0) + Number(shopify.refund || 0);
  const shopifyVat = Number(shopify.salesVat || 0) + Number(shopify.refundVat || 0);
  if (present(shopifyGross)) {
    add('Shopify Brookfield Comfort', 'Shopify Sales', shopifyGross, 20, shopifyVat, BANK.SHOPIFY);
  }

  // --- SHOP -----------------------------------------------------------------------------------------------------------------
  // VAT at gross/6 assumes everything sold in the shop is standard-rated. Strictly that over-declares on children's footwear; the
  // owner has accepted it at five or six sales a month (spec §3.5). Revisit alongside the SumUp API, not before.
  if (present(manual.sumupSales)) {
    add('SumUp', 'Shop Card Sales', manual.sumupSales, 20, Number(manual.sumupSales) / VAT_DIVISOR, BANK.SUMUP);
  }
  if (present(manual.cashSales)) {
    add('Shop', 'Shop Cash Sales', manual.cashSales, 20, Number(manual.cashSales) / VAT_DIVISOR, BANK.CASH);
  }

  return { csv: toCsv(rows), rows: detail };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Purchase invoices
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * The purchase invoice file: money going out.
 *
 * Fees arrive NEGATIVE from the parsers (they are deductions in the source files). QuickFile wants a positive cost, so each is
 * flipped once, here, and a fee that is somehow positive is skipped rather than written as a negative purchase.
 */
function buildPurchaseCsv(figures, month) {
  const date = invoiceDate(month);
  const rows = [PURCHASE_HEADER];
  const detail = [];

  const add = (supplier, description, gross, vatRate, vat, nominal, bank) => {
    rows.push([date, supplier, description, money(gross), String(vatRate), money(vat), nominal, date, bank]);
    detail.push({ supplier, description, gross: round2(gross), vatRate, vat: round2(vat), nominal, bank });
  };

  const amazon = figures.amazon || {};
  const shopify = figures.shopify || {};
  const paypal = figures.paypal || {};
  const manual = figures.manual || {};

  // --- AMAZON FEES ----------------------------------------------------------------------------------------------------------
  // Amazon charges VAT on its fees, so a sixth of the gross is reclaimable (owner, confirmed 2026-09-11).
  const amazonFees = -Number(amazon.fees || 0);
  if (amazonFees > 0) {
    add('Amazon', 'Fees', amazonFees, 20, amazonFees / VAT_DIVISOR, NOMINAL.FEES, BANK.AMAZON);
  }

  // --- SHOPIFY FEES ---------------------------------------------------------------------------------------------------------
  // Shopify does NOT charge VAT on its fees (owner, confirmed 2026-09-11) — hence 0%, not gross/6.
  const shopifyFees = -Number(shopify.fees || 0);
  if (shopifyFees > 0) {
    add('Shopify', 'Fees', shopifyFees, 0, 0, NOMINAL.FEES, BANK.SHOPIFY);
  }

  // --- PAYPAL FEES ----------------------------------------------------------------------------------------------------------
  // financePayPal already returns this as a positive cost, so it is not flipped again.
  if (present(paypal.fees) && Number(paypal.fees) > 0) {
    add('PayPal', 'Fees', paypal.fees, 0, 0, NOMINAL.FEES, BANK.PAYPAL);
  }

  // --- CAR ------------------------------------------------------------------------------------------------------------------
  if (present(manual.car) && Number(manual.car) > 0) {
    add('Car', 'Travel', manual.car, 0, 0, NOMINAL.TRAVEL, BANK.CASH);
  }

  // --- SUMUP FEES -----------------------------------------------------------------------------------------------------------
  if (present(manual.sumupFees) && Number(manual.sumupFees) > 0) {
    add('SumUp', 'Fees', manual.sumupFees, 0, 0, NOMINAL.FEES, BANK.SUMUP);
  }

  return { csv: toCsv(rows), rows: detail };
}

module.exports = { buildSalesCsv, buildPurchaseCsv, invoiceDate, BANK, NOMINAL };
