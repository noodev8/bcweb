/*
=======================================================================================================================================
Util: googleAdsReports
=======================================================================================================================================
Purpose: Identify and parse the two Google Ads Report editor exports behind the Google Ads module. Pure functions — no DB, no I/O.
         Given a file's text, work out WHICH report it is from its header alone, verify the columns we depend on are present, and
         hand back typed rows plus an honest account of anything skipped.

         Same contract and the same reasoning as utils/amzReports.js — read that file's header for the full argument. The short
         version: identify by HEADER CONTENT (never filename), resolve every column by NAME (never position), and account for every
         row that does not make it through.

THE TWO REPORTS
  PRODUCT   `bcweb_product_30`      Day x Custom label 1 (style) x Custom label 0 (bucket) x Campaign, with spend and conversions.
                                    The per-style economics the screen is built on. Defined in docs/google-ads-spec.md §2.3.
  CAMPAIGN  `adcost_summary_30`     Day x Campaign, with impression share and lost-IS. Campaign grain ONLY — impression share does
                                    not exist at product grain in Google Ads, which is why both reports are needed.

FIVE THINGS THE REAL FILES DO THAT A NAIVE PARSER GETS WRONG (all verified against the live 2026-09-05 exports):

  1. TWO PREAMBLE LINES BEFORE THE HEADER. Line 1 is the report name, line 2 is a QUOTED date range
     ("August 6, 2026 - September 4, 2026" — note the commas inside the quotes). We do NOT assume the header is on line 3; we scan
     for the first line that actually looks like a known report's header. A saved report renamed or re-exported with a different
     preamble then still parses.

  2. QUOTED THOUSANDS SEPARATORS IN THE DATA. One row of the 5,855-row sample reads:
         2026-08-12,0051701-arizona, --,STANDARD,"1,007",8,GBP,4.94,0.00,0.00
     A `split(',')` yields ELEVEN fields for that row and silently shifts every value after it. This file therefore does real
     RFC4180 parsing. Do not replace parseCsvLine() with a split.

  3. GOOGLE LOWERCASES CUSTOM LABELS. The file says `0043693-gizeh`; our groupid is `0043693-GIZEH`. Every style id is upper-cased
     here, at the parse boundary, so nothing downstream has to remember. A case-sensitive join matches ZERO rows and looks exactly
     like an empty report.

  4. `" --"` IS GOOGLE'S NULL, WITH A LEADING SPACE. It appears in Custom label 0 (no bucket set) and in the share columns
     (reporting lag). It must become NULL, never a bucket literally named `--`.

  5. THE TWO REPORTS ORDER THEIR SHARED COLUMNS DIFFERENTLY. The product report is `Impr.` then `Clicks`; the campaign report is
     `Clicks` then `Impr.`. Positional parsing across both is guaranteed to be wrong in one of them. (The legacy Python parses the
     campaign report positionally — which is why the two new conversion columns must be APPENDED to it, never inserted.)

WHY THE SHARE COLUMNS ARE PARSED SEPARATELY FROM THE NUMBERS
Google censors share metrics rather than reporting them: '< 10%' below a threshold, '> 90%' above one, '--' while the figure is not
yet final. All three mean "we are not telling you", which is NULL — not 10, not 90, and definitely not 0. Feeding a censored cell
through the ordinary number parser would turn "unknown" into a real-looking measurement.
=======================================================================================================================================
Exports:
  REPORTS                    the two report definitions
  identify(text)             -> { type, label, header, headerLine, extraColumns } | { type: null, reason, bestGuess? }
  parseReport(text)          -> { type, label, rows, skipped, extraColumns, window, rowCount }
  parseCsvLine(line)         exported for tests
  normaliseHeader(cell)      exported for tests
  parseNumber / parsePercent / parseDate / parseLabel   exported for tests
=======================================================================================================================================
*/

// ---------------------------------------------------------------------------------------------------------------------------------
// Report definitions
// ---------------------------------------------------------------------------------------------------------------------------------
// `identity` = the columns that fingerprint the report. Must be distinctive enough to tell the two apart: both carry Day, Campaign,
// Clicks, Impr., Currency code and Cost, so the discriminator is the product report's custom-label columns and the campaign
// report's impression-share column.
//
// `required` = columns the import genuinely reads. A missing one is a hard stop — doing the job half-correctly is precisely the
// legacy failure mode this module exists to end.
//
// `layout` = the full header as Google shipped it on 2026-09-05. Not used for parsing. Its only job is to make "Google added a
// column" detectable without firing on every upload. Update it when the saved report changes.
const REPORTS = {
  PRODUCT: {
    type: 'PRODUCT',
    label: 'Product performance (bcweb_product_30)',
    identity: ['day', 'custom label 1', 'campaign'],
    required: ['day', 'custom label 1', 'custom label 0', 'campaign', 'impr.', 'clicks', 'cost'],
    layout: ['day', 'custom label 1', 'custom label 0', 'campaign', 'impr.', 'clicks', 'currency code', 'cost',
             'conversions', 'conv. value'],
  },
  CAMPAIGN: {
    type: 'CAMPAIGN',
    label: 'Campaign summary (adcost_summary_30)',
    identity: ['day', 'campaign', 'search impr. share'],
    required: ['day', 'campaign', 'clicks', 'impr.', 'cost'],
    layout: ['day', 'campaign', 'clicks', 'impr.', 'currency code', 'cost', 'search impr. share',
             'search lost is (rank)', 'search lost is (budget)', 'conversions', 'conv. value'],
  },
};

