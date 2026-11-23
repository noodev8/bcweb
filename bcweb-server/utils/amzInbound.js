/*
=======================================================================================================================================
Util: utils/amzInbound.js   — "Do shipment": the Amazon inbound shipment made from BCWEB (SP-API Fulfillment Inbound v2024-03-20)
=======================================================================================================================================
THE copy of the rules. docs/amz-inbound/PLAN.md is the record (owner decisions, the probe's and the test plan's findings), read it first.

ONE PRESS, ONE STOP (part 1 built 2026-11-12, part 2 2026-11-13). Runs in the background (routes/amz-inbound-start.js), followed by
GET /amz-inbound-status:
  1. DRAFTS   every ACTIVE plan on Amazon is read. A BOOKED one (placement accepted = a real FBA15 shipment) is never cancelled by
              BCWEB. If its items are exactly our packed boxes, it IS this shipment: the run ends there showing it, with Reprint labels
              (a second press after Confirm, or after a server restart). Any other booked one stops the run: it's an earlier shipment not
              yet marked shipped in Seller Central. Every unconfirmed draft (ours AND Seller Central's) is CANCELLED, free, so each
              press starts clean (owner: "dont want to send wrong info - can it not clear any drafts and then go?").
  2. PREP     Amazon decides prep per SKU (prepDetails). Each SKU gets the owner Amazon allows: NONE, or SELLER for the ~57 "textile"
              ones (they go in shoe boxes as always, owner). AMAZON-only prep or labelling would cost money, so it STOPS.
     2b. SIZE  a SKU Amazon's catalogue has no package size / weight for gets 30 × 15 × 10 cm / 1 kg on our listing, only what is
              missing (fillPackageSize, owner 2026-11-19); without it Amazon refuses the plan.
  3. PLAN     createInboundPlan from the stored packed boxes (amzshipment, read at the press; "your box" never goes), our Welshpool address.
              "WARNING: Address was unable to be verified" comes every time and is harmless (Amazon's docs: warnings "can be ignored").
  4. PACK     generatePackingOptions → ONLY an option with exactly ONE pack group and no fee is confirmed (owner: never more than one).
              None → STOP, the plan is cancelled, and the message names which SKUs Amazon wanted in which group.
  5. BOXES    setPackingInformation: every box's SKUs and quantities, CM / KG, in our box order (Amazon numbers them U000001… in that order).
  6. WAREHOUSE generatePlacementOptions → ONLY an option with exactly ONE shipment (NEVER SPLIT, REGARDLESS OF PRICE — owner). None →
              STOP, plan cancelled. NOT confirmed yet: the job waits in state 'confirm' showing the warehouse and Amazon's fee.
              Amazon may offer several one-shipment options, one for our own carriers and one for its partnered ones (2026-11-19):
              all to the same warehouse at the same fee are kept, and the DPD chosen picks which is booked (onePlacements).
  ── THE ONE CONFIRM BOX (owner picks the ready-to-ship date, then the carrier, presses Confirm; Cancel = cancelInboundPlan, free) ──
     Picking a date asks Amazon for the carriers for that date (carriers(), free: generate + list only) and shows the two DPDs:
     OUR OWN DPD (USE_YOUR_OWN_CARRIER / GROUND_SMALL_PARCEL / DPDX, no quote, Amazon charges nothing) and AMAZON'S DPD
     (AMAZON_PARTNERED_CARRIER / GROUND_SMALL_PARCEL / DPDX, with Amazon's quote = what it charges). Both have carrier code DPDX, so
     the shippingSolution decides (test plan). And AMAZON'S UPS (AMAZON_PARTNERED_CARRIER / GROUND_SMALL_PARCEL / UPS, with its
     quote; owner 2026-11-23). The owner chooses (owner 2026-11-17, was own DPD only); no other carrier is offered.
  7. CARRIER  generateTransportationOptions again for the chosen date → the chosen carrier. Amazon's DPD / UPS only at or under the price
              shown: dearer now → back to the confirm box with the new price (nothing confirmed, plan kept).
  8. WINDOW   OUR OWN DPD ONLY (Amazon's docs: own-carrier options carry the precondition CONFIRMED_DELIVERY_WINDOW; the partnered
              workflow has no window step): generateDeliveryWindowOptions → the earliest AVAILABLE window on or after the ready date.
              7 and 8 are worked out BEFORE anything is confirmed: if either is missing, STOP and cancel the plan, still free.
  9. BOOK     confirmPlacementOption (placement fees are charged from here) → [confirmDeliveryWindowOptions, own DPD only] →
              confirmTransportationOptions (Amazon's DPD / UPS is charged from here).
              After the placement confirm nothing is ever cancelled automatically: a later failure says so and points to Seller Central.
 10. LABELS   the FBA15 id read back; the screen then fetches the box labels (labels() below: v0 getLabels, PackageLabel_Thermal,
              one 4×6 page per box in box order) and prints them on the Zebra.
 11. BOOK DPD its own button after Confirm, our own DPD only (2026-11-19): DPD consignment + labels on the DPD printer, and the tracking
              sent to Amazon straight away. See BOOK DPD below.

COSTS. Every write goes through post()/put(), which allow only the paths in ALLOWED (the tracking PUT only with DPD parcel numbers). The two confirms that can cost money carry a second
check on the ids themselves: a placement confirm only for an option vetted as ONE shipment, a transportation confirm only for an option
vetted at the confirm as the carrier the owner chose (own DPD: no quote; Amazon's DPD / UPS: priced at or under what the box showed).
No other carrier can ever be confirmed. A run that fails before the placement confirm cancels its plan (free).

BOOKED = FROZEN BOXES (PLAN.md: "Boxes are frozen once a plan is CONFIRMED"). From Confirm until Mark shipped, Pack and Delete refuse
(frozen(), checked by routes/amz-shipment-pack.js / -box-delete.js), so what Amazon booked and what we packed can't drift apart. Mark
shipped (routes/amz-shipment-ship.js) clears it. Held in memory (no table, owner rule); after a server restart the first status read
asks Amazon once (recover()), so the freeze comes back by itself when the booked shipment matches the boxes.

ONE AT A TIME, IN MEMORY. The job's progress lives in this process. A restart mid-run loses it, which is fine: the next press cancels the
half-made draft (or finds the booked shipment) and carries on from there.
=======================================================================================================================================
*/

const sp = require('./amzSpApi');
const dpdApi = require('./dpdApi');
const { query } = require('../database');
const { logActivity } = require('./bclog');
const logger = require('./logger');

const BASE = '/inbound/fba/2024-03-20';
const P = '^\\/inbound\\/fba\\/2024-03-20\\/inboundPlans';

// Our ship-from (Seller Central's own, exactly). Amazon REQUIRES a phone on it (Seller Central doesn't show one), kept in .env.
function shipFrom() {
  const phone = (process.env.AMZ_SHIP_FROM_PHONE || '').trim();
  if (!phone) throw new Error('AMZ_SHIP_FROM_PHONE is not set in bcweb-server/.env (Amazon requires a phone on the ship-from address)');
  return {
    name: 'Brookfield Comfort', companyName: 'Brookfield Comfort', addressLine1: '1 Cumberland Place', city: 'Welshpool',
    stateOrProvinceCode: 'Powys', postalCode: 'SY21 7SB', countryCode: 'GB', phoneNumber: phone,
  };
}

const LISTING = /^\/listings\/2021-08-01\/items\/[^/]+\/[^/]+$/;
const PACKAGE_ATTRS = ['/attributes/item_package_dimensions', '/attributes/item_package_weight'];

