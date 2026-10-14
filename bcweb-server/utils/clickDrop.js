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

// `raw`: return { status, json, text, location } on success instead of just the JSON — for replies whose shape we don't trust.
async function call(method, path, { body, binary = false, raw = false } = {}) {
  const key = process.env.CLICKDROP_API_KEY;
  if (!key) throw new ClickDropError('CLICKDROP_API_KEY is not set on the server', 0, null);
  // A dropped connection (Node's fetch says just "terminated" — the first live manifest PDF fetch hit it, 2026-10-14) or a timeout
  // becomes a ClickDropError with status 0, naming the call, so callers can tell it from a refusal and retry what's safe to retry.
  let res;
  let text;
  try {
    res = await fetch(BASE + path, {
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
    text = await res.text();
  } catch (err) {
    const why = err.cause?.message || err.message || 'connection failed';
    throw new ClickDropError(`connection to Click & Drop failed on ${method} ${path.split('?')[0]} (${why})`, 0, null);
  }
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error body */ }
  // No readable message: show the raw body and the call, so a refusal like the manifest's bare 400 can be diagnosed from the screen.
  if (!res.ok) {
    throw new ClickDropError(
      errorText(json) || `HTTP ${res.status} on ${method} ${path.split('?')[0]}${text ? `: ${text.slice(0, 300)}` : ' (empty reply)'}`,
      res.status, json ?? text
    );
  }
  if (raw) return { status: res.status, json, text, location: res.headers?.get?.('location') || null };
  return json;
}

// Click & Drop errors come in a few shapes: an array of {code,message}, {message}, or a failedOrders list. One readable line.
function errorText(json) {
  if (!json) return '';
  if (Array.isArray(json)) return json.map((e) => e.message || e.errorMessage || e.description).filter(Boolean).join('; ');
  if (json.message) return json.message;
  if (Array.isArray(json.errors)) return errorText(json.errors);
  // ASP.NET validation shape: { title, errors: { Field: ["msg", ...] } }
  if (json.errors && typeof json.errors === 'object') return Object.values(json.errors).flat().join('; ') || json.title || '';
  if (json.title || json.detail) return [json.title, json.detail].filter(Boolean).join(' — ');
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

/*
MANIFEST (OBA only — 403 otherwise). Asynchronous in Click & Drop: POST /manifests starts one manifest per carrier over EVERY order on
the account that's ready (whoever created it — PowerBuilder's too, owner 2026-10-14) and returns their ids; GET /manifests/{id} reports
progress and, once documentStatus is Completed, carries the manifest PDF (base64). An empty `manifests` list (HTTP 200) means nothing
was waiting to be manifested. Can't be undone: a manifested order can no longer be deleted.

CARRIER NAME IS REQUIRED on this account (C&D: "The CarrierName field is required", 2026-10-14 — it has one carrier, "Royal Mail OBA",
but the field is mandatory when there are several postage location numbers). It must match the name in Click & Drop's carrier settings,
so it's read from GET /carriers each time (the active RoyalMailOba carrier) rather than hard-coded — a rename there doesn't break this.
*/

/** The name of the account's active Royal Mail OBA carrier, as Click & Drop's carrier settings spell it. */
async function obaCarrierName() {
  const carriers = await call('GET', '/carriers');
  const oba = (Array.isArray(carriers) ? carriers : [])
    .find((c) => c.carrierType === 'RoyalMailOba' && c.carrierStatus === 'Active');
  if (!oba?.carrierName) throw new ClickDropError('no active Royal Mail OBA carrier on the account', 200, carriers);
  return oba.carrierName;
}

// Manifest ids out of whatever a successful POST /manifests sent back. The spec says { manifests: ["<uuid>"] }, but on the first live
// manifest (2026-10-14) the reply had no such list — the manifest happened and bcweb said "nothing to manifest". So every plausible
// shape is tried: a bare array, `manifests`/`manifestIds`/`manifestGuids`, items as strings or objects, and a Location header.
const ID_KEYS = ['manifestGuid', 'manifestIdentifier', 'manifestId', 'guid', 'id'];
function manifestIds(json, location) {
  const list = Array.isArray(json) ? json : (json?.manifests ?? json?.manifestIds ?? json?.manifestGuids ?? (json ? [json] : []));
  const ids = (Array.isArray(list) ? list : [list])
    .map((m) => (typeof m === 'string' ? m : ID_KEYS.map((k) => m?.[k]).find(Boolean)))
    .filter((v) => typeof v === 'string' && v.trim());
  if (!ids.length && location) {
    const last = String(location).split('/').filter(Boolean).pop();
    if (last) ids.push(last);
  }
  return ids;
}

/**
 * Start manifesting everything that's ready. Returns { ids, nothing, reply }:
 *   nothing  true ONLY when Click & Drop said so — the live 400 NO_ELIGIBLE_ORDERS, or the spec's HTTP 200 with an explicit empty list.
 *   ids      the manifests started. Can be [] with nothing=false: Click & Drop accepted (so it DID manifest) but sent no id we can read —
 *            `reply` then carries its raw answer so the caller can show it, and the PDF is on the Click & Drop website.
 * Never reads an unrecognised success as "nothing": that's the bug this replaced.
 */
async function createManifests() {
  let r;
  try {
    r = await call('POST', '/manifests', { body: { carrierName: await obaCarrierName() }, raw: true });
  } catch (err) {
    if (err.status === 400 && (err.body?.errors || []).some((e) => e.code === 'NO_ELIGIBLE_ORDERS')) return { ids: [], nothing: true, reply: null };
    throw err;
  }
  const ids = manifestIds(r.json, r.location);
  const reply = `HTTP ${r.status}${r.location ? ` Location ${r.location}` : ''}: ${r.text ? r.text.slice(0, 500) : '(empty)'}`;
  const nothing = !ids.length && r.status === 200 && Array.isArray(r.json?.manifests) && r.json.manifests.length === 0;
  return { ids, nothing, reply };
}

/** { manifestStatus: InProgress|Completed|Failed, documentStatus, orders: [{orderIdentifier, orderReference}], pdf, errorReference } */
// A read, so safe to retry: a dropped connection or a 5xx is tried up to 3 times, a few seconds apart, before it's given up on.
async function getManifest(manifestId) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call('GET', `/manifests/${encodeURIComponent(manifestId)}`);
    } catch (err) {
      const transient = err instanceof ClickDropError && (err.status === 0 || err.status >= 500);
      if (!transient || attempt >= 3) throw err;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

module.exports = {
  SERVICE_CODES, MAX_KG, ClickDropError, findByReference, getLabel, createOrder, deleteOrder, createManifests, getManifest,
};