// Google's Report editor labels the same underlying field differently depending on where it was added from — the shopping
// attributes appear as "Custom label N" in some pickers and "Custom attribute N" in others, and money columns pick up a currency
// suffix when the account reports in more than one. Accepting the variants costs nothing and saves a rejected file that is
// genuinely the right report. Canonical name -> the alternatives that mean the same thing.
const COLUMN_ALIASES = {
  'custom label 0': ['custom attribute 0', 'product custom attribute 0'],
  'custom label 1': ['custom attribute 1', 'product custom attribute 1'],
  'cost': ['cost (gbp)', 'cost (£)'],
  'conv. value': ['conv value', 'conversion value', 'conv. value (gbp)', 'all conv. value'],
  'conversions': ['conv.', 'all conv.'],
  'impr.': ['impressions', 'impr'],
  'search impr. share': ['search impression share'],
  'search lost is (rank)': ['search lost is (rank) (%)'],
  'search lost is (budget)': ['search lost is (budget) (%)'],
};

// Google's markers for "no value". All mean NULL. The leading space on ' --' is real and is why every cell is trimmed first.
const NULL_MARKERS = new Set(['', '--', '---', 'n/a', 'none']);

// ---------------------------------------------------------------------------------------------------------------------------------
// CSV mechanics
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Split one CSV line into cells, honouring RFC4180 double-quoting (including "" as an escaped quote inside a quoted field).
 *
 * This exists because of the `"1,007"` case in the real file (see header note 2). It is a line-level parser, not a whole-file one:
 * none of the fields in either report can contain a newline (dates, ids, campaign names and numbers), so a quoted field never
 * spans lines and splitting the file into lines first is safe.
 */
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

/** Split a report into non-empty lines. Handles CRLF and a missing trailing newline. */
function splitLines(text) {
  return String(text || '')
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);
}

/**
 * Normalise one header cell for name matching: strip the UTF-8 BOM, trim, collapse internal runs of whitespace, lower-case.
 * Punctuation is KEPT — 'Impr.' and 'Conv. value' carry meaningful dots and Google is consistent about them.
 */
