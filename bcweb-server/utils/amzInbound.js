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
  3. PLAN     createInboundPlan from the stored packed boxes (amzshipment, read at the press; "your box" never goes), our Welshpool address.
              "WARNING: Address was unable to be verified" comes every time and is harmless (Amazon's docs: warnings "can be ignored").
  4. PACK     generatePackingOptions → ONLY an option with exactly ONE pack group and no fee is confirmed (owner: never more than one).
              None → STOP, the plan is cancelled, and the message names which SKUs Amazon wanted in which group.
  5. BOXES    setPackingInformation: every box's SKUs and quantities, CM / KG, in our box order (Amazon numbers them U000001… in that order).
  6. WAREHOUSE generatePlacementOptions → ONLY an option with exactly ONE shipment (NEVER SPLIT, REGARDLESS OF PRICE — owner). None →
              STOP, plan cancelled. NOT confirmed yet: the job waits in state 'confirm' showing the warehouse, Amazon's fee, our DPD.
  ── THE ONE CONFIRM BOX (owner picks the ready-to-ship date, presses Confirm; Cancel = cancelInboundPlan, free) ──
  7. DPD      generateTransportationOptions for the chosen date → ONLY our own DPD: USE_YOUR_OWN_CARRIER / GROUND_SMALL_PARCEL / DPDX
              with no quote. Amazon's DPD has the SAME carrier code DPDX, so the shippingSolution is checked first (test plan).
  8. WINDOW   generateDeliveryWindowOptions → the earliest AVAILABLE window starting on or after the ready-to-ship date.
              7 and 8 are worked out BEFORE anything is confirmed: if either is missing, STOP and cancel the plan, still free.
  9. BOOK     confirmPlacementOption (placement fees are charged from here) → confirmDeliveryWindowOptions → confirmTransportationOptions.
              After the placement confirm nothing is ever cancelled automatically: a later failure says so and points to Seller Central.
 10. LABELS   the FBA15 id read back; the screen then fetches the box labels (labels() below: v0 getLabels, PackageLabel_Thermal,
              one 4×6 page per box in box order) and prints them on the Zebra.

COSTS. Every write goes through post()/put(), which allow only the paths in ALLOWED. The two confirms that can cost money carry a second
check on the ids themselves: a placement confirm only for an option vetted as ONE shipment, a transportation confirm only for an option
vetted as our own DPD with no quote (vetted sets below). Amazon's partnered carriers can never be confirmed, even if they're the only
option or the cheapest. A run that fails before the placement confirm cancels its plan (free).

BOOKED = FROZEN BOXES (PLAN.md: "Boxes are frozen once a plan is CONFIRMED"). From Confirm until Mark shipped, Pack and Delete refuse
(frozen(), checked by routes/amz-shipment-pack.js / -box-delete.js), so what Amazon booked and what we packed can't drift apart. Mark
shipped (routes/amz-shipment-ship.js) clears it. Held in memory (no table, owner rule); after a server restart the first status read
asks Amazon once (recover()), so the freeze comes back by itself when the booked shipment matches the boxes.

ONE AT A TIME, IN MEMORY. The job's progress lives in this process. A restart mid-run loses it, which is fine: the next press cancels the
half-made draft (or finds the booked shipment) and carries on from there.
=======================================================================================================================================
*/

const sp = require('./amzSpApi');
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

// The ONLY writes this util may send to Amazon.
const ALLOWED = [
  new RegExp(`${P}$`),                                                          // createInboundPlan
  new RegExp(`${P}\\/[^/]+\\/packingOptions$`),                                 // generatePackingOptions
  new RegExp(`${P}\\/[^/]+\\/packingOptions\\/[^/]+\\/confirmation$`),          // confirmPackingOption (fees checked = 0)
  new RegExp(`${P}\\/[^/]+\\/packingInformation$`),                             // setPackingInformation
  new RegExp(`${P}\\/[^/]+\\/placementOptions$`),                               // generatePlacementOptions (free)
  new RegExp(`${P}\\/[^/]+\\/placementOptions\\/[^/]+\\/confirmation$`),        // confirmPlacementOption — vetted ONE-shipment ids only
  new RegExp(`${P}\\/[^/]+\\/transportationOptions$`),                          // generateTransportationOptions (free)
  new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/deliveryWindowOptions$`),      // generateDeliveryWindowOptions (free)
  new RegExp(`${P}\\/[^/]+\\/shipments\\/[^/]+\\/deliveryWindowOptions\\/[^/]+\\/confirmation$`), // confirmDeliveryWindowOptions (free)
  new RegExp(`${P}\\/[^/]+\\/transportationOptions\\/confirmation$`),           // confirmTransportationOptions — vetted own-DPD ids only
  new RegExp(`${P}\\/[^/]+\\/cancellation$`),                                   // cancelInboundPlan (unconfirmed only)
];
const PLACEMENT_CONFIRM = new RegExp(`${P}\\/[^/]+\\/placementOptions\\/([^/]+)\\/confirmation$`);
const TRANSPORT_CONFIRM = new RegExp(`${P}\\/[^/]+\\/transportationOptions\\/confirmation$`);
// Filled ONLY by the rule checks below (onePlacement / ownDpd). The guard refuses a confirm for any id not in them.
const vettedPlacement = new Set();
const vettedTransport = new Set();

function guard(path, body) {
  if (!ALLOWED.some((re) => re.test(path))) throw new Error(`BLOCKED: ${path} is not an allowed Amazon write`);
  const pm = path.match(PLACEMENT_CONFIRM);
  if (pm && !vettedPlacement.has(pm[1])) throw new Error('BLOCKED: placement option not checked as ONE shipment');
  if (TRANSPORT_CONFIRM.test(path)) {
    const sel = (body && body.transportationSelections) || [];
    if (!sel.length || !sel.every((s) => vettedTransport.has(s.transportationOptionId))) {
      throw new Error('BLOCKED: transportation option not checked as our own DPD');
    }
  }
}
const pace = () => sp.sleep(550); // most inbound operations allow ~2 a second
async function get(path, q) { const r = await sp.spGet(path, q); await pace(); return r; }
async function post(path, body) { guard(path, body); const r = await sp.spPost(path, body); await pace(); return r; }
async function put(path, body) { guard(path, body); const r = await sp.spPut(path, body); await pace(); return r; }

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
  return { boxes: boxes.length, units: boxes.reduce((n, b) => n + b.lines.reduce((m, l) => m + l.qty, 0), 0) };
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
  const sid = ((plan.shipments || [])[0] || {}).shipmentId;
  const sh = sid ? await get(`${BASE}/inboundPlans/${plan.inboundPlanId}/shipments/${sid}`).catch(() => null) : null;
  const d = (sh && sh.destination) || {};
  const w = (sh && sh.selectedDeliveryWindow) || null;
  return {
    planId: plan.inboundPlanId, shipmentId: sid || null, fba: (sh && sh.shipmentConfirmationId) || null,
    warehouse: d.warehouseId || null, town: titleCase(d.address && d.address.city),
    carrierSet: !!(sh && sh.selectedTransportationOptionId),
    window: w ? { start: String(w.startDate || '').slice(0, 10), end: String(w.endDate || '').slice(0, 10) } : null,
    sellerCentral: sellerCentral(plan.inboundPlanId),
  };
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
    if (prepOwner === 'SELLER') textile += 1;
    owners.set(m, { prepOwner, labelOwner: 'SELLER' });
  }
  return { owners, sellerPrep: textile };
}

// ---- the rules on Amazon's options ------------------------------------------------------------------------------------------------
// NEVER SPLIT: an option with exactly one shipment, whatever it costs (price never decides). Amazon's first if there are several.
function onePlacement(options) {
  const o = options.find((x) => (x.shipmentIds || []).length === 1);
  if (o) vettedPlacement.add(o.placementOptionId);
  return o || null;
}
// OUR OWN DPD, never Amazon's (both are carrier DPDX — the shippingSolution decides), and never one with a quote (a charge).
function ownDpd(options, shipmentId) {
  const o = options.find((x) => x.shippingSolution === 'USE_YOUR_OWN_CARRIER' && x.shippingMode === 'GROUND_SMALL_PARCEL'
    && x.carrier && x.carrier.alphaCode === 'DPDX' && !x.quote
    && (!x.shipmentId || x.shipmentId === shipmentId));
  if (o) vettedTransport.add(o.transportationOptionId);
  return o || null;
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

function snapshot() { return job ? JSON.parse(JSON.stringify(job)) : null; }

function say(text) {
  job.step = text;
  job.log.push({ at: new Date().toISOString(), text });
}

function newJob(by, totals) {
  seq += 1;
  ctx = null;
  job = { id: seq, by, startedAt: new Date().toISOString(), finishedAt: null, state: 'running', step: 'Starting', log: [], warnings: [], message: null, totals, confirm: null, result: null };
}

async function cancelPlan(planId) {
  await waitOp((await put(`${BASE}/inboundPlans/${planId}/cancellation`)).operationId, 'Cancelling the plan');
}

// End a run that went wrong. Before the placement confirm the plan is cancelled (free); after it, never.
async function fail(e, planId, placed) {
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
    job.warnings.push(...(await waitOp(created.operationId, 'Creating the plan')).filter((w) => !ADDRESS_WARNING.test(w)));

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
    const place = onePlacement(places);
    if (!place) throw new Stop(`Amazon only offers to SPLIT this shipment over ${Math.min(...places.map((o) => (o.shipmentIds || []).length)) || 'several'} warehouses. We never split.`);
    const shipmentId = place.shipmentIds[0];
    const sh = await get(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}`);
    const dest = sh.destination || {};

    ctx = { planId, placementOptionId: place.placementOptionId, shipmentId, qtyBySku };
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

// THE CONFIRM BOX's Confirm. Returns { error } | { job }; the booking runs in the background.
async function confirm({ id, readyDate, expect }) {
  if (!job || job.id !== Number(id) || job.state !== 'confirm' || !ctx) return { error: 'NOT_WAITING' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(readyDate || '')) || readyDate < todayLondon()) return { error: 'BAD_DATE' };
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
  book(readyDate).catch(() => {}); // never throws
  return { job: snapshot() };
}

