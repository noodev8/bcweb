/*
=======================================================================================================================================
Script: scripts/amz-inbound-test-plan.js   — TEST inbound plan, then CANCEL (docs/amz-inbound/PLAN.md build step 1, 2026-11-12)
=======================================================================================================================================
Purpose: Prove the "Do shipment" flow against Amazon before building it, WITHOUT costing anything (owner: "just STOP if its gonna
         charge us anything ... our own courier and its our own dpd. DO NOT DO AMZ DPD OR UPS AS THEY CHARGE US").

What it does, in order (a real draft appears in Seller Central and ends VOIDED, like the team's own abandoned drafts):
  1. createInboundPlan: 2 SKUs × 1, our Welshpool address, prep / label owner SELLER.
  2. generatePackingOptions → list. STOP unless there is an option with exactly ONE pack group AND no fee above £0. Then confirm it
     (the packing confirm has no cost; its fees are checked first anyway).
  3. setPackingInformation: one test box (30×20×15 cm, 1.5 kg) holding both units.
  4. generatePlacementOptions → list. Shown: shipments per option, fees. NEVER confirmed.
  5. generateTransportationOptions for the single-shipment option, BEFORE any placement confirm (the question the one-confirm design
     depends on) → list. Shown: own-carrier DPD (DPDX) present? partnered (Amazon's carriers) options are only listed. NEVER confirmed.
  6. generateDeliveryWindowOptions for that shipment → list (or Amazon's refusal before a placement confirm). NEVER confirmed.
  7. cancelInboundPlan, ALWAYS, also when anything above fails.

SAFETY. Every write goes through post()/put(), which allow ONLY the paths listed in ALLOWED. The placement, transport and delivery-window
CONFIRMS are not on it, so this script cannot confirm them, and nothing that costs money is ever confirmed (placement fees and partnered
carriers are charged on those confirms). The only confirm allowed is the packing option, and only with all fees at £0.

Usage (from bcweb-server/):  node scripts/amz-inbound-test-plan.js [--out file.json]
=======================================================================================================================================
*/

require('dotenv').config();
const fs = require('fs');
const sp = require('../utils/amzSpApi');

const BASE = '/inbound/fba/2024-03-20';
const OUT = (() => { const i = process.argv.indexOf('--out'); return i > -1 ? process.argv[i + 1] : null; })();
const dump = {};

// The ONLY writes this script may make. Placement / transportation / delivery-window confirmations are deliberately absent.
const ALLOWED = [
  /^\/inbound\/fba\/2024-03-20\/inboundPlans$/,                                         // createInboundPlan
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingOptions$/,                  // generatePackingOptions
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingOptions\/[^/]+\/confirmation$/, // confirmPackingOption (no cost, fees checked)
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/packingInformation$/,              // setPackingInformation
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/placementOptions$/,                // generatePlacementOptions
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/transportationOptions$/,           // generateTransportationOptions
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/shipments\/[^/]+\/deliveryWindowOptions$/, // generateDeliveryWindowOptions
  /^\/inbound\/fba\/2024-03-20\/inboundPlans\/[^/]+\/cancellation$/,                    // cancelInboundPlan
];
function guard(path) {
  if (!ALLOWED.some((re) => re.test(path))) throw new Error(`BLOCKED: ${path} is not an allowed write in the test plan`);
}
async function post(label, path, body) { guard(path); const r = await sp.spPost(path, body); dump[label] = r; await sp.sleep(600); return r; }
async function put(label, path, body) { guard(path); const r = await sp.spPut(path, body); dump[label] = r; await sp.sleep(600); return r; }
async function get(label, path, q) { const r = await sp.spGet(path, q); dump[label] = r; await sp.sleep(600); return r; }

