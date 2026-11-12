/*
=======================================================================================================================================
Util: utils/amzInbound.js   — "Do shipment": the Amazon inbound shipment made from BCWEB (SP-API Fulfillment Inbound v2024-03-20)
=======================================================================================================================================
THE copy of the rules. docs/amz-inbound/PLAN.md is the record (owner decisions, the probe's and the test plan's findings), read it first.

PART 1 (built 2026-11-12). One press, run in the background (routes/amz-inbound-start.js), followed by GET /amz-inbound-status:
  1. DRAFTS   every ACTIVE plan on Amazon is read. A CONFIRMED one (placement accepted = a real FBA15 shipment) stops the run: it is
              never cancelled by BCWEB (its labels may be on the boxes). Every unconfirmed draft (ours AND Seller Central's) is
              CANCELLED, free, so each press starts clean (owner: "dont want to send wrong info - can it not clear any drafts and then go?").
  2. PREP     Amazon decides prep per SKU (prepDetails). Each SKU gets the owner Amazon allows: NONE, or SELLER for the ~57 "textile"
              ones (they go in shoe boxes as always, owner). AMAZON-only prep or labelling would cost money, so it STOPS.
  3. PLAN     createInboundPlan from the stored packed boxes (amzshipment, read at the press; "your box" never goes), our Welshpool address.
              "WARNING: Address was unable to be verified" comes every time and is harmless (Amazon's docs: warnings "can be ignored").
  4. PACK     generatePackingOptions → ONLY an option with exactly ONE pack group and no fee is confirmed (owner: never more than one).
              None → STOP, the plan is cancelled, and the message names which SKUs Amazon wanted in which group.
  5. BOXES    setPackingInformation: every box's SKUs and quantities, CM / KG, in our box order (Amazon numbers them U000001… in that order).
  Then it STOPS. Warehouse, carrier (own DPD), delivery window and labels are finished in Seller Central until part 2.

COSTS. Nothing here can cost money: the only writes allowed are in ALLOWED below. Placement, transportation and delivery-window
CONFIRMS are not on it (part 2 adds them behind the owner's one confirm box). The packing confirm is allowed only with every fee at 0.
A run that fails after the plan exists cancels that plan (free before placement is confirmed).

ONE AT A TIME, IN MEMORY. The job's progress lives in this process (no table, owner rule). A server restart mid-run loses it, which is
fine: the next press cancels the half-made draft and starts again.
=======================================================================================================================================
*/

const sp = require('./amzSpApi');
const { query } = require('../database');
const { logActivity } = require('./bclog');
const logger = require('./logger');

const BASE = '/inbound/fba/2024-03-20';

// Our ship-from (Seller Central's own, exactly). Amazon REQUIRES a phone on it (Seller Central doesn't show one), kept in .env.
function shipFrom() {
  const phone = (process.env.AMZ_SHIP_FROM_PHONE || '').trim();
  if (!phone) throw new Error('AMZ_SHIP_FROM_PHONE is not set in bcweb-server/.env (Amazon requires a phone on the ship-from address)');
  return {
    name: 'Brookfield Comfort', companyName: 'Brookfield Comfort', addressLine1: '1 Cumberland Place', city: 'Welshpool',
    stateOrProvinceCode: 'Powys', postalCode: 'SY21 7SB', countryCode: 'GB', phoneNumber: phone,
  };
}

// The ONLY writes this util may send to Amazon. No placement / transportation / delivery-window confirmation is on it.
const ALLOWED = [
  /^\/inbound\/fba\/2024-03-20\/inboundPlans$/,                                             // createInboundPlan
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingOptions$/,                      // generatePackingOptions
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingOptions\/[^/]+\/confirmation$/, // confirmPackingOption (fees checked = 0)
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingInformation$/,                  // setPackingInformation
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/cancellation$/,                        // cancelInboundPlan (unconfirmed only)
];
function guard(path) {
  if (!ALLOWED.some((re) => re.test(path))) throw new Error(`BLOCKED: ${path} is not an allowed Amazon write`);
}
const pace = () => sp.sleep(550); // most inbound operations allow ~2 a second
async function get(path, q) { const r = await sp.spGet(path, q); await pace(); return r; }
async function post(path, body) { guard(path); const r = await sp.spPost(path, body); await pace(); return r; }
async function put(path, body) { guard(path); const r = await sp.spPut(path, body); await pace(); return r; }

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

