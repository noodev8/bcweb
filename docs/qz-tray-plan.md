# Label printing through QZ Tray — set-up and how it works

Status: **built 2026-10-29**, first FNSKU print came out blank (density bug, fixed same day); not yet confirmed on a real label of
either kind. Replaces the Chrome kiosk shortcuts (`docs/label-printer-shortcut.txt`) — keep those until both labels have printed and
scanned through QZ Tray, then retire them.

With QZ Tray running on a packing PC, BCWEB in **ordinary Chrome** prints labels with no dialog and no special shortcut:

| Label | Screens | Printer |
|---|---|---|
| FNSKU (Amazon) | AMZ Shipment, Goods In | the **Dymo** — any printer named DYMO / LabelWriter |
| Royal Mail | Customer Orders | the **Zebra** — any printer named ZDesigner / Zebra |

No printer picking (owner, 2026-10-29). If QZ Tray isn't running or the PC has no such printer, the label prints the old browser way
(print dialog, or silent from a kiosk shortcut) — never lost.

---

## Set up a packing PC

1. **Printer drivers.** Install the Dymo driver (dymo.com) and the Zebra's **ZDesigner** driver (zebra.com). In Windows'
   Printers & scanners check each shows up once — if there's a duplicate (e.g. "DYMO LabelWriter 450 Turbo (Copy 1)"), delete the
   one that isn't plugged in. (When there are two, BCWEB uses the name without "Copy".)
2. **Driver settings** (QZ Tray prints through the Windows driver, so these still matter):
   - Dymo → Printing Preferences → Advanced: Print Quality **Barcodes and Graphics** (not Auto/Text — grey bars that won't scan),
     darkness **Normal**.
   - Zebra → Printing Preferences: stock **4 × 6 in**, media type matching the roll (direct thermal, with gaps).
3. **Install QZ Tray** from https://qz.io/download (2.2.x). When it's running there's a QZ icon in the system tray; right-click it
   and make sure **Automatically start** is ticked.
4. **Trust our certificate** (this is what stops the Allow/Block popup on every label):
   - Copy `docs/qz-override.crt` from this repo into `C:\Program Files\QZ Tray\` and rename it **`override.crt`** (needs admin).
   - Right-click the tray icon → **Exit**, then start QZ Tray again from the Start menu.
5. **Test.** Open BCWEB in normal Chrome (logged in):
   - AMZ Shipment → scan a shoe that has an FNSKU → one label on the Dymo, no dialog, and it scans.
   - Customer Orders → scan the shoe of a single-pair order → one Royal Mail label on the Zebra, no dialog.

## If it goes wrong

- **Allow / Block popup from QZ Tray** — `override.crt` is missing or misnamed, or QZ Tray wasn't restarted after copying it.
- **Chrome's print dialog appears** — the label fell back to the browser: QZ Tray isn't running (no tray icon), the printer's name
  doesn't contain DYMO/LabelWriter or ZDesigner/Zebra, or the server is missing its `QZ_` keys (see below).
- **Goes to the wrong Dymo/Zebra** — a dead duplicate in Printers & scanners; delete it (step 1).
- **Blank, tiny, cut off or off-centre label** — look at the last job in QZ Tray's log, `%APPDATA%\qz\debug.log` (look for
  `Message: {"call":"print"` and any WARN after it, e.g. "Not using a supported DPI"). The job settings are in
  `bcweb-web/src/lib/labelPrinter.ts`.
- **Royal Mail label grey/faint** — add `ignoreTransparency: true` to the Royal Mail job options in `labelPrinter.ts`.

---

## Server keys (once — done 2026-10-29)

QZ Tray only prints silently when each request is signed with our key and the PC trusts the matching certificate.

- Self-signed, made with OpenSSL on 2026-10-29, RSA 2048, **expires 2036-10-26**.
  `CN=BCWEB label printing, O=Brookfield Comfort`.
- `bcweb-server/.env` holds both, one line each with `\n` escapes, double-quoted: `QZ_CERTIFICATE` (public) and `QZ_PRIVATE_KEY`
  (PKCS#8, unencrypted — never commit it). **The VPS `.env` needs the same two lines** — copy them from the local `.env`.
- `docs/qz-override.crt` is the public certificate (safe to commit) = each PC's `override.crt`.
- If the key is ever replaced: new `.env` lines on the server AND a new `override.crt` on every PC, or every label falls back to the
  browser.

## How it works (code)

- **Server:** `routes/qz-cert.js` (GET — the certificate) and `routes/qz-sign.js` (POST `{ request }` — `RSA-SHA512` signature,
  base64). Both behind `verifyToken`, so only a logged-in user gets a job past QZ Tray.
- **Web:** `src/lib/labelPrinter.ts` (npm `qz-tray` 2.2.6, loaded on the first print). Connects once; a failed connection isn't
  retried for a minute so a PC without QZ Tray doesn't wait at every scan. `printLabel(kind, base64)` resolves true only if QZ Tray
  took the job.
  - `fnsku` — the canvas from `fnskuLabel.ts` as a PNG `pixel/image` job: 25 × 54 mm portrait, given **in inches** at density 300
    (QZ reads density in the size's units — in mm, 300 meant 300 dots/mm and printed a blank label), `scaleContent: false`,
    nearest-neighbour, black/white, so each image pixel is one Dymo dot.
  - `royalMail` — the Click & Drop PDF as a `pixel/pdf` job, no size given (the PDF's own 6 × 4 page), `scaleContent: false`.
- **Callers** are unchanged: `fnskuLabel.ts → printFnskuLabel` (AMZ Shipment, Goods In) and `printPdf.ts → printPdfBase64`
  (Customer Orders) try QZ first and fall back to their iframe + `window.print()` path.
