/*
=======================================================================================================================================
Script: scripts/amz-inbound-probe.js   — READ ONLY probe for "Do shipment" (docs/amz-inbound/PLAN.md, 2026-11-12)
=======================================================================================================================================
Purpose: Before building the one-button Amazon inbound shipment, read Amazon's REAL replies (memory: build against a real response, not
         the spec) for shipments the team already made in Seller Central's Send to Amazon. Only GET calls: nothing is created,
         confirmed or cancelled, nothing is written to the DB.

What it reads (Fulfillment Inbound v2024-03-20, plus v0 for older shipments):
  1. listInboundPlans: the recent plans (status, created, source address).
  2. For the newest N plans: getInboundPlan, listPackingOptions (how many pack groups), listPlacementOptions (how many shipments,
     fees), listInboundPlanBoxes (box shape), and per shipment getShipment + listTransportationOptions + listDeliveryWindowOptions
     (the own-carrier / DPD option and whether a delivery window was needed).
  3. v0 getShipments (the older API) for shipment statuses, so we see the FBA15 ids side by side.

Usage (from bcweb-server/):
  node scripts/amz-inbound-probe.js [--plans 3] [--out <file.json>]     --out saves every raw reply as JSON
=======================================================================================================================================
*/

require('dotenv').config();
const fs = require('fs');
const sp = require('../utils/amzSpApi');

const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const PLANS = Number(arg('--plans', 3));
const OUT = arg('--out', null);
const BASE = '/inbound/fba/2024-03-20';
const dump = {};

// One read, kept in the dump; an error is recorded and returned as null so the probe carries on.
async function get(label, path, q) {
  try {
    const r = await sp.spGet(path, q);
    dump[label] = r;
    await sp.sleep(600); // most inbound ops allow ~2 a second
    return r;
  } catch (e) {
    dump[label] = { error: e.message };
    console.log(`  ! ${label}: ${e.message}`);
    await sp.sleep(600);
    return null;
  }
}