// Amazon's async operations: poll until SUCCESS / FAILED (or ~3 minutes).
async function waitOp(label, operationId) {
  for (let i = 0; i < 90; i += 1) {
    const r = await sp.spGet(`${BASE}/operations/${operationId}`);
    if (r.operationStatus !== 'IN_PROGRESS') {
      dump[`op:${label}`] = r;
      const probs = (r.operationProblems || []).map((p) => `${p.severity} ${p.code}: ${p.message}`);
      console.log(`  ${label}: ${r.operationStatus}${probs.length ? '\n    ' + probs.join('\n    ') : ''}`);
      if (r.operationStatus !== 'SUCCESS') throw new Error(`${label} ${r.operationStatus}`);
      return r;
    }
    await sp.sleep(2000);
  }
  throw new Error(`${label}: still IN_PROGRESS after 3 minutes`);
}

const money = (fees) => (fees || []).reduce((n, f) => n + Number((f.value && f.value.amount) || 0), 0);
const feeText = (fees) => (fees || []).map((f) => `${f.target || f.type}: ${f.value ? f.value.amount + ' ' + f.value.code : '?'}`).join('; ') || 'none';

const ITEMS = [
  { msku: 'IVES-WHITE-07', quantity: 1, labelOwner: 'SELLER', prepOwner: 'NONE' },
  { msku: 'DJG-OI9Z-VNC', quantity: 1, labelOwner: 'SELLER', prepOwner: 'NONE' },   // FLE030-IVES-WHITE-06
];

