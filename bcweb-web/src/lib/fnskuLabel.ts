/*
=======================================================================================================================================
FNSKU label — print one Amazon label from the browser
=======================================================================================================================================
AMZ Shipment and Goods In print one of these per Amazon unit: the FNSKU barcode, the FNSKU under it (as the barcode folder's
`<FNSKU>.bmp` images have it), and the product CODE under that (skumap.code — owner, 2026-10-08: "add the code under it"). Printed on
the Dymo LabelWriter's 54 × 25 mm label (11352 / 30336 size). MEASURED, not taken from the paper name: a ruler printed on an 89 mm page
(2026-10-07) ran across two labels with the gap at ~55 mm. The driver's paper must be a 54 mm one too — on a longer paper (e.g. 30252
Address, 89 mm) Chrome centres the 54 mm page on it and the label lands ~17 mm along, cut off.

THE BARS ARE THE FOLDER IMAGE'S BARS AT ¾ SIZE — 3 PRINTER DOTS A MODULE, NOT 4 (2026-11-02). From 2026-10-08 the label WAS the folder
image, printed 1:1: 4-dot modules, so a 10-character FNSKU's 145 modules were 49 mm of bars on a 54 mm label whose printable span is
~50 mm, with Code 128 wanting ~3.4 mm of blank beyond each end. It didn't fit: the start of the barcode was clipped at the label's
edge and nothing could read it (photographed 2026-11-02 — off-centre, ~2 mm blank one end, ~6 mm the other; no scanner read it,
through QZ Tray or Chrome). Shrinking the image would resample the bars unevenly (that stopped the very first label scanning), so the
same bars are DRAWN from the FNSKU (barcode128.ts → code128bModules, the generator that writes the folder files — bit-for-bit the
same pattern) at 3 dots: 145 modules = 36.8 mm, ~8.6 mm blank each side, room for the label to sit a couple of mm off. Every bar
edge lands on a whole printer dot.

BARS THINNED FOR THE PRINTER'S HEAT — BY 1 DOT (tested 2026-11-02). A thermal head spreads each bar wider than drawn, closing the
gaps; each bar is drawn BAR_REDUCTION_DOTS narrower on its right (its gap that much wider). Test strip (see TEST STRIP below) on the
office Dymo, scanned into Notepad with the warehouse handheld: 0 dots needed 1-2 scans, 1 dot mostly read first time, 2 dots up to
5-6 scans (2 left the narrowest bar ONE dot wide — a hairline). The PowerBuilder-era folder BMP that scanned well had no thinning.
If a printer prints bars merged, raise it; faint or broken, lower it — and re-run the test strip on that printer first.

HOW IT PRINTS. Through QZ Tray first (labelPrinter.ts, 2026-10-29), silently, to the Dymo. If QZ Tray isn't running or there's no
Dymo, the old way (docs/label-printing-notes.md): a web page can't talk to the printer directly, so the label is an image on a page
exactly the label's size, in a hidden iframe, and that iframe is printed. On the packing PC Chrome runs from a shortcut with
--kiosk-printing, which skips the dialog and sends it straight to the default printer. Anywhere else the normal print dialog appears.

QZ TRAY GETS WHAT CHROME GETS. The same 25 × 54 mm page with the canvas filling it, as a PDF with NO density, so the driver prints at
its own setting. Not a PNG image job: that needs a density, which forced the Dymo to 300 × 300 — its "Text" quality, grey streaky
bars — (and 300 × 600 garbled the label); and an image job is drawn from the driver's printable-area corner, ~2 mm in.

PORTRAIT PAGE, ROTATED DRAWING. The Dymo driver's pages are PORTRAIT — the label's height across the head, its length along the feed.
So the page is sent in the driver's own orientation, 25 × 54, and the label is drawn turned 90° on it: nothing for Chrome or the
driver to rotate. If labels ever come out upside down, flip ROTATE_CLOCKWISE.
=======================================================================================================================================
*/

import { code128bModules } from './barcode128';
import { printLabel } from './labelPrinter';