// The ONLY writes this util may send to Amazon.
const ALLOWED = [
  new RegExp(`${P}$`),                                                          // createInboundPlan
  /^\/inbound\/fba\/2024-03-20\/items\/prepDetails$/,                                // setPrepDetails — NONE on new UNKNOWN SKUs only (free)
  new RegExp(`${P}\\/[^/]+\\/packingOptions$`),                                 // generatePackingOptions
  new RegExp(`${P}\\/[^/]+\\/packingOptions\\/[^/]+\\/confirmation$`),          // confirmPackingOption (fees checked = 0)
  new RegExp(`${P}\\/[^/]+\\/packingInformation$`),                             // setPackingInformation
  new RegExp(`${P}\\/[^/]+\\/placementOptions$`),                               // generatePlacementOptions (free)
  new RegExp(`${P}\\/[^/]+\\/placementOptions\\/[^/]+\\/confirmation$`),        // confirmPlacementOption — vetted ONE-shipment ids only
  new RegExp(`${P}\\/[^/]+\\/transportationOptions$`),                          // generateTransportationOptions (free)
  new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/deliveryWindowOptions$`),      // generateDeliveryWindowOptions (free)
  new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/deliveryWindowOptions\\/[^/]+\\/confirmation$`), // confirmDeliveryWindowOptions (free)
  new RegExp(`${P}\\/[^/]+\\/transportationOptions\\/confirmation$`),           // confirmTransportationOptions — vetted chosen-DPD ids only
  new RegExp(`${P}\\/[^/]+\\/cancellation$`),                                   // cancelInboundPlan (unconfirmed only)
  LISTING,                                                                      // patchListingsItem — package size / weight ONLY (fillPackageSize)
  new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/trackingDetails$`),            // updateShipmentTrackingDetails — DPD parcel numbers only (bookDpd)
];
const PLACEMENT_CONFIRM = new RegExp(`${P}\\/[^/]+\\/placementOptions\\/([^/]+)\\/confirmation$`);
const TRANSPORT_CONFIRM = new RegExp(`${P}\\/[^/]+\\/transportationOptions\\/confirmation$`);
const TRACKING = new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/trackingDetails$`);
const DPD_PARCEL = /^\d{14}$/; // DPD's parcel number (spec v3.2: "the 14 digit number used to track the parcel")
// Filled ONLY by the rule checks below (run()'s kept one-shipment options / pickCarrier). The guard refuses a confirm for any id not in them.
const vettedPlacement = new Set();
const vettedTransport = new Set();

function guard(path, body) {
  if (!ALLOWED.some((re) => re.test(path))) throw new Error(`BLOCKED: ${path} is not an allowed Amazon write`);
  const pm = path.match(PLACEMENT_CONFIRM);
  if (pm && !vettedPlacement.has(pm[1])) throw new Error('BLOCKED: placement option not checked as ONE shipment');
  if (LISTING.test(path)) { // a listing patch may touch the package size / weight and nothing else (never price, stock, title…)
    const patches = (body && body.patches) || [];
    if (!patches.length || !patches.every((x) => x.op === 'replace' && PACKAGE_ATTRS.includes(x.path))) {
      throw new Error('BLOCKED: a listing patch here may only set the package size / weight');
    }
  }
  if (TRANSPORT_CONFIRM.test(path)) {
    const sel = (body && body.transportationSelections) || [];
    if (!sel.length || !sel.every((s) => vettedTransport.has(s.transportationOptionId))) {
      throw new Error('BLOCKED: transportation option not checked as the DPD chosen');
    }
  }
  if (TRACKING.test(path)) { // small-parcel tracking only, every id a DPD parcel number — never LTL, never anything else
    const t = (body && body.trackingDetails) || {};
    const items = (t.spdTrackingDetail && t.spdTrackingDetail.spdTrackingItems) || [];
    if (t.ltlTrackingDetail || !items.length || !items.every((x) => x.boxId && DPD_PARCEL.test(String(x.trackingId)))) {
      throw new Error('BLOCKED: tracking here may only be DPD parcel numbers, one per box');
    }
  }
}
const pace = () => sp.sleep(550); // most inbound operations allow ~2 a second
async function get(path, q) { const r = await sp.spGet(path, q); await pace(); return r; }
async function post(path, body) { guard(path, body); const r = await sp.spPost(path, body); await pace(); return r; }
async function put(path, body) { guard(path, body); const r = await sp.spPut(path, body); await pace(); return r; }
async function patch(path, body, q) { guard(path, body); const r = await sp.spPatch(path, body, q); await pace(); return r; }

// Every page of a list call. `key` is the array in the reply.
async function listAll(path, q, key) {
  const out = [];
  let paginationToken;
  do {
    const r = await get(path, { ...q, paginationToken });
    out.push(...(r[key] || []));
    paginationToken = r.pagination && r.pagination.nextToken;
  } while (paginationToken);
  return out;
}

class Stop extends Error {} // a rule said no: shown as a plain message, not as a failure
class Requote extends Stop {} // Amazon's DPD got dearer before anything was confirmed: back to the confirm box, plan kept

// Amazon's async operations. Returns the WARNING texts; an ERROR / FAILED throws with Amazon's words.
async function waitOp(operationId, what) {
  for (let i = 0; i < 120; i += 1) {
    const r = await sp.spGet(`${BASE}/operations/${operationId}`);
    if (r.operationStatus !== 'IN_PROGRESS') {
      const probs = r.operationProblems || [];
      const warnings = probs.filter((p) => p.severity !== 'ERROR').map((p) => String(p.message || p.code).replace(/^WARNING:\s*/, ''));
      if (r.operationStatus !== 'SUCCESS') {
        const errs = probs.filter((p) => p.severity === 'ERROR').map((p) => String(p.message || p.code).replace(/^ERROR:\s*/, ''));
        throw new Error(`${what}: Amazon said ${errs.join(' | ') || r.operationStatus}`);
      }
      return warnings;
    }
    await sp.sleep(2000);
  }
  throw new Error(`${what}: Amazon still working after 4 minutes`);
}

const feeTotal = (fees) => (fees || []).reduce((n, f) => n + Number((f.value && f.value.amount) || 0), 0);
// Amazon prefixes its own message; "Address was unable to be verified" is expected on every create, so it's left out of the screen.
const ADDRESS_WARNING = /address was unable to be verified/i;
const sellerCentral = (planId) => `https://sellercentral.amazon.co.uk/fba/sendtoamazon?wf=${planId}`;
const titleCase = (s) => String(s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

// ---- dates (Europe/London) ------------------------------------------------------------------------------------------------------
const todayLondon = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' }); // YYYY-MM-DD
// `hh`:00 London on `date`, as a UTC instant (BST-safe: 09:00Z reads as 10 in London in summer → one hour back).
function londonAt(date, hh) {
  const guess = new Date(`${date}T${String(hh).padStart(2, '0')}:00:00Z`);
  const shown = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', hourCycle: 'h23' }).format(guess));
  return new Date(guess.getTime() - (shown - hh) * 3600000);
}
// The ready-to-ship start Amazon gets: 09:00 London on the chosen day, or 15 minutes from now when that's today and 09:00 has passed.
function readyStart(date) {
  const nine = londonAt(date, 9);
  const soon = new Date(Date.now() + 15 * 60000);
  return (nine < soon ? soon : nine).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// ---- the stored shipment --------------------------------------------------------------------------------------------------------
// Packed boxes in box order: [{ box, dims: { length, width, height, weight } (numbers or NaN), lines: [{ sku, code, qty }] }].
async function readBoxes() {
  const rows = (await query(
    `SELECT box, code, COALESCE(sku, '') AS sku, COALESCE(qty, 0) AS qty,
            MAX(length) OVER w AS length, MAX(width) OVER w AS width, MAX(height) OVER w AS height, MAX(weight) OVER w AS weight
       FROM amzshipment
     WINDOW w AS (PARTITION BY box)
      ORDER BY box, code`
  )).rows;
  const boxes = [];
  for (const r of rows) {
    let b = boxes[boxes.length - 1];
    if (!b || b.box !== r.box) {
      b = { box: r.box, dims: { length: Number(r.length), width: Number(r.width), height: Number(r.height), weight: Number(r.weight) }, lines: [] };
      boxes.push(b);
    }
    if (Number(r.qty) > 0) b.lines.push({ sku: String(r.sku).trim(), code: r.code, qty: Number(r.qty) });
  }
  return boxes.filter((b) => b.lines.length); // an empty box isn't sent (as the .xlsx fill left it out)
}

// Checks before anything goes to Amazon. Returns { boxes, units } or throws Stop with what to fix.
function checkBoxes(boxes) {
  if (!boxes.length) throw new Stop('No packed boxes to send.');
  const unmeasured = boxes.filter((b) => !['length', 'width', 'height', 'weight'].every((k) => Number.isFinite(b.dims[k]) && b.dims[k] > 0));
  if (unmeasured.length) throw new Stop(`Box ${unmeasured.map((b) => b.box).join(', ')} has no size or weight. Unpack and pack it again.`);
  const noSku = boxes.flatMap((b) => b.lines.filter((l) => !l.sku).map((l) => `${l.code} (box ${b.box})`));
  if (noSku.length) throw new Stop(`No Amazon SKU for ${noSku.join(', ')}.`);
  // kg = every box's weighed total (what Amazon is sent per box), shown on the confirm box beside boxes / units (owner 2026-11-17).
  const kg = Math.round(boxes.reduce((n, b) => n + b.dims.weight, 0) * 10) / 10;
  return { boxes: boxes.length, units: boxes.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.qty, 0), 0), kg };
}

