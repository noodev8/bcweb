/*
=======================================================================================================================================
Module: utils/financeCar.js
=======================================================================================================================================
Purpose: Turn the owner's car mileage spreadsheet into one month's expense figure for the Finance / Month End screen. READ ONLY — it
         reads the sheet through utils/googleSheets.js and returns a total; it writes nothing, to the sheet or the database.

WHY THIS EXISTS: the Car figure was one of the four typed by hand (spec section 3.5). The mileage itself has to be logged in the sheet
         for HMRC either way, so typing it again into this screen was re-keying a number that already existed — and the failure it
         invites is silent, because a mistyped car total looks exactly like a correct one. Reading the sheet makes the figure and its
         evidence the same object.

THE SHEET (one row per journey, not one row per month):
         Date | Business | Miles | Rate | Total Miles | Car | Description | Expense
         16/06/2026 | Brookfield | 154 | 0.45 | 154 | Andreas | ECCO Meeting | £69.30

  - Date is UK DD/MM/YYYY, and that is the whole reason it is parsed here by hand rather than handed to `new Date()`: JavaScript reads
    '14/08/2026' as an invalid date and '06/07/2026' as the SIXTH OF JULY. A silently wrong month is the one bug this module cannot
    have, so anything that is not dd/mm/yyyy is refused, never guessed.
  - `Business` is filtered to Brookfield (owner, 2026-09-17). The column only earns its place by excluding something, and a personal
    journey swept into a business expense claim is invisible once it is inside a single total.
  - `Expense` is READ, not recomputed from Miles x Rate. The sheet is the record: if the owner overrides a line, or the rate drops to
    25p after 10,000 miles (what the running `Total Miles` column is tracking), the sheet already says so and arithmetic here would
    quietly disagree with it.
  - Columns are found BY HEADER NAME, never by position, so inserting a column in the sheet cannot silently shift which one is read.

NO VAT. A mileage claim carries none, which is exactly what the QuickFile Car line already assumes (Car | Travel | total | VAT 0 |
        nominal 7400 | bank 1230 — spec section 5). Nothing downstream changes; this only fills the box.
=======================================================================================================================================
*/

const config = require('../config/config');
const { readValues } = require('./googleSheets');

// The one business whose journeys are claimable here. The sheet has a Business column so that this filter can exist.
const BUSINESS = 'brookfield';

// Header names we need, lower-cased for matching. A sheet missing one of these is a structural change, and we say so by name.
const NEED = ['date', 'business', 'miles', 'expense'];

/** '£69.30' / '69.30' / '1,234.56' -> 69.3. Returns null for anything that isn't a number, so junk can be reported, not summed as 0. */
function money(cell) {
  if (cell === undefined || cell === null) return null;
  const cleaned = String(cell).replace(/[£,\s]/g, '');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * 'DD/MM/YYYY' -> 'YYYY-MM'. Returns null if the cell is not that shape.
 * Deliberately string-to-string: no Date object is built, so no timezone can move a journey dated the 1st into the previous month
 * (the same BST trap CLAUDE.md flags for pg DATEs and toISOString).
 */
function monthOf(cell) {
  const m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4})\s*$/.exec(String(cell ?? ''));
  if (!m) return null;
  const day = Number(m[1]);
  const mon = Number(m[2]);
  if (day < 1 || day > 31 || mon < 1 || mon > 12) return null;
  return `${m[3]}-${String(mon).padStart(2, '0')}`;
}

/**
 * Read the mileage sheet and total one month's journeys.
 *
 * @param {string} month 'YYYY-MM'
 * @returns {Promise<{configured:boolean, total:number, journeys:number, miles:number, rows:Array, skipped:number}>}
 *
 * `rows` is the month's journeys themselves — the screen shows them under the figure so the total can be checked against the sheet
 * without opening it. That is the module's rule (every figure arrives with what produced it), applied to this one too.
 */
async function carExpense(month) {
  const sheetId = config.sheets.carSheetId;
  if (!sheetId) return { configured: false, total: 0, journeys: 0, miles: 0, rows: [], skipped: 0 };

  const values = await readValues(sheetId, `${config.sheets.carTab}!A:Z`);
  if (values.length === 0) throw new Error('The car expense sheet is empty');

  // --- locate the columns by header name ---
  const header = values[0].map((h) => String(h || '').trim().toLowerCase());
  const at = {};
  for (const name of NEED) {
    const i = header.indexOf(name);
    if (i === -1) throw new Error(`The car expense sheet has no '${name}' column (found: ${values[0].join(', ')})`);
    at[name] = i;
  }
  const descAt = header.indexOf('description');   // optional — evidence, not arithmetic

  // --- walk the journeys ---
  let total = 0;
  let miles = 0;
  let skipped = 0;             // rows we could not read (bad date, non-numeric expense) — counted, never silently dropped
  const rows = [];

  for (const raw of values.slice(1)) {
    // Google omits trailing empty cells, so a short row is normal, not corrupt.
    const cell = (i) => (i >= 0 && i < raw.length ? String(raw[i] ?? '').trim() : '');

    if (!raw.some((c) => String(c ?? '').trim() !== '')) continue;              // blank spacer row
    if (cell(at.business).toLowerCase() !== BUSINESS) continue;                 // not ours — see the header note

    const rowMonth = monthOf(cell(at.date));
    if (rowMonth === null) { skipped += 1; continue; }
    if (rowMonth !== month) continue;

    const amount = money(cell(at.expense));
    if (amount === null) { skipped += 1; continue; }

    total += amount;
    miles += money(cell(at.miles)) || 0;
    rows.push({ date: cell(at.date), miles: money(cell(at.miles)) || 0, description: cell(descAt), amount });
  }

  // Money is summed as floats here (a handful of rows a year), so round once at the end rather than carrying 119.69999999999999
  // into the screen and the QuickFile CSV.
  return {
    configured: true,
    total: Math.round(total * 100) / 100,
    journeys: rows.length,
    miles,
    rows,
    skipped,
  };
}

module.exports = { carExpense, monthOf, money };
