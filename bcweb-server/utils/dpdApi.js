/*
=======================================================================================================================================
Util: utils/dpdApi.js   — DPD Local API (domestic), THE one place BCWEB calls DPD
=======================================================================================================================================
docs/dpd/NOTES.md is the record (what was proven, the owner's decisions); the spec is docs/DPD Local API Domestic Specification v3.2.pdf.

THE CALLS (spec v3.2, base https://api.dpdlocal.co.uk):
  login         POST /user/?action=login, Authorization: Basic base64(user:password) → data.geoSession. Every other call sends
                GeoClient: account/<DPD_ACCOUNT> + GeoSession. The spec advises one session a day, so it is kept for the London day and
                asked again on a 401 / 403.
  insert        POST /shipping/shipment. With ?test=true DPD only VALIDATES the body ({ shipmentId: null }, nothing booked). Without
                it, it books a REAL consignment — DPD has no test environment. Billing only happens if a parcel enters the network;
                an unwanted one is voided in MyDPD (the spec has no void call).
  label         GET /shipping/shipment/{shipmentId}/label/ with Accept text/vnd.eltron-epl (EPL, tried first on the TSC DA200) or
                text/vnd.citizen-clp. Raw printer commands, sent to the DPD printer through QZ Tray (never the Zebra, owner
                2026-11-19). text/html is A4 only and fails DPD's sign-off on a thermal printer, so it is not offered.

EVERY BOOKING IS VALIDATED FIRST: book() sends the body with ?test=true and only then, if DPD accepted it, books it for real. A
mistake in the body comes back as DPD's own words with nothing booked. LIVE since 2026-11-27 (owner: "make the actualy dpd not a test
but real"): the DPD_LIVE switch and the temporary label-test route are gone; every booking that passes the check is real.

.env: DPD_USERNAME, DPD_PASSWORD, DPD_ACCOUNT, DPD_COLLECT_ORG / _STREET / _TOWN / _POSTCODE / _PHONE (our address, the collection).
Never plain `username` / `password`: on Windows process.env.username is the Windows user (env names are case-insensitive), a 401.
=======================================================================================================================================
*/

const BASE = 'https://api.dpdlocal.co.uk';

// Parcel Next Day (owner, 2026-11-19: "parcel next day"). The account's other services: docs/dpd/NOTES.md.
const PARCEL_NEXT_DAY = '2^12';

const LABEL_TYPES = { epl: 'text/vnd.eltron-epl', clp: 'text/vnd.citizen-clp' };

function env(name) {
  const v = (process.env[name] || '').trim();
  if (!v) throw new Error(`${name} is not set in bcweb-server/.env`);
  return v;
}

// Our address = the collection (DPD_COLLECT_*).
function collection() {
  return {
    contactDetails: { contactName: cut(env('DPD_COLLECT_ORG'), 35), telephone: cut(env('DPD_COLLECT_PHONE'), 15) },
    address: {
      organisation: cut(env('DPD_COLLECT_ORG'), 35), countryCode: 'GB', postcode: env('DPD_COLLECT_POSTCODE'),
      street: cut(env('DPD_COLLECT_STREET'), 35), locality: '', town: cut(env('DPD_COLLECT_TOWN'), 35), county: '',
    },
  };
}
// The spec's field limits (35 for address lines and names, 15 for a phone, 25 for a reference).
function cut(s, n) { return String(s == null ? '' : s).trim().slice(0, n); }

// ---- session ------------------------------------------------------------------------------------------------------------------
let session = null; // { value, day }
const londonDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

async function login() {
  const auth = Buffer.from(`${env('DPD_USERNAME')}:${env('DPD_PASSWORD')}`).toString('base64');
  const res = await fetch(`${BASE}/user/?action=login`, {
    method: 'POST', headers: { Authorization: `Basic ${auth}`, Accept: 'application/json', 'Content-Type': 'application/json' },
  });
  const body = await res.json().catch(() => null);
  const value = body && body.data && body.data.geoSession;
  if (!res.ok || !value) throw new Error(`DPD login failed (${res.status}${body && body.error ? `: ${errorText(body.error)}` : ''})`);
  session = { value, day: londonDay() };
  return value;
}
async function geoSession() {
  if (session && session.day === londonDay()) return session.value;
  return login();
}

// DPD's error: null, one object, or a list of them ({ errorCode, errorMessage, errorObj, … }).
function errorText(err) {
  const list = Array.isArray(err) ? err : [err];
  return list.map((e) => (e && typeof e === 'object' ? [e.errorMessage, e.errorObj && `(${e.errorObj})`].filter(Boolean).join(' ') || JSON.stringify(e) : String(e))).join(' | ');
}

