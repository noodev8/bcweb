# Label printing through QZ Tray — PLAN

Status: **plan only, not built** (2026-10-23). Replaces the Chrome kiosk shortcuts (`docs/label-printer-shortcut.txt`).
Silent printing uses our own self-signed certificate, trusted on each PC by `override.crt` (https://qz.io/docs/signing).

## Build

**Server (`bcweb-server`)**
- `.env`: `QZ_CERTIFICATE` (public cert, PEM) and `QZ_PRIVATE_KEY` (PKCS#8 PEM, 2048-bit, unencrypted). Add to the VPS `.env` at deploy.
- `routes/qz-cert.js` (GET) — returns the certificate text.
- `routes/qz-sign.js` (POST `{ request }`) — `crypto.createSign('RSA-SHA512')`, returns the base64 signature. Behind `verifyToken`.

**Web (`bcweb-web`)**
- `qz-tray` npm package, loaded only when a label prints.
- `src/lib/labelPrinter.ts`:
  - connect once; `setCertificatePromise` / `setSignatureAlgorithm('SHA512')` / `setSignaturePromise` against the two routes;
  - job types:
    - `fnsku` — the canvas from `fnskuLabel.ts` as a `pixel` / `image` / `base64` job; 25 × 54 mm portrait, `scaleContent: false`,
      `interpolation: 'nearest-neighbor'`, `colorType: 'blackwhite'`;
    - `royalMail` — the Click & Drop PDF as a `pixel` / `pdf` / `base64` job; 4 × 6 in, `scaleContent: false`
      (`options: { ignoreTransparency: true }` if it prints grey);
  - returns success or an error message for the screen;
  - QZ Tray not running → fall back to the current iframe + `window.print()` path.
- **Printers panel**: lists `qz.printers.find()`, saves "FNSKU → printer" and "Royal Mail → printer" in localStorage. No printer
  chosen → open the panel.
- Callers: `fnskuLabel.ts → printFnskuLabel` (AMZ Shipment, Goods In) and `printPdf.ts → printPdfBase64` (Customer Orders) go through
  `labelPrinter`, keeping their `onPrinted` callbacks.

## Set-up

**Once (certificate)**
- Make the key + self-signed certificate with OpenSSL (long lifetime, e.g. 10 years). Key → server `.env`; certificate → `.env` and
  `override.crt`. Note the expiry date here.

**Each packing PC**
1. Printer drivers (Dymo, ZDesigner for the Zebra).
2. Install QZ Tray, set to start with Windows.
3. Copy `override.crt` into the QZ Tray install folder, restart QZ Tray.
4. BCWEB in normal Chrome → Printers panel → pick the FNSKU and Royal Mail printers.
5. Test: scan a shoe on AMZ Shipment, and a single-pair order on Customer Orders — one label each, no dialog.

Once every PC is moved over, retire `docs/label-printer-shortcut.txt` and the kiosk shortcuts.

## Order of work
1. Test PC: certificate, QZ Tray, `override.crt`, print a test FNSKU image and a Click & Drop PDF from a scratch page — silent, scans,
   right size.
2. Server routes + `.env`.
3. `labelPrinter.ts` + Printers panel.
4. Move callers over; roll out PC by PC.
