/*
=======================================================================================================================================
Util: financePayPal
=======================================================================================================================================
Purpose: Total the month's PayPal fees from the PayPal "All transactions" CSV export. Spec: docs/finance-month-end-spec.md §3.4.
         One number reaches the accounts from this file; everything else here exists to make sure that number is not silently wrong.

WHAT THIS REPLACES, and the trap it removes
`C:\scripts\month-end\shopify_fees.py` reads this file only if it is sitting in Downloads under the EXACT name 'Download.CSV', then
renames it to 'Download-done.CSV' so a second run cannot double-count it. The failure mode is nasty precisely because it looks like
success: re-run the export and the script prints "PayPal fees not available in the results" and carries on, so the month's accounts
are produced with the PayPal fee simply absent and nothing says so. Here the operator drops the file on the screen under whatever
name PayPal gave it, and a file that is not a PayPal export is refused BY NAME with a reason.

VERIFIED AGAINST A LIVE EXPORT (2026-09-11)
A real August 2026 export (106 rows, 41 columns, UTF-8 BOM) was run through this and through the Python side by side: both produce
GBP 198.44 across 85 fees. The header is captured in LAYOUT_2026_08 below purely so a future change to it is visible.

WHAT CARRIES A FEE, AND WHAT DOES NOT
In that file: 85 Express Checkout Payments each carry a fee; the 16 Payment Refunds and 5 General Withdrawals carry none (PayPal does
not return the fee on a refund). So `count` is the number of transactions that actually cost something, not the row count — and a
month where those two are equal is the thing worth a second look.

CURRENCY
The Python sums the Fee column regardless of currency. That is kept — changing it silently would change the figure the owner has
been filing — but any non-GBP currency present is reported so a mixed-currency export cannot pass unnoticed.
=======================================================================================================================================
Exports:
  identify(text)      -> { ok, header, headerLine } | { ok:false, reason }
  computePayPal(text) -> { ok, fees, count, rowCount, currencies, window }
=======================================================================================================================================
*/

const { pence, pounds, parseCsvLine, splitLines, normaliseHeader } = require('./financeAmazon');

// The one column the figure actually comes from. A missing Fee column is a hard stop, not a zero.
const REQUIRED = ['fee'];

// Structural columns that fingerprint a PayPal export. `fee` must be present, plus at least two of these. Still deliberately
// forgiving rather than demanding the exact 41-column layout: PayPal's export columns depend on account settings and on which
// optional fields are ticked at download time, so a strict match would refuse a perfectly good file from a slightly different export
// screen. Two supporting columns is already far more than any other CSV in the month-end pile can offer.
const SUPPORTING = ['date', 'gross', 'net', 'currency', 'name', 'type', 'status', 'transaction id', 'balance'];
const MIN_SUPPORTING = 2;

// The full header of the live 2026-08 export. NOT used for parsing — columns are resolved by name — its only job is to record what
// was verified, so a future difference can be seen rather than guessed at.
const LAYOUT_2026_08 = [
  'date', 'time', 'time zone', 'name', 'type', 'status', 'currency', 'gross', 'fee', 'net', 'from email address',
  'to email address', 'transaction id', 'shipping address', 'address status', 'item title', 'item id',
  'postage and packaging amount', 'insurance amount', 'vat', 'option 1 name', 'option 1 value', 'option 2 name',
  'option 2 value', 'reference txn id', 'invoice number', 'custom number', 'quantity', 'receipt id', 'balance',
  'address line 1', 'address line 2/district/neighbourhood', 'town/city', 'county', 'postcode', 'country',
  'contact phone number', 'subject', 'note', 'country code', 'balance impact',
];

// ---------------------------------------------------------------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Find the header row and confirm this is a PayPal transaction export. PayPal writes its header on line 1 with a UTF-8 BOM, but the
 * same content-scan as the Amazon reader is used rather than assuming that — it costs nothing and survives a preamble appearing.
 */
function identify(text) {
  const lines = splitLines(text);
  if (lines.length === 0) return { ok: false, reason: 'The file is empty.' };

  const limit = Math.min(lines.length, 20);
  for (let i = 0; i < limit; i += 1) {
    const header = parseCsvLine(lines[i]).map(normaliseHeader);
    const present = new Set(header);
    if (!present.has('fee')) continue;

    const supporting = SUPPORTING.filter((c) => present.has(c));
    if (supporting.length < MIN_SUPPORTING) continue;

    const missing = REQUIRED.filter((c) => !present.has(c));
    if (missing.length > 0) {
      return { ok: false, reason: `This looks like a PayPal export but the ${missing.join(', ')} column is missing or renamed.` };
    }
    return { ok: true, header, headerLine: i };
  }

  const first = parseCsvLine(lines[0]).map(normaliseHeader);
  return {
    ok: false,
    reason: `Not recognised as a PayPal transaction export — no 'Fee' column found in the first ${limit} lines. First line seen: ${first.slice(0, 6).join(', ') || '(blank)'}`,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The figure
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Total the Fee column.
 *
 * PayPal writes fees as NEGATIVE numbers (money leaving). The accounts want a positive cost, so the sign is flipped once, here —
 * matching what the Python prints and what the QuickFile purchase file expects. Rows with a zero or blank fee are not counted in
 * `count`, so "85 fees" means 85 transactions that actually cost something.
 *
 * Pure: no DB, no I/O, no date filtering. The export is already the month the operator asked PayPal for, and second-guessing that
 * here would mean re-implementing PayPal's own window from a date column whose format varies by account locale.
 */
function computePayPal(text) {
  const id = identify(text);
  if (!id.ok) return id;

  const lines = splitLines(text);
  const index = new Map(id.header.map((name, i) => [name, i]));
  const at = (cells, name) => (index.has(name) ? cells[index.get(name)] : undefined);

  let total = 0;
  let count = 0;
  let rowCount = 0;
  const currencies = new Map();

  for (let i = id.headerLine + 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    if (cells.length < id.header.length) continue;   // trailing fragment, not a row
    rowCount += 1;

    const fee = pence(at(cells, 'fee'));
    if (fee !== 0) {
      total += fee;
      count += 1;
      const cur = String(at(cells, 'currency') || '').trim().toUpperCase() || 'GBP';
      currencies.set(cur, (currencies.get(cur) || 0) + 1);
    }
  }

  return {
    ok: true,
    fees: pounds(-total),      // PayPal writes fees negative; the accounts want a positive cost
    count,
    rowCount,
    // Reported so a mixed-currency export cannot pass unnoticed — the total above sums them all, as the Python always has.
    currencies: [...currencies.entries()].map(([code, rows]) => ({ code, rows })).sort((a, b) => b.rows - a.rows),
  };
}

module.exports = { identify, computePayPal, LAYOUT_2026_08 };