// Amazon SKU → units across every box.
function skuTotals(boxes) {
  const m = new Map();
  for (const b of boxes) for (const l of b.lines) m.set(l.sku, (m.get(l.sku) || 0) + l.qty);
  return m;
}
const sameTotals = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

// ---- Amazon reads --------------------------------------------------------------------------------------------------------------
async function activePlanDetails() {
  const plans = await listAll(`${BASE}/inboundPlans`, { status: 'ACTIVE', pageSize: 30 }, 'inboundPlans');
  const out = [];
  for (const p of plans) out.push(await get(`${BASE}/inboundPlans/${p.inboundPlanId}`));
  return out;
}
const isBooked = (plan) => (plan.placementOptions || []).some((o) => o.status === 'ACCEPTED');

// What the screen shows of a booked shipment (and what labels() needs).
async function describeBooked(plan) {
  // The ACCEPTED placement's shipment: a plan can carry one shipment per placement option offered (see onePlacements).
  const acc = (plan.placementOptions || []).find((o) => o.status === 'ACCEPTED');
  const sid = (acc && (acc.shipmentIds || [])[0]) || ((plan.shipments || [])[0] || {}).shipmentId;
  const sh = sid ? await get(`${BASE}/inboundPlans/${plan.inboundPlanId}/shipments/${sid}`).catch(() => null) : null;
  const d = (sh && sh.destination) || {};
  const w = (sh && sh.selectedDeliveryWindow) || null;
  return {
    planId: plan.inboundPlanId, shipmentId: sid || null, fba: (sh && sh.shipmentConfirmationId) || null,
    warehouse: d.warehouseId || null, town: titleCase(d.address && d.address.city),
    carrierSet: !!(sh && sh.selectedTransportationOptionId),
    window: w ? { start: String(w.startDate || '').slice(0, 10), end: String(w.endDate || '').slice(0, 10) } : null,
    tracking: trackingOf(sh), // the tracking Amazon holds per box (Book DPD sends it), in box order
    sellerCentral: sellerCentral(plan.inboundPlanId),
  };
}
// [{ boxId, trackingId }] from a getShipment reply, U000001 first (read 2026-11-19 on FBA15MY3PC4M: spdTrackingDetail.spdTrackingItems).
function trackingOf(sh) {
  const items = (sh && sh.trackingDetails && sh.trackingDetails.spdTrackingDetail && sh.trackingDetails.spdTrackingDetail.spdTrackingItems) || [];
  return items.filter((x) => x.boxId && x.trackingId).map((x) => ({ boxId: x.boxId, trackingId: String(x.trackingId) }))
    .sort((a, b) => a.boxId.localeCompare(b.boxId));
}

// A booked plan whose items are exactly these boxes' SKU totals = this shipment, already booked.
async function planMatches(plan, totals) {
  const items = await listAll(`${BASE}/inboundPlans/${plan.inboundPlanId}/items`, { pageSize: 1000 }, 'items');
  const theirs = new Map();
  for (const it of items) theirs.set(it.msku, (theirs.get(it.msku) || 0) + Number(it.quantity || 0));
  return sameTotals(theirs, totals);
}

// prepOwner / labelOwner per SKU, as Amazon allows. Stops on a SKU Amazon doesn't know or one only Amazon may prep / label (a cost).
async function prepFor(mskus) {
  const details = [];
  for (let i = 0; i < mskus.length; i += 50) {
    const r = await get(`${BASE}/items/prepDetails`, { marketplaceId: sp.marketplaceId(), mskus: mskus.slice(i, i + 50) });
    details.push(...(r.mskuPrepDetails || []));
  }
  // A SKU with no prep category (UNKNOWN, e.g. a brand-new listing like the Padders, 2026-11-17) stops the plan: "Prep classification
  // for this SKU was missing". Set it the way it is set by hand in Seller Central — No prep needed (category NONE, type ITEM_NO_PREP;
  // Amazon refuses a bare 'NONE') — then READ IT BACK, because Amazon decides the owner rules after the change (tested on
  // REPOSE-TAUPE-05-2611: it came back prepOwner SELLER_ONLY + MUST_MATCH, not the NONE_ONLY older SKUs show).
  const unset = details.filter((d) => !d.prepCategory || d.prepCategory === 'UNKNOWN').map((d) => d.msku);
  if (unset.length) {
    for (let i = 0; i < unset.length; i += 50) {
      const r = await post(`${BASE}/items/prepDetails`, {
        marketplaceId: sp.marketplaceId(),
        mskuPrepDetails: unset.slice(i, i + 50).map((msku) => ({ msku, prepCategory: 'NONE', prepTypes: ['ITEM_NO_PREP'] })),
      });
      if (r && r.operationId) await waitOp(r.operationId, `Setting No prep needed on ${unset.length} new SKU${unset.length === 1 ? '' : 's'}`);
    }
    const fresh = new Map();
    for (let i = 0; i < unset.length; i += 50) {
      const r = await get(`${BASE}/items/prepDetails`, { marketplaceId: sp.marketplaceId(), mskus: unset.slice(i, i + 50) });
      for (const d of (r.mskuPrepDetails || [])) fresh.set(d.msku, d);
    }
    const still = unset.filter((m) => !fresh.has(m) || !fresh.get(m).prepCategory || fresh.get(m).prepCategory === 'UNKNOWN');
    if (still.length) throw new Stop(`Amazon still has no prep category for ${still.join(', ')}. Set "No prep needed" on them in Seller Central and try again.`);
    for (let i = 0; i < details.length; i += 1) if (fresh.has(details[i].msku)) details[i] = fresh.get(details[i].msku);
  }
  const by = new Map(details.map((d) => [d.msku, d]));
  const unknown = mskus.filter((m) => !by.has(m));
  if (unknown.length) throw new Stop(`Amazon doesn't know these SKUs: ${unknown.join(', ')}.`);
  const amazonOnly = mskus.filter((m) => by.get(m).prepOwnerConstraint === 'AMAZON_ONLY' || by.get(m).labelOwnerConstraint === 'AMAZON_ONLY');
  if (amazonOnly.length) throw new Stop(`Amazon wants to prep or label ${amazonOnly.join(', ')} itself, which it charges for. Take them out of the boxes.`);
  const owners = new Map();
  let textile = 0;
  for (const m of mskus) {
    const d = by.get(m);
    const prepOwner = d.prepOwnerConstraint === 'NONE_ONLY' ? 'NONE'
      : d.prepOwnerConstraint === 'SELLER_ONLY' ? 'SELLER'
        : (d.prepCategory === 'NONE' ? 'NONE' : 'SELLER');
    // sellerPrep counts SKUs with real prep to do (polybag a textile), not a No-prep SKU Amazon happens to want owned by SELLER.
    if (d.prepCategory !== 'NONE') textile += 1;
    // labelOwner is always SELLER (we label every unit); with allOwnersConstraint MUST_MATCH a SELLER prepOwner then matches.
    owners.set(m, { prepOwner, labelOwner: 'SELLER' });
  }
  return { owners, sellerPrep: textile };
}

