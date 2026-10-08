/*
=======================================================================================================================================
FNSKU label — print one Amazon label from the browser
=======================================================================================================================================
AMZ Shipment and Goods In print one of these per Amazon unit. The label is the Code 128 barcode of the FNSKU with two lines under
it: the FNSKU text, then the Amazon SKU — nothing else (owner: SKU added 2026-10-07, replacing the FNSKU text; FNSKU text back above
it 2026-10-08) — on the Dymo LabelWriter's 54 × 25 mm label
(11352 / 30336 size). MEASURED, not taken from the paper name: a ruler printed on an 89 mm page (2026-10-07) ran across two labels
with the gap at ~55 mm. The driver's paper must be a 54 mm one too — on a longer paper (e.g. 30252 Address, 89 mm) Chrome centres
the 54 mm page on it and the label lands ~17 mm along, cut off at one end.

HOW IT PRINTS (docs/label-printing-notes.md). A web page can't talk to the printer directly, so the label is drawn as an SVG in mm on a
page exactly the label's size, in a hidden iframe, and that iframe is printed. On the packing PC Chrome runs from a shortcut with
--kiosk-printing, which skips the dialog and sends it straight to the default printer (the label printer, its paper size set to the
label stock in the driver). Anywhere else the normal print dialog appears — still correct, just not silent.

GEOMETRY. The content is drawn centred, well inside the label: bars 13 mm tall (were 10 — taller reads at more angles; 14 until the FNSKU line came back) with the FNSKU and SKU under them. The bars are sized in
PRINTER DOTS, not stretched to a width: every module is exactly MODULE_DOTS of the Dymo's 300 dpi head (3 dots = 0.254 mm, so a
10-char FNSKU's 145 modules are ~36.8 mm, ~8.6 mm quiet zone each side; Code 128 needs 10 modules). The first version scaled the bars
to 32 mm — 2.6 dots a module — so the driver rounded each bar and gap to 2 or 3 dots unevenly, and with thermal spread the narrow
gaps closed up: printed dark and crowded, wouldn't scan (2026-10-08). Each bar is also drawn BAR_REDUCTION_DOTS (2 — 1 still printed merged, 2026-10-08) narrower than its
modules (gaps that much wider) to cancel the spread — the usual thermal bar-width reduction. If scans still fail, that's the knob. The SVG is sized to FILL THE
PRINTED PAGE (viewBox + "meet"), not pinned in mm — the first version was pinned at 50 × 25 mm and printed enlarged and cut off at the
left when the driver's page didn't match, so now whatever page size the printer reports, the label scales into it and stays centred.
A long SKU or FNSKU shrinks its font to stay inside the label rather than run off the edge.

PORTRAIT PAGE, ROTATED DRAWING. The Dymo driver's pages are PORTRAIT — the label's height across the head, its length along
the feed. So the page is sent in the driver's own orientation, 25 × 54, and the label is drawn turned 90° on it: nothing for Chrome
or the driver to rotate. If labels ever come out upside down, flip
ROTATE_CLOCKWISE. The bars come from the same encoder as
the barcode-folder images (barcode128.ts), which is verified bit-for-bit against the legacy files.
=======================================================================================================================================
*/

import { code128bModules } from './barcode128';

export const LABEL_MM = { width: 54, height: 25 } as const;
// The Dymo LabelWriter head is 300 dpi. Module and bar sizes are whole dots so the driver never has to round a bar.
const DOT_MM = 25.4 / 300;
const MODULE_DOTS = 3;
const BAR_REDUCTION_DOTS = 2;
const BAR_TOP_MM = 2;
const BAR_HEIGHT_MM = 13;
const FNSKU_BASELINE_MM = 18.2;
const SKU_BASELINE_MM = 21.9;
const TEXT_SIZE_MM = 2.9;
const TEXT_MAX_WIDTH_MM = 40;
// Arial's average glyph is ~0.6 em wide for codes (capitals and digits) — near enough to decide when to shrink.
const GLYPH_EM = 0.6;
// Which way the label is turned on the portrait page — decides only whether the text reads upright on the roll.
const ROTATE_CLOCKWISE = true;
// The page as the driver sees it: portrait, the label's height across the head and its width along the feed.
const PAGE_MM = { width: LABEL_MM.height, height: LABEL_MM.width } as const;

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The label as standalone SVG markup, drawn in label mm and turned onto the portrait page: the FNSKU's barcode over the FNSKU text and the Amazon `sku`. Throws if the FNSKU can't be
 *  encoded (never, for a real FNSKU). */