async function main() {
  const mkt = sp.marketplaceId();

  // 1. Plans
  // listInboundPlans returns ONLY ACTIVE plans unless a status is given (found 2026-11-12), so each status is read.
  const plans = [];
  for (const status of ['ACTIVE', 'SHIPPED', 'VOIDED']) {
    const list = await get(`listInboundPlans:${status}`, `${BASE}/inboundPlans`, { pageSize: 30, status, sortBy: 'CREATION_TIME', sortOrder: 'DESC' });
    plans.push(...((list && list.inboundPlans) || []));
  }
  plans.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  console.log(`\n== ${plans.length} inbound plans (first page per status, newest first)`);
  for (const p of plans.slice(0, 15)) {
    console.log(`  ${p.inboundPlanId}  ${p.status.padEnd(10)}  created ${p.createdAt}  updated ${p.lastUpdatedAt}  "${p.name || ''}"`);
  }

  // 2. Detail on the newest few
  for (const p of plans.filter((x) => x.status === 'SHIPPED').slice(0, PLANS)) {
    const id = p.inboundPlanId;
    console.log(`\n== Plan ${id} (${p.status}) "${p.name || ''}"`);
    const plan = await get(`plan:${id}`, `${BASE}/inboundPlans/${id}`);
    if (plan) {
      const a = plan.sourceAddress || {};
      console.log(`  source: ${[a.name, a.addressLine1, a.city, a.postalCode, a.countryCode].filter(Boolean).join(', ')}`);
      console.log(`  marketplaces: ${(plan.marketplaceIds || []).join(', ')}  · shipments: ${(plan.shipments || []).length}  · packingOptions: ${(plan.packingOptions || []).length}  · placementOptions: ${(plan.placementOptions || []).length}`);
    }

    const pack = await get(`packing:${id}`, `${BASE}/inboundPlans/${id}/packingOptions`);
    for (const o of (pack && pack.packingOptions) || []) {
      console.log(`  packing ${o.packingOptionId} ${o.status}: ${(o.packingGroups || []).length} pack group(s); fees ${JSON.stringify(o.fees || [])}; discounts ${JSON.stringify(o.discounts || [])}; modes ${JSON.stringify(o.supportedShippingConfigurations || o.supportedConfigurations || [])}`);
    }

    const place = await get(`placement:${id}`, `${BASE}/inboundPlans/${id}/placementOptions`);
    for (const o of (place && place.placementOptions) || []) {
      const fees = (o.fees || []).map((f) => `${f.type || f.description || ''} ${f.value ? f.value.amount + ' ' + f.value.code : ''}`).join('; ');
      console.log(`  placement ${o.placementOptionId} ${o.status}: ${(o.shipmentIds || []).length} shipment(s); fees ${fees || 'none'}; discounts ${JSON.stringify(o.discounts || [])}`);
    }

    const boxes = await get(`boxes:${id}`, `${BASE}/inboundPlans/${id}/boxes`, { pageSize: 10 });
    const b = (boxes && boxes.boxes) || [];
    console.log(`  boxes: ${b.length}${boxes && boxes.pagination && boxes.pagination.nextToken ? '+' : ''}${b[0] ? ` · e.g. ${JSON.stringify({ boxId: b[0].boxId, dims: b[0].dimensions, weight: b[0].weight, items: (b[0].items || []).length, source: b[0].contentInformationSource })}` : ''}`);

    const shipIds = (plan && plan.shipments || []).map((s) => s.shipmentId);
    for (const sid of shipIds) {
      const s = await get(`shipment:${id}:${sid}`, `${BASE}/inboundPlans/${id}/shipments/${sid}`);
      if (s) {
        const d = s.destination || {};
        const da = d.address || {};
        console.log(`  shipment ${sid}: ${s.status} · confirmation ${s.shipmentConfirmationId || '-'} · to ${d.warehouseId || '?'} ${da.city || ''} · placement ${s.placementOptionId || '-'}`);
        console.log(`    selectedTransportationOptionId ${s.selectedTransportationOptionId || '-'} · readyToShip ${JSON.stringify(s.source && s.source.readyToShip || s.readyToShipWindow || null)} · trackingDetails ${JSON.stringify(s.trackingDetails || null)}`);
      }
      const tr = await get(`transport:${id}:${sid}`, `${BASE}/inboundPlans/${id}/transportationOptions`, { shipmentId: sid, pageSize: 20 });
      for (const o of (tr && tr.transportationOptions) || []) {
        const c = o.carrier || {};
        console.log(`    transport ${o.transportationOptionId}: ${o.shippingSolution} / ${o.shippingMode} · carrier ${c.name || '?'} (${c.alphaCode || '-'}) · quote ${o.quote ? JSON.stringify(o.quote.cost) : 'none'} · prefs ${JSON.stringify(o.preconditions || [])}`);
      }
      const dw = await get(`delivery:${id}:${sid}`, `${BASE}/inboundPlans/${id}/shipments/${sid}/deliveryWindowOptions`);
      const w = (dw && dw.deliveryWindowOptions) || [];
      console.log(`    delivery window options: ${w.length}${w[0] ? ` · e.g. ${JSON.stringify(w[0])}` : ''}`);
    }
  }

  // 3. v0 shipments (older API) — statuses and FBA15 ids
  const since = new Date(Date.now() - 120 * 86400000).toISOString();
  const v0 = await get('v0:getShipments', '/fba/inbound/v0/shipments', {
    MarketplaceId: mkt, QueryType: 'DATE_RANGE', LastUpdatedAfter: since, LastUpdatedBefore: new Date().toISOString(),
    ShipmentStatusList: 'WORKING,READY_TO_SHIP,SHIPPED,RECEIVING,CANCELLED,DELETED,CLOSED,ERROR,IN_TRANSIT,DELIVERED,CHECKED_IN',
  });
  const v0s = (v0 && v0.payload && v0.payload.ShipmentData) || [];
  console.log(`\n== v0 shipments updated in 120 days: ${v0s.length}`);
  for (const s of v0s) {
    console.log(`  ${s.ShipmentId}  ${String(s.ShipmentStatus).padEnd(10)}  to ${s.DestinationFulfillmentCenterId}  "${s.ShipmentName}"  label ${s.LabelPrepType}  boxContents ${s.BoxContentsSource || '-'}`);
  }

  // 4. One recent v0 shipment's items: shipped vs received (for the "what Amazon received" later step)
  const recent = v0s.find((s) => s.ShipmentStatus === 'RECEIVING') || v0s[0];
  if (recent) {
    const it = await get(`v0:items:${recent.ShipmentId}`, `/fba/inbound/v0/shipments/${recent.ShipmentId}/items`, { MarketplaceId: mkt });
    const items = (it && it.payload && it.payload.ItemData) || [];
    const sum = (k) => items.reduce((n, i) => n + Number(i[k] || 0), 0);
    console.log(`
== ${recent.ShipmentId} items: ${items.length} SKUs · shipped ${sum('QuantityShipped')} · received ${sum('QuantityReceived')}${items[0] ? ` · e.g. ${JSON.stringify(items[0])}` : ''}`);
  }

  if (OUT) { fs.writeFileSync(OUT, JSON.stringify(dump, null, 2)); console.log(`\nRaw replies saved to ${OUT}`); }
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; });