// PACKAGE SIZE (owner 2026-11-19: "can it be 30, 15, 10 cm and 1kg weight ( for skus that need dimensions )"). Amazon refuses the plan
// for a SKU its catalogue has no package dimensions for: "This product is missing necessary information; dimensions need to be
// provided in the manufacturer's original packaging" (2026-11-19: FLE030-IVES-BLACKSOLE-09-2611 had none, FLE030-IVES-GREY-03-2611
// only a weight). Each SKU's package is read from the catalogue (by SKU, 20 a call); a missing size gets 30 × 15 × 10 cm, a missing
// weight 1 kg, set on OUR listing (patchListingsItem item_package_dimensions / item_package_weight — Amazon answered VALID in a
// validation preview on both SKUs). Only what is missing is sent: a weight Amazon already has is never replaced with the guess.
// Amazon may take a while to take them in, so the plan is still tried; if it refuses for dimensions, the run says to press again.
const FILL_CM = { length: 30, width: 15, height: 10 };
const FILL_KG = 1;
async function fillPackageSize(mskus) {
  const mkt = sp.marketplaceId();
  const found = new Map();
  for (let i = 0; i < mskus.length; i += 20) {
    const r = await get('/catalog/2022-04-01/items', {
      identifiers: mskus.slice(i, i + 20), identifiersType: 'SKU', sellerId: sp.sellerId(), marketplaceIds: mkt,
      includedData: 'dimensions,identifiers,productTypes', pageSize: 20,
    });
    for (const it of r.items || []) {
      for (const g of it.identifiers || []) for (const id of g.identifiers || []) if (id.identifierType === 'SKU') found.set(id.identifier, it);
    }
  }
  const has = (v) => v && Number(v.value) > 0;
  const sent = [];
  for (const m of mskus) {
    const it = found.get(m);
    if (!it) continue; // a SKU the catalogue can't find by SKU: left to Amazon's own answer on the plan
    const pkg = (((it.dimensions || []).find((d) => d.marketplaceId === mkt) || (it.dimensions || [])[0]) || {}).package || {};
    const needSize = !(has(pkg.length) && has(pkg.width) && has(pkg.height));
    const needWeight = !has(pkg.weight);
    if (!needSize && !needWeight) continue;
    const cm = (v) => ({ value: v, unit: 'centimeters' });
    const patches = [];
    if (needSize) patches.push({ op: 'replace', path: '/attributes/item_package_dimensions', value: [{ length: cm(FILL_CM.length), width: cm(FILL_CM.width), height: cm(FILL_CM.height), marketplace_id: mkt }] });
    if (needWeight) patches.push({ op: 'replace', path: '/attributes/item_package_weight', value: [{ value: FILL_KG, unit: 'kilograms', marketplace_id: mkt }] });
    const productType = ((it.productTypes || []).find((p) => p.marketplaceId === mkt) || (it.productTypes || [])[0] || {}).productType || 'SHOES';
    const r = await patch(`/listings/2021-08-01/items/${encodeURIComponent(sp.sellerId())}/${encodeURIComponent(m)}`,
      { productType, patches }, { marketplaceIds: mkt, includedData: 'issues' });
    const errs = ((r && r.issues) || []).filter((x) => x.severity === 'ERROR');
    if (!r || r.status !== 'ACCEPTED') throw new Stop(`Amazon refused the package size for ${m}: ${errs.map((x) => x.message).join(' · ') || (r && r.status) || 'no answer'}.`);
    sent.push(`${m} (${[needSize && `${FILL_CM.length}×${FILL_CM.width}×${FILL_CM.height} cm`, needWeight && `${FILL_KG} kg`].filter(Boolean).join(', ')})`);
  }
  return sent;
}
const DIMENSIONS_REFUSED = /dimensions need to be provided|missing necessary information/i;

// ---- the rules on Amazon's options ------------------------------------------------------------------------------------------------
// NEVER SPLIT: an option with exactly one shipment, whatever it costs (price never decides). Finder only: run() vets the ones it keeps.
// SEVERAL ONE-SHIPMENT OPTIONS, ONE PER CARRIER KIND (read 2026-11-19 on wff955e362…): Amazon offered two, both CWL1 and £0 — one
// listing only our own carriers, the other only its partnered ones (its DPD £59.14). Taking just the first hid Amazon's DPD (Seller
// Central shows both). So every one-shipment option to the SAME warehouse at the SAME fee as Amazon's first is kept (the confirm box
// is then true for any of them), and the carrier chosen decides which one is booked.
function onePlacements(options) {
  return options.filter((x) => (x.shipmentIds || []).length === 1);
}
// THE TWO DPDs. Both are carrier DPDX, so the shippingSolution decides (test plan). Finders only; pickCarrier vets the one chosen (Amazon's UPS below).
const forShipment = (x, shipmentId) => !x.shipmentId || x.shipmentId === shipmentId;
const isDpd = (x) => x.shippingMode === 'GROUND_SMALL_PARCEL' && x.carrier && x.carrier.alphaCode === 'DPDX';
// Amazon's price on an option (quote.cost.amount), or null when it has none.
function quoteOf(o) {
  const c = o && o.quote && o.quote.cost;
  const n = c ? Number(c.amount) : NaN;
  return Number.isFinite(n) ? n : null;
}
// Our own DPD: Amazon charges nothing (an own-carrier option WITH a quote is never taken).
function ownDpd(options, shipmentId) {
  return options.find((x) => x.shippingSolution === 'USE_YOUR_OWN_CARRIER' && isDpd(x) && !x.quote && forShipment(x, shipmentId)) || null;
}
// Amazon's DPD: Amazon books and charges it, the price is its quote. One without a price is never offered.
function amazonDpd(options, shipmentId) {
  return options.find((x) => x.shippingSolution === 'AMAZON_PARTNERED_CARRIER' && isDpd(x) && quoteOf(x) !== null && forShipment(x, shipmentId)) || null;
}
// Amazon's UPS (owner, 2026-11-23: "also get UPS … and show the price, just like we do for amz dpd"): Amazon books and charges it,
// the price is its quote. The test plan saw it (£2.45 against Amazon's DPD £2.86) but didn't keep its carrier code, and shipped plans
// keep only the option chosen, so it's matched on UPS in the code OR the name (UPS's code is normally UPSN). Check on the first box.
const isUps = (x) => x.shippingMode === 'GROUND_SMALL_PARCEL' && x.carrier
  && (/^UPS/i.test(String(x.carrier.alphaCode || '')) || /\bUPS\b/i.test(String(x.carrier.name || '')));