// Steps 7–10.
async function book(readyDate) {
  const { planId, placementOptionId, shipmentId } = ctx;
  let placed = false;
  try {
    // 7. Our DPD, for the chosen date — before anything is confirmed
    say('Getting our DPD');
    const listTransport = () => listAll(`${BASE}/inboundPlans/${planId}/transportationOptions`, { placementOptionId, pageSize: 20 }, 'transportationOptions');
    const genTransport = async () => waitOp((await post(`${BASE}/inboundPlans/${planId}/transportationOptions`, {
      placementOptionId,
      shipmentTransportationConfigurations: [{ shipmentId, readyToShipWindow: { start: readyStart(readyDate) } }],
    })).operationId, 'Getting carriers');
    await genTransport();
    let dpd = ownDpd(await listTransport(), shipmentId);
    if (!dpd) throw new Stop('Amazon didn\'t offer our own DPD for this shipment, and Amazon\'s carriers are never used.');

    // 8. Delivery window — before anything is confirmed
    say('Getting the delivery window');
    const listWindows = () => listAll(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`, {}, 'deliveryWindowOptions');
    const genWindows = async () => waitOp((await post(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`)).operationId, 'Getting delivery windows');
    await genWindows();
    let win = windowFor(await listWindows(), readyDate);
    if (!win) throw new Stop(`Amazon offered no delivery window starting on or after ${readyDate}. Try another date.`);

    // 9. Book: placement (fees from here on — never cancelled automatically after this), then the window, then our DPD
    say(`Booking ${job.confirm.warehouse}`);
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/placementOptions/${placementOptionId}/confirmation`)).operationId, 'Booking the warehouse');
    placed = true;
    booked = { planId, shipmentId, fba: null }; // frozen from here (see BOOKED = FROZEN BOXES)

    // The options worked out before the confirm are used if Amazon still lists them; otherwise asked again (same rules).
    if (!(await listWindows()).some((w) => w.deliveryWindowOptionId === win.deliveryWindowOptionId)) {
      await genWindows();
      win = windowFor(await listWindows(), readyDate);
      if (!win) throw new Stop(`Amazon offered no delivery window starting on or after ${readyDate} once booked.`);
    }
    say('Confirming the delivery window');
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions/${win.deliveryWindowOptionId}/confirmation`)).operationId, 'Confirming the delivery window');

    if (!(await listTransport()).some((o) => o.transportationOptionId === dpd.transportationOptionId)) {
      await genTransport();
      dpd = ownDpd(await listTransport(), shipmentId);
      if (!dpd) throw new Stop('Our own DPD wasn\'t offered any more once the warehouse was booked.');
    }
    say('Confirming our DPD');
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/transportationOptions/confirmation`, {
      transportationSelections: [{ shipmentId, transportationOptionId: dpd.transportationOptionId }],
    })).operationId, 'Confirming our DPD');

    // 10. The FBA15 id (labels are fetched by the screen)
    say('Reading the shipment id');
    let b = null;
    for (let i = 0; i < 5 && !(b && b.fba); i += 1) {
      if (i) await sp.sleep(3000);
      b = await describeBooked({ inboundPlanId: planId, shipments: [{ shipmentId }] });
    }
    booked = b;
    job.state = 'done';
    job.result = { ...b, boxes: job.totals.boxes, units: job.totals.units, readyDate, already: false };
    say('Booked');
    logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment booked: ${b.fba || planId} to ${b.warehouse || '?'}, ${job.totals.boxes} boxes / ${job.totals.units} units, own DPD, ready ${readyDate}${b.window ? `, delivery ${b.window.start}–${b.window.end}` : ''}` });
  } catch (e) {
    await fail(e, planId, placed);
  } finally {
    job.finishedAt = new Date().toISOString();
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

// Pack / Delete ask this. Null = boxes may change.
const frozen = () => (booked ? { fba: booked.fba, warehouse: booked.warehouse || null } : null);

// Mark shipped: the boxes have gone, the freeze ends and the booked notice clears.
function clearBooked() {
  booked = null;
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
  start, confirm, cancel, labels, frozen, clearBooked, recover, status: snapshot,
  readBoxes, checkBoxes, ALLOWED,
  // rule checks, exported for a dry test
  onePlacement, ownDpd, windowFor, readyStart, londonAt,
};