async function main() {
  const mkt = sp.marketplaceId();
  let planId = null;
  const findings = [];
  try {
    // 1. Plan
    console.log('1. createInboundPlan');
    const created = await post('create', `${BASE}/inboundPlans`, {
      name: 'BCWEB TEST - cancelled by script',
      destinationMarketplaces: [mkt],
      items: ITEMS,
      sourceAddress: {
        name: 'Brookfield Comfort', companyName: 'Brookfield Comfort', addressLine1: '1 Cumberland Place', city: 'Welshpool',
        stateOrProvinceCode: 'Powys', postalCode: 'SY21 7SB', countryCode: 'GB',
        // Amazon wants it international (+44…); .env keeps it as typed, a leading 0 becomes +44.
        phoneNumber: (process.env.AMZ_SHIP_FROM_PHONE || '').trim().replace(/^0/, '+44'),
      },
    });
    planId = created.inboundPlanId;
    console.log(`  plan ${planId}`);
    await waitOp('createInboundPlan', created.operationId);

    // 2. Packing
    console.log('2. packing options');
    await waitOp('generatePackingOptions', (await post('genPacking', `${BASE}/inboundPlans/${planId}/packingOptions`)).operationId);
    const packs = (await get('listPacking', `${BASE}/inboundPlans/${planId}/packingOptions`)).packingOptions || [];
    for (const o of packs) console.log(`  ${o.packingOptionId}: ${(o.packingGroups || []).length} pack group(s), fees ${feeText(o.fees)}`);
    const pack = packs.find((o) => (o.packingGroups || []).length === 1 && money(o.fees) === 0);
    if (!pack) { findings.push('STOP: no packing option with ONE pack group at £0'); return findings; }
    await waitOp('confirmPackingOption', (await post('confirmPacking', `${BASE}/inboundPlans/${planId}/packingOptions/${pack.packingOptionId}/confirmation`)).operationId);
    const packingGroupId = pack.packingGroups[0];

    // 3. Box
    console.log('3. setPackingInformation (1 test box)');
    await waitOp('setPackingInformation', (await post('setPacking', `${BASE}/inboundPlans/${planId}/packingInformation`, {
      packageGroupings: [{
        packingGroupId,
        boxes: [{
          contentInformationSource: 'BOX_CONTENT_PROVIDED',
          dimensions: { length: 30, width: 20, height: 15, unitOfMeasurement: 'CM' },
          weight: { value: 1.5, unit: 'KG' },
          quantity: 1,
          items: ITEMS.map((i) => ({ ...i })),
        }],
      }],
    })).operationId);

    // 4. Placement: listed only
    console.log('4. placement options (NOT confirmed)');
    await waitOp('generatePlacementOptions', (await post('genPlacement', `${BASE}/inboundPlans/${planId}/placementOptions`)).operationId);
    const places = (await get('listPlacement', `${BASE}/inboundPlans/${planId}/placementOptions`)).placementOptions || [];
    for (const o of places) console.log(`  ${o.placementOptionId}: ${(o.shipmentIds || []).length} shipment(s), fees ${feeText(o.fees)}, expires ${o.expiration}`);
    const place = places.find((o) => (o.shipmentIds || []).length === 1);
    if (!place) { findings.push('No single-shipment placement option'); return findings; }
    if (money(place.fees) > 0) findings.push(`Single-shipment placement fee would be ${money(place.fees)} (not confirmed, nothing charged)`);
    const shipmentId = place.shipmentIds[0];
    const ship = await get('shipment', `${BASE}/inboundPlans/${planId}/shipments/${shipmentId}`);
    console.log(`  shipment ${shipmentId} → ${ship.destination && ship.destination.warehouseId} · confirmation id yet: ${ship.shipmentConfirmationId || 'none'}`);

    // 5. Transport BEFORE a placement confirm: listed only
    console.log('5. transportation options before placement confirm (NOT confirmed)');
    const start = new Date(Date.now() + 86400000); start.setUTCHours(9, 0, 0, 0);
    try {
      await waitOp('generateTransportationOptions', (await post('genTransport', `${BASE}/inboundPlans/${planId}/transportationOptions`, {
        placementOptionId: place.placementOptionId,
        shipmentTransportationConfigurations: [{ shipmentId, readyToShipWindow: { start: start.toISOString().replace(/\.\d{3}Z$/, 'Z') } }],
      })).operationId);
      const trs = (await get('listTransport', `${BASE}/inboundPlans/${planId}/transportationOptions`, { placementOptionId: place.placementOptionId, pageSize: 20 })).transportationOptions || [];
      for (const o of trs) {
        console.log(`  ${o.shippingSolution} / ${o.shippingMode} · ${o.carrier && o.carrier.name} (${o.carrier && o.carrier.alphaCode}) · quote ${o.quote ? JSON.stringify(o.quote.cost) : 'none'}`);
      }
      const ours = trs.find((o) => o.shippingSolution === 'USE_YOUR_OWN_CARRIER' && o.shippingMode === 'GROUND_SMALL_PARCEL' && o.carrier && o.carrier.alphaCode === 'DPDX');
      findings.push(ours ? `Transport CAN be listed before the placement confirm; our own DPD (DPDX) offered, quote ${ours.quote ? JSON.stringify(ours.quote.cost) : 'none'}`
        : 'Transport listed before placement confirm, but NO own-carrier DPDX option');
    } catch (e) {
      findings.push(`Transport before placement confirm FAILED: ${e.message}`);
    }

    // 6. Delivery window: generate only
    console.log('6. delivery window options (NOT confirmed)');
    try {
      await waitOp('generateDeliveryWindowOptions', (await post('genDelivery', `${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`)).operationId);
      const dws = (await get('listDelivery', `${BASE}/inboundPlans/${planId}/shipments/${shipmentId}/deliveryWindowOptions`)).deliveryWindowOptions || [];
      console.log(`  ${dws.length} window(s)${dws[0] ? ` e.g. ${dws[0].startDate} → ${dws[0].endDate} (${dws[0].availabilityType})` : ''}`);
      findings.push(`Delivery windows before placement confirm: ${dws.length}`);
    } catch (e) {
      findings.push(`Delivery window before placement confirm FAILED: ${e.message}`);
    }
    return findings;
  } finally {
    // 7. Always cancel what was made
    if (planId) {
      console.log('7. cancelInboundPlan');
      try {
        await waitOp('cancelInboundPlan', (await put('cancel', `${BASE}/inboundPlans/${planId}/cancellation`)).operationId);
        const after = await get('after', `${BASE}/inboundPlans/${planId}`);
        console.log(`  plan now ${after.status}`);
      } catch (e) {
        console.log(`  !! CANCEL FAILED for ${planId}: ${e.message} — void it in Seller Central`);
      }
    }
    if (OUT) fs.writeFileSync(OUT, JSON.stringify(dump, null, 2));
  }
}

main()
  .then((f) => { console.log('\nFINDINGS'); for (const x of f || []) console.log(`  - ${x}`); })
  .catch((e) => { console.error(`\nSTOPPED: ${e.message}`); process.exitCode = 1; });
