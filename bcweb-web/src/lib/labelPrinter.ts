/*
=======================================================================================================================================
labelPrinter — silent label printing through QZ Tray (docs/qz-tray-plan.md, built 2026-10-29)
=======================================================================================================================================
QZ Tray is a small program on the packing PC that takes print jobs from the browser over a local websocket and sends them straight to
a named printer — no print dialog, no --kiosk-printing Chrome shortcut, and the FNSKU and Royal Mail labels go to two different
printers from the same Chrome. It only prints without an Allow/Block popup when each request is signed: the certificate comes from
GET /qz-cert and each request is signed by POST /qz-sign (the private key stays on the server). The PC trusts that certificate through
`override.crt` in the QZ Tray folder (copy: docs/qz-override.crt).

Two kinds of label, each to its own printer, FOUND BY NAME — no picking (owner, 2026-10-29: "you know royal mail orders go to the zebra
and fnskus go to the dymo"):
  fnsku      → the Dymo (name has DYMO or LabelWriter). The FNSKU label canvas from fnskuLabel.ts as a PNG, 25 × 54 mm portrait,
             printed at 300 dpi with no scaling so each image pixel is one printer dot (resampling the bars stopped them scanning once,
             2026-10-08).
  royalMail  → the Zebra (name has ZDesigner or Zebra). The Click & Drop PDF from Customer Orders. No size given: the PDF's own page
             size is the label's, exactly as the browser path did. If it ever prints grey, add `ignoreTransparency: true` to the job.
Windows often keeps a duplicate install of a USB printer ("DYMO LabelWriter 450 Turbo (Copy 1)"), so a name WITHOUT "Copy" wins when
there are two; if labels ever go to the wrong one, delete the dead duplicate in Windows' Printers & scanners.

FALLBACK, never a lost label. printLabel() resolves true only when QZ Tray took the job. Anything else — QZ Tray not running, no such
printer on this PC, the job refused — resolves false and the caller prints the old way (hidden iframe + window.print(): the dialog, or
silent under the kiosk shortcut). A failed connection is not retried for a minute, so a PC without QZ Tray doesn't wait on it at every
scan.
=======================================================================================================================================
*/

import { getQzCertificate, signQzRequest } from './api';

export type LabelKind = 'fnsku' | 'royalMail';

const PRINTER_NAME: Record<LabelKind, RegExp> = {
  fnsku: /dymo|labelwriter/i,
  royalMail: /zdesigner|zebra/i,
};

// The slice of the qz-tray API used here (the package ships no types).
interface Qz {
  websocket: { isActive(): boolean; connect(opts?: { retries?: number; delay?: number }): Promise<void> };
  security: {
    setCertificatePromise(fn: (resolve: (cert: string) => void, reject: (err: unknown) => void) => void): void;
    setSignatureAlgorithm(alg: string): void;
    setSignaturePromise(fn: (toSign: string) => (resolve: (sig: string) => void, reject: (err: unknown) => void) => void): void;
  };
  printers: { find(): Promise<string[] | string> };
  configs: { create(printer: string, opts?: Record<string, unknown>): unknown };
  print(config: unknown, data: unknown[]): Promise<void>;
}

// ---- connection ---------------------------------------------------------------------------------------------------------------

const RETRY_AFTER_MS = 60000;
let connecting: Promise<Qz | null> | null = null;
let failedAt = 0;

async function connect(): Promise<Qz | null> {
  const qz = ((await import('qz-tray')) as unknown as { default: Qz }).default;
  if (qz.websocket.isActive()) return qz;
  qz.security.setCertificatePromise((resolve, reject) => {
    void getQzCertificate().then((r) => (r.success && r.data ? resolve(r.data) : reject(r.error)));
  });
  qz.security.setSignatureAlgorithm('SHA512');
  qz.security.setSignaturePromise((toSign) => (resolve, reject) => {
    void signQzRequest(toSign).then((r) => (r.success && r.data ? resolve(r.data) : reject(r.error)));
  });
  await qz.websocket.connect({ retries: 0, delay: 0 });
  return qz;
}

/** QZ Tray, connected — or null if it isn't running on this PC (not re-tried for a minute after a failure). */
async function qzTray(): Promise<Qz | null> {
  if (failedAt && Date.now() - failedAt < RETRY_AFTER_MS) return null;
  connecting ??= connect()
    .then((qz) => { failedAt = 0; return qz; })
    .catch(() => { failedAt = Date.now(); return null; })
    .finally(() => { connecting = null; });
  return connecting;
}

/** The printer this kind of label goes to on this PC, or null if there isn't one. Looked up each time (a cheap local call), so a
 *  printer plugged in mid-session is found without a reload. */
async function printerFor(qz: Qz, kind: LabelKind): Promise<string | null> {
  const found = await qz.printers.find();
  const matches = (Array.isArray(found) ? found : [found]).filter((p) => PRINTER_NAME[kind].test(p));
  return matches.find((p) => !/copy/i.test(p)) ?? matches[0] ?? null;
}

// ---- printing -----------------------------------------------------------------------------------------------------------------

/** Send one label to its printer through QZ Tray. True = printed; false = the caller prints it the browser way (see FALLBACK). */
export async function printLabel(kind: LabelKind, base64: string): Promise<boolean> {
  try {
    const qz = await qzTray();
    if (!qz) return false;
    const printer = await printerFor(qz, kind);
    if (!printer) return false;
    // Size in INCHES: QZ reads `density` in the size's units, so with 'mm' 300 meant 300 dots per mm and the label image printed ~1 mm
    // wide — a blank label (first test, 2026-10-29, log: "Not using a supported DPI"). 25 × 54 mm = 0.984 × 2.126 in at the head's 300 dpi.
    const config = kind === 'fnsku'
      ? qz.configs.create(printer, {
        size: { width: 25 / 25.4, height: 54 / 25.4 }, units: 'in', margins: 0, density: 300,
        scaleContent: false, interpolation: 'nearest-neighbor', colorType: 'blackwhite',
      })
      : qz.configs.create(printer, { margins: 0, scaleContent: false, colorType: 'blackwhite' });
    const format = kind === 'fnsku' ? 'image' : 'pdf';
    await qz.print(config, [{ type: 'pixel', format, flavor: 'base64', data: base64 }]);
    return true;
  } catch (err) {
    console.warn('[labelPrinter] QZ Tray print failed, printing through the browser:', err);
    return false;
  }
}
