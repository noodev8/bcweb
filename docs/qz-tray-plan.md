# Label printing through QZ Tray

Status: **built 2026-10-29** (planned 2026-10-23). Certificate made 2026-10-29, **expires 2036-10-26**; public copy
`docs/qz-override.crt`, key in the server `.env` only (add `QZ_CERTIFICATE` + `QZ_PRIVATE_KEY` to the VPS `.env` at deploy).
Code: `routes/qz-cert.js`, `routes/qz-sign.js`, `src/lib/labelPrinter.ts`, no printer picking — FNSKU goes to the Dymo, Royal Mail to the Zebra,
found by name (owner, 2026-10-29). Replaces the Chrome kiosk shortcuts (`docs/label-printer-shortcut.txt`).
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
- **Printer by name, no panel** (owner, 2026-10-29): FNSKU → the printer named DYMO/LabelWriter, Royal Mail → ZDesigner/Zebra; a
  name without "Copy" wins over a Windows duplicate. No such printer → the browser path.
- Callers: `fnskuLabel.ts → printFnskuLabel` (AMZ Shipment, Goods In) and `printPdf.ts → printPdfBase64` (Customer Orders) go through
  `labelPrinter`, keeping their `onPrinted` callbacks.

## Set-up

**Once (certificate)**
- Make the key + self-signed certificate with OpenSSL (long lifetime, e.g. 10 years). Key → server `.env`; certificate → `.env` and
  `override.crt`. Note the expiry date here.

**Each packing PC**
1. Printer drivers (Dymo, ZDesigner for the Zebra).
2. Install QZ Tray, set to start with Windows.
3. Copy `docs/qz-override.crt` into `C:\Program Files\QZ Tray\` as `override.crt` (needs admin), restart QZ Tray.
4. BCWEB in normal Chrome — nothing to pick; delete any dead duplicate Dymo/Zebra in Windows' Printers & scanners.
5. Test: scan a shoe on AMZ Shipment, and a single-pair order on Customer Orders — one label each, no dialog.

Once every PC is moved over, retire `docs/label-printer-shortcut.txt` and the kiosk shortcuts.

## Order of work
1. Test PC: certificate, QZ Tray, `override.crt`, print a test FNSKU image and a Click & Drop PDF from a scratch page — silent, scans,
   right size.
2. Server routes + `.env`.
3. `labelPrinter.ts`.
4. Move callers over; roll out PC by PC.