export function fnskuLabelSvg(fnsku: string, sku: string): string {
  const modules = code128bModules(fnsku);
  const moduleMm = MODULE_DOTS * DOT_MM;
  // Centred, then snapped to a whole dot so every bar edge lands on a dot boundary.
  const left = Math.round((LABEL_MM.width - modules.length * moduleMm) / 2 / DOT_MM) * DOT_MM;
  const reductionMm = BAR_REDUCTION_DOTS * DOT_MM;

  // One rect per run of bar modules, not per module — fewer shapes and no hairline gaps between neighbours. Trimmed on the right
  // by the bar-width reduction.
  const rects: string[] = [];
  for (let i = 0; i < modules.length;) {
    if (modules[i] !== '1') { i += 1; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1') j += 1;
    rects.push(`<rect x="${(left + i * moduleMm).toFixed(3)}" y="${BAR_TOP_MM}" width="${((j - i) * moduleMm - reductionMm).toFixed(3)}" height="${BAR_HEIGHT_MM}"/>`);
    i = j;
  }

  const textSize = (s: string) => Math.min(TEXT_SIZE_MM, TEXT_MAX_WIDTH_MM / Math.max(1, s.length * GLYPH_EM));
  const textLine = (s: string, baseline: number) =>
    `<text x="${LABEL_MM.width / 2}" y="${baseline}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" `
    + `font-size="${textSize(s).toFixed(2)}" fill="#000">${escapeXml(s)}</text>`;

  // Label (x along, y down) → portrait page. Clockwise: label top lands on the page's right edge; anticlockwise: on its left.
  const turn = ROTATE_CLOCKWISE
    ? `translate(${PAGE_MM.width} 0) rotate(90)`
    : `translate(0 ${PAGE_MM.height}) rotate(-90)`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" `
    + `viewBox="0 0 ${PAGE_MM.width} ${PAGE_MM.height}" shape-rendering="crispEdges"><g transform="${turn}">`
    + `<g fill="#000">${rects.join('')}</g>`
    + textLine(fnsku, FNSKU_BASELINE_MM)
    + textLine(sku, SKU_BASELINE_MM)
    + `</g></svg>`;
}

/**
 * Print one label. Fire-and-forget: the iframe removes itself once the print has been handed off. Several scans in quick succession
 * each get their own iframe, so labels never overwrite each other. Returns false only if the label couldn't be built.
 * `onDone` runs once print() has returned — printing focuses the iframe, so the caller uses it to put focus back on its scan field
 * (otherwise the scanner's next code would be typed into nothing).
 */
export function printFnskuLabel(fnsku: string, sku: string, onDone?: () => void): boolean {
  let svg: string;
  try { svg = fnskuLabelSvg(fnsku, sku); } catch { return false; }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off-screen rather than display:none — some browsers won't print a frame that isn't laid out.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:30mm;height:60mm;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return false; }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>
    @page { size: ${PAGE_MM.width}mm ${PAGE_MM.height}mm; margin: 0; }
    /* The page box, whatever size the driver made it: the SVG fills it and centres the label. Just under 100vh so a rounding
       sliver never spills onto a second (blank) label. */
    html, body { margin: 0; padding: 0; background: #fff; width: 100vw; height: 99vh; overflow: hidden; }
    svg { display: block; width: 100%; height: 100%; }
  </style></head><body>${svg}</body></html>`);
  doc.close();

  // print() blocks until the dialog closes (or returns at once under --kiosk-printing); either way the frame is done after it.
  // Removal is deferred so Chrome has finished spooling, and focus goes back to the scan field's page.
  setTimeout(() => {
    try { win.focus(); win.print(); } finally {
      onDone?.();
      setTimeout(() => frame.remove(), 1000);
    }
  }, 50);
  return true;
}
