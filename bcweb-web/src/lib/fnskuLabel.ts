/*
=======================================================================================================================================
FNSKU label — print one Amazon label from the browser
=======================================================================================================================================
AMZ Shipment and Goods In print one of these per Amazon unit. The label IS THE FNSKU'S IMAGE FROM THE BARCODE FOLDER — `<FNSKU>.bmp`,
the same file the old system printed (owner, 2026-10-08: "all we want is to print the image from the fnsku folder"). Until then the
label was drawn here (barcode + FNSKU + Amazon SKU); that is gone, so the label carries what the folder image carries: the bars and
the FNSKU caption, no SKU. Printed on the Dymo LabelWriter's 54 × 25 mm label (11352 / 30336 size). MEASURED, not taken from the paper
name: a ruler printed on an 89 mm page (2026-10-07) ran across two labels with the gap at ~55 mm. The driver's paper must be a 54 mm
one too — on a longer paper (e.g. 30252 Address, 89 mm) Chrome centres the 54 mm page on it and the label lands ~17 mm along, cut off.

WHERE THE IMAGE COMES FROM. The folder is the one Update Amazon's barcode panel keeps (barcodeFolder.ts — a Drive folder synced onto
the PC, reached through the browser's File System Access handle). Reading it needs the folder's permission for this browser session,
which Chrome only grants from a click (Update Amazon's panel, or "Allow on every visit"); a scan can't ask for it. So if the folder
isn't granted, or the file isn't in it yet, the label is the same image built on the spot (barcode128.ts → fnskuBarcodeBmp — the
generator that writes the folder's files, bars verified bit-for-bit against them). Either way the printed label is the folder image.

PRINTED AT ITS OWN PIXELS. The current folder files are 300 dpi — the Dymo head's resolution — with 4-pixel modules. The image is
trimmed to its ink (the files have a 129 px blank right margin and no left one, which would put the bars off-centre and too wide for
54 mm), then placed on a page canvas of exactly the label's size in printer dots at a WHOLE-NUMBER scale (1 for the 300 dpi files; the
2017-style 96 dpi files with 1 px modules come out at 3), centred. So every bar is a whole number of dots and nothing is resampled —
the first label version stretched bars to 2.6 dots a module and the uneven rounding stopped it scanning (2026-10-08). The page is
shown with image-rendering: pixelated for the same reason. Note there is no thermal bar-width reduction any more (the file's bars are
full width); at 4 dots a module the spread matters less than it did at 3, but if scans fail, that's where to look.

HOW IT PRINTS (docs/label-printing-notes.md). A web page can't talk to the printer directly, so the label is an image on a page exactly
the label's size, in a hidden iframe, and that iframe is printed. On the packing PC Chrome runs from a shortcut with --kiosk-printing,
which skips the dialog and sends it straight to the default printer. Anywhere else the normal print dialog appears.

PORTRAIT PAGE, ROTATED DRAWING. The Dymo driver's pages are PORTRAIT — the label's height across the head, its length along the feed.
So the page is sent in the driver's own orientation, 25 × 54, and the image is drawn turned 90° on it: nothing for Chrome or the
driver to rotate. If labels ever come out upside down, flip ROTATE_CLOCKWISE.
=======================================================================================================================================
*/

import { fnskuBarcodeBmp } from './barcode128';
import { ensureFolderPermission, savedBarcodeFolder } from './barcodeFolder';

export const LABEL_MM = { width: 54, height: 25 } as const;
// The Dymo LabelWriter head is 300 dpi; the page canvas is the label in its dots.
const dots = (mm: number) => Math.round((mm * 300) / 25.4);
const LABEL_DOTS = { width: dots(LABEL_MM.width), height: dots(LABEL_MM.height) } as const;
// Kept clear of ink at each end and edge, so the image never touches the label's edge.
const MARGIN_DOTS = dots(1);
// Which way the label is turned on the portrait page — decides only whether the caption reads upright on the roll.
const ROTATE_CLOCKWISE = true;
// The page as the driver sees it: portrait, the label's height across the head and its width along the feed.
const PAGE_MM = { width: LABEL_MM.height, height: LABEL_MM.width } as const;