function amazonUps(options, shipmentId) {
  return options.find((x) => x.shippingSolution === 'AMAZON_PARTNERED_CARRIER' && isUps(x) && quoteOf(x) !== null && forShipment(x, shipmentId)) || null;
}
// What the confirm box shows of an Amazon carrier (its DPD or UPS).
function priceOf(o) {
  return o ? { cost: quoteOf(o), currency: (o.quote.cost && o.quote.cost.code) || 'GBP', voidableUntil: o.quote.voidableUntil || null, expires: o.quote.expiration || null } : null;
}
// carrier: 'own' (our own DPD) | 'amazon' (Amazon's DPD) | 'ups' (Amazon's UPS). The two Amazon ones are charged, at their quote.
const CARRIERS = ['own', 'amazon', 'ups'];
const charged = (carrier) => carrier === 'amazon' || carrier === 'ups';
const carrierName = (carrier) => ({ amazon: 'Amazon\'s DPD', ups: 'Amazon\'s UPS' }[carrier] || 'our own DPD');
const finderFor = (carrier) => ({ amazon: amazonDpd, ups: amazonUps }[carrier] || ownDpd);
// The carrier the owner chose, vetted for the transportation confirm. Amazon's DPD / UPS only at or under the price the box showed
// (maxCost). Throws Stop (not offered) or Requote (dearer than shown).
function pickCarrier(options, shipmentId, carrier, maxCost) {
  const name = carrierName(carrier);
  const o = finderFor(carrier)(options, shipmentId);
  if (charged(carrier)) {
    if (!o) throw new Stop(`Amazon didn't offer ${name} for this shipment any more.`);
    if (quoteOf(o) > maxCost + 0.005) throw new Requote(`${name} now costs £${quoteOf(o).toFixed(2)}, not the £${maxCost.toFixed(2)} shown. Nothing was booked: check the price and confirm again.`);
  } else if (!o) {
    throw new Stop('Amazon didn\'t offer our own DPD for this shipment.');
  }
  vettedTransport.add(o.transportationOptionId);
  return o;
}
// The earliest AVAILABLE delivery window starting on or after the ready-to-ship date.
function windowFor(options, readyDate) {
  return options
    .filter((w) => w.availabilityType === 'AVAILABLE' && String(w.startDate || '').slice(0, 10) >= readyDate)
    .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)))[0] || null;
}

// ---- the job ---------------------------------------------------------------------------------------------------------------------
// job (what the screen sees): { id, by, startedAt, finishedAt, state, step, log[], warnings[], message, totals, confirm, result }
//   state: 'running' | 'confirm' (waiting on the one confirm box) | 'done' (booked: result) | 'stopped' | 'failed'
// ctx (server only): the ids the confirm needs, never sent to the screen.
let job = null;
let ctx = null;
let seq = 0;
let booked = null;     // the booked shipment while its boxes are frozen: { planId, shipmentId, fba, … } (see BOOKED = FROZEN BOXES)
let recovered = false; // recover() has asked Amazon once since this process started

// The job as the screen sees it, with this process's DPD booking (BOOK DPD below) on the booked result.
function snapshot() {
  if (!job) return null;
  const s = JSON.parse(JSON.stringify(job));
  if (s.result && dpd && dpd.amzShipmentId === s.result.shipmentId) s.result.dpd = dpdView();
  return s;
}

function say(text) {
  job.step = text;
  job.log.push({ at: new Date().toISOString(), text });
}

function newJob(by, totals) {
  seq += 1;
  ctx = null;
  job = { id: seq, by, startedAt: new Date().toISOString(), finishedAt: null, state: 'running', step: 'Starting', log: [], warnings: [], message: null, notice: null, totals, confirm: null, result: null };
}

async function cancelPlan(planId) {
  await waitOp((await put(`${BASE}/inboundPlans/${planId}/cancellation`)).operationId, 'Cancelling the plan');
}

