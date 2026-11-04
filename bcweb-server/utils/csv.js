/*
=======================================================================================================================================
Util: csv
=======================================================================================================================================
Purpose: Read a Seller Central CSV download (RFC-4180: quoted fields, commas inside product titles, doubled quotes, a UTF-8 BOM) into
         an array of objects keyed by the header row. Shared by scripts/amz-ledger-backfill.js (Inventory Ledger) and
         utils/amzPricingStandard.js (Business Report). Moved here from the backfill script 2026-11-04 so there is one copy.
=======================================================================================================================================
*/

const fs = require('fs');

/** Parse CSV text -> array of objects keyed by the header. Rows with a single empty field (blank lines) are dropped. */
function parseCsv(text) {
  const txt = String(text).replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < txt.length; i += 1) {
    const ch = txt[i];
    if (quoted) {
      if (ch === '"') {
        if (txt[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

/** Read a CSV file from disk. */
function readCsv(file) {
  return parseCsv(fs.readFileSync(file, 'utf8'));
}

module.exports = { parseCsv, readCsv };