/** `<FNSKU>.bmp` from the barcode folder, or null if the folder isn't set up / granted this session or the file isn't there. Never
 *  prompts — a scan isn't a click, so Chrome wouldn't allow it. */
async function folderImage(fnsku: string): Promise<Blob | null> {
  try {
    const folder = await savedBarcodeFolder();
    if (!folder || !(await ensureFolderPermission(folder, false))) return null;
    // Exact name first (the usual case), then a case-insensitive look — Windows treats x000q6arld.bmp as the same file.
    try { return await (await folder.getFileHandle(`${fnsku}.bmp`)).getFile(); } catch { /* not under that exact name */ }
    const wanted = `${fnsku}.bmp`.toUpperCase();
    const entries = (folder as unknown as { values?(): AsyncIterableIterator<FileSystemHandle> }).values?.();
    if (!entries) return null;
    for await (const entry of entries) {
      if (entry.kind === 'file' && entry.name.toUpperCase() === wanted) return await (entry as FileSystemFileHandle).getFile();
    }
    return null;
  } catch {
    return null;
  }
}

/** The image's inked area: the smallest box holding every dark pixel. */
function inkBox(bitmap: ImageBitmap): { x: number; y: number; w: number; h: number } {
  const c = document.createElement('canvas');
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.drawImage(bitmap, 0, 0);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let minX = c.width; let minY = c.height; let maxX = -1; let maxY = -1;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 4;
      if (px[i] + px[i + 1] + px[i + 2] < 384) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return { x: 0, y: 0, w: c.width, h: c.height }; // blank image — print it as it is
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

/** The label page as a canvas: the barcode image trimmed to its ink, at a whole-number scale, centred, turned onto the portrait page. */
async function labelCanvas(image: Blob): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(image);
  const box = inkBox(bitmap);
  const fitW = (LABEL_DOTS.width - 2 * MARGIN_DOTS) / box.w;
  const fitH = (LABEL_DOTS.height - 2 * MARGIN_DOTS) / box.h;
  // Whole-number scale so each image pixel is a whole number of dots. An image too big at 1:1 is shrunk to fit as a last resort.
  const fit = Math.min(fitW, fitH);
  const scale = fit >= 1 ? Math.floor(fit) : fit;
  const w = Math.round(box.w * scale);
  const h = Math.round(box.h * scale);

  const canvas = document.createElement('canvas');
  canvas.width = LABEL_DOTS.height;
  canvas.height = LABEL_DOTS.width;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.imageSmoothingEnabled = false;

  // Label (x along, y down) → portrait page. Clockwise: label top lands on the page's right edge; anticlockwise: on its left.
  if (ROTATE_CLOCKWISE) { ctx.translate(canvas.width, 0); ctx.rotate(Math.PI / 2); }
  else { ctx.translate(0, canvas.height); ctx.rotate(-Math.PI / 2); }
  ctx.drawImage(bitmap, box.x, box.y, box.w, box.h,
    Math.round((LABEL_DOTS.width - w) / 2), Math.round((LABEL_DOTS.height - h) / 2), w, h);
  bitmap.close();
  return canvas;
}

/**
 * Print one label. Fire-and-forget: the iframe removes itself once the print has been handed off. Several scans in quick succession
 * each get their own iframe, so labels never overwrite each other. Failures are silent (the label just doesn't print) — the scan
 * itself has already succeeded and must not be held up.
 * `onDone` runs once print() has returned — printing focuses the iframe, so the caller uses it to put focus back on its scan field
 * (otherwise the scanner's next code would be typed into nothing).
 */
export function printFnskuLabel(fnsku: string, onDone?: () => void): void {
  void (async () => {
    let url: string;
    try {
      const image = (await folderImage(fnsku)) ?? fnskuBarcodeBmp(fnsku);
      const canvas = await labelCanvas(image);
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
  })();
}