// One call with the session; a 401 / 403 logs in again once (an expired session).
async function call(method, path, { body, accept = 'application/json' } = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        GeoClient: `account/${env('DPD_ACCOUNT')}`, GeoSession: await geoSession(), Accept: accept,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) { session = null; continue; }
    return res;
  }
  throw new Error('DPD refused the session twice');
}
async function callJson(method, path, opts) {
  const res = await call(method, path, opts);
  const text = await res.text();
  let j = null;
  try { j = JSON.parse(text); } catch { /* not JSON */ }
  if (!res.ok || !j) throw new Error(`DPD ${method} ${path.split('?')[0]} failed (${res.status}): ${j && j.error ? errorText(j.error) : text.slice(0, 200)}`);
  if (j.error) throw new Error(`DPD said: ${errorText(j.error)}`);
  return j.data;
}

// ---- shipments ----------------------------------------------------------------------------------------------------------------
// The insert body (spec v3.2 "Insert Shipment", domestic: parcel [] and invoice null; consolidate false; liability off).
// delivery = { organisation, street, locality, town, county, postcode, contactName, telephone }; refs = up to three strings.
function shipmentBody({ delivery, parcels, totalKg, collectionDate, refs = [] }) {
  return {
    jobId: null,
    collectionOnDelivery: false,
    invoice: null,
    collectionDate,
    consolidate: false,
    consignment: [{
      consignmentNumber: null,
      consignmentRef: null,
      parcel: [],
      collectionDetails: collection(),
      deliveryDetails: {
        contactDetails: { contactName: cut(delivery.contactName, 35), telephone: cut(delivery.telephone, 15) },
        address: {
          organisation: cut(delivery.organisation, 35), countryCode: 'GB', postcode: cut(delivery.postcode, 10),
          street: cut(delivery.street, 35), locality: cut(delivery.locality, 35), town: cut(delivery.town, 35), county: cut(delivery.county, 35),
        },
        notificationDetails: { email: null, mobile: null },
      },
      networkCode: PARCEL_NEXT_DAY,
      numberOfParcels: parcels,
      totalWeight: Math.max(0.1, Math.round(Number(totalKg) * 10) / 10),
      shippingRef1: cut(refs[0], 25), shippingRef2: cut(refs[1], 25), shippingRef3: cut(refs[2], 25),
      customsValue: null,
      deliveryInstructions: '',
      parcelDescription: '',
      liabilityValue: null,
      liability: false,
    }],
  };
}

// Validate (?test=true), then book for real.
// Returns { body, shipmentId, consignment, parcels: ['15976…', …] }.
async function book(args) {
  const body = shipmentBody(args);
  await callJson('POST', '/shipping/shipment?test=true', { body }); // throws with DPD's words on a bad body; books nothing
  const data = await callJson('POST', '/shipping/shipment', { body });
  const c = ((data && data.consignmentDetail) || [])[0] || {};
  if (!data || !data.shipmentId || !c.consignmentNumber) throw new Error(`DPD booked but sent back no consignment: ${JSON.stringify(data).slice(0, 300)}`);
  return { body, shipmentId: data.shipmentId, consignment: String(c.consignmentNumber), parcels: (c.parcelNumbers || []).map(String) };
}

// The labels of a booked shipment as raw printer commands (a Buffer). format 'epl' | 'clp'.
// The spec says the reply is the print string; some accounts wrap it as JSON ({ data: { printString } } / { printString }), so both
// are taken.
async function label(shipmentId, format = 'epl') {
  const accept = LABEL_TYPES[format];
  if (!accept) throw new Error(`Unknown label format ${format}`);
  const res = await call('GET', `/shipping/shipment/${encodeURIComponent(shipmentId)}/label/`, { accept });
  const buf = Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(`DPD label failed (${res.status}): ${buf.toString('utf8').slice(0, 200)}`);
  const head = buf.toString('utf8', 0, Math.min(buf.length, 200)).trim();
  if (head.startsWith('{')) {
    let j = null;
    try { j = JSON.parse(buf.toString('utf8')); } catch { /* raw after all */ }
    if (j) {
      if (j.error) throw new Error(`DPD said: ${errorText(j.error)}`);
      const s = (j.data && (j.data.printString || (typeof j.data === 'string' ? j.data : null))) || j.printString;
      if (!s) throw new Error('DPD sent no label');
      return Buffer.from(String(s), 'utf8');
    }
  }
  if (!buf.length) throw new Error('DPD sent an empty label');
  return buf;
}

// The collection date DPD gets: 09:00 London on `date` (YYYY-MM-DD), or now when that's today and 09:00 has passed. DPD reads it as a
// local date-time (the spec's example "2019-04-03T09:00:00"), so no zone is sent.
function collectionDate(date) {
  const today = londonDay();
  const d = date && date > today ? date : today;
  if (d > today) return `${d}T09:00:00`;
  const now = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${d}T${now < '09:00' ? '09:00' : now}:00`;
}

module.exports = { book, label, collectionDate, collection, PARCEL_NEXT_DAY };
