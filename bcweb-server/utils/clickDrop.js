/*
=======================================================================================================================================
Module: utils/clickDrop.js
=======================================================================================================================================
Purpose: A thin client for the Royal Mail Click & Drop REST API (https://api.parcel.royalmail.com/api/v1). Used by Customer Orders to
         create the shipment for a fully scanned order and fetch its label, and to reprint or cancel one (docs/clickdrop-labels-plan.md).

CLICK & DROP IS THE RECORD OF A LABEL (owner, 2026-10-13: no new table). bcweb stores nothing about a shipment. Whether an order has a
label, its Click & Drop id, reprint and cancel all go through findByReference(ordernum): our ordernum (BC19292) is the Click & Drop
`orderReference`. That is also the guard against paying postage twice — check by reference before every create. PowerBuilder still
sends orders to Click & Drop in parallel, so an order may already be there that bcweb never created; it's treated exactly like ours.

ACCOUNT FACTS (checked 2026-10-13):
  - OBA account, so labels come back from the API (POST /orders with includeLabelInResponse, GET /orders/{id}/label).
  - GET /orders/{id}/full is "Forbidden (Feature not available)" on this plan — don't build on it.
  - Lookup by reference: GET /orders/"BC19292" (quoted, URL-encoded). Not found = HTTP 400 with an error item code "3".
  - Services (owner): courier '4' Royal Mail 24 -> TPN24 (Tracked 24), '5' Royal Mail 48 -> TPS48 (Tracked 48).
  - Package format: always 'parcel' (owner, 2026-10-13) — PACKAGE_FORMAT. Weight doesn't change the format or the service.
  - A BILLING address is required too (C&D: "At least 'Full name' or 'Company Name' is required for 'Billing address'", "Billing
    address postcode is required for UK orders"). We have no separate billing address, so the delivery address is sent as both.

KEY: CLICKDROP_API_KEY in .env (local + VPS). Sent as `Authorization: Bearer <key>`.
=======================================================================================================================================
*/

const BASE = 'https://api.parcel.royalmail.com/api/v1';
const TIMEOUT_MS = 30000;

// Our courier code -> Royal Mail service code. Pack only ('0') has no service, and so no label.
const SERVICE_CODES = { 4: 'TPN24', 5: 'TPS48' };
const MAX_KG = 20;   // Tracked parcel limit
// Always 'parcel' (owner, 2026-10-13) — never small/medium. C&D refused 'smallParcel' for TPN24 anyway.
const PACKAGE_FORMAT = 'parcel';

class ClickDropError extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}

async function call(method, path, { body, binary = false } = {}) {
  const key = process.env.CLICKDROP_API_KEY;
  if (!key) throw new ClickDropError('CLICKDROP_API_KEY is not set on the server', 0, null);
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Accept: binary ? 'application/pdf' : 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (binary && res.ok) return Buffer.from(await res.arrayBuffer());
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  if (!res.ok) throw new ClickDropError(errorText(json) || `Click & Drop returned HTTP ${res.status}`, res.status, json ?? text);
  return json;
}

// Click & Drop errors come in a few shapes: an array of {code,message}, {message}, or a failedOrders list. One readable line.
function errorText(json) {
  if (!json) return '';
  if (Array.isArray(json)) return json.map((e) => e.message || e.errorMessage).filter(Boolean).join('; ');
  if (json.message) return json.message;
  if (json.errors) return errorText(json.errors);
  return '';
}

/** The Click & Drop order for our ordernum, or null if there isn't one. */
async function findByReference(ordernum) {
  try {
    const rows = await call('GET', `/orders/${encodeURIComponent(`"${ordernum}"`)}`);
    return (Array.isArray(rows) ? rows : []).find((o) => o.orderReference === ordernum) || null;
  } catch (err) {
    // Not found is a 400 whose item carries code "3" — any other failure is real and must not read as "no label yet", or the caller
    // would create a second shipment.
    if (err.status === 400 && Array.isArray(err.body) && err.body.some((e) => String(e.code) === '3')) return null;
    throw err;
  }
}

/** The label PDF (Buffer) for a Click & Drop order id. */
function getLabel(orderIdentifier) {
  return call('GET', `/orders/${orderIdentifier}/label?documentType=postageLabel&includeReturnsLabel=false`, { binary: true });
}

/**
 * Create the shipment and return { orderIdentifier, trackingNumber, label: Buffer|null }.
 * `order` = { ordernum, name, company, address1, address2, city, county, postcode, phone, email, serviceCode, weightKg }.
 */
async function createOrder(order) {
  const clip = (s, n) => (String(s || '').trim().slice(0, n) || undefined);
  // Delivery and billing are the same person/address — see the header.
  const contact = {
    address: {
      fullName: clip(order.name, 210),
      companyName: clip(order.company, 100),
      addressLine1: clip(order.address1, 100),
      addressLine2: clip(order.address2, 100),
      city: clip(order.city, 100),
      county: clip(order.county, 100),
      postcode: clip(order.postcode, 20),
      countryCode: 'GB',
    },
    phoneNumber: clip(order.phone, 25),
    emailAddress: clip(order.email, 254),
  };
  const result = await call('POST', '/orders', {
    body: {
      items: [{
        orderReference: order.ordernum,
        recipient: contact,
        billing: contact,
        packages: [{ weightInGrams: Math.round(order.weightKg * 1000), packageFormatIdentifier: PACKAGE_FORMAT }],
        orderDate: new Date().toISOString(),
        // The order's money isn't on orderstatus and a domestic parcel doesn't need it (no customs).
        subtotal: 0,
        shippingCostCharged: 0,
        total: 0,
        currencyCode: 'GBP',
        postageDetails: { serviceCode: order.serviceCode },
        label: { includeLabelInResponse: true, includeCN: false, includeReturnsLabel: false },
      }],
    },
  });

  const failed = result?.failedOrders?.[0];
  if (failed) {
    const msg = (failed.errors || []).map((e) => e.errorMessage || e.message).filter(Boolean).join('; ');
    throw new ClickDropError(msg || 'Click & Drop refused the order', 200, result);
  }
  const created = result?.createdOrders?.[0];
  if (!created) throw new ClickDropError('Click & Drop returned no order', 200, result);
  return {
    orderIdentifier: created.orderIdentifier,
    trackingNumber: created.trackingNumber || null,
    // The label normally comes back inline. If it didn't (labelErrors), the caller fetches it separately.
    label: created.label ? Buffer.from(created.label, 'base64') : null,
  };
}

/** Delete (void) a Click & Drop order. Royal Mail refuses once it's manifested; that comes back as a ClickDropError. */
async function deleteOrder(orderIdentifier) {
  const result = await call('DELETE', `/orders/${orderIdentifier}`);
  const err = result?.errors?.[0];
  if (err) throw new ClickDropError(err.errorMessage || err.message || 'Click & Drop would not cancel the order', 200, result);
  return result;
}

module.exports = {
  SERVICE_CODES, MAX_KG, ClickDropError, findByReference, getLabel, createOrder, deleteOrder,
};
