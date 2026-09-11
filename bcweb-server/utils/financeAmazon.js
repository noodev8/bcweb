/*
=======================================================================================================================================
Util: financeAmazon
=======================================================================================================================================
Purpose: Turn the Amazon "Monthly Transaction" CSV (Seller Central -> Payments -> Reports Repository) into the month's accounting
         figures, with every row accounted for. Spec: docs/finance-month-end-spec.md §3.1 / §3.2.

         Replaces the PowerBuilder of_amzaccounts() + of_kidsvat() pair. Both were reverse-engineered from the live August 2026 file
         before this was written, and the rules below reproduce PB's VAT figure to the penny; PB's sales and fee figures drift by 7p
         and 2p across 950 rows because PowerBuilder accumulates in `Real` (single precision). Everything here is INTEGER PENCE for
         that exact reason — see the pence() note.

THE ONE RULE THAT CHANGED, and why (spec §5.1)
PowerBuilder swept the `other` column of every row into Fees. That column is a dumping ground: in August it held a +£233.74 FBA
reimbursement for lost/damaged stock, which is INCOME, and netting it against fees understated both sides — and then the QuickFile
generator claimed VAT on it at gross/6, on a reimbursement carrying no VAT at all. So `other` on Adjustment rows is now its own
bucket. `other` on every other row (Service Fee subscriptions, refund admin) is still a fee, because it is one.
That single reclassification is the ONLY difference from PB: fees(-7208.93) + reimbursements(233.74) = -6975.19, PB's figure exactly.

EVERY ROW IS ALLOCATED, AND THE ARITHMETIC IS CHECKED
reconcile() proves it: the non-Transfer rows' own `total` column must equal net + VAT + fees + reimbursements. On the August file the
difference is exactly zero. That check is the module's early warning for an Amazon format change — it is cheap, it is exact, and it
is the thing the legacy screen could not do (a missing file there produced a silent 0.00 and a red box).

VAT IS NOT WHAT AMAZON SAYS IT IS
Amazon charges VAT on children's footwear, which is zero-rated in the UK. The authority is skusummary.tax (1 = VAT applies, 0 =
zero-rated) reached via skumap.sku -> groupid, NOT PowerBuilder's description keyword match on BOYS/GIRLS/KIDS/... plus four
hard-coded codes. A flag is maintained; a description is not, and a renamed listing silently dropped out of the old rule.

Note what is NOT adjusted: the GROSS. The customer paid the VAT, so it is income and stays in the gross. Only the DECLARED VAT drops.
That is what QuickFile wants (a gross and a VAT amount) and it is what PB did via its kids-VAT subtraction.
=======================================================================================================================================
Exports:
  identify(text)              -> { ok, header, headerLine, extraColumns, droppedColumns } | { ok:false, reason }
  parse(text)                 -> { rows, rowCount, window, extraColumns, droppedColumns }
  computeAmazon(db, text)     -> the full figure set + evidence (async; SELECTs only)
  KIDSVAT_CSV_HEADER          the legacy kidsvatcharged.csv header, for the year-end pack
  buildKidsVatCsv(rows)       -> CSV text in the legacy layout
=======================================================================================================================================
*/

// ---------------------------------------------------------------------------------------------------------------------------------
// Column names, as Amazon writes them
// ---------------------------------------------------------------------------------------------------------------------------------

// The four columns that make up what the customer paid us, excluding tax.
const SALES_COLUMNS = ['product sales', 'postage credits', 'gift wrap credits', 'promotional rebates'];

// The five tax columns. `marketplace withheld tax` is VAT Amazon collected and remitted itself (MarketplaceFacilitator rows); it is
// still VAT on our sale, so it counts — PowerBuilder counted it too.
const TAX_COLUMNS = [
  'product sales tax', 'shipping credits tax', 'giftwrap credits tax', 'promotional rebates tax', 'marketplace withheld tax',
];

// The three genuine fee columns. `other` is handled separately because it is not one thing (see the header note).
const FEE_COLUMNS = ['selling fees', 'fba fees', 'other transaction fees'];

// Row types that represent money from a customer. Everything else in the file is a fee, an adjustment, or a bank transfer.
// Liquidations = Amazon disposing of stock on our behalf; Order_Retrocharge = a tax correction on an old order. Both are income.
const INCOME_TYPES = new Set(['Order', 'Refund', 'Liquidations', 'Order_Retrocharge']);

// Excluded entirely: a Transfer is our own payout landing in our own bank. Counting it would double the month.
const EXCLUDED_TYPES = new Set(['Transfer']);

