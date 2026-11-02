/*
=======================================================================================================================================
Code 128B encoder — the bar pattern for an FNSKU label
=======================================================================================================================================
Text in, module pattern out ('1' bar, '0' space). fnskuLabel.ts draws the AMZ Shipment / Goods In label from it at print time.

Amazon requires Code 128 on FNSKU labels. Subset B (printable ASCII) covers every FNSKU — all 10 characters, [A-Z0-9]. Verified
bit-for-bit against the barcode folder's PowerBuilder-era images (X000Q6ARLD.bmp 2017, X002NE1DDH.bmp 2026, X002891WM9.bmp).

THE BARCODE FOLDER IS RETIRED (owner, 2026-11-02: "nothing else uses it"). This file used to also draw the folder's 709 x 260 300 dpi
`<FNSKU>.bmp` images, written by a panel on Update Amazon after an import brought in a new FNSKU. Since the label is drawn at print
time nothing read those files, so the panel, the BMP writer, the folder picker and GET /amz-barcode-check went. Git history has them.
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

/** Characters Code 128B can carry: printable ASCII 32..126. FNSKUs are [A-Z0-9] so this never bites, but a bad value must not
 *  silently produce a barcode that scans as something else. */
export function isEncodable(text: string): boolean {
  return text.length > 0 && [...text].every((ch) => {
    const c = ch.charCodeAt(0);
    return c >= 32 && c <= 126;
  });
}

/**
 * Turn text into the module pattern: a string of '1' (bar) and '0' (space). NO QUIET ZONES — the blank
 * space either side is the caller's business.
 *
 * Subset B only — no shifts, no subset switching. Correct and dull, which is what a barcode wants to be.
 * Verified to reproduce the folder's sample files bit-for-bit.
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