function normaliseHeader(cell) {
  return String(cell === undefined || cell === null ? '' : cell)
    .replace(/^\uFEFF/, '')   // UTF-8 BOM, written as an escape: a literal one here is invisible and gets "tidied away" by editors
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Build a {canonicalName -> columnIndex} map for one parsed header row, resolving aliases. Every read downstream goes through this,
 * so an inserted or reordered column is harmless and a REMOVED one is a named hard stop.
 */
function indexHeader(headerCells) {
  const index = {};
  headerCells.forEach((cell, i) => {
    if (cell && index[cell] === undefined) index[cell] = i;
  });

  for (const [canonical, aliases] of Object.entries(COLUMN_ALIASES)) {
    if (index[canonical] !== undefined) continue;
    for (const alias of aliases) {
      if (index[alias] !== undefined) { index[canonical] = index[alias]; break; }
    }
  }
  return index;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Cell parsing
// ---------------------------------------------------------------------------------------------------------------------------------

/** True for any of Google's "no value" markers. Trims first — ' --' arrives with a leading space. */
function isNull(raw) {
  return NULL_MARKERS.has(String(raw === undefined || raw === null ? '' : raw).trim().toLowerCase());
}

/**
 * A count or money cell -> Number, or null if it cannot be read. Strips thousands separators, currency symbols and stray quotes.
 * Returns NULL rather than 0 on junk: a row we cannot read must be reported as skipped, not silently booked as zero spend.
 */
function parseNumber(raw) {
  if (isNull(raw)) return null;
  const cleaned = String(raw).replace(/[",£$€\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/**
 * A share/percentage cell -> Number, or null. Google CENSORS these rather than reporting them:
 *   '--'     the figure is not final yet (2-3 day reporting lag)
 *   '< 10%'  below Google's disclosure threshold
 *   '> 90%'  above it
 * All three are NULL — "we are not telling you" is not a measurement, and mapping '< 10%' to 10 would invent one.
 */
function parsePercent(raw) {
  if (isNull(raw)) return null;
  const s = String(raw).trim().replace(/%/g, '').replace(/[",\s]/g, '');
  if (s.startsWith('<') || s.startsWith('>')) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

/**
 * A `Day` cell -> 'YYYY-MM-DD', or null. Google exports ISO in this account's locale; anything else is rejected by name rather
 * than guessed at, because a mis-read date writes real spend onto the wrong day and nothing downstream would ever notice.
 */
function parseDate(raw) {
  if (isNull(raw)) return null;
  const s = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [, m, d] = s.split('-').map(Number);   // year needs no range check; the regex above already fixed it at 4 digits
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return s;
}

/**
 * A custom-label cell -> the label, or null when Google reported no label. Upper-cased: Google lower-cases custom labels on the way
 * out, and every consumer of these rows joins against our upper-case groupids (header note 3).
 */
function parseLabel(raw) {
  if (isNull(raw)) return null;
  const s = String(raw).trim().toUpperCase();
  return s.length > 0 ? s : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Identification
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Work out which report this is, from its header alone.
 *
 * Scans the first PREAMBLE_SCAN_LINES lines for the first row that carries a known report's identity columns, rather than assuming
 * the header sits on line 3. The preamble is a report name and a date range today; a renamed or re-exported report could carry a
 * different number of lines, and that should not reject a perfectly good file.
 *
 * Returns { type: null, reason } when nothing matches, so the operator is told WHY a file was refused rather than just that it was.
 */
const PREAMBLE_SCAN_LINES = 10;

function identify(text) {
  const lines = splitLines(text);
  if (lines.length === 0) return { type: null, reason: 'The file is empty.' };

  for (let i = 0; i < Math.min(lines.length, PREAMBLE_SCAN_LINES); i += 1) {
    const cells = parseCsvLine(lines[i]).map(normaliseHeader);
    if (cells.length < 2) continue;               // the report-name line has no commas
    const index = indexHeader(cells);

    for (const def of Object.values(REPORTS)) {
      if (!def.identity.every((col) => index[col] !== undefined)) continue;

      const missingRequired = def.required.filter((col) => index[col] === undefined);
      if (missingRequired.length > 0) {
        return {
          type: null,
          bestGuess: def.type,
          reason: `This is the ${def.label} export, but ${missingRequired.length > 1 ? 'these columns are' : 'this column is'} missing or renamed: ${missingRequired.join(', ')}. Add ${missingRequired.length > 1 ? 'them' : 'it'} back to the saved report in the Google Ads Report editor. Nothing was imported.`,
        };
      }

      // Columns Google has ADDED since `layout` was captured. Not an error — name-based parsing is immune to it — but it is the
      // earliest visible sign that the saved report has been edited, so the preview surfaces it. Measured against the full known
      // layout so it stays empty in normal use and means something when it does not.
      const known = new Set([...def.layout, ...Object.values(COLUMN_ALIASES).flat()]);
      const extraColumns = cells.filter((c) => c && !known.has(c));

      return { type: def.type, label: def.label, header: cells, headerLine: i, index, extraColumns };
    }
  }

  // Nothing matched. Say which report it most resembles rather than giving a bare "not recognised" — a file that is obviously the
  // right report with one column renamed is far more useful reported that way.
  let best = null;
  const firstRealHeader = lines
    .slice(0, PREAMBLE_SCAN_LINES)
    .map((l) => parseCsvLine(l).map(normaliseHeader))
    .filter((c) => c.length >= 2)
    .sort((a, b) => b.length - a.length)[0] || [];
  const present = new Set(firstRealHeader);

  for (const def of Object.values(REPORTS)) {
    const overlap = def.layout.filter((c) => present.has(c)).length;
    const score = def.layout.length ? overlap / def.layout.length : 0;
    if (!best || score > best.score) best = { def, score, overlap };
  }

  if (best && best.score >= 0.4) {
    const missing = best.def.identity.filter((c) => !present.has(c));
    return {
      type: null,
      bestGuess: best.def.type,
      reason: `This looks like the ${best.def.label} export (${best.overlap} of ${best.def.layout.length} known columns present), but ${missing.length > 1 ? 'these columns are' : 'this column is'} missing: ${missing.join(', ')}. Nothing was imported.`,
    };
  }

  return {
    type: null,
    reason: 'Not recognised as either Google Ads export. Expected the product report (with Day + Custom label 1) or the campaign report (with Day + Search impr. share). Download them from the Google Ads Report editor as CSV.',
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------------------------------------------------------------

/** Record a skipped row under a reason code, keeping a few examples for the preview. Mirrors utils/amzImport's skip accounting. */
function addSkip(skipped, reason, label, row) {
  let entry = skipped.find((s) => s.reason === reason);
  if (!entry) { entry = { reason, label, count: 0, examples: [] }; skipped.push(entry); }
  entry.count += 1;
  if (entry.examples.length < 5) entry.examples.push(row.slice(0, 6).join(','));
}

/**
 * Parse a whole report into typed rows.
 *
 * The contract the preview renders is: rowCount = rows.length + every skip count. Nothing is discarded without a reason attached.
 *
 * `window` is derived from the DATA, not from the report's date-range preamble line. The preamble is a human-readable string in the
 * account's locale ("August 6, 2026 - September 4, 2026") and parsing it would be a second, worse date parser; the Day column is
 * already authoritative and is what actually gets written.
 */
function parseReport(text) {
  const id = identify(text);
  if (!id.type) return { type: null, reason: id.reason, bestGuess: id.bestGuess || null };

  const def = REPORTS[id.type];
  const lines = splitLines(text);
  const index = id.index;
  const at = (cells, col) => (index[col] === undefined ? '' : cells[index[col]]);

  const rows = [];
  const skipped = [];
  let rowCount = 0;

  for (let i = id.headerLine + 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);

    // Google appends a "Total" summary row to some exports. It has no date, so the date guard below would catch it anyway — but
    // naming it keeps a legitimate, expected row out of the error list where it would look like a fault.
    const firstCell = String(cells[0] || '').trim().toLowerCase();
    if (firstCell.startsWith('total')) continue;

    rowCount += 1;

    const date = parseDate(at(cells, 'day'));
    if (!date) { addSkip(skipped, 'BAD_DATE', 'Unreadable date in the Day column', cells); continue; }

    const campaign = String(at(cells, 'campaign') || '').trim();
    if (!campaign) { addSkip(skipped, 'NO_CAMPAIGN', 'No campaign name on the row', cells); continue; }

    if (id.type === 'PRODUCT') {
      // The style. Upper-cased at the boundary (header note 3). A row with no style id cannot be attributed and is skipped by name
      // rather than being written against an empty groupid.
      const groupid = parseLabel(at(cells, 'custom label 1'));
      if (!groupid) { addSkip(skipped, 'NO_STYLE', 'Custom label 1 (the style id) was empty', cells); continue; }

      const impressions = parseNumber(at(cells, 'impr.'));
      const clicks = parseNumber(at(cells, 'clicks'));
      const cost = parseNumber(at(cells, 'cost'));
      if (impressions === null || clicks === null || cost === null) {
        addSkip(skipped, 'BAD_NUMBER', 'Impressions, clicks or cost could not be read as a number', cells);
        continue;
      }

      rows.push({
        date,
        groupid,
        // NULL here means Google reported no bucket for this style — a real, expected state (' --'), not an error.
        googleLabel: parseLabel(at(cells, 'custom label 0')),
        campaign,
        impressions,
        clicks,
        cost,
        // Nullable on purpose: Google revises conversions upward for weeks after the click, and an un-reported figure is unknown,
        // not zero.
        conversions: parseNumber(at(cells, 'conversions')),
        convValue: parseNumber(at(cells, 'conv. value')),
      });
    } else {
      const clicks = parseNumber(at(cells, 'clicks'));
      const impressions = parseNumber(at(cells, 'impr.'));
      const cost = parseNumber(at(cells, 'cost'));
      if (clicks === null || impressions === null || cost === null) {
        addSkip(skipped, 'BAD_NUMBER', 'Clicks, impressions or cost could not be read as a number', cells);
        continue;
      }

      rows.push({
        date,
        campaign,
        clicks,
        impressions,
        cost,
        // Share columns go through parsePercent, never parseNumber — Google censors them and a censored cell is NULL.
        searchImpShare: parsePercent(at(cells, 'search impr. share')),
        lostIsRank: parsePercent(at(cells, 'search lost is (rank)')),
        lostIsBudget: parsePercent(at(cells, 'search lost is (budget)')),
        conversions: parseNumber(at(cells, 'conversions')),
        convValue: parseNumber(at(cells, 'conv. value')),
      });
    }
  }

  const dates = rows.map((r) => r.date).sort();
  const window = dates.length ? { from: dates[0], to: dates[dates.length - 1], days: new Set(dates).size } : null;

  return { type: id.type, label: def.label, rows, skipped, extraColumns: id.extraColumns, window, rowCount };
}

module.exports = {
  REPORTS,
  identify,
  parseReport,
  addSkip,
  parseCsvLine,
  normaliseHeader,
  parseNumber,
  parsePercent,
  parseDate,
  parseLabel,
};