// `other` on these rows is income (FBA reimbursement for lost/damaged stock), not a negative fee.
const REIMBURSEMENT_TYPES = new Set(['Adjustment']);

// Columns the figures genuinely read. A missing one is a hard stop: doing this job half-correctly is what the legacy code did.
const REQUIRED = ['type', 'sku', 'total', ...SALES_COLUMNS, ...TAX_COLUMNS, ...FEE_COLUMNS, 'other'];

// The subset that fingerprints the report — and ONLY that. Deliberately STRUCTURAL columns, not money columns: if a money column we
// read gets renamed, we want the precise "this is the Amazon report but `fba fees` is missing" message, which is only reachable once
// the file has already been recognised. Putting money columns in the fingerprint would make a rename look like an unknown file.
const IDENTITY = ['date/time', 'settlement id', 'type', 'order id'];

// The FULL header as Amazon shipped it on 2026-08-31, captured from the live file. Not used for parsing — its only job is to make
// "Amazon changed the report" visible. Without it, extraColumns would list every column we don't read and fire on every upload,
// which trains the operator to ignore it. Update this when Amazon changes the report.
const LAYOUT = [
  'date/time', 'settlement id', 'type', 'order id', 'sku', 'description', 'quantity', 'marketplace', 'fulfilment',
  'order city', 'order state', 'order postal', 'tax collection model', 'product sales', 'product sales tax', 'postage credits',
  'shipping credits tax', 'gift wrap credits', 'giftwrap credits tax', 'promotional rebates', 'promotional rebates tax',
  'marketplace withheld tax', 'selling fees', 'fba fees', 'other transaction fees', 'other', 'total',
  'transaction status', 'transaction release date',
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Money: integer pence, everywhere
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Parse one money cell to INTEGER PENCE.
 *
 * Everything in this file accumulates in pence and divides by 100 exactly once, at the edge. Floating-point pounds is precisely how
 * PowerBuilder's figures drift (its `Real` is single-precision, so 950 rows cost it 7p on sales), and an accounts total that is 7p
 * out is a total someone has to go and explain. Amazon writes '1,234.56', '-6.24', '' and '0'.
 */
function pence(cell) {
  const s = String(cell === undefined || cell === null ? '' : cell).replace(/,/g, '').trim();
  if (s === '' || s === '--') return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Pence back to a 2dp number, once, at the edge. */
const pounds = (p) => Math.round(p) / 100;

// ---------------------------------------------------------------------------------------------------------------------------------
// CSV reading
// ---------------------------------------------------------------------------------------------------------------------------------

/** One CSV line -> cells. Handles quoted cells and "" escapes, which the Amazon file uses on every single field. */
function parseCsvLine(line) {
  const cells = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cell += '"'; i += 1; }  // "" -> a literal quote
        else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += ch;
    }
  }
  cells.push(cell);
  return cells;
}

/** Split into non-empty lines. Handles CRLF and a missing trailing newline. */
function splitLines(text) {
  return String(text || '').split(/\r\n|\n|\r/).filter((l) => l.length > 0);
}