// ---- Amazon reads --------------------------------------------------------------------------------------------------------------
async function activePlans() {
  const out = [];
  let paginationToken;
  do {
    const r = await get(`${BASE}/inboundPlans`, { status: 'ACTIVE', pageSize: 30, paginationToken });
    out.push(...(r.inboundPlans || []));
    paginationToken = r.pagination && r.pagination.nextToken;
  } while (paginationToken);
  return out;
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

// ---- the job ---------------------------------------------------------------------------------------------------------------------
let job = null; // { id, by, startedAt, finishedAt, state: 'running'|'done'|'stopped'|'failed', step, log[], warnings[], result, message }
let seq = 0;

function snapshot() { return job ? JSON.parse(JSON.stringify(job)) : null; }

function say(text) {
  job.step = text;
  job.log.push({ at: new Date().toISOString(), text });
}

// Called by the route. Reads + checks the boxes NOW (so a stale screen or an unmeasured box answers at once), then runs in the
// background. Returns { busy } | { stop } | { job }.
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
  seq += 1;
  job = { id: seq, by, startedAt: new Date().toISOString(), finishedAt: null, state: 'running', step: 'Starting', log: [], warnings: [], result: null, message: null, totals };
  run(boxes, totals).catch(() => {}); // never throws (see run)
  return { job: snapshot() };
}

async function run(boxes, totals) {
  let planId = null;
  try {
    // 1. Drafts
    say('Checking Amazon for drafts');
    const plans = await activePlans();
    const details = [];
    for (const p of plans) details.push(await get(`${BASE}/inboundPlans/${p.inboundPlanId}`));
    const booked = details.filter((d) => (d.placementOptions || []).some((o) => o.status === 'ACCEPTED'));
    if (booked.length) {
      const ids = [];
      for (const d of booked) {
        for (const s of d.shipments || []) {
          const sh = await get(`${BASE}/inboundPlans/${d.inboundPlanId}/shipments/${s.shipmentId}`).catch(() => null);
          ids.push(sh && sh.shipmentConfirmationId ? `${sh.shipmentConfirmationId}${sh.destination && sh.destination.warehouseId ? ` to ${sh.destination.warehouseId}` : ''}` : d.inboundPlanId);
        }
      }
      throw new Stop(`There's a booked Amazon shipment not finished yet (${ids.join(', ')}). Mark it shipped, or cancel it in Seller Central, then press again.`);
    }
    for (const d of details) {
      say(`Cancelling an old draft${d.name ? ` (${d.name})` : ''}`);
      await waitOp((await put(`${BASE}/inboundPlans/${d.inboundPlanId}/cancellation`)).operationId, 'Cancelling a draft');
    }

    // 2. Prep
    say('Reading prep from Amazon');
    const qtyBySku = new Map();
    for (const b of boxes) for (const l of b.lines) qtyBySku.set(l.sku, (qtyBySku.get(l.sku) || 0) + l.qty);
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
    job.planId = planId;
    job.warnings.push(...(await waitOp(created.operationId, 'Creating the plan')).filter((w) => !ADDRESS_WARNING.test(w)));

    // 4. One pack group
    say('Getting the pack group');
    await waitOp((await post(`${BASE}/inboundPlans/${planId}/packingOptions`)).operationId, 'Getting pack groups');
    const packs = (await get(`${BASE}/inboundPlans/${planId}/packingOptions`)).packingOptions || [];
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
      throw new Stop(`Amazon won't take these as ONE pack group.${detail} Nothing was booked.`);
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

    job.state = 'done';
    job.result = {
      planId, boxes: totals.boxes, units: totals.units, skus: qtyBySku.size, sellerPrep,
      sellerCentral: `https://sellercentral.amazon.co.uk/fba/sendtoamazon?wf=${planId}`,
    };
    say('Sent to Amazon');
    logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment: plan ${planId} made, ${totals.boxes} boxes / ${totals.units} units sent (part 1, finish in Seller Central)` });
  } catch (e) {
    const stopped = e instanceof Stop;
    job.state = stopped ? 'stopped' : 'failed';
    job.message = e.message;
    if (!stopped) logger.error('[amzInbound] Do shipment failed:', e.message);
    if (planId) { // half-made plan: cancel it (nothing is confirmed beyond the free pack group)
      try {
        await waitOp((await put(`${BASE}/inboundPlans/${planId}/cancellation`)).operationId, 'Cancelling the plan');
        job.message += ' The half-made plan was cancelled.';
      } catch (ce) {
        job.message += ` Cancelling the half-made plan failed too (${ce.message}). The next press clears it.`;
      }
    }
    logActivity({ who: job.by, section: 'AMZ Shipment', log: `Do shipment ${job.state}: ${job.message}` });
  } finally {
    job.finishedAt = new Date().toISOString();
  }
}

module.exports = { start, status: snapshot, readBoxes, checkBoxes, ALLOWED };
