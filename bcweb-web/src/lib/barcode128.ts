/*
=======================================================================================================================================
Code 128B barcode -> 24bpp BMP, in the browser
=======================================================================================================================================
Generates the FNSKU barcode images for the Update Amazon barcode panel, in the format the barcode folder currently uses.

The format was reverse-engineered pixel by pixel from a CURRENT file (_amz-port/sample-data/X002NE1DDH.bmp, written 2026-07-27):

  - 709 x 260, 24bpp uncompressed BMP (BITMAPINFOHEADER, bottom-up, 54-byte pixel offset), 300 dpi, white ground.
  - Symbology is Code 128 subset B: the first 11 modules decode to 11010010000 = Start B.
  - MODULE WIDTH IS EXACTLY 4 PIXELS, and there is NO LEFT QUIET ZONE — the first bar starts at x=0.
  - Bars occupy y=0..221 (222px tall, hard against the top edge).
  - Caption y=229..252, antialiased, centred on the BAR AREA (x=290) and not on the image.
  - For a 10-character FNSKU the bars are 145 modules = 580px, leaving a 129px right margin: 580 + 129 = 709.

Every FNSKU Amazon issues is 10 characters (verified across all 522 rows of amzfeed), so in practice every file we write is 709 x 260 —
but the width is computed from the code, not hard-coded, so an odd-length code still produces a valid barcode rather than a corrupt one.

TWO SAMPLES, TWO FORMATS. An older file in the same folder (X000Q6ARLD.bmp, 2017) is 161 x 56, 32bpp, 96 dpi, 1px modules — a
different generator entirely, and the reason this file previously targeted the wrong geometry. The 2026 file is the live format and
the one we write. The encoder below was verified to reproduce the bar pattern of BOTH samples bit-for-bit, so the symbology is not in
doubt; only the presentation changed.

The caption is drawn with canvas in Arial, sized to match the sample's ~24px cap height. The owner confirmed 2026-07-29 that the
caption is for a human to read and nothing downstream parses it, so an exact font match is not required. THE BARS ARE WHAT MATTERS
AND THE BARS ARE EXACT.
=======================================================================================================================================
*/

// The 107 Code 128 element patterns, values 0..106. Each digit is a run length, alternating bar, space, bar, space... starting with a
// bar. Values 0..102 are the encodable characters, 103-105 the start codes, 106 the stop (7 elements, the only one that isn't 6).
const CODE128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const STOP = 106;

/** Geometry, all measured off the 2026 sample. */
export const BARCODE_LAYOUT = {
  moduleWidth: 4,        // px per module — the sample's runs are all exact multiples of 4
  rightMargin: 129,      // whitespace after the last bar; with a 10-char code this makes the image 709px, the label template's width
  barTop: 0,             // bars start hard against the top edge — there is no top margin
  barHeight: 222,        // y = 0..221
  height: 260,
  captionBaseline: 253,  // alphabetic baseline; glyph bottoms land on y=252 as in the sample
  captionFont: '33px Arial, Helvetica, sans-serif',  // ~24px cap height, matching the sample
  dpiPixelsPerMetre: 11811,                          // 300 dpi (the 2017 file was 96 dpi — do not copy that one)
} as const;

/** Characters Code 128B can carry: printable ASCII 32..126. FNSKUs are [A-Z0-9] so this never bites, but a bad value must not
 *  silently produce a barcode that scans as something else. */
export function isEncodable(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  });
}

/**
 * Turn text into the module pattern: a string of '1' (bar) and '0' (space). NO QUIET ZONES — the live format has no left quiet zone
 * and its right margin is part of the image geometry, so both are the caller's business.
 *
 * Subset B only — no shifts, no subset switching. Correct and dull, which is what a barcode wants to be.
 * Verified to reproduce both sample files bit-for-bit.
 */