/** Normalise a header cell: strip the UTF-8 BOM (the file has one on cell 1), trim, lower-case. */
function normaliseHeader(cell) {
  return String(cell === undefined || cell === null ? '' : cell)
    .replace(/^/, '')   // written as an escape: a literal BOM here is invisible and editors 'tidy' it away
    .trim()
    .toLowerCase();
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Find the header row and confirm this is the Amazon transaction report.
 *
 * The file opens with NINE preamble lines of prose ("Includes Amazon Marketplace...", "Definitions:", ...). We locate the header by
 * CONTENT rather than counting to nine, because counting is exactly what went wrong in PowerBuilder: of_amzaccounts skipped 10 lines
 * and of_kidsvat skipped 8, so the two functions disagreed about the same file and the kids pass imported two prose lines as data.
 * It only survived by luck (they were deleted for not being Order/Refund rows).
 */
function identify(text) {
  const lines = splitLines(text);
  if (lines.length === 0) return { ok: false, reason: 'The file is empty.' };

  // Scan a generous window for a line that carries the identity columns. 40 is far beyond Amazon's nine and still cheap.
  const limit = Math.min(lines.length, 40);
  for (let i = 0; i < limit; i += 1) {
    const header = parseCsvLine(lines[i]).map(normaliseHeader);
    const present = new Set(header);
    if (!IDENTITY.every((c) => present.has(c))) continue;

    const missing = REQUIRED.filter((c) => !present.has(c));
    if (missing.length > 0) {
      return {
        ok: false,
        reason: `This is the Amazon transaction report but ${missing.length > 1 ? 'these columns are' : 'this column is'} missing or renamed: ${missing.join(', ')}. Amazon may have changed the report — nothing was calculated.`,
      };
    }

    const known = new Set(LAYOUT);
    return {
      ok: true,
      header,
      headerLine: i,
      // Columns Amazon has ADDED since LAYOUT was captured. Harmless (we resolve by name), but the earliest visible sign of a
      // format change, so the screen shows it.
      extraColumns: header.filter((c) => c && !known.has(c)),
      // Columns that have GONE but that we don't read. Same early-warning reason; a column we DO read is the hard stop above.
      droppedColumns: LAYOUT.filter((c) => !present.has(c) && !REQUIRED.includes(c)),
    };
  }

  const first = parseCsvLine(lines[0]).map(normaliseHeader);
  return {
    ok: false,
    reason: `No Amazon transaction header found in the first ${limit} lines. Expected columns including: ${IDENTITY.slice(0, 4).join(', ')}. First line seen: ${first.slice(0, 4).join(', ') || '(blank)'}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------------------------------------------------------------

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * '31 Jul 2026 23:35:15 UTC' -> '2026-07-31'.
 *
 * Taken TEXTUALLY, never via `new Date()`. Parsing to a Date and formatting would re-interpret the instant in the server's zone and
 * shift the day for anything near midnight — the same class of bug CLAUDE.md warns about for pg DATE -> toISOString().
 * The date is used only to report the file's window on screen; no figure depends on it.
 */
function isoDate(value) {
  const m = /^\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})/.exec(String(value || ''));
  if (!m) return null;
  const month = MONTHS[m[2].toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Read the whole file into typed rows. Columns are resolved by NAME against the actual header, once — so a column Amazon inserts or
 * reorders is harmless. (The legacy import read by POSITION while looking as though it read by name, which meant one inserted column
 * shifted every field after it and the import carried on with wrong values in every row.)
 */
function parse(text) {
  const id = identify(text);
  if (!id.ok) return id;

  const lines = splitLines(text);
  const index = new Map(id.header.map((name, i) => [name, i]));
  const at = (cells, name) => cells[index.get(name)];

  const rows = [];
  let from = null;
  let to = null;

  for (let i = id.headerLine + 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    // A short line is a trailing fragment, not a row. Amazon's files end cleanly, but a partial download would land here.
    if (cells.length < id.header.length) continue;

    const type = String(at(cells, 'type') || '').trim();
    if (type === '') continue;

    const date = isoDate(at(cells, 'date/time'));
    if (date) {
      if (from === null || date < from) from = date;
      if (to === null || date > to) to = date;
    }

    const sales = {};
    for (const c of SALES_COLUMNS) sales[c] = pence(at(cells, c));
    const taxes = {};
    for (const c of TAX_COLUMNS) taxes[c] = pence(at(cells, c));
    const fees = {};
    for (const c of FEE_COLUMNS) fees[c] = pence(at(cells, c));

    rows.push({
      line: i + 1,                                   // 1-based line number in the file, for naming a bad row on screen
      date,
      type,
      orderId: String(at(cells, 'order id') || '').trim(),
      sku: String(at(cells, 'sku') || '').trim(),
      description: String(at(cells, 'description') || '').trim(),
      status: String(at(cells, 'transaction status') || '').trim(),
      sales,
      taxes,
      fees,
      other: pence(at(cells, 'other')),
      total: pence(at(cells, 'total')),
      salesTotal: SALES_COLUMNS.reduce((s, c) => s + sales[c], 0),
      taxTotal: TAX_COLUMNS.reduce((s, c) => s + taxes[c], 0),
      feeTotal: FEE_COLUMNS.reduce((s, c) => s + fees[c], 0),
      raw: cells,                                    // kept for the kidsvatcharged.csv pass-through
    });
  }

  return { ok: true, rows, rowCount: rows.length, window: { from, to }, header: id.header, extraColumns: id.extraColumns, droppedColumns: id.droppedColumns };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The tax flag
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * sku -> { code, groupid, tax } for every SKU in the file, in ONE round trip.
 *
 * Deliberately set-based. The legacy of_kidsvat did a DataWindow Find per row, and worse, never reset its `ls_code` variable when a
 * lookup missed — so a miss silently inherited the PREVIOUS row's code and could false-trigger its hard-coded B430A rule. Here a miss
 * is a miss, and it is reported (see unmatched, below).
 */
async function loadTaxFlags(db, skus) {
  const list = [...new Set(skus.filter(Boolean))];
  if (list.length === 0) return new Map();

  const res = await db.query(
    `SELECT sm.sku, sm.code, sm.groupid, ss.tax
       FROM skumap sm
       LEFT JOIN skusummary ss ON ss.groupid = sm.groupid
      WHERE sm.sku = ANY($1::text[])`,
    [list]
  );

  const bySku = new Map();
  for (const r of res.rows) bySku.set(r.sku, { code: r.code, groupid: r.groupid, tax: r.tax });
  return bySku;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The figures
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Everything the Amazon side of the month needs, from the file text. SELECTs only — this never writes.
 *
 * Returns pounds (2dp numbers) at the edge, plus the evidence the screen drills into: a per-type breakdown, the zero-rated rows, the
 * unmatched SKUs, and the reconciliation.
 */
async function computeAmazon(db, text) {
  const parsed = parse(text);
  if (!parsed.ok) return parsed;

  const { rows } = parsed;
  const taxBySku = await loadTaxFlags(db, rows.map((r) => r.sku));

  let net = 0;             // customer money excluding tax
  let vatCharged = 0;      // tax as Amazon reported it
  let vatZeroRated = 0;    // the part of vatCharged charged on zero-rated products — excluded from what we declare
  let fees = 0;
  let reimbursements = 0;
  let excludedTotal = 0;   // Transfer rows, for the reconciliation line
  let excludedRows = 0;

  const byType = new Map();
  const zeroRatedRows = [];
  const unmatched = new Map();
  // Liquidation rows carry Amazon's own disposal identifier (X001L0082L...) in the SKU column, not ours, so they can NEVER match
  // skumap — all 17 of August's did not. Counting them in `unmatched` would put a warning on the screen every single month that the
  // operator can do nothing about, which is how a warning stops being read. They are counted separately and reported quietly.
  // The bounded cost: a zero-rated product disposed of via liquidation has its VAT declared. August's entire liquidation VAT was
  // £3.83, so the exposure is pennies; if liquidations ever become material this is the line to revisit.
  let liquidationUnmatchedRows = 0;
  let liquidationUnmatchedVat = 0;

  for (const row of rows) {
    const bucket = byType.get(row.type) || { type: row.type, rows: 0, net: 0, vat: 0, fees: 0, other: 0, total: 0 };
    bucket.rows += 1;
    bucket.total += row.total;
    byType.set(row.type, bucket);

    // --- Excluded: a Transfer is our own payout arriving in our own bank -------------------------------------------------------
    if (EXCLUDED_TYPES.has(row.type)) {
      excludedTotal += row.total;
      excludedRows += 1;
      continue;
    }

    // --- Income ---------------------------------------------------------------------------------------------------------------
    if (INCOME_TYPES.has(row.type)) {
      net += row.salesTotal;
      vatCharged += row.taxTotal;
      bucket.net += row.salesTotal;
      bucket.vat += row.taxTotal;

      // Zero-rated (children's footwear). The VAT Amazon charged still sits in the gross — the customer paid it — but it is not
      // ours to declare, so it comes out of the declared figure and is shown separately as evidence.
      const hit = row.sku ? taxBySku.get(row.sku) : undefined;
      if (!hit) {
        if (row.type === 'Liquidations') {
          liquidationUnmatchedRows += 1;
          liquidationUnmatchedVat += row.taxTotal;
        } else if (row.sku) {
          const u = unmatched.get(row.sku) || { sku: row.sku, rows: 0, value: 0, description: row.description };
          u.rows += 1;
          u.value += row.salesTotal + row.taxTotal;
          unmatched.set(row.sku, u);
        }
      } else if (hit.tax === 0) {
        vatZeroRated += row.taxTotal;
        zeroRatedRows.push({ ...row, code: hit.code, groupid: hit.groupid });
      }
    }

    // --- Fees, and the `other` column ----------------------------------------------------------------------------------------
    fees += row.feeTotal;
    bucket.fees += row.feeTotal;
    if (REIMBURSEMENT_TYPES.has(row.type)) {
      reimbursements += row.other;                  // FBA lost/damaged stock — income, no VAT (spec §5.1)
    } else {
      fees += row.other;                            // Service Fee subscriptions, refund admin — genuinely fees
    }
    bucket.other += row.other;
  }

  // --- The reconciliation --------------------------------------------------------------------------------------------------
  // Every non-Transfer row's own `total` column, against what we allocated. These must agree exactly; a non-zero difference means
  // Amazon has added a money column we are not reading, and it is the one check that catches that on the day it happens.
  const fileTotal = rows.reduce((s, r) => (EXCLUDED_TYPES.has(r.type) ? s : s + r.total), 0);
  const allocated = net + vatCharged + fees + reimbursements;

  const vatDeclared = vatCharged - vatZeroRated;

  return {
    ok: true,
    rowCount: parsed.rowCount,
    window: parsed.window,
    extraColumns: parsed.extraColumns,
    droppedColumns: parsed.droppedColumns,

    // The figures, in pounds.
    net: pounds(net),
    vatCharged: pounds(vatCharged),
    vatZeroRated: pounds(vatZeroRated),     // the "Kids VAT" line — explanatory, already excluded from vatDeclared
    vatDeclared: pounds(vatDeclared),
    gross: pounds(net + vatCharged),        // what customers paid. NOT reduced by the zero-rated adjustment — see header note.
    fees: pounds(fees),
    reimbursements: pounds(reimbursements),

    // The evidence.
    byType: [...byType.values()]
      .map((b) => ({
        type: b.type, rows: b.rows, net: pounds(b.net), vat: pounds(b.vat), fees: pounds(b.fees), other: pounds(b.other),
        total: pounds(b.total), excluded: EXCLUDED_TYPES.has(b.type), income: INCOME_TYPES.has(b.type),
      }))
      .sort((a, b) => b.rows - a.rows),
    zeroRated: {
      rows: zeroRatedRows.length,
      vat: pounds(vatZeroRated),
      examples: zeroRatedRows.slice(0, 10).map((r) => ({ sku: r.sku, code: r.code, description: r.description, vat: pounds(r.taxTotal) })),
    },
    // SKUs the screen should WARN about: an order or refund whose product we could not resolve, so its VAT treatment was assumed
    // standard. Actionable — either the SKU is missing from skumap or Amazon has renamed a listing.
    unmatched: [...unmatched.values()]
      .map((u) => ({ ...u, value: pounds(u.value) }))
      .sort((a, b) => b.value - a.value),
    // Reported, not warned about. See the note at the accumulator.
    liquidationUnmatched: { rows: liquidationUnmatchedRows, vat: pounds(liquidationUnmatchedVat) },
    reconciliation: {
      fileTotal: pounds(fileTotal),
      allocated: pounds(allocated),
      difference: pounds(fileTotal - allocated),
      excludedRows,
      excludedTotal: pounds(excludedTotal),
    },

    // Held for the year-end pack (§4.3). Not sent to the browser — see the route.
    _zeroRatedRows: zeroRatedRows,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// kidsvatcharged.csv — the year-end pack
// ---------------------------------------------------------------------------------------------------------------------------------

// The legacy header, reproduced EXACTLY as PowerBuilder's d_amztxn saved it. The owner files this file each year alongside the
// Amazon and Shopify exports, so its shape is part of a paper trail that predates this module — it is not ours to tidy.
const KIDSVAT_CSV_HEADER = [
  'datetime', 'settlementid', 'type', 'orderid', 'sku', 'description', 'qty', 'marketplace', 'fulfilment', 'ordercity',
  'orderstate', 'orderpostal', 'taxmodel', 'productsales', 'producttax', 'postcredits', 'shipcredittax', 'giftwrap',
  'giftwraptax', 'promrebates', 'promrebatetax', 'marketwitheldtax', 'sellingfees', 'fbafees', 'otherfees', 'other', 'total',
  'transaction', 'transactiondate',
];

/** Quote one CSV cell. Everything is quoted, matching both the legacy file and Amazon's own export. */
const quote = (v) => `"${String(v === undefined || v === null ? '' : v).replace(/"/g, '""')}"`;

/**
 * Build kidsvatcharged.csv from the zero-rated rows, passing the ORIGINAL cells straight through. The legacy file is a verbatim
 * subset of the Amazon report under different column names, so re-deriving the values here would only introduce a way for the two
 * to disagree.
 */
function buildKidsVatCsv(zeroRatedRows) {
  const lines = [KIDSVAT_CSV_HEADER.map(quote).join(',')];
  for (const row of zeroRatedRows || []) {
    lines.push(KIDSVAT_CSV_HEADER.map((_, i) => quote(row.raw ? row.raw[i] : '')).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

module.exports = {
  identify,
  parse,
  computeAmazon,
  buildKidsVatCsv,
  KIDSVAT_CSV_HEADER,
  // exported for the PayPal util and tests — one pence() implementation across the module
  pence,
  pounds,
  parseCsvLine,
  splitLines,
  normaliseHeader,
  // exported so a future change to the classification is visible in one place
  INCOME_TYPES,
  EXCLUDED_TYPES,
  REIMBURSEMENT_TYPES,
};
