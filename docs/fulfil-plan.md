# Fulfill button on Customer Orders — PLAN

Status: **plan only, not built** (agreed with owner 2026-10-14). The decisions below are the owner's, don't re-ask them.
The button already sits in the top row of Customer Orders (list-wide, not per order) and does nothing yet.

## The job
One press: manifest everything on Click & Drop that needs manifesting, save the manifest to Downloads, then fulfil every PACKED customer order on
Shopify with its Royal Mail tracking number, so Shopify emails the customer.

## Owner decisions (2026-10-14)
- **Manifest = everything Click & Drop has waiting**, whoever created it (PowerBuilder orders included). Don't worry about PowerBuilder.
- **Send Shopify's shipping confirmation email** (`notifyCustomer: true`).
- **Only fulfil a PACKED order.** Never a Waiting order (`customerwaiting = 1`) and never Pack only (courier `'0'`).
- **Save the manifest PDF to Downloads** (owner, 2026-10-14 — changed from printing it).

## Flow
1. **Confirm** ("Manifest and fulfil N packed orders?") — same ConfirmBox pattern as Cancel label. A manifest can't be undone.
2. **Manifest** on Click & Drop (`clickDrop.js → manifest()`; `POST /manifests` from memory — check the exact path/body/response in the
   C&D API docs before building). Returns the manifest number + PDF.
3. **Download the manifest PDF** to the browser's Downloads folder.
4. **Pick the orders to fulfil:** customer orders (ordertype 1) where EVERY line is packed (`batch = '2'`), none is Waiting, courier is
   not `'0'`. A partly packed order is skipped.
5. **Per order:** `findByReference(ordernum)` → `trackingNumber` (+ `manifestedOn`). No C&D order or no tracking number → skip, report why.
6. **Fulfil on Shopify**, per order, failures don't stop the rest: find the order by name (`ordernum` = Shopify `order.name`, we store no
   Shopify id) → its open fulfillment orders → `fulfillmentCreate` with `trackingInfo { company: 'Royal Mail', number, url }`,
   `notifyCustomer: true`. Already fulfilled → skip (counts as done).
7. **Summary** on screen: manifest number, fulfilled count, skipped/failed with reasons. Then refresh; the fulfilled orders leave the
   list on the next Update orders (archive phase) — optionally trigger it automatically.

**Order matters:** manifest before fulfil, so no customer gets tracking for an un-manifested parcel. If the manifest call fails, stop —
fulfil nothing. Re-pressing is safe: nothing new to manifest is not an error, and fulfilled orders are skipped.

## Build list
- `utils/clickDrop.js`: `manifest()` (+ retry if the API offers it).
- `utils/shopifyFulfil.js`: order-by-name lookup + `fulfillmentCreate`. Own token — **new `.env` var** (e.g.
  `SHOPIFY_FULFIL_ACCESS_TOKEN`) with `read_orders`, `read_/write_merchant_managed_fulfillment_orders`. The existing
  `SHOPIFY_ORDERS_ACCESS_TOKEN` is read-only. Owner creates it in the Shopify custom app and adds it locally + on the VPS.
- Route `order-status-customer-fulfil` (one file, header block, HTTP 200 + `return_code`, per-order results). No DB writes needed —
  Shopify + the archive phase do the rest.
- Web: wire the button in `CustomerOrderList.tsx`, confirm, results panel, manifest print; `api.ts` call.

## Open items
- Exact C&D manifest endpoint and response (PDF inline or fetched separately).
- **Printer for the manifest:** kiosk printing goes to the Windows default printer (the Zebra on the label PC). The manifest is
  probably A4 — check what C&D returns and whether it needs a different printer/profile.
- Tracking URL format for Royal Mail Tracked 24/48.
- Testing: one real run with the owner's OK on a genuine collection day — a manifest can't be rolled back.