// End a run that went wrong. Before the placement confirm the plan is cancelled (free); after it, never.
async function fail(e, planId, placed) {
  if (e instanceof Requote && !placed) { // nothing confirmed: the plan stays, the box shows the new price
    job.state = 'confirm';
    job.notice = e.message;
    say('Waiting for Confirm');
    return;
  }
  const stopped = e instanceof Stop;
  job.state = stopped ? 'stopped' : 'failed';
  job.message = e.message;
  if (!stopped) logger.error('[amzInbound] Do shipment failed:', e.message);
  if (planId && placed) {
    job.message += ' The warehouse IS booked, so nothing was cancelled: finish the carrier and date in Seller Central.';
    job.sellerCentral = sellerCentral(planId);
  } else if (planId) {
    try {
      await cancelPlan(planId);
      job.message += ' The plan was cancelled, nothing booked.';
    } catch (ce) {
      job.message += ` Cancelling the plan failed too (${ce.message}). The next press clears it.`;
    }
  }
  logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment ${job.state}: ${job.message}` });
}

// Called by the route. Reads + checks the boxes NOW (so a stale screen or an unmeasured box answers at once), then runs in the
// background. Returns { busy } | { stop } | { stale } | { job }.
async function start({ by, expect }) {
  if (job && job.state === 'running') return { busy: snapshot() };
  sp.marketplaceId();
  shipFrom(); // throws when the phone is missing, before anything is sent
  const boxes = await readBoxes();
  let totals;
  try { totals = checkBoxes(boxes); } catch (e) { if (e instanceof Stop) return { stop: e.message }; throw e; }
  if (expect && (Number(expect.boxes) !== totals.boxes || Number(expect.units) !== totals.units)) {
    return { stale: `The boxes changed since this screen loaded (now ${totals.boxes} boxes, ${totals.units} units). Reload the page and press again.` };
  }
  newJob(by, totals);
  run(boxes, totals).catch(() => {}); // never throws (see run)
  return { job: snapshot() };
}

// Steps 1–6, then wait for the confirm box.
async function run(boxes, totals) {
  let planId = null;
  try {
    // 1. Drafts, and an already-booked shipment
    say('Checking Amazon for drafts');
    const qtyBySku = skuTotals(boxes);
    const details = await activePlanDetails();
    const bookedPlans = details.filter(isBooked);
    for (const d of bookedPlans) {
      if (await planMatches(d, qtyBySku)) { // this very shipment, booked already: show it, offer the labels
        booked = await describeBooked(d);
        job.state = 'done';
        job.result = { ...booked, boxes: totals.boxes, units: totals.units, already: true };
        say('Already booked');
        return;
      }
    }
    if (bookedPlans.length) {
      const names = [];
      for (const d of bookedPlans) {
        const b = await describeBooked(d);
        names.push(b.fba ? `${b.fba}${b.warehouse ? ` to ${b.warehouse}` : ''}` : d.inboundPlanId);
      }
      throw new Stop(`An earlier booked Amazon shipment isn't marked shipped in Seller Central yet (${names.join(', ')}). Mark it shipped there (with its DPD tracking), then press again.`);
    }
    for (const d of details) {
      say(`Cancelling an old draft${d.name ? ` (${d.name})` : ''}`);
      await cancelPlan(d.inboundPlanId);
    }

    // 2. Prep
    say('Reading prep from Amazon');
    const { owners, sellerPrep } = await prepFor([...qtyBySku.keys()]);
    const item = (msku, quantity) => ({ msku, quantity, ...owners.get(msku) });

    // 2b. Package size for SKUs Amazon has none for (fillPackageSize)
    say('Checking package sizes on Amazon');
    const filled = await fillPackageSize([...qtyBySku.keys()]);
    if (filled.length) {
      job.warnings.push(`Package size sent to Amazon for ${filled.join(', ')}.`);
      logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment: package size sent to Amazon for ${filled.join(', ')}` });
    }

    // 3. Plan
    say(`Creating the plan: ${qtyBySku.size} SKUs, ${totals.units} units`);
    const stamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
    const created = await post(`${BASE}/inboundPlans`, {
      name: `BCWEB ${stamp}`.slice(0, 40),
      destinationMarketplaces: [sp.marketplaceId()],
      items: [...qtyBySku].map(([msku, q]) => item(msku, q)),
      sourceAddress: shipFrom(),
    });
    planId = created.inboundPlanId;
    try {
      job.warnings.push(...(await waitOp(created.operationId, 'Creating the plan')).filter((w) => !ADDRESS_WARNING.test(w)));
    } catch (e) {
      if (filled.length && DIMENSIONS_REFUSED.test(e.message)) {
        throw new Stop(`The package size was sent to Amazon for ${filled.length} SKU${filled.length === 1 ? '' : 's'}, but Amazon hasn't taken it in yet. Press Do shipment again in 15 minutes.`);
      }
      throw e;
    }

    // 4. One pack group
    say('Getting the pack group');
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/packingOptions`)).operationId, 'Getting pack groups');
    const packs = await listAll(`${BASE}/inboundPlans/${planId}/packingOptions`, {}, 'packingOptions');
    const pack = packs.find((o) => (o.packingGroups || []).length === 1 && feeTotal(o.fees) === 0);
    if (!pack) {
      const split = packs.find((o) => (o.packingGroups || []).length > 1);
      let detail = '';
      if (split) {
        const groups = [];
        for (const g of split.packingGroups) {
          const it = await get(`${BASE}/inboundPlans/${planId}/packingGroups/${g}/items`).catch(() => ({ items: [] }));
          groups.push((it.items || []).map((x) => x.msku).join(', '));
        }
        detail = ` Amazon wants them kept apart: ${groups.map((g, i) => `group ${i + 1}: ${g}`).join(' / ')}.`;
      }
      throw new Stop(`Amazon won't take these as ONE pack group.${detail}`);
    }
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/packingOptions/${pack.packingOptionId}/confirmation`)).operationId, 'Confirming the pack group');

    // 5. Boxes, in our box order
    say(`Sending ${boxes.length} boxes`);
    const sent = await post(`${BASE}/inboundPlans/${planId}/packingInformation`, {
      packageGroupings: [{
        packingGroupId: pack.packingGroups[0],
        boxes: boxes.map((b) => ({
          contentInformationSource: 'BOX_CONTENT_PROVIDED',
          dimensions: { length: b.dims.length, width: b.dims.width, height: b.dims.height, unitOfMeasurement: 'CM' },
          weight: { value: b.dims.weight, unit: 'KG' },
          quantity: 1,
          items: b.lines.map((l) => item(l.sku, l.qty)),
        })),
      }],
    });
    job.warnings.push(...await waitOp(sent.operationId, 'Sending the boxes'));

    // 6. Warehouse: ONE shipment, never split. Worked out, NOT confirmed.
    say('Getting the warehouse');
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/placementOptions`)).operationId, 'Getting warehouses');
    const places = await listAll(`${BASE}/inboundPlans/${planId}/placementOptions`, {}, 'placementOptions');
    const singles = onePlacements(places);
    if (!singles.length) throw new Stop(`Amazon only offers to SPLIT this shipment over ${Math.min(...places.map((o) => (o.shipmentIds || []).length)) || 'several'} warehouses. We never split.`);
    const place = singles[0];
    const shipmentId = place.shipmentIds[0];
    const sh = await get(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}`);
    const dest = sh.destination || {};
    const options = [{ placementOptionId: place.placementOptionId, shipmentId }];
    for (const o of singles.slice(1)) { // same warehouse, same fee as the first, or left out (see onePlacements)
      if (feeTotal(o.fees) !== feeTotal(place.fees)) continue;
      const s2 = await get(`${BASE}/inboundPlans/${planId}/shipments/${o.shipmentIds[0]}`);
      if ((s2.destination || {}).warehouseId === dest.warehouseId) options.push({ placementOptionId: o.placementOptionId, shipmentId: o.shipmentIds[0] });
    }
    for (const o of options) vettedPlacement.add(o.placementOptionId);

    ctx = { planId, options, qtyBySku };
    job.state = 'confirm';
    job.confirm = {
      warehouse: dest.warehouseId || '?', town: titleCase(dest.address && dest.address.city),
      fee: feeTotal(place.fees),
      fees: (place.fees || []).map((f) => ({ text: f.description || f.type || 'Fee', amount: Number((f.value && f.value.amount) || 0), currency: (f.value && f.value.code) || 'GBP' })),
      expires: place.expiration || null,
      skus: qtyBySku.size, sellerPrep, today: todayLondon(),
    };
    say('Waiting for Confirm');
  } catch (e) {
    await fail(e, planId, false);
  } finally {
    if (job.state !== 'confirm' && job.state !== 'running') job.finishedAt = new Date().toISOString();
  }
}

// Transport options for one kept placement option c = { planId, placementOptionId, shipmentId }: generate for a ready date (free), list.
const listTransport = (c) => listAll(`${BASE}/inboundPlans/${c.planId}/transportationOptions`, { placementOptionId: c.placementOptionId, pageSize: 20 }, 'transportationOptions');
async function genTransport(c, readyDate) {
  await waitOp((await post(`${BASE}/inboundPlans/${c.planId}/transportationOptions`, {
    placementOptionId: c.placementOptionId,
    shipmentTransportationConfigurations: [{ shipmentId: c.shipmentId, readyToShipWindow: { start: readyStart(readyDate) } }],
  })).operationId, 'Getting carriers');
}
const goodDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || '')) && d >= todayLondon();

// Every kept placement option (see onePlacements), each with its transport options for the date: [{ c, opts }]. Free.
async function transportByPlacement(readyDate) {
  const out = [];
  for (const o of ctx.options) {
    const c = { planId: ctx.planId, ...o };
    await genTransport(c, readyDate);
    out.push({ c, opts: await listTransport(c) });
  }
  return out;
}

// THE CONFIRM BOX's carriers for the date picked: is our own DPD offered, and Amazon's DPD and UPS with their prices. Free (generate + list).
// Returns { error } | { carriers: { readyDate, own, amazon: { cost, currency, voidableUntil, expires } | null, ups: same | null } }.
async function carriers({ id, readyDate }) {
  if (!job || job.id !== Number(id) || job.state !== 'confirm' || !ctx) return { error: 'NOT_WAITING' };
  if (!goodDate(readyDate)) return { error: 'BAD_DATE' };
  const all = await transportByPlacement(readyDate);
  const own = all.some(({ c, opts }) => ownDpd(opts, c.shipmentId));
  const first = (finder) => all.map(({ c, opts }) => finder(opts, c.shipmentId)).find(Boolean) || null;
  return { carriers: { readyDate, own, amazon: priceOf(first(amazonDpd)), ups: priceOf(first(amazonUps)) } };
}

// THE CONFIRM BOX's Confirm. carrier 'own' | 'amazon' | 'ups'; for Amazon's DPD / UPS, maxCost = the price the box showed (never
// paid above it). Returns { error } | { job }; the booking runs in the background.
async function confirm({ id, readyDate, carrier, maxCost, expect }) {
  if (!job || job.id !== Number(id) || job.state !== 'confirm' || !ctx) return { error: 'NOT_WAITING' };
  if (!goodDate(readyDate)) return { error: 'BAD_DATE' };
  if (!CARRIERS.includes(carrier)) return { error: 'BAD_CARRIER' };
  const cap = Number(maxCost);
  if (charged(carrier) && !(maxCost !== null && maxCost !== undefined && maxCost !== '' && Number.isFinite(cap) && cap >= 0)) return { error: 'BAD_CARRIER' };
  const boxes = await readBoxes();
  const now = skuTotals(boxes);
  const changed = !sameTotals(now, ctx.qtyBySku)
    || (expect && (Number(expect.boxes) !== boxes.length || Number(expect.units) !== job.totals.units))
    || boxes.length !== job.totals.boxes;
  job.state = 'running';
  if (changed) {
    say('Boxes changed');
    await fail(new Stop('The boxes changed after Do shipment was pressed, so nothing was booked. Press Do shipment again.'), ctx.planId, false);
    job.finishedAt = new Date().toISOString();
    return { job: snapshot() };
  }
  job.readyDate = readyDate;
  job.notice = null;
  book(readyDate, carrier, cap).catch(() => {}); // never throws
  return { job: snapshot() };
}

// Steps 7–10. carrier 'own' | 'amazon' | 'ups'; maxCost = Amazon's DPD / UPS price the box showed.
async function book(readyDate, carrier, maxCost) {
  const planId = ctx.planId;
  const name = carrierName(carrier);
  const own = carrier === 'own';
  let placed = false;
  try {
    // 7. The chosen carrier, for the chosen date — before anything is confirmed. The kept placement option that offers it is the one booked.
    say(`Getting ${name}`);
    const all = await transportByPlacement(readyDate);
    const hit = all.find(({ c: x, opts }) => finderFor(carrier)(opts, x.shipmentId)) || all[0];
    const c = hit.c;
    const { placementOptionId, shipmentId } = c;
    let dpd = pickCarrier(hit.opts, shipmentId, carrier, maxCost); // none offered anywhere → Stop; Amazon's dearer → Requote

    // 8. Delivery window (our own DPD only) — before anything is confirmed
    const listWindows = () => listAll(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`, {}, 'deliveryWindowOptions');
    const genWindows = async () => waitOp((await post(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`)).operationId, 'Getting delivery windows');
    let win = null;
    if (own) {
      say('Getting the delivery window');
      await genWindows();
      win = windowFor(await listWindows(), readyDate);
      if (!win) throw new Stop(`Amazon offered no delivery window starting on or after ${readyDate}. Try another date.`);
    }

    // 9. Book: placement (fees from here on — never cancelled automatically after this), then the window, then the DPD
    say(`Booking ${job.confirm.warehouse}`);
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/placementOptions/${placementOptionId}/confirmation`)).operationId, 'Booking the warehouse');
    placed = true;
    booked = { planId, shipmentId, fba: null }; // frozen from here (see BOOKED = FROZEN BOXES)

    // The options worked out before the confirm are used if Amazon still lists them; otherwise asked again (same rules).
    if (own) {
      if (!(await listWindows()).some((w) => w.deliveryWindowOptionId === win.deliveryWindowOptionId)) {
        await genWindows();
        win = windowFor(await listWindows(), readyDate);
        if (!win) throw new Stop(`Amazon offered no delivery window starting on or after ${readyDate} once booked.`);
      }
      say('Confirming the delivery window');
      await waitOp((await post(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions/${win.deliveryWindowOptionId}/confirmation`)).operationId, 'Confirming the delivery window');
    }

    if (!(await listTransport(c)).some((o) => o.transportationOptionId === dpd.transportationOptionId)) {
      await genTransport(c, readyDate);
      dpd = pickCarrier(await listTransport(c), shipmentId, carrier, maxCost); // after the placement, dearer = a stop (Seller Central)
    }
    say(`Confirming ${name}`);
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/transportationOptions/confirmation`, {
      transportationSelections: [{ shipmentId, transportationOptionId: dpd.transportationOptionId }],
    })).operationId, `Confirming ${name}`);
    const cost = own ? null : quoteOf(dpd);

    // 10. The FBA15 id (labels are fetched by the screen)
    say('Reading the shipment id');
    let b = null;
    for (let i = 0; i < 5 && !(b && b.fba); i += 1) {
      if (i) await sp.sleep(3000);
      b = await describeBooked({ inboundPlanId: planId, shipments: [{ shipmentId }] });
    }
    booked = b;
    job.state = 'done';
    job.result = { ...b, boxes: job.totals.boxes, units: job.totals.units, readyDate, already: false, carrier, carrierCost: cost };
    say('Booked');
    logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment booked: ${b.fba || planId} to ${b.warehouse || '?'}, ${job.totals.boxes} boxes / ${job.totals.units} units, ${own ? 'own DPD' : `${name} £${cost.toFixed(2)}`}, ready ${readyDate}${b.window ? `, delivery ${b.window.start}–${b.window.end}` : ''}` });
  } catch (e) {
    await fail(e, planId, placed);
  } finally {
    if (job.state !== 'confirm') job.finishedAt = new Date().toISOString(); // a Requote waits at the confirm box again
  }
}

// THE CONFIRM BOX's Cancel: the plan is cancelled on Amazon (free — nothing confirmed yet).
async function cancel({ id }) {
  if (!job || job.id !== Number(id) || job.state !== 'confirm' || !ctx) return { error: 'NOT_WAITING' };
  job.state = 'running';
  say('Cancelling');
  try {
    await cancelPlan(ctx.planId);
    job.state = 'stopped';
    job.message = 'Cancelled. Nothing was booked.';
    logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment cancelled at the confirm (plan ${ctx.planId})` });
  } catch (e) {
    job.state = 'failed';
    job.message = `Cancelling failed (${e.message}). The next Do shipment press clears it.`;
  }
  job.finishedAt = new Date().toISOString();
  ctx = null;
  return { job: snapshot() };
}

