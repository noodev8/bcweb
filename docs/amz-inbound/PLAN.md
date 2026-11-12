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
| 10 | **The FBA15 id / plan id are NOT stored on the archive.** Mark shipped stays as it is, no migration. |

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

## What the read-only probe found (2026-11-12)

`scripts/amz-inbound-probe.js` (GET calls only, nothing written anywhere) read the team's real Send to Amazon history:

- **Seller Central's shipments ARE visible through the API.** Every Send to Amazon shipment is a v2024 inbound plan (`wf…` id). Since
  Mar 2026 there have been 25 SHIPPED and ~35 VOIDED (abandoned drafts). **Gotcha:** `listInboundPlans` returns only ACTIVE plans
  unless `status` is passed, so read each status.
- **One pack group, one warehouse, every time.** All three detailed plans (3, 6 and 9 Nov) had exactly 1 packing option with 1 pack
  group, and 1 placement option with 1 shipment. The never-split rules match how Amazon UK already behaves for us.
- **Placement fee £0.** Amazon's fee line ("Placement service fee … minimal shipment splits") was 0 GBP on each. Prep = `ITEM_LABELING`,
  owner SELLER, fee £0.
- **Destinations vary**: CWL1 Swansea, LBA4 New Rossington (Doncaster), BHX4 Coventry, EMA5. That's Amazon's choice; we only make sure it's ONE.
- **Our DPD as Amazon sees it:** `shippingSolution: USE_YOUR_OWN_CARRIER`, `shippingMode: GROUND_SMALL_PARCEL`, carrier
  `{ name: "DPD", alphaCode: "DPDX" }`, no quote (Amazon charges nothing). Packing options also offer `AMAZON_PARTNERED_CARRIER`
  modes. The code only ever takes `USE_YOUR_OWN_CARRIER` + `GROUND_SMALL_PARCEL` + DPDX.
- **A delivery window IS confirmed on every shipment** (`selectedDeliveryWindow`, e.g. 8–14 Nov, `editableUntil` 2 days later).
  Seller Central does it quietly. So Do shipment must run `generateDeliveryWindowOptions` → `confirmDeliveryWindowOptions` (before the
  transport confirm). It's done inside the Confirm press and shown in the confirm box.
- **Boxes:** `BOX_CONTENT_PROVIDED`, CM / KG (what `amzshipment` stores), 5–10 boxes a shipment. Amazon's box ids are
  `<FBA15 id>U000001…`, numbered in order, so our Box n = Amazon's U00000n.
- **Tracking is already entered per box today** (`spdTrackingItems`: boxId + the DPD number per box). So the parked step would replace
  existing hand work, and the shape is known.
- **Received per SKU works** (v0 `/fba/inbound/v0/shipments/{id}/items`: `QuantityShipped` / `QuantityReceived`, e.g. 6 of 6 on
  FBA15MSR8YBF). **NOT wanted** (owner, 2026-11-12: "can just look at amz for that, dont need it on bcweb"). Don't build it.
- **One ACTIVE plan from 9 Nov (15:30) has no shipments**, an abandoned draft that never got voided. Open plans are simply left
  lying around today, which is harmless.
- Shipment names are Seller Central's `FBA STA (dd/mm/yyyy hh:mm)-<FC>`. We can pass our own name (e.g. our shipment number).

## What the TEST PLAN proved (2026-11-12, `scripts/amz-inbound-test-plan.js`)

A real plan (2 Ives White sizes × 1, one test box) was taken through every step WITHOUT confirming placement, transport or delivery
window, then cancelled → VOIDED. **Nothing charged.** The script can't confirm those three (its writes are allow-listed).

- **The whole one-button flow works through the API**, and the single confirm box is possible: transport options AND delivery windows
  can be generated and listed for a placement option BEFORE it is confirmed.