export const LABEL_MM = { width: 54, height: 25 } as const;
// The Dymo LabelWriter head is 300 dpi; the page canvas is the label in its dots.
const dots = (mm: number) => Math.round((mm * 300) / 25.4);
const LABEL_DOTS = { width: dots(LABEL_MM.width), height: dots(LABEL_MM.height) } as const;
// Printer dots per barcode module, and dots trimmed off the right of every bar — see THE BARS and BARS THINNED above.
const MODULE_DOTS = 3;
const BAR_REDUCTION_DOTS = 1;
// Kept clear of ink at the label's top and bottom edges.
const MARGIN_DOTS = dots(1);
// The two text lines under the bars (FNSKU, then code): their size, the gap above each, and the widest before the font shrinks.
const TEXT_SIZE_DOTS = dots(2.6);
const TEXT_GAP_DOTS = dots(0.5);
const TEXT_MAX_WIDTH_DOTS = LABEL_DOTS.width - 2 * MARGIN_DOTS;
const FONT = 'Arial, Helvetica, sans-serif';
// Which way the label is turned on the portrait page — decides only whether the text reads upright on the roll.
const ROTATE_CLOCKWISE = true;
// The page as the driver sees it: portrait, the label's height across the head and its width along the feed.
const PAGE_MM = { width: LABEL_MM.height, height: LABEL_MM.width } as const;

/** The label page as a canvas: the FNSKU's bars centred on the label, the FNSKU and `code` under them, all turned onto the portrait
 *  page. Throws if the FNSKU can't be encoded (never, for a real one). */
function labelCanvas(fnsku: string, code: string, reduction = BAR_REDUCTION_DOTS): HTMLCanvasElement {
  const modules = code128bModules(fnsku);
  const lines = [fnsku, code].filter(Boolean);
  const textBand = lines.length * (TEXT_GAP_DOTS + TEXT_SIZE_DOTS);
  const barsH = LABEL_DOTS.height - 2 * MARGIN_DOTS - textBand;
  const left = Math.round((LABEL_DOTS.width - modules.length * MODULE_DOTS) / 2);
  const top = MARGIN_DOTS;

  const canvas = document.createElement('canvas');
  canvas.width = LABEL_DOTS.height;
  canvas.height = LABEL_DOTS.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Label (x along, y down) → portrait page. Clockwise: label top lands on the page's right edge; anticlockwise: on its left.
  if (ROTATE_CLOCKWISE) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
  else { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }

  // One rectangle per run of bar modules, in whole dots, trimmed on the right by the bar-width reduction (never below one dot).
  ctx.fillStyle = '#000000';
  for (let i = 0; i < modules.length;) {
    if (modules[i] !== '1') { i += 1; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1') j += 1;
    ctx.fillRect(left + i * MODULE_DOTS, top, Math.max(1, (j - i) * MODULE_DOTS - reduction), barsH);
    i = j;
  }

  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  let lineTop = top + barsH;
  for (const line of lines) {
    ctx.font = `${TEXT_SIZE_DOTS}px ${FONT}`;
    const width = ctx.measureText(line).width;
    if (width > TEXT_MAX_WIDTH_DOTS) ctx.font = `${Math.floor((TEXT_SIZE_DOTS * TEXT_MAX_WIDTH_DOTS) / width)}px ${FONT}`;
    // Baseline at ~0.75 em below the line's top: Arial's caps sit there, and FNSKUs and codes are capitals, digits and hyphens.
    ctx.fillText(line, LABEL_DOTS.width / 2, lineTop + TEXT_GAP_DOTS + Math.round(TEXT_SIZE_DOTS * 0.75));
    lineTop += TEXT_GAP_DOTS + TEXT_SIZE_DOTS;
  }
  return canvas;
}

/** The page as a one-page PDF (base64), for QZ Tray: 25 × 54 mm, the whole canvas filling it (see QZ TRAY above).
 *  The canvas goes in DOUBLED (each pixel 2 × 2, no smoothing) — 600 dpi. In "Barcodes and Graphics" the Dymo prints 600 dpi along
 *  the feed, the bars' width direction; at 600 every bar edge falls on a printer dot whether the driver prints 300 or 600, so
 *  nothing is stretched with smoothing (grey bar edges burn black and thicken the bars). Chrome scales it pixelated, the same. */
async function pagePdf(page: HTMLCanvasElement): Promise<string> {
  const doubled = document.createElement('canvas');
  doubled.width = page.width * 2;
  doubled.height = page.height * 2;
  const ctx = doubled.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(page, 0, 0, doubled.width, doubled.height);

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ unit: 'mm', format: [PAGE_MM.width, PAGE_MM.height], orientation: 'portrait' });
  // FAST = lossless flate, so the PDF stays small at the doubled size.
  pdf.addImage(doubled, 'PNG', 0, 0, PAGE_MM.width, PAGE_MM.height, undefined, 'FAST');
  return pdf.output('datauristring').split(',')[1];
}