// ---- booked shipment: labels, freeze, recovery -------------------------------------------------------------------------------------
// Find the booked shipment of THESE boxes on Amazon (or null). Used after a restart, and by labels() when memory is empty.
async function findBooked() {
  const boxes = await readBoxes();
  if (!boxes.length) return null;
  const totals = skuTotals(boxes);
  for (const d of (await activePlanDetails()).filter(isBooked)) {
    if (await planMatches(d, totals)) return describeBooked(d);
  }
  return null;
}

// The box labels as one PDF (base64), one 4×6 thermal page per box, U000001 first — the same file Seller Central prints
// (read 2026-11-13 on FBA15MVXM5VF: PackageLabel_Thermal + UNIQUE + the box ids → a DownloadURL to a 306×432 pt PDF).
async function labels() {
  let b = booked && booked.fba ? booked : null;
  if (!b) {
    b = await findBooked();
    if (b) booked = b;
  }
  if (!b || !b.fba) return { none: true };
  const boxes = await listAll(`${BASE}/inboundPlans/${b.planId}/shipments/${b.shipmentId}/boxes`, { pageSize: 100 }, 'boxes');
  const ids = boxes.map((x) => x.boxId).filter(Boolean).sort(); // Amazon lists them out of order; U000001… sort as text
  if (!ids.length) throw new Error(`Amazon has no boxes on ${b.fba}`);
  const r = await get(`/fba/inbound/v0/shipments/${b.fba}/labels`, {
    MarketplaceId: sp.marketplaceId(), PageType: 'PackageLabel_Thermal', LabelType: 'UNIQUE', PackageLabelsToPrint: ids,
  });
  const url = r && r.payload && r.payload.DownloadURL;
  if (!url) throw new Error('Amazon sent no label file');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Label download failed (${res.status})`);
  const pdf = Buffer.from(await res.arrayBuffer()).toString('base64');
  return { pdf, fba: b.fba, boxes: ids.length };
}

// ---- BOOK DPD: our own DPD for the booked shipment (owner, 2026-11-19 — docs/dpd/NOTES.md) ------------------------------------------
// Its own button on the booked notice, after Confirm (owner: "for now do it as a different button"). Only for a shipment booked with OUR
// OWN DPD (Amazon's DPD makes its own labels): the selected transportation option is read back from Amazon and must be
// USE_YOUR_OWN_CARRIER / DPDX. One press:
//   1. DPD  one consignment, Parcel Next Day (owner), from our address to Amazon's warehouse (getShipment's destination; Amazon gives no
//           phone and DPD requires one, so the contact phone is ours). Parcels = Amazon's boxes, weight = their kg added up, ref 1 =
//           the FBA15 id, ref 2 = the warehouse. Validated with ?test=true first; booked for real only when DPD_LIVE=true (utils/dpdApi.js).
//   2. AMAZON  the tracking straight away (owner: "send the tracking to amz right away"): box U00000n → DPD parcel n, in order.
//           Amazon then holds the numbers, so nothing is stored here (no table); a restart reads them back (describeBooked.tracking).
//   The screen then prints DPD's labels on the DPD printer (never the Zebra, owner) — dpdLabel().
// NEVER BOOKED TWICE: a shipment Amazon already has tracking for is refused, and a booking this process made whose tracking didn't
// reach Amazon is re-sent on the next press, not booked again. Held in memory until Mark shipped (clearBooked).
let dpd = null;        // { amzShipmentId, fba, dpdShipmentId, consignment, parcels: ['15976…'], trackingSent }
let dpdBusy = false;

const dpdView = () => (dpd ? { consignment: dpd.consignment, parcels: dpd.parcels, trackingSent: dpd.trackingSent, canReprint: !!dpd.dpdShipmentId } : null);
const kgOf = (w) => { const v = Number((w && w.value) || 0); return w && /^lb/i.test(String(w.unit || '')) ? v * 0.45359237 : v; };

// Returns { error: 'BUSY' | 'NOT_BOOKED' | 'NOT_OWN_DPD' | 'ALREADY' | 'PARCEL_COUNT', … } | { test: true, … } | { dpd, trackingError? }.
async function bookDpd({ by }) {
  if (dpdBusy) return { error: 'BUSY' };
  dpdBusy = true;
  try {
    let b = booked && booked.fba ? booked : null;
    if (!b) {
      b = await findBooked();
      if (b) booked = b;
    }
    if (!b || !b.fba) return { error: 'NOT_BOOKED' };
    const sh = await get(`${BASE}/inboundPlans/${b.planId}/shipments/${b.shipmentId}`);
    const opts = await listAll(`${BASE}/inboundPlans/${b.planId}/transportationOptions`, { shipmentId: b.shipmentId, pageSize: 20 }, 'transportationOptions');
    const sel = opts.find((o) => o.transportationOptionId === sh.selectedTransportationOptionId);
    if (!sel || sel.shippingSolution !== 'USE_YOUR_OWN_CARRIER' || !isDpd(sel)) return { error: 'NOT_OWN_DPD' };
    const have = trackingOf(sh);
    if (have.length) return { error: 'ALREADY', tracking: have };
    const boxes = (await listAll(`${BASE}/inboundPlans/${b.planId}/shipments/${b.shipmentId}/boxes`, { pageSize: 100 }, 'boxes'))
      .filter((x) => x.boxId).sort((x, y) => x.boxId.localeCompare(y.boxId)); // Amazon lists them out of order; U000001 first
    if (!boxes.length) throw new Error(`Amazon has no boxes on ${b.fba}`);
    const kg = boxes.reduce((n, x) => n + kgOf(x.weight), 0);

    let d = dpd && dpd.amzShipmentId === b.shipmentId ? dpd : null;
    if (!d) {
      const a = (sh.destination && sh.destination.address) || {};
      const wh = (sh.destination && sh.destination.warehouseId) || b.warehouse || '';
      const r = await dpdApi.book({
        delivery: {
          organisation: a.name || a.companyName || `Amazon ${wh}`, street: a.addressLine1, locality: a.addressLine2 || '',
          town: a.city, county: a.stateOrProvinceCode || '', postcode: a.postalCode,
          contactName: `Amazon ${wh}`.trim(), telephone: process.env.DPD_COLLECT_PHONE,
        },
        parcels: boxes.length, totalKg: kg,
        collectionDate: dpdApi.collectionDate(job && job.result && job.result.shipmentId === b.shipmentId ? job.result.readyDate : null),
        refs: [b.fba, wh],
      }, { live: dpdApi.isLive() });
      if (r.test) {
        logActivity({ who: by, section: 'AMZ Shipment', log: `Book DPD (test mode, nothing booked): ${b.fba} to ${wh}, ${boxes.length} parcels, ${kg.toFixed(1)} kg — DPD accepted the details` });
        return { test: true, boxes: boxes.length, kg: Math.round(kg * 10) / 10 };
      }
      d = { amzShipmentId: b.shipmentId, fba: b.fba, dpdShipmentId: r.shipmentId, consignment: r.consignment, parcels: r.parcels, trackingSent: false };
      dpd = d;
      logActivity({ who: by, section: 'AMZ Shipment', log: `Book DPD: ${b.fba} to ${wh}, consignment ${r.consignment}, ${r.parcels.length} parcels (${r.parcels.join(', ')}), ${kg.toFixed(1)} kg, Parcel Next Day` });
    }
    if (d.parcels.length !== boxes.length || !d.parcels.every((p) => DPD_PARCEL.test(p))) {
      return { error: 'PARCEL_COUNT', dpd: dpdView(), message: `DPD gave ${d.parcels.length} parcel numbers for ${boxes.length} boxes, so no tracking was sent to Amazon. Put it in Seller Central by hand.` };
    }

    const items = boxes.map((x, i) => ({ boxId: x.boxId, trackingId: d.parcels[i] }));
    try {
      await waitOp((await put(`${BASE}/inboundPlans/${b.planId}/shipments/${b.shipmentId}/trackingDetails`, {
        trackingDetails: { spdTrackingDetail: { spdTrackingItems: items } },
      })).operationId, 'Sending the DPD tracking to Amazon');
    } catch (e) {
      logger.error('[amzInbound] DPD tracking to Amazon failed:', e.message);
      return { dpd: dpdView(), trackingError: `${e.message}. The DPD consignment IS booked: press Book DPD again to resend the tracking (it won't book twice).` };
    }
    d.trackingSent = true;
    booked.tracking = items;
    if (job && job.result && job.result.shipmentId === b.shipmentId) job.result.tracking = items;
    logActivity({ who: by, section: 'AMZ Shipment', log: `Book DPD: tracking sent to Amazon for ${b.fba}, ${items.length} boxes (consignment ${d.consignment})` });
    return { dpd: dpdView() };
  } finally {
    dpdBusy = false;
  }
}

