/*
=======================================================================================================================================
FNSKU label — print one Amazon label from the browser
=======================================================================================================================================
AMZ Shipment prints one of these per good scan (owner, 2026-10-02). The label is the Code 128 barcode of the FNSKU with the FNSKU
written under it — nothing else (owner's choice) — on the 50 × 25 mm thermal stock at the packing bench.

HOW IT PRINTS (docs/label-printing-notes.md). A web page can't talk to the printer directly, so the label is drawn as an SVG in mm on a
page exactly the label's size, in a hidden iframe, and that iframe is printed. On the packing PC Chrome runs from a shortcut with
--kiosk-printing, which skips the dialog and sends it straight to the default printer (the label printer, its paper size set to the
label stock in the driver). Anywhere else the normal print dialog appears — still correct, just not silent.

GEOMETRY. Module width is 0.25 mm: exactly 2 dots on a 203 dpi head and 3 on a 300 dpi one, so every bar lands on whole dots and
nothing is smeared by rounding. A 10-character FNSKU is 145 modules = 36.25 mm, centred on 50 mm, which leaves ~6.9 mm of quiet zone
each side (Code 128 needs 10 modules = 2.5 mm). The bars come from the same encoder as the barcode-folder images (barcode128.ts),
which is verified bit-for-bit against the legacy files.
=======================================================================================================================================
*/

import { code128bModules } from './barcode128';

export const LABEL_MM = { width: 50, height: 25 } as const;
const MODULE_MM = 0.25;
const BAR_TOP_MM = 2.5;
const BAR_HEIGHT_MM = 14;
const TEXT_BASELINE_MM = 21.5;
const TEXT_SIZE_MM = 3.6;

/** The label as standalone SVG markup, sized in mm. Throws if the text can't be encoded (never, for a real FNSKU). */
export function fnskuLabelSvg(fnsku: string): string {
  const modules = code128bModules(fnsku);
  const barsWidth = modules.length * MODULE_MM;
  const left = (LABEL_MM.width - barsWidth) / 2;

  // One rect per run of bar modules, not per module — fewer shapes and no hairline gaps between neighbours.
  const rects: string[] = [];
  for (let i = 0; i < modules.length;) {
    if (modules[i] !== '1') { i += 1; continue; }
    let j = i;
    while (j < modules.length && modules[j] === '1') j += 1;
    rects.push(`<rect x="${(left + i * MODULE_MM).toFixed(3)}" y="${BAR_TOP_MM}" width="${((j - i) * MODULE_MM).toFixed(3)}" height="${BAR_HEIGHT_MM}"/>`);
    i = j;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${LABEL_MM.width}mm" height="${LABEL_MM.height}mm" `
    + `viewBox="0 0 ${LABEL_MM.width} ${LABEL_MM.height}" shape-rendering="crispEdges">`
    + `<g fill="#000">${rects.join('')}</g>`
    + `<text x="${LABEL_MM.width / 2}" y="${TEXT_BASELINE_MM}" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" `
    + `font-size="${TEXT_SIZE_MM}" letter-spacing="0.3" fill="#000">${fnsku}</text>`
    + `</svg>`;
}

/**
 * Print one label. Fire-and-forget: the iframe removes itself once the print has been handed off. Several scans in quick succession
 * each get their own iframe, so labels never overwrite each other. Returns false only if the label couldn't be built.
 * `onDone` runs once print() has returned — printing focuses the iframe, so the caller uses it to put focus back on its scan field
 * (otherwise the scanner's next code would be typed into nothing).
 */
export function printFnskuLabel(fnsku: string, onDone?: () => void): boolean {
  let svg: string;
  try { svg = fnskuLabelSvg(fnsku); } catch { return false; }

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Off-screen rather than display:none — some browsers won't print a frame that isn't laid out.
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:60mm;height:35mm;border:0;';
  document.body.appendChild(frame);

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) { frame.remove(); return false; }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${fnsku}</title><style>
    @page { size: ${LABEL_MM.width}mm ${LABEL_MM.height}mm; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; }
    svg { display: block; }
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
