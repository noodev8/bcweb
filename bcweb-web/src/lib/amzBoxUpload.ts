/*
=======================================================================================================================================
Amazon box-contents upload — fill Amazon's "Box packing information" .xlsx from our packed boxes (AMZ Shipment's "Amazon upload").
=======================================================================================================================================
Send to Amazon hands out an Excel file per pack group: one row per SKU (Amazon SKU in "SKU", "FNSKU", "Expected quantity"), a
"Box N quantity" column per box, a "Total box count" cell, and weight / width / length / height rows under the SKUs. We fill those
inputs and give the file back to upload to Seller Central (owner, 2026-10-06).

EDITED IN PLACE, NOT REBUILT. An .xlsx is a zip of XML; we open it (JSZip), write ONLY the input cells of the box-packing sheet and
zip it back up, so everything Amazon put in it — the locked structure, data validations, formulas, the hidden Id column, the
Metadata sheet — goes back untouched. Amazon's own formula cells carry dummy cached values (0.0), so its upload reads the inputs,
not the formulas; calcPr fullCalcOnLoad is added so Excel shows the right "Boxed quantity" if someone opens the file to look.

FOUND BY LABEL, NOT POSITION. The SKU rows push the box rows down (a 40-SKU file has them 40 rows lower), so the header row is the one
whose column A says "SKU", the measurement rows are found by their "Box weight/width/length/height" labels, the box columns by their
"Box N quantity" header formulas, and the box count by the "Total box count" label.

ONE PACK GROUP ONLY (owner: "we only do 1 pack group") — a file with more than one box-packing sheet is refused.

WARN, DON'T BLOCK (owner, 2026-10-06: "make with a warning"). Quantities that don't match Amazon's expected, SKUs boxed that aren't in
the file, missing measurements, a box count more than 10 from Amazon's estimate — all are listed, and the file is still made. Only a
file we can't fill at all (not this template, more than one pack group, more boxes than it has columns, no boxes) is an error.

Boxes go in our order as Amazon's Box 1, 2, 3… — box deletes renumber ours (amz-shipment-box-delete), so they match; an EMPTY box is
left out and the warning says which of ours became which of Amazon's.
=======================================================================================================================================
*/

import JSZip from 'jszip';

export interface UploadBoxLine { code: string; sku?: string; fnsku?: string; qty: number }
export interface UploadBox { id: number; lines: UploadBoxLine[]; dims: { length: string; width: string; height: string; weight: string } }

export type FillResult =
  | { ok: true; blob: Blob; fileName: string; boxes: number; units: number; warnings: string[] }
  | { ok: false; error: string };

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SHEET_PREFIX = 'Box packing information';
// Amazon: "you can modify it by up to 10 boxes" from the estimate entered in Send to Amazon.
const BOX_COUNT_SLACK = 10;

