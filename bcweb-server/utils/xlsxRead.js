/*
=======================================================================================================================================
Module: utils/xlsxRead.js
=======================================================================================================================================
Purpose: Read the first worksheet of an .xlsx file out of a Buffer into plain rows of cell values. READ ONLY, in memory, no temp files.
         Built for the Birk Tracker "Load order" upload (utils/birkOrder.js), but knows nothing about Birkenstock.

WHY HAND-ROLLED RATHER THAN A LIBRARY. An .xlsx is a zip of XML, and reading one sheet of values out of it is ~150 lines on top of
Node's own zlib. The candidates were worse trades for one upload button:
  `exceljs`          unmaintained since 2024 and drags in archiver, jszip, unzipper, tmp, uuid — a large surface in a repo whose
                     dependency history is mostly clearing advisories (docs/maintenance-notes.md).
  `read-excel-file`  small, but ESM-first with four transitive packages, for a job zlib already does.
  `xlsx` (SheetJS)   the npm copy is frozen on a version with known advisories; the fixed builds live off-registry.

WHAT IT DELIBERATELY DOES NOT DO: formulas (the cached value is read, which is what the file shows), styles, merged cells, multiple
sheets, or zip64 (an order confirmation is kilobytes). Number formats are not applied either, so a DATE COMES BACK AS ITS EXCEL SERIAL
NUMBER — the caller knows which columns are dates and converts them with `excelSerialToParts`. Guessing "date-ness" from the style
table here would be the kind of quiet cleverness that turns a price into a date.

BOTH CELL LAYOUTS ARE HANDLED. Birkenstock's portal writes cells with no `r="A1"` reference and every string inline; Excel, on re-save,
adds references, skips empty cells and moves strings into sharedStrings.xml. An operator who opens the file to look at it before
uploading will produce the second, so both must read identically.
=======================================================================================================================================
*/

const zlib = require('zlib');

// Hard ceiling on any single inflated part. A real order export is ~130KB of sheet XML; this only exists so a crafted zip cannot
// expand into the process's whole heap.
const MAX_PART_BYTES = 50 * 1024 * 1024;

// --- the zip container -----------------------------------------------------------------------------------------------------------

/*
 * readZipEntries(buffer) -> Map<name, () => Buffer>
 * Walks the central directory (the authoritative index at the END of a zip — local headers can carry zeroed sizes when the writer
 * streamed) and returns a lazy reader per entry, so only the three or four parts actually needed are ever inflated.
 */
function readZipEntries(buf) {
  // End-of-central-directory record: fixed 22 bytes plus an optional comment of up to 65535, so search backwards that far at most.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i -= 1) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (p === 0xffffffff) throw new Error('zip64 is not supported');

  const entries = new Map();
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt zip directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    entries.set(name, () => {
      if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`corrupt zip entry ${name}`);
      // The local header's own name/extra lengths can differ from the central directory's, so the data offset is taken from here.
      const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
      const data = buf.subarray(start, start + compSize);
      if (method === 0) return data;
      if (method === 8) return zlib.inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES });
      throw new Error(`unsupported zip compression ${method}`);
    });

    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// --- the XML -----------------------------------------------------------------------------------------------------------------------
// SpreadsheetML is machine-written and regular, so targeted regexes are enough; a general XML parser would be the dependency this
// file exists to avoid.

function decodeXml(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&') // last, so "&amp;lt;" stays the literal text "&lt;"
    // Excel's own escape for control characters inside strings, e.g. _x000D_ for a carriage return.
    .replace(/_x([0-9A-F]{4})_/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

// The visible text of a string item: every <t> run concatenated. Phonetic guides (<rPh>) also contain <t> and are not part of the
// value, so they are removed first.
function textOf(xml) {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  for (const m of body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function attr(attrs, name) {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : null;
}

// "AB12" -> 27 (zero-based column of the letters).
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref);
  if (!letters) return null;
  let n = 0;
  for (const ch of letters[1]) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// The first sheet's part name, found the way Excel does: workbook.xml names the sheet's relationship id, and the workbook's rels
// file maps that id to a path. Falls back to the conventional name when either is missing.
function firstSheetPath(entries) {
  const read = (name) => (entries.has(name) ? entries.get(name)().toString('utf8') : null);
  const workbook = read('xl/workbook.xml');
  const rels = read('xl/_rels/workbook.xml.rels');
  if (workbook && rels) {
    const sheet = /<sheet\b[^>]*>/.exec(workbook);
    const rid = sheet ? attr(sheet[0], 'r:id') : null;
    if (rid) {
      for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
        if (attr(m[0], 'Id') !== rid) continue;
        const target = attr(m[0], 'Target') || '';
        // Targets are relative to xl/ unless they start with a slash.
        const path = target.startsWith('/') ? target.slice(1) : `xl/${target}`;
        if (entries.has(path)) return path;
      }
    }
  }
  return entries.has('xl/worksheets/sheet1.xml') ? 'xl/worksheets/sheet1.xml' : null;
}

/*
 * readFirstSheet(buffer) -> Array<Array<string|number|boolean|null>>
 * Rows in sheet order, each an array indexed by column. Strings stay strings (so '0002268001' keeps its zeros), numbers become numbers,
 * empty cells are null. Throws on anything that is not a readable .xlsx.
 */
function readFirstSheet(buffer) {
  const entries = readZipEntries(buffer);
  const sheetPath = firstSheetPath(entries);
  if (!sheetPath) throw new Error('no worksheet in file');

  const shared = [];
  if (entries.has('xl/sharedStrings.xml')) {
    const sst = entries.get('xl/sharedStrings.xml')().toString('utf8');
    for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));
  }

  const xml = entries.get(sheetPath)().toString('utf8');
  const rows = [];
  // A self-closing <row/> is an empty row; it still takes up its row number.
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNum = parseInt(attr(rm[1], 'r'), 10);
    const index = Number.isInteger(rowNum) ? rowNum - 1 : rows.length;
    const cells = [];
    let next = 0;
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = attr(cm[1], 'r');
      const col = ref ? columnIndex(ref) : next;
      next = (col ?? next) + 1;
      const type = attr(cm[1], 't');
      const inner = cm[2] || '';
      const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);

      let value = null;
      if (type === 'inlineStr') value = textOf(inner);
      else if (type === 's') value = v ? (shared[parseInt(v[1], 10)] ?? null) : null;
      else if (type === 'str' || type === 'e') value = v ? decodeXml(v[1]) : null;
      else if (type === 'b') value = v ? v[1] === '1' : null;
      else if (v) {
        const num = Number(v[1]);
        value = Number.isFinite(num) ? num : decodeXml(v[1]);
      }
      cells[col] = value;
    }
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = null;
    while (rows.length < index) rows.push([]);
    rows[index] = cells;
  }
  return rows;
}

/*
 * excelSerialToParts(serial) -> { y, m, d } | null
 * Excel stores a date as days since 1899-12-30 (the epoch that absorbs its 1900 leap-year bug). Worked in UTC and returned as parts,
 * never as a Date, so no timezone can move the day (CLAUDE.md: the BST day-shift landmine).
 */
function excelSerialToParts(serial) {
  if (typeof serial !== 'number' || !Number.isFinite(serial) || serial < 1) return null;
  const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

module.exports = { readFirstSheet, excelSerialToParts };
