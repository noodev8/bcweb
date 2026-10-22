# Manifest and fulfil — Customer Orders — PLAN

Status: **manifest BUILT and live; Shopify fulfil BUILT 2026-10-20; ONE button again 2026-10-22** (owner: "put manifest and fulfill
as one button now") — `ManifestButton.tsx` ("Fulfill" on screen, Customer Orders header bar) runs the flow below in one press. Each
packed order's box keeps its own Fulfil (`routes/order-status-customer-fulfil.js` with `{ ordernum }`). Tracking copied from what
PowerBuilder writes (real orders, 2026-10-20): Royal Mail = company 'Royal Mail' + royalmail.com tracking url; FBA = number
'AMZCourier', no company. The decisions below are the owner's, don't re-ask them.

## The job
One press: manifest everything on Click & Drop that's waiting, save the manifest PDF to Downloads, then fulfil on Shopify — with the
customer email — **every order we have as packed**: Royal Mail boxes (`batch = '2'`) with their tracking number, and FBA orders whose
Amazon MCF file is made, marked fulfilled with the Amazon courier.

## Owner decisions
- **Manifest = everything Click & Drop has waiting**, whoever created it (PowerBuilder orders included). (2026-10-14)
- **Save the manifest PDF to Downloads**, not print it. (2026-10-14)
- **Send Shopify's shipping confirmation email** (`notifyCustomer: true`). (2026-10-14)
- **Fulfil = every order we have as packed (`batch = '2'`).** That is the whole rule (owner, 2026-10-19: "doesnt need to be on
  manifest actually. just do manifest first then fulfil anything that we have as packed"). No Waiting test, no on-the-manifest test —
  supersedes the 2026-10-14 "never a Waiting order". Manifest runs FIRST; the fulfil list is our packed rows, not the manifest's.
- **FBA orders: mark fulfilled with the Amazon courier** (owner, 2026-10-19: "fba orders - mark as fulfilled with amz courier"). "Packed"
  for FBA = what `customerOrders.js → rowState` already calls packed: `amz > 0` with `orderdate` stamped (the MCF file is made). An FBA
  line still waiting for its file (`orderdate` blank) is NOT fulfilled.

## Flow
1. **Confirm** ("Manifest and fulfil? This can't be undone.") — existing inline confirm.
2. **Manifest** — BUILT: `routes/order-status-customer-manifest.js` → `clickDrop.createManifests()`. This account replies HTTP 201
   `{ manifestNumber, documentPdf }` inline (live, 2026-10-15). PDF saved to Downloads by the button. **If the manifest fails, stop —
   fulfil nothing.**
3. **Fulfil** — a SECOND request from the same press, to a new route `order-status-customer-fulfil`, so a slow manifest can't push the
   whole job past the browser's 120s wait. Only sent if the manifest succeeded (or there was nothing to manifest).
   - **Candidates:** customer orders (`ordertype 1`, channel SHOPIFY) where every line reads `packed` by `rowState` — a Royal Mail
     box (`batch = '2'`) or an FBA line with its MCF file made. A partly packed order is skipped (reported). (FBA orders are always
     single-line — the FBA route refuses groups — so an order is one kind or the other.)
   - **Royal Mail orders — tracking:** `clickDrop.findByReference(ordernum)` → `trackingNumber`. None (e.g. a Pack only order, no
     label) → skip, report why.
   - **FBA orders:** no Click & Drop lookup. `trackingInfo { company: <Shopify's Amazon carrier> }`, no number (we don't hold the MCF
     tracking). Same `notifyCustomer: true`.
   - **Shopify:** order by name (`ordernum` = Shopify `order.name` exactly, per `orderSync.js`) → its open fulfillment orders →
     `fulfillmentCreate` with `trackingInfo` as above (Royal Mail: `{ company: 'Royal Mail', number, url }`), `notifyCustomer: true`. Already fulfilled → skip,
     counts as done. One order failing doesn't stop the rest.
4. **Summary** under the title row: manifest number, fulfilled count, skipped/failed with reasons.
5. **Auto Update orders** (the existing order-sync) after the fulfil, so the fulfilled orders archive off the list straight away.

**Re-press:** NOTHING_TO_MANIFEST is not an error — the fulfil still runs over whatever is packed. Already-fulfilled orders are
skipped, so pressing again is safe.

No DB writes — Shopify and the archive phase of Update orders do the rest.

## Build list
- `utils/shopifyFulfil.js`: order-by-name lookup + open fulfillment orders + `fulfillmentCreate`. Own app — the **"bcweb
  fulfil" Dev Dashboard app** (2026-10-20; legacy custom apps can't be created any more) with `read_orders`,
  `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`. `.env`: `SHOPIFY_FULFIL_CLIENT_ID` +
  `SHOPIFY_FULFIL_CLIENT_SECRET`, swapped for a 24h token by the util (client_credentials grant). Set locally; needed on the VPS too.
- `routes/order-status-customer-fulfil.js`: one file, header block, HTTP 200 + `return_code`, per-order results.
- Web: `ManifestButton.tsx` chains manifest → fulfil → Update orders, combined summary; `api.ts` call.

## Open items — check against REAL replies before building (see the manifest lesson)
- Read-only checks first: `findByReference` for one packed order (where the tracking number sits), and the Shopify order + its
  fulfillment orders with the new token.
- Royal Mail tracking URL format (or let Shopify build it from company 'Royal Mail').
- The exact Amazon carrier name in Shopify's supported-carrier list (e.g. 'Amazon Logistics UK' vs 'Amazon') — check at build.
- FBA email with no tracking number: confirm the shipping email reads OK without one (first live FBA run).
- `fulfillmentCreate` can't be dry-run and emails a real customer: first live run = ONE order the owner picks, on a collection day.
