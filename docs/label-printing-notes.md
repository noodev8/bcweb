# Label printing from BCWEB — TEMP discussion notes (2026-09-30)

Status: **not built, not decided.** Written to be reviewed in a later session as a second-opinion discussion.

## The need
Migrating the PowerBuilder screens that print a label directly. First case: **Amazon** — scan a shoe box, a small **FNSKU label** prints, stick it on the box.
Constraint (owner): **no extra tools/options for the packer.** Scan → label prints. Nothing else.

## Core problem
A web page cannot silently talk to a USB/LAN printer. The API runs on the VPS, so it can't reach a printer on the local network either (without a VPN).

## Proposed approach (current leaning): Chrome kiosk printing
- Scanner = keyboard. A focused scan field; Enter triggers the print.
- Label rendered as HTML/SVG at exact label size (Code128 FNSKU barcode + FNSKU text, optional title/size). CSS `@page { size: <w>mm <h>mm; margin: 0 }`, then `window.print()`.
- Chrome started with `--kiosk-printing` skips the print dialog and prints to the default printer.

One-time setup on the packing PC:
1. Install the label printer's normal Windows driver.
2. Make it the Windows default printer; set paper size to the label stock in driver preferences.
3. Dedicated Chrome shortcut for BCWEB with `--kiosk-printing` (own profile if the PC also prints normal documents from Chrome — kiosk mode sends everything to the default printer).

Pros: nothing to install beyond the driver; no packer choices; pure web code.
Cons: only works from that Chrome shortcut (other browsers/PCs show the dialog); slower than raw ZPL (fine for one label per scan); relies on the driver's page-size handling.

## Alternatives considered
| Option | Why not (for now) |
|---|---|
| WebUSB / raw ZPL/TSPL from browser | Needs USB driver swap (Zadig) + per-device permission prompt; fragile |
| QZ Tray / PrintNode / Zebra Browser Print | Work well, but need an installed agent (owner doesn't want extra tools) |
| Server-side printing from the API | VPS can't reach the LAN printer without a VPN |

## Open questions
- Printer model (Zebra / Brother / Dymo / TSC / …)? Label size?
- How does the PowerBuilder screen map a scan to the FNSKU (EAN → `amzfeed`/`skumap`)? Check before building.
- Single packing PC or several? (Kiosk shortcut is per-PC.)
- Do other PB label screens (non-Amazon) share the same needs? If many, a print agent may be worth revisiting.

## If we proceed
Start with a test-print screen: verify label size and that Amazon's scanners read the barcode on the real stock, then build the scan-to-print screen.