/**
 * Print one label. Fire-and-forget: the iframe removes itself once the print has been handed off. Several scans in quick succession
 * each get their own iframe, so labels never overwrite each other. Failures are silent (the label just doesn't print) — the scan
 * itself has already succeeded and must not be held up.
 * `onDone` runs once print() has returned — printing focuses the iframe, so the caller uses it to put focus back on its scan field
 * (otherwise the scanner's next code would be typed into nothing).
 */
export function printFnskuLabel(fnsku: string, code: string, onDone?: () => void): void {
  void printOne(fnsku, code, BAR_REDUCTION_DOTS, onDone);
}

/**
 * TEST STRIP (2026-11-02, kept for checking any printer): Shift+click a row's printer icon on AMZ Shipment
 * prints the same label three times, its bars thinned 0, 1 and 2 dots, each marked T0 / T1 / T2 after the code. Scan each ~10 times
 * on each printer; the one that reads first time everywhere sets BAR_REDUCTION_DOTS (1, office Dymo, 2026-11-02). The folder BMP that scanned well under
 * PowerBuilder (X002891WM9.bmp) had NO thinning — bars and gaps at their true widths.
 */
export function printFnskuTestStrip(fnsku: string, code: string, onDone?: () => void): void {
  void (async () => {
    for (const reduction of [0, 1, 2]) await printOne(fnsku, `${code}  T${reduction}`, reduction);
    onDone?.();
  })();
}

/**
 * TEMP (2026-11-02): every label for a stored box, one after another, sorted by code — to relabel the boxes scanned before the 1-dot
 * thinning (the "Print all labels" button on a stored box on AMZ Shipment). Remove with the button once those boxes are redone.
 */
export async function printFnskuLabels(labels: { fnsku: string; code: string }[]): Promise<void> {
  for (const l of labels) await printOne(l.fnsku, l.code, BAR_REDUCTION_DOTS);
}

async function printOne(fnsku: string, code: string, reduction: number, onDone?: () => void): Promise<void> {
  {
    let url: string;
    try {
      const canvas = labelCanvas(fnsku, code, reduction);
      // QZ Tray takes the same page as a one-page PDF; if it prints, that's the label done.
      if (await printLabel('fnsku', await pagePdf(canvas))) { onDone?.(); return; }
      const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
      if (!png) return;
      url = URL.createObjectURL(png);
    } catch {
      return;
    }

    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    // Off-screen rather than display:none — some browsers won't print a frame that isn't laid out.
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:30mm;height:60mm;border:0;';
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    const win = frame.contentWindow;
    if (!doc || !win) { frame.remove(); URL.revokeObjectURL(url); return; }
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title></title><style>
      @page { size: ${PAGE_MM.width}mm ${PAGE_MM.height}mm; margin: 0; }
      /* The page box, whatever size the driver made it: the image fills it. Just under 100vh so a rounding sliver never spills onto
         a second (blank) label. */
      html, body { margin: 0; padding: 0; background: #fff; width: 100vw; height: 99vh; overflow: hidden; }
      img { display: block; width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated; }
    </style></head><body><img alt="" src="${url}"></body></html>`);
    doc.close();

    // Print only once the image has decoded, or the label comes out blank. print() blocks until the dialog closes (or returns at once
    // under --kiosk-printing). Removal is deferred so Chrome has finished spooling.
    const img = doc.querySelector('img');
    if (img) await img.decode().catch(() => undefined);
    try { win.focus(); win.print(); } finally {
      onDone?.();
      setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 1000);
    }
  }
}
