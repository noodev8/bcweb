# Royal Mail labels from Customer Orders (Click & Drop) — PLAN

Status: **plan only, nothing built** (agreed with owner 2026-10-09). Read this before starting; the decisions below are the owner's, don't re-ask them.

## The job
On the **Customer Orders** screen, scan a shoe that belongs to a customer order. When every item in that order has been scanned, bcweb
creates the shipment in Royal Mail **Click & Drop** through its API, fetches the label PDF and prints it on the **Zebra**. No dialog,
no extra steps for the packer.

## Owner decisions (2026-10-09)
- **Account:** Royal Mail **OBA business account** with Click & Drop, so the API can return labels.
- **Click & Drop is NOT connected to Shopify** and doesn't need to be. bcweb creates the Click & Drop order itself from our own data.
- **No new screen.** Everything lives on the existing Customer Orders screen (`/customer-orders`, `CustomerOrderList.tsx`).
- **Weight is for the whole order (one parcel).** Use the stored weights. If any are missing, ask the user to enter the weight.
- **Printer:** Zebra.
- **Tracking back to Shopify:** not now (possible later phase).

## What's already in place (checked 2026-10-09)
- **Address:** `orderstatus` customer rows (ordertype 1) hold shippingname, address1/2, company, city, county, postcode, country,
  phone, email and shippingnotes. The order sync refreshes them every run (`utils/orderSync.js` re-sync path). No Shopify call is needed.
- **Service:** `orderstatus.courier`, set at sync insert from the shipping paid: `'4'` = Royal Mail 24, `'5'` = Royal Mail 48,
  `'0'` = pack only (**no label**). See `COURIERS` in `utils/customerOrders.js`. Can be overridden per order via
  `order-status-customer-courier`.
- **Weights (DB, read-only check):**
  - `skumap.weight` is varchar, **kg per variant** (`.54`, `1.1`, …). 1,233 of 2,085 rows are filled, and all filled ones are numeric.
  - `orderstatus.weight` is `''` on live customer rows but filled on 70 of 75 archived ones (`'1'`, `.567`, `1.31` …). PowerBuilder writes
    it at pack time, so we write it too.
- **Barcode → code:** the AMZ Shipment scan check already resolves our code or the EAN (`skumap.ean`, trailing `B` stripped). Reuse that
  lookup logic.
- **Packed:** `batch = '2'` (see the PACKED notes in `utils/customerOrders.js`). Nothing in bcweb writes it today (PowerBuilder or the
  mobile app does), so this is bcweb's first packed write. Neither order-sync copy (`orderSync.js` / `update_orders.py`) resets `batch`.
- **Kiosk printing:** `docs/label-printer-shortcut.txt` (Chrome `--kiosk-printing`, its own profile, default printer).

## Flow
1. **Scan field** in the pinned control block on Customer Orders, next to the find box. Enter commits, focus stays, forced uppercase.
   A refused scan turns red and beeps (same pattern as AMZ Shipment).
2. **Scan a shoe:**
   - Resolve the barcode to our code.
   - Find the **oldest** open customer line for that code. Open means not packed, not FBA (`amz > 0`), not parked, and not pack-only
     where that matters.
   - The grid jumps to and selects that order.
   - No match: "No customer order waiting for this shoe".
3. **Orders with more than one item:**
   - The order shows "1 of 2 scanned, still need X".
   - Nothing prints until every unit is scanned.
   - Scanned progress is stored on the server, so a page reload doesn't lose it.
4. **Order complete:**
   1. **Weight** = Σ `skumap.weight` × qty over the order's lines.
      - Every line has a weight: use the total, no prompt.
      - Any line is missing one: prompt for the **whole-order** weight in kg. It's used for this label only and NOT written back to
        `skumap`.
   2. Create the Click & Drop order:
      - recipient = the `orderstatus` address
      - service = from `courier`
      - weight = the order weight
      - order reference = our ordernum (e.g. BC18671)
   3. Fetch the label PDF and return it to the browser.
   4. In one transaction: `batch = '2'` on the order's lines, `orderstatus.weight` = the order weight, plus the shipment row (below).
   5. The browser loads the PDF in a hidden iframe and prints it. Kiosk printing sends it to the Zebra.
5. **"Print label" / "Reprint label"** button in the existing per-order action bar, for when nobody scans and for reprints.
   **If a Click & Drop order already exists for the ordernum, re-fetch its label. Never create a second one** (that pays postage twice).
6. **Refused with a reason, no label:** pack only (`'0'`), non-GB country (customs is a separate job), missing postcode/address1.

## Build list
**Server (`bcweb-server`)**
- `utils/clickDrop.js`: a thin Click & Drop REST client (`https://api.parcel.royalmail.com/api/v1`, `Authorization` = API key).
  Create order, get label. Key from a **new `.env` var `CLICKDROP_API_KEY`** (local + VPS, never in code or chat).
- Routes, one file each, the usual header block and HTTP 200 + `return_code`:
  - `order-status-customer-scan`: barcode → matched order line, records the scan, returns order progress (n of m).
  - `order-status-customer-label`: create-or-reprint. Takes the optional user-entered weight and returns the PDF (base64).
    Idempotent on ordernum.
- Migration: new table **`customer_shipment`**: `ordernum`, Click & Drop order id, weight, service code, created_at/by, reprint
  count, plus scanned-unit tracking (or a child table). A new table rather than legacy `orderstatus` columns, which PowerBuilder also
  reads.

**Web (`bcweb-web`)**
- `CustomerOrderList.tsx`: scan field, "n of m scanned" badge, weight prompt, Print/Reprint label in the action bar.
- `api.ts`: the two client calls.
- A print helper: PDF blob → hidden iframe → `print()`.

## Phases
0. **Before code:**
   - The owner creates the API key (Click & Drop → Settings → Integrations) and puts it in `.env`.
   - One read-only test call from the VPS.
   - Confirm the Zebra label size (6×4?) and the **service codes** for RM24 / RM48 on the account (the API wants Royal Mail's service
     codes, not our `'4'`/`'5'`; check which the account offers, e.g. Tracked 24/48 vs plain 1st/2nd).
   - Confirm the package format (parcel / small parcel).
1. Server util, routes and migration. DB writes tested inside `BEGIN … ROLLBACK`. Create ONE real test Click & Drop order only with the
   owner's OK, and cancel it afterwards.
2. Customer Orders UI.
3. Printer setup and a test print on real Zebra stock.
4. *(Later)* Tracking number → Shopify fulfilment (phase C of the sync then archives the order automatically).

## Open items
- **Is the Zebra on the same PC as the FNSKU Dymo?** Kiosk printing always uses the Windows default printer. If they share a PC,
  Customer Orders needs its own Chrome shortcut/profile with the Zebra as default (add it to `docs/label-printer-shortcut.txt`).
- Zebra label size (6×4 assumed) and the Click & Drop label format setting to match.
- Exact Click & Drop service codes and package format for this account (phase 0).