export function code128bModules(text: string): string {
  if (!isEncodable(text)) throw new Error(`Cannot encode "${text}" as Code 128B`);

  const values = [...text].map((ch) => ch.charCodeAt(0) - 32);

  // Checksum: start value, plus each data value weighted by its 1-based position, modulo 103.
  let checksum = START_B;
  values.forEach((v, i) => { checksum += v * (i + 1); });
  checksum %= 103;

  const sequence = [START_B, ...values, checksum, STOP];

  let modules = '';
  for (const value of sequence) {
    const pattern = CODE128_PATTERNS[value];
    // Runs alternate bar/space starting with a bar, so even indices are bars.
    for (let i = 0; i < pattern.length; i += 1) {
      modules += (i % 2 === 0 ? '1' : '0').repeat(Number(pattern[i]));
    }
  }
  return modules;
}

/**
 * Draw the barcode onto a fresh canvas: bars, then the caption centred underneath them.
 * Kept separate from the BMP encoding so the same pixels can be shown on screen as a preview.
 */
export function drawBarcode(text: string): HTMLCanvasElement {
  const { moduleWidth, rightMargin, barTop, barHeight, height, captionBaseline, captionFont } = BARCODE_LAYOUT;

  const modules = code128bModules(text);
  const barWidth = modules.length * moduleWidth;

  const canvas = document.createElement('canvas');
  canvas.width = barWidth + rightMargin;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#000000';
  for (let i = 0; i < modules.length; i += 1) {
    if (modules[i] === '1') ctx.fillRect(i * moduleWidth, barTop, moduleWidth, barHeight);
  }

  // Centred on the bars, NOT on the image — the right margin would otherwise drag the caption off-centre by 65px.
  ctx.font = captionFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(text, barWidth / 2, captionBaseline);

  return canvas;
}

/**
 * Encode a canvas as an uncompressed 24bpp BMP, matching the current files byte-for-byte in structure.
 *
 * Two things here are easy to get wrong and produce a file that opens fine but prints upside down or inverted: BMP stores rows
 * BOTTOM-UP, and channels in B,G,R order. The third is padding — at 24bpp a row is width*3 bytes, which is NOT generally 4-byte
 * aligned (709*3 = 2127 -> 2128), and every row must be padded up. Getting that wrong skews the image into diagonal mush.
 */
export function canvasToBmpBlob(canvas: HTMLCanvasElement): Blob {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is unavailable in this browser');

  const { width, height } = canvas;
  const rgba = ctx.getImageData(0, 0, width, height).data;

  const HEADER = 54;                          // 14-byte file header + 40-byte BITMAPINFOHEADER
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = rowBytes * height;
  const buffer = new ArrayBuffer(HEADER + pixelBytes);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  // --- File header ---
  bytes[0] = 0x42; bytes[1] = 0x4d;           // "BM"
  view.setUint32(2, HEADER + pixelBytes, true);
  view.setUint32(10, HEADER, true);           // pixel data offset

  // --- BITMAPINFOHEADER ---
  view.setUint32(14, 40, true);               // header size
  view.setInt32(18, width, true);
  view.setInt32(22, height, true);            // positive = bottom-up, as the originals are
  view.setUint16(26, 1, true);                // colour planes
  view.setUint16(28, 24, true);               // bits per pixel
  view.setUint32(30, 0, true);                // BI_RGB, no compression
  // biSizeImage. Zero is legal for BI_RGB (the reader derives it from width/height/bpp) and is what the existing files carry —
  // matched deliberately, so a generated file is byte-identical in structure to one downstream has already accepted.
  view.setUint32(34, 0, true);
  view.setInt32(38, BARCODE_LAYOUT.dpiPixelsPerMetre, true);
  view.setInt32(42, BARCODE_LAYOUT.dpiPixelsPerMetre, true);

  // --- Pixels: bottom row first, B G R per pixel, each row padded to a 4-byte boundary ---
  for (let y = 0; y < height; y += 1) {
    let out = HEADER + (height - 1 - y) * rowBytes;
    let src = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      bytes[out] = rgba[src + 2];             // B
      bytes[out + 1] = rgba[src + 1];         // G
      bytes[out + 2] = rgba[src];             // R
      out += 3;
      src += 4;
    }
    // The padding bytes are already zero from the ArrayBuffer; nothing to write.
  }

  return new Blob([buffer], { type: 'image/bmp' });
}

/** The whole job for one FNSKU: text in, .bmp file contents out. */
export function fnskuBarcodeBmp(fnsku: string): Blob {
  return canvasToBmpBlob(drawBarcode(fnsku));
}
