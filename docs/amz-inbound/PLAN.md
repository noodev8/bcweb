# Amazon inbound shipments from BCWEB — PLAN

Status: **plan only, nothing built** (2026-11-12). Goal (owner): do the whole Amazon shipment from BCWEB instead of going back and
forth to Seller Central's Send to Amazon with the shipping-plan .txt and the box-contents .xlsx.

## Owner decisions (2026-11-12)

| # | Decision |
|---|---|
| 1 | **Own courier**, not Amazon's partnered carrier. |
| 2 | **NEVER split, regardless of price.** A shipment always goes to ONE Amazon warehouse, even if a split would be cheaper. Price is never used to choose. If Amazon offers no single-warehouse option, BCWEB stops and confirms nothing. |
| 3 | **Box labels print on the Zebra** (4×6 thermal), through the existing QZ Tray path. |
| 4 | **Ship from our address**, always the same one. |
| 5 | **Courier = our own local DPD account. NEVER Amazon's DPD** (Amazon's partnered / Amazon-booked DPD option is never offered or confirmed, even if it shows up, even if it's cheaper). |
| 6 | **Ready-to-ship date: we choose it** on the screen at step 4 (no default to today). |
| 7 | **Tracking numbers: parked**, sorted later. Not part of the first build. |
| 8 | **ONE PACK GROUP, ALWAYS.** Only a packing option with exactly one pack group is ever confirmed. If Amazon offers none, stop, confirm nothing and cancel the plan. Never pack to more than one group. |
| 9 | **Mark shipped stays its own button**, pressed when DPD collects. Not part of Do shipment. |

## Today (what this replaces)

1. Pick → scan into boxes → Pack (measured + weighed). **Stays as it is.**
2. Do shipment 1: `Amazon-ShippingPlan.txt` → upload in Send to Amazon → pick the pack group → download the box-contents .xlsx.
3. Do shipment 2: "Amazon upload" fills the .xlsx (`bcweb-web/src/lib/amzBoxUpload.ts`) → upload it back in Seller Central.
4. In Seller Central: placement, carrier, dates, print box labels, mark shipped, tracking.
5. Do shipment 3: Mark shipped in BCWEB (`routes/amz-shipment-ship.js`: archive, stock off C3-Amazon, boxes cleared). **Stays.**

Steps 2–4 move into BCWEB. The two files stay behind a ⋯ as the backup (same pattern as List on Amazon / the .xlsm).

## The API

SP-API **Fulfillment Inbound v2024-03-20** (the API behind Send to Amazon; plans made through it show in Seller Central like any other).
Role: **Amazon Fulfillment**, which BCWEB already has. All calls go through `utils/amzSpApi.js`. Most of the calls are **asynchronous**
(they return an `operationId` that we poll with `getInboundOperationStatus`), so each step is a button with a spinner, from a few
seconds up to about a minute.

## ONE BUTTON: "Do shipment" (owner, 2026-11-12)

One press does the whole job, **stopping once, where there is a cost**:

1. **Press Do shipment.** BCWEB runs steps 1–2 (plan, pack group, boxes), then works out steps 3–4 **without confirming anything**:
   lists the placement options and picks the single-warehouse one (never split), then lists the transport options for it and picks our own DPD
   (`generateTransportationOptions` can be run against a placement option before it's confirmed — to verify in the probe). A
   progress line shows where it is ("Creating plan… Sending 14 boxes… Getting warehouse…").
2. **ONE confirm box** shows everything that costs or commits:
   - the warehouse (Amazon's FC code + town) and that it's ONE shipment
   - Amazon's placement fee (and any other fee Amazon lists), for info only, since it never changes the choice
   - carrier: our DPD (own carrier)
   - **ready-to-ship date: picked here** (date picker, required)
   - boxes / units
   - **Confirm** or **Cancel**. Cancel calls `cancelInboundPlan` (free before confirming) and nothing is charged.
3. **Confirm** → `confirmPlacementOption` → `confirmTransportationOptions` (+ the delivery window if Amazon requires one) →
   FBA15 id → **box labels print on the Zebra** straight away. Done.

Stops early with a plain message, with nothing confirmed and Cancel offered, when: no single-warehouse option, no own-carrier
option, no single-pack-group option, or Amazon rejects a box. More than one pack group is NEVER accepted.

**Pressing it again resumes.** If it stopped or the browser closed, Do shipment picks up from the saved step (see State) rather
than making a second plan. Once confirmed, the button turns into **Reprint labels**.

**Mark shipped stays its own button** (owner, 2026-11-12): it takes the stock off the C3-Amazon shelf and clears the boxes, pressed
when DPD collects, not when the plan is confirmed.

The two files (.txt / .xlsx) move behind a ⋯ as the backup.

## The steps underneath

Everything comes from the stored packed boxes (`amzshipment`). Your unpacked box never goes, same as Mark shipped now.

| Step | BCWEB calls | Notes |
|---|---|---|
| **1 Create plan** | `createInboundPlan`: items = Amazon SKU + qty totalled across boxes, `prepOwner` / `labelOwner` SELLER (as the .txt says now), ship-from address from `.env`. Then `generatePackingOptions` → `listPackingOptions` → `confirmPackingOption`. | Replaces the .txt. **ONE PACK GROUP, ALWAYS** (owner): from `listPackingOptions` only an option with exactly one packing group is confirmed. If there is none, stop, confirm nothing and cancel the plan, with a message naming the SKUs Amazon wanted kept apart (so they can go on a separate shipment by hand). |
| **2 Boxes** | `setPackingInformation`: per box its items, `BOX_CONTENT_PROVIDED`, dimensions in CM and weight in KG straight from `amzshipment`. | Replaces the .xlsx. Our Box 1..n = Amazon's box order. Amazon's errors are shown per box. |
| **3 Warehouse** | `generatePlacementOptions` → `listPlacementOptions` → **only an option with exactly ONE shipment** → `confirmPlacementOption`. | **NEVER SPLIT, REGARDLESS OF PRICE** (owner, 2026-11-12). Price never decides anything here: a split is never taken, even if it's cheaper. If Amazon offers more than one single-shipment option (unlikely), take Amazon's first. If there's none, stop, confirm nothing and offer Cancel plan. The fee and the warehouse are shown before the press, for information only. **Placement fees are charged from this confirm on.** |
| **4 Carrier + dates** | `generateTransportationOptions` (ready-to-ship date **picked on screen**) → choose the **non-partnered / own-carrier** option, carrier **DPD (UK)** → delivery window if Amazon requires one (`generateDeliveryWindowOptions` → `confirmDeliveryWindowOptions`) → `confirmTransportationOptions`. | **Our local DPD only, NEVER Amazon's DPD.** An Amazon-partnered option (`AMAZON_PARTNERED_CARRIER`, or any option Amazon books/charges for) is filtered out in code and never confirmed, even if it's the only one or the cheapest. If no own-carrier option comes back, stop. The probe confirms the exact DPD carrier name/code Amazon wants. |
| **5 Box labels** | `getShipment` → shipment confirmation id (FBA15…); v0 `getLabels`, `PageType=PackageLabel_Thermal`, `LabelType=UNIQUE`, one per box. | PDF → `printPdfBase64` (QZ Tray → Zebra), the same path as the Royal Mail labels. Reprint any time. |
| **6 Shipped** | The existing Mark shipped (+ the FBA15 id onto the archive). | **Tracking (`updateShipmentTrackingDetails`) is parked** (owner, 2026-11-12: sort later), entered in Seller Central meanwhile. |

Steps 1–5 all run from the ONE button (above). The only human press is the confirm before 3 and 4 are CONFIRMED. **Cancel plan**
(`cancelInboundPlan`) is available up to that confirm. What it costs after the confirm is to check in the test plan.

## State: stopping halfway

You must be able to close the browser after any step and come back to the next one. The plan id, shipment id, FBA15 id and how far it
got are kept in the DB, **not a new table if avoidable** (owner rule):
- While building: a small status record for the one open plan, e.g. a row in an existing status/sync table (`amz_api_sync.detail`
  already holds JSON for the nightly job — a similar key could hold `{ inboundPlanId, step, shipmentId, confirmationId }`). To be decided at build time.
- At Mark shipped: the FBA15 id + plan id go onto the archived rows, as **columns on `amzshipment_archive`** (one migration). That
  links our shipment number to Amazon's.

**Boxes are frozen once step 2 is sent.** Unpack, Delete and Pack on a stored box must refuse (or warn and require a re-send of step 2)
while a plan is open. Otherwise what Amazon has and what we packed drift apart. Decide which at build time. The simplest choice is to refuse
after step 3.

## Build order (probe first, against Amazon's real replies)

0. **Read-only probe** `scripts/amz-inbound-probe.js`: `listInboundPlans` + one recent plan's shipments, items and boxes (one made in
   Seller Central). Proves the role and shows the real reply shapes, the placement and transport option layout for UK own-carrier,
   and whether a delivery window is required.
1. **Test plan, then cancel**: a script creates a plan for 1–2 SKUs, runs steps 1–2, LISTS the placement options (no confirm), then
   `cancelInboundPlan`. That tells us whether UK offers a single-warehouse option and what it costs.
2. **Do shipment, part 1**: the button runs steps 1–2 and stops. The rest is finished in Seller Central for a while, where the plan shows up ready.
3. **Do shipment, full**: works out 3–4, the one confirm box (warehouse, fee, DPD, date), confirm → Zebra labels.
4. **Step 6**: the FBA15 id carried into Mark shipped's archive.
5. **Later**: DPD tracking per box (parked). Also read what Amazon RECEIVED per SKU (`listShipmentItems` / shipment status), so Inventory's transit bucket
   (`amzshipment_archive`) becomes real ("38 of 40 received") instead of a guess.

## Open questions

- Does Amazon UK require a **delivery window** for own-carrier small parcel? (The probe / test plan answers it.)
- What happens to a plan **left open** (e.g. created, never shipped)? Auto-cancel after N days, or just a warning?