// ---- cell references --------------------------------------------------------------------------------------------------------------
const colToNum = (col: string) => [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
function numToCol(n: number) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
const splitRef = (ref: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  return m ? { col: colToNum(m[1]), row: Number(m[2]) } : null;
};

const parse = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
function serialize(doc: Document) {
  const out = new XMLSerializer().serializeToString(doc);
  return out.startsWith('<?xml') ? out : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${out}`;
}
const kids = (el: Element | Document, name: string) => Array.from(el.getElementsByTagNameNS(NS, name));
const zipPath = (target: string) => (target.startsWith('/') ? target.slice(1) : `xl/${target}`);

// ---- reading the sheet ------------------------------------------------------------------------------------------------------------
interface Cell { el: Element; col: number; row: number; text: string; formula: string; num: number | null }

function readCells(sheet: Document, shared: string[]): Cell[] {
  return kids(sheet, 'c').flatMap((el) => {
    const pos = splitRef(el.getAttribute('r') || '');
    if (!pos) return [];
    const t = el.getAttribute('t');
    const v = kids(el, 'v')[0]?.textContent ?? '';
    const formula = kids(el, 'f')[0]?.textContent ?? '';
    let text = v;
    if (t === 's') text = shared[Number(v)] ?? '';
    else if (t === 'inlineStr') text = kids(el, 't').map((x) => x.textContent).join('');
    const num = t === 's' || t === 'inlineStr' || t === 'str' || v.trim() === '' ? null : Number(v);
    return [{ el, ...pos, text: text.trim(), formula, num: Number.isFinite(num) ? num : null }];
  });
}

// ---- writing a number into a cell, creating the row/cell if Amazon left it out ----------------------------------------------------
function rowEl(sheet: Document, r: number): Element {
  const data = kids(sheet, 'sheetData')[0];
  const rows = kids(data, 'row');
  const hit = rows.find((x) => Number(x.getAttribute('r')) === r);
  if (hit) return hit;
  const el = sheet.createElementNS(NS, 'row');
  el.setAttribute('r', String(r));
  data.insertBefore(el, rows.find((x) => Number(x.getAttribute('r')) > r) ?? null);
  return el;
}

function setNumber(sheet: Document, col: number, row: number, value: number | null) {
  const ref = `${numToCol(col)}${row}`;
  const r = rowEl(sheet, row);
  const cells = kids(r, 'c');
  let c = cells.find((x) => x.getAttribute('r') === ref);
  if (!c) {
    if (value === null) return;
    c = sheet.createElementNS(NS, 'c');
    c.setAttribute('r', ref);
    // Take the column's style, as Excel would: the sheet is protected and Amazon's box columns carry an UNLOCKED style, so a bare
    // cell would come out locked and couldn't be corrected in Excel.
    const colStyle = kids(sheet, 'col').find((x) => Number(x.getAttribute('min')) <= col && col <= Number(x.getAttribute('max')))
      ?.getAttribute('style');
    if (colStyle) c.setAttribute('s', colStyle);
    r.insertBefore(c, cells.find((x) => (splitRef(x.getAttribute('r') || '')?.col ?? 0) > col) ?? null);
  }
  for (const child of Array.from(c.childNodes)) c.removeChild(child);
  c.removeAttribute('t');
  if (value === null) return;
  const v = sheet.createElementNS(NS, 'v');
  v.textContent = String(value);
  c.appendChild(v);
}

const dimNum = (v: string) => { const n = Number(v); return v.trim() !== '' && Number.isFinite(n) && n > 0 ? n : null; };

// ---- the fill -----------------------------------------------------------------------------------------------------------------------
export async function fillAmazonBoxFile(file: File, ourBoxes: UploadBox[]): Promise<FillResult> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(await file.arrayBuffer()); } catch { return { ok: false, error: 'That isn’t an Excel (.xlsx) file.' }; }
  const read = (p: string) => zip.file(p)?.async('string');

  // Workbook -> the box-packing sheet's file.
  const wbXml = await read('xl/workbook.xml');
  const relsXml = await read('xl/_rels/workbook.xml.rels');
  if (!wbXml || !relsXml) return { ok: false, error: 'That isn’t an Excel (.xlsx) file.' };
  const wb = parse(wbXml);
  const packSheets = kids(wb, 'sheet').filter((s) => (s.getAttribute('name') || '').startsWith(SHEET_PREFIX));
  if (packSheets.length === 0) return { ok: false, error: `No “${SHEET_PREFIX}” sheet — is this Amazon’s box contents file?` };
  if (packSheets.length > 1) return { ok: false, error: `This file has ${packSheets.length} pack groups — we only handle one.` };
  const rid = packSheets[0].getAttributeNS(REL_NS, 'id') || packSheets[0].getAttribute('r:id');
  const rel = Array.from(parse(relsXml).getElementsByTagName('Relationship')).find((x) => x.getAttribute('Id') === rid);
  const sheetPath = rel ? zipPath(rel.getAttribute('Target') || '') : '';
  const sheetXml = sheetPath ? await read(sheetPath) : undefined;
  if (!sheetXml) return { ok: false, error: 'Couldn’t find the box packing sheet inside the file.' };

  const sharedXml = await read('xl/sharedStrings.xml');
  const shared = sharedXml ? kids(parse(sharedXml), 'si').map((si) => kids(si, 't').map((t) => t.textContent).join('')) : [];

  // Units: the Metadata sheet says kg / cm on the files we've seen; we only fill kg and cm.
  const warnings: string[] = [];
  const metaSheet = kids(wb, 'sheet').find((s) => s.getAttribute('name') === 'Metadata');
  if (metaSheet) {
    const mrel = Array.from(parse(relsXml).getElementsByTagName('Relationship'))
      .find((x) => x.getAttribute('Id') === (metaSheet.getAttributeNS(REL_NS, 'id') || metaSheet.getAttribute('r:id')));
    const mxml = mrel ? await read(zipPath(mrel.getAttribute('Target') || '')) : undefined;
    if (mxml) {
      const mc = readCells(parse(mxml), shared);
      const unit = (label: string) => {
        const lab = mc.find((c) => c.col === 1 && c.text === label);
        return lab ? mc.find((c) => c.row === lab.row && c.col === 2)?.text : undefined;
      };
      const w = unit('Weight unit'), l = unit('Length unit');
      if ((w && w !== 'kg') || (l && l !== 'cm')) {
        return { ok: false, error: `This file wants weights in ${w} and sizes in ${l} — we only fill kg and cm.` };
      }
    }
  }

  const sheet = parse(sheetXml);
  if (sheet.getElementsByTagName('parsererror').length) return { ok: false, error: 'Couldn’t read the box packing sheet.' };
  const cells = readCells(sheet, shared);
  const at = (row: number, col: number) => cells.find((c) => c.row === row && c.col === col);

  // Layout, by label.
  const header = cells.find((c) => c.col === 1 && c.text === 'SKU');
  if (!header) return { ok: false, error: 'Couldn’t find the SKU table in the file.' };
  const headerCol = (name: string) => cells.find((c) => c.row === header.row && c.text === name)?.col;
  const fnskuCol = headerCol('FNSKU');
  const expectedCol = headerCol('Expected quantity');
  const boxCols = new Map<number, number>();   // Amazon box number -> column
  for (const c of cells) {
    if (c.row !== header.row) continue;
    const m = /"Box (\d+) quantity"/.exec(c.formula) || /^Box (\d+) quantity$/.exec(c.text);
    if (m) boxCols.set(Number(m[1]), c.col);
  }
  const labelRow = (re: RegExp) => cells.find((c) => c.col === 1 && c.row > header.row && re.test(c.text))?.row;
  const dimRows = {
    weight: labelRow(/^Box weight/i), width: labelRow(/^Box width/i), length: labelRow(/^Box length/i), height: labelRow(/^Box height/i),
  };
  const countLabel = cells.find((c) => /^Total box count/i.test(c.text));
  const countCell = countLabel ? cells.filter((c) => c.row === countLabel.row && c.col > countLabel.col && c.num !== null)
    .sort((a, b) => a.col - b.col)[0] : undefined;
  if (!fnskuCol || !expectedCol || boxCols.size === 0 || !countCell || Object.values(dimRows).some((r) => !r)) {
    return { ok: false, error: 'This doesn’t look like Amazon’s box contents template — some of its columns or rows are missing.' };
  }

  // SKU rows: from under the header down to the first blank column A.
  const skuRows: { row: number; sku: string; fnsku: string; expected: number }[] = [];
  for (let r = header.row + 1; ; r++) {
    const sku = at(r, 1)?.text || '';
    if (!sku) break;
    skuRows.push({ row: r, sku, fnsku: at(r, fnskuCol)?.text || '', expected: at(r, expectedCol)?.num ?? 0 });
  }
  if (skuRows.length === 0) return { ok: false, error: 'The file has no SKUs in it.' };

  // Our boxes, empties dropped, in order -> Amazon Box 1..n.
  const packed = [...ourBoxes].sort((a, b) => a.id - b.id).filter((b) => b.lines.some((l) => l.qty > 0));
  const n = packed.length;
  if (n === 0) return { ok: false, error: 'There are no packed boxes to put in the file.' };
  const usable = [...boxCols.keys()].filter((k) => k <= n);
  if (usable.length < n) {
    return {
      ok: false,
      error: `We have ${n} boxes but this file only has columns for ${boxCols.size}. In Send to Amazon set the box count to about ${n} and download the file again.`,
    };
  }
  const estimate = countCell.num ?? 0;
  if (Math.abs(n - estimate) > BOX_COUNT_SLACK) {
    warnings.push(`Amazon’s file was made for ${estimate} boxes and we have ${n} — Amazon only accepts a change of up to ${BOX_COUNT_SLACK}, so it may refuse this file.`);
  }
  const moved = packed.filter((b, i) => b.id !== i + 1);
  if (moved.length) {
    warnings.push(`Empty boxes were left out, so: ${moved.map((b) => `our Box ${b.id} is P1 - B${packed.indexOf(b) + 1}`).join(', ')}.`);
  }

  // Match each boxed line to a file row: Amazon SKU first, FNSKU if the SKU doesn't match.
  const rowFor = (l: UploadBoxLine) => skuRows.find((s) => l.sku && s.sku === l.sku) ?? skuRows.find((s) => l.fnsku && s.fnsku === l.fnsku);
  const qty = new Map<number, number[]>(skuRows.map((s) => [s.row, Array(n).fill(0)]));
  const notInFile = new Map<string, number>();
  packed.forEach((b, i) => {
    for (const l of b.lines) {
      if (l.qty <= 0) continue;
      const s = rowFor(l);
      if (s) qty.get(s.row)![i] += l.qty;
      else { const k = l.sku || l.code; notInFile.set(k, (notInFile.get(k) || 0) + l.qty); }
    }
  });
  if (notInFile.size) {
    warnings.push(`Boxed but not in Amazon’s file (left out — they aren’t in this shipment plan): ${[...notInFile].map(([k, q]) => `${k} ×${q}`).join(', ')}.`);
  }
  const off = skuRows
    .map((s) => ({ s, boxed: qty.get(s.row)!.reduce((a, v) => a + v, 0) }))
    .filter((x) => x.boxed !== x.s.expected);
  if (off.length) {
    warnings.push(`Boxed quantity doesn’t match Amazon’s expected for ${off.length} ${off.length === 1 ? 'SKU' : 'SKUs'}: `
      + `${off.map((x) => `${x.s.sku} ${x.boxed} of ${x.s.expected}`).join(', ')}.`);
  }
  const noSize = packed.map((b, i) => ({ b, i })).filter(({ b }) => (['weight', 'width', 'length', 'height'] as const).some((k) => dimNum(b.dims[k]) === null));
  if (noSize.length) {
    warnings.push(`Missing measurements on ${noSize.map(({ b }) => `Box ${b.id}`).join(', ')} — Amazon needs all four for every box.`);
  }

  // Write: box count, quantities, measurements. Box columns past n are cleared, so a re-used file can't keep stale numbers.
  setNumber(sheet, countCell.col, countCell.row, n);
  for (const [box, col] of boxCols) {
    const i = box - 1;
    const inUse = i < n;
    for (const s of skuRows) setNumber(sheet, col, s.row, inUse ? qty.get(s.row)![i] : null);
    for (const k of ['weight', 'width', 'length', 'height'] as const) {
      setNumber(sheet, col, dimRows[k]!, inUse ? dimNum(packed[i].dims[k]) : null);
    }
  }
  zip.file(sheetPath, serialize(sheet));

  // Ask Excel to recalculate on open, so its own "Boxed quantity" / box-name formulas show the filled values.
  if (!kids(wb, 'calcPr').length) {
    const calc = wb.createElementNS(NS, 'calcPr');
    calc.setAttribute('fullCalcOnLoad', '1');
    const root = wb.documentElement;
    const after = ['sheets', 'functionGroups', 'externalReferences', 'definedNames']
      .map((t) => kids(wb, t)[0]).filter(Boolean).pop();
    root.insertBefore(calc, after ? after.nextSibling : null);
    zip.file('xl/workbook.xml', serialize(wb));
  }

  const blob = await zip.generateAsync({
    type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const units = [...qty.values()].flat().reduce((a, v) => a + v, 0);
  return { ok: true, blob, fileName: file.name.replace(/\.xlsx$/i, '') + '-filled.xlsx', boxes: n, units, warnings };
}