- **prepOwner must be `NONE`** for our shoes ("IVES-WHITE-07 does not require prepOwner but SELLER was assigned. Accepted values:
  [NONE]"). labelOwner stays SELLER (we put the FNSKU labels on). If a SKU ever does need prep, Amazon says so in the same way.
- **"WARNING: Address was unable to be verified" is harmless.** Amazon's docs: "Non-blocking errors are warnings that can be ignored
  (for example, when the address is suspected to be wrong, but progression is allowed anyway)." The plan goes ahead. It comes on every
  create for our Welshpool address. Show it, never stop on it. (It cost an hour: our client printed only Amazon's FIRST error, the
  warning, and hid the real prepOwner ERROR behind it. `utils/amzSpApi.js` now puts ALL errors in the message.)
- **Phone is REQUIRED on the ship-from** (Seller Central doesn't show one): `AMZ_SHIP_FROM_PHONE` in `.env`. Add it to the VPS `.env` too.
- Packing: 1 option, 1 pack group, no fee. Placement: 1 option, 1 shipment (LBA4), "Placement Services: 0 GBP".
- **Transport: Amazon's DPD and our own DPD have THE SAME carrier code `DPDX`.** Own: `USE_YOUR_OWN_CARRIER / GROUND_SMALL_PARCEL / DPD (DPDX)`,
  no quote. Amazon's: `AMAZON_PARTNERED_CARRIER / GROUND_SMALL_PARCEL / DPD (DPDX)`, quote £2.86 (Amazon UPS £2.45). **So the filter MUST be on
  `shippingSolution === 'USE_YOUR_OWN_CARRIER'` first, never on the carrier code alone.** Also offered as own carrier: DPDgroupUK (DPDUK),
  Parcelforce, Yodel, DHL UK, UPS, TNT, Other. We take DPD (DPDX), the one on every past shipment, and STOP if it's missing.
  Any option with a `quote` is never confirmed.
- Delivery windows: 7 offered, 7 days each, AVAILABLE. Take the one that starts on or after the chosen ready-to-ship date. Shown in the confirm box.
- Box warning seen: "Box minimum cubic volume does not meet the expected minimum cubic cm 11925.79" (the 30×20×15 test box was
  under ~11,900 cm³). A WARNING only; real cartons are far bigger (e.g. 62×48×47). Show warnings, don't stop on them.
- Cancel before any confirm: SUCCESS, plan VOIDED, free.

## Prep: Amazon decides per SKU (read 2026-11-12, `GET /inbound/fba/2024-03-20/items/prepDetails`, read only)

Prep is not ours to choose. Amazon fixes it per product (ASIN), and createInboundPlan refuses a wrong prepOwner. Read for all 357 SKUs
in stock at FBA:

| SKUs | Amazon's category | Prep types | prepOwner allowed | Brands |
|---|---|---|---|---|
| 300 | NONE | labelling only | **NONE only** | Lunar 114, Rieker 70, Strive 49, Caprice 21, Remonte 15, … |
| 57 | **TEXTILE** | labelling + **POLYBAGGING** | **SELLER only** | Lunar 15, Rieker 15, Remonte 12, Lazy Dogz 5, Free Spirit 5, Dek 2, Goor 2, Strive 1 |

The split is per ASIN, not per brand (Amazon calls fabric-upper shoes "textile"). labelOwner is SELLER-only for all.

**So BCWEB can't send "no prep" for everything.** The 57 would be refused. **Plan:** before createInboundPlan, Do shipment reads
prepDetails for the shipment's SKUs and sends each SKU the owner Amazon allows (NONE, or SELLER for textile). Automatic, nobody
picks anything. That is what Seller Central quietly did with the .txt's "Default prep owner: Seller".

Not done: `setPrepDetails` (changing a SKU's category to NONE). Declaring a textile shoe "no prep" when Amazon expects a polybag
risks Amazon's unplanned-prep / non-compliance charges.

**Owner, 2026-11-12: "everything is in a shoe box"**, so nothing is polybagged, the textile 57 included, and that is how every past
shipment went. For Do shipment nothing changes: textile SKUs go as prepOwner SELLER, exactly as the .txt's "Default prep owner:
Seller" did. Whether Amazon has been charging unplanned prep for them is a separate read-only check (Finances API) if the owner wants it.
Changing their category is NOT part of this build.

## ONE BUTTON: "Do shipment" (owner, 2026-11-12)

One press does the whole job, **stopping once, where there is a cost**:

1. **Press Do shipment.** BCWEB runs steps 1–2 (plan, pack group, boxes), then works out steps 3–4 **without confirming anything**:
   lists the placement options and picks the single-warehouse one (never split), then lists the transport options for it and picks our own DPD
   (`generateTransportationOptions` can be run against a placement option before it's confirmed. The probe only saw finished plans,
   so the test plan (build step 1) must prove this). A
   progress line shows where it is ("Creating plan… Sending 14 boxes… Getting warehouse…").
2. **ONE confirm box** shows everything that costs or commits:
   - the warehouse (Amazon's FC code + town) and that it's ONE shipment
   - Amazon's placement fee (and any other fee Amazon lists), for info only, since it never changes the choice
   - carrier: our DPD (own carrier)
   - **ready-to-ship date: picked here** (date picker, required)
   - boxes / units
   - **Confirm** or **Cancel**. Cancel calls `cancelInboundPlan` (free before confirming) and nothing is charged.
3. **Confirm** → `confirmPlacementOption` → delivery window (generate → confirm, always — see probe) → `confirmTransportationOptions` →
   FBA15 id → **box labels print on the Zebra** straight away. Done.

Stops early with a plain message, with nothing confirmed and Cancel offered, when: no single-warehouse option, no own-carrier
option, no single-pack-group option, or Amazon rejects a box. More than one pack group is NEVER accepted.

**NO RESUMING: every press starts clean (owner, 2026-11-12: "dont want to send wrong info - can it not clear any drafts and then
go?").** Each press of Do shipment first CANCELS every unconfirmed draft plan on Amazon (ACTIVE, placement not confirmed: free, as
the test plan proved), Seller Central's own drafts included, then builds a brand-new plan from the boxes as they are NOW. Nothing
half-done is ever reused, so a box changed since the last press can't send stale contents. Stopping halfway, closing the browser or
Cancel all just mean: press again.

**A CONFIRMED plan is never cancelled automatically** (placement can't be reversed; a booked shipment may be inside its charge window).
If one exists and isn't marked shipped yet, Do shipment doesn't start a new one. It shows that shipment (FBA15…, warehouse) and
offers **Reprint labels** only. A confirmed plan is cleared by Mark shipped (ours) or by hand in Seller Central.

**Mark shipped stays its own button** (owner, 2026-11-12): it takes the stock off the C3-Amazon shelf and clears the boxes, pressed
when DPD collects, not when the plan is confirmed.

The two files (.txt / .xlsx) move behind a ⋯ as the backup.

## The steps underneath

Everything comes from the stored packed boxes (`amzshipment`). Your unpacked box never goes, same as Mark shipped now.

| Step | BCWEB calls | Notes |
|---|---|---|
| **1 Create plan** | `createInboundPlan`: items = Amazon SKU + qty totalled across boxes, `labelOwner` SELLER, `prepOwner` NONE (test plan), ship-from address from `.env`. Then `generatePackingOptions` → `listPackingOptions` → `confirmPackingOption`. | Replaces the .txt. **ONE PACK GROUP, ALWAYS** (owner): from `listPackingOptions` only an option with exactly one packing group is confirmed. If there is none, stop, confirm nothing and cancel the plan, with a message naming the SKUs Amazon wanted kept apart (so they can go on a separate shipment by hand). |
| **2 Boxes** | `setPackingInformation`: per box its items, `BOX_CONTENT_PROVIDED`, dimensions in CM and weight in KG straight from `amzshipment`. | Replaces the .xlsx. Our Box 1..n = Amazon's box order. Amazon's errors are shown per box. |
| **3 Warehouse** | `generatePlacementOptions` → `listPlacementOptions` → **only an option with exactly ONE shipment** → `confirmPlacementOption`. | **NEVER SPLIT, REGARDLESS OF PRICE** (owner, 2026-11-12). Price never decides anything here: a split is never taken, even if it's cheaper. If Amazon offers more than one single-shipment option (unlikely), take Amazon's first. If there's none, stop, confirm nothing and offer Cancel plan. The fee and the warehouse are shown before the press, for information only. **Placement fees are charged from this confirm on.** |
| **4 Carrier + dates** | `generateTransportationOptions` (ready-to-ship date **picked on screen**) → choose `USE_YOUR_OWN_CARRIER` / `GROUND_SMALL_PARCEL` / carrier **DPD `DPDX`** → delivery window (`generateDeliveryWindowOptions` → `confirmDeliveryWindowOptions`, every shipment has one) → `confirmTransportationOptions`. | **Our local DPD only, NEVER Amazon's DPD.** Anything `AMAZON_PARTNERED_CARRIER` is filtered out in code and never confirmed, even if it's the only one or the cheapest. If no own-carrier DPDX option comes back, stop. |
| **5 Box labels** | `getShipment` → shipment confirmation id (FBA15…); v0 `getLabels`, `PageType=PackageLabel_Thermal`, `LabelType=UNIQUE`, one per box. | PDF → `printPdfBase64` (QZ Tray → Zebra), the same path as the Royal Mail labels. Reprint any time. |
| **6 Shipped** | The existing Mark shipped, unchanged (no FBA15 id on the archive, owner 2026-11-12). | **Tracking (`updateShipmentTrackingDetails`) is parked** (owner, 2026-11-12: sort later), entered in Seller Central meanwhile. |

Steps 1–5 all run from the ONE button (above). The only human press is the confirm before 3 and 4 are CONFIRMED. **Cancel plan**
(`cancelInboundPlan`) is available up to that confirm. What it costs after the confirm is to check in the test plan.

## State

No resume state (every press starts clean, above). BCWEB only needs to know about a CONFIRMED shipment, for Reprint labels and Mark
shipped: its plan id, shipment id and FBA15 id. It can always re-read these from Amazon (ACTIVE plans with a confirmed placement),
so nothing is stored. **Not on the archive either** (owner, 2026-11-12: not needed): `amzshipment_archive` gets no FBA15 id /
plan id columns, no migration.

**Boxes are frozen once a plan is CONFIRMED.** Before that, changing a box is fine: the next press cancels the draft and starts again.
After Confirm, Unpack / Delete / Pack on a stored box refuse until Mark shipped. Otherwise what Amazon booked and what we packed drift apart.

## Build order (probe first, against Amazon's real replies)

0. ~~Read-only probe~~ **DONE 2026-11-12**, `scripts/amz-inbound-probe.js` (findings above). Re-run any time:
   `node scripts/amz-inbound-probe.js [--plans 3] [--out file.json]`.
1. ~~Test plan, then cancel~~ **DONE 2026-11-12** (findings above): a script creates a plan for 1–2 SKUs, runs steps 1–2, generates placement AND transport options without
   confirming, then `cancelInboundPlan`. That proves transport can be listed before the placement confirm (the one confirm box depends
   on it) and that a cancel before confirming is free. Needs the owner's OK: it creates a real draft in Seller Central (it shows as VOIDED,
   like the ~35 drafts already there).
2. **BUILT 2026-11-12, not yet used on a real shipment.** `utils/amzInbound.js` (THE copy, writes allow-listed), `POST /amz-inbound-start`, `GET /amz-inbound-status`, the Do shipment button on AMZ Shipment's Shipment panel (old files behind "Backup: files"). **Do shipment, part 1**: the button runs steps 1–2 and stops. The rest is finished in Seller Central for a while, where the plan shows up ready.
3. **Do shipment, full**: works out 3–4, the one confirm box (warehouse, fee, DPD, date), confirm → Zebra labels.
4. ~~**Step 6**: the FBA15 id carried into Mark shipped's archive.~~ **Dropped** (owner, 2026-11-12: not needed). Mark shipped stays as it is.
5. **Later**: DPD tracking per box (parked). Amazon's API has no "mark shipped" call: for our own courier, sending the tracking
   (`updateShipmentTrackingDetails`) is what tells Amazon the boxes are on their way. Proposal for then: BCWEB's Mark shipped asks
   for the DPD numbers (scan each box's label) and sends them, so one press does both. Received-per-SKU tracking is NOT wanted (owner: checked on Amazon).

## Open questions

- ~~Delivery window required?~~ Yes, every shipment has one (probe).
- ~~A plan left open?~~ Every press cancels unconfirmed drafts first (owner), the 9 Nov leftover included.
- ~~Transport before the placement confirm?~~ Yes (test plan).
