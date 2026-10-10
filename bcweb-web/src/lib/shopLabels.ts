/*
=======================================================================================================================================
Shop price labels — the A4 PDF for an Avery L7160 sheet
=======================================================================================================================================
The Shop Labels screen (/shop-labels) prints the price stickers for the shoes on the shop floor (CM3). One label = the GROUPID at the
top (only so staff can see the right price is on the right shoe — owner, 2026-10-10) and the price under it, large.

THE PRICE. RRP — the shop charges RRP (docs/cm3-shop-plan.md §4.3). With the screen's "RRP + sale" switch on, a style whose WEBSITE
price (skusummary.shopifyprice) is under its RRP prints the RRP struck through and the website price under it (owner, 2026-10-10:
"The website price is the correct price"). A style at or over RRP prints RRP alone either way.

THE SHEET (Avery L7160): A4, 3 across × 7 down = 21 labels of 63.5 × 38.1 mm, 2.5 mm between columns, none between rows. The margins
fall out of those: (210 − 3×63.5 − 2×2.5) / 2 = 7.25 mm each side, (297 − 7×38.1) / 2 = 15.15 mm top and bottom. Positions are in
mm in the PDF, so a sheet lines up only if it's printed at ACTUAL SIZE — "fit to page" shrinks it ~3% and the labels creep.

MADE IN THE BROWSER with jsPDF (loaded only when the button is pressed, so the page itself stays light). Nothing goes to the server.
=======================================================================================================================================
*/

export const SHEET = {
  pageW: 210,
  pageH: 297,
  cols: 3,
  rows: 7,
  labelW: 63.5,
  labelH: 38.1,
  left: 7.25,
  top: 15.15,
  colGap: 2.5,
} as const;

export const LABELS_PER_SHEET = SHEET.cols * SHEET.rows;

// One label to print. `was` set = on sale: `was` (the RRP) struck through, `price` the current price.
export interface PrintLabel { groupid: string; price: number; was: number | null }

const PT = 25.4 / 72;            // one point in mm
const SIDE_PAD = 3;              // ink kept this far in from the label's left and right edges
const MAX_TEXT_W = SHEET.labelW - 2 * SIDE_PAD;

export const money = (v: number) => `£${v.toFixed(2)}`;

/** The labels to print for a list row, given the price switch. null = the style has no usable price (blank/junk RRP and website). */
export function labelFor(groupid: string, rrp: number | null, websitePrice: number | null, withSale: boolean): PrintLabel | null {
  if (rrp === null) return websitePrice === null ? null : { groupid, price: websitePrice, was: null };
  if (withSale && websitePrice !== null && websitePrice < rrp) return { groupid, price: websitePrice, was: rrp };
  return { groupid, price: rrp, was: null };
}

/** Builds the PDF and downloads it. `startAt` (1–21) skips the labels already used on the first sheet. */
export async function downloadLabelPdf(labels: PrintLabel[], startAt: number) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);

  // Draws text centred on x at baseline y, shrinking the font if it would run past the label's sides.
  const centred = (text: string, x: number, y: number, sizePt: number, bold: boolean) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setFontSize(sizePt);
    const w = doc.getTextWidth(text);
    if (w > MAX_TEXT_W) doc.setFontSize((sizePt * MAX_TEXT_W) / w);
    doc.text(text, x, y, { align: 'center' });
    return Math.min(w, MAX_TEXT_W);
  };

  let slot = Math.min(Math.max(Math.floor(startAt), 1), LABELS_PER_SHEET) - 1;
  labels.forEach((l) => {
    if (slot === LABELS_PER_SHEET) { doc.addPage(); slot = 0; }
    const col = slot % SHEET.cols;
    const row = Math.floor(slot / SHEET.cols);
    const x0 = SHEET.left + col * (SHEET.labelW + SHEET.colGap);
    const y0 = SHEET.top + row * SHEET.labelH;
    const cx = x0 + SHEET.labelW / 2;

    centred(l.groupid, cx, y0 + 9, 12, true);
    if (l.was === null) {
      centred(money(l.price), cx, y0 + 27, 30, true);
    } else {
      const size = 14;
      const w = centred(money(l.was), cx, y0 + 18.5, size, false);
      // The strike: through the middle of the digits (about a third of the font size above the baseline).
      const yLine = y0 + 18.5 - size * PT * 0.33;
      doc.setLineWidth(0.4);
      doc.line(cx - w / 2 - 0.5, yLine, cx + w / 2 + 0.5, yLine);
      centred(money(l.price), cx, y0 + 31.5, 26, true);
    }
    slot++;
  });

  doc.save('shop-labels.pdf');
}