// The DPD labels of this process's booking (raw printer commands, base64), or { none } (nothing booked here, or the server restarted
// since: reprint from MyDPD). format 'epl' | 'clp'.
async function dpdLabel({ format }) {
  if (!dpd || !dpd.dpdShipmentId) return { none: true };
  const buf = await dpdApi.label(dpd.dpdShipmentId, format);
  return { data: buf.toString('base64'), consignment: dpd.consignment, parcels: dpd.parcels.length, fba: dpd.fba };
}

// Pack / Delete ask this. Null = boxes may change.
const frozen = () => (booked ? { fba: booked.fba, warehouse: booked.warehouse || null } : null);

// Mark shipped: the boxes have gone, the freeze ends and the booked notice clears.
function clearBooked() {
  booked = null;
  dpd = null;
  if (job && job.state === 'done') job = null;
}

// Once per process (after a restart): ask Amazon whether the stored boxes are already booked, so the freeze and Reprint come back.
// Never throws; a failed check is tried again on the next status read.
async function recover() {
  if (recovered || booked || job) return; // a press since the start already knows
  try {
    const b = await findBooked();
    recovered = true;
    if (b && !job && !booked) {
      booked = b;
      const boxes = await readBoxes();
      newJob('', { boxes: boxes.length, units: boxes.reduce((n, x) => n + x.lines.reduce((m, l) => m + l.qty, 0), 0) });
      job.state = 'done';
      job.result = { ...b, boxes: job.totals.boxes, units: job.totals.units, already: true };
      job.finishedAt = new Date().toISOString();
      say('Already booked');
    }
  } catch (e) {
    logger.error('[amzInbound] recover:', e.message);
  }
}

module.exports = {
  start, carriers, confirm, cancel, labels, bookDpd, dpdLabel, frozen, clearBooked, recover, status: snapshot,
  readBoxes, checkBoxes, ALLOWED,
  // rule checks, exported for a dry test
  onePlacements, ownDpd, amazonDpd, amazonUps, quoteOf, windowFor, readyStart, londonAt,
};
