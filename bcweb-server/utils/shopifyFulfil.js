/*
=======================================================================================================================================
Module: utils/shopifyFulfil.js
=======================================================================================================================================
Purpose: Marks a Shopify order FULFILLED, with tracking, and sends the customer Shopify's shipping email (docs/fulfil-plan.md). The
         only caller is routes/order-status-customer-fulfil.js.

WHY ITS OWN FILE AND APP. utils/shopify.js is the product push (write_products); utils/shopifyOrders.js reads orders over pinned REST.
Fulfilling needs fulfillment-order scopes neither of their tokens has, so it has its own Dev Dashboard app, "bcweb fulfil"
(SHOPIFY_FULFIL_CLIENT_ID / _SECRET), and nothing else uses it.

THE TOKEN IS FETCHED, NOT STORED. A Dev Dashboard app has no copyable token: the client id + secret go to /admin/oauth/access_token
(client_credentials grant) and come back as a token that lasts 24h (expires_in 86399 — checked 2026-10-20). It's cached in-process and
refetched 5 minutes before it runs out, or at once if Shopify answers 401.

HOW SHOPIFY FULFILS (GraphQL): an order has one or more FULFILLMENT ORDERS (one per location it ships from). We find the order by its
name (our ordernum IS Shopify's order.name — orderSync.js), take every fulfillment order still open that allows CREATE_FULFILLMENT,
and fulfil them all in one fulfillmentCreate: by the time we get here every line of the order is packed, so the whole order goes.

TRACKING — copied from what PowerBuilder writes today (read off real fulfilled orders, 2026-10-20):
  Royal Mail  { company: 'Royal Mail', number: 'MX822421214GB', url: 'https://www.royalmail.com/track-your-item#/tracking-results/<n>' }
  FBA         { number: 'AMZCourier' } — no company, no url. That literal is the "Amazon courier" (BC19344, BC19345).

NOT IDEMPOTENT ON ITS OWN — fulfillmentCreate emails a real customer and can't be dry-run. The guard is the read before it: an order
already FULFILLED, or with no open fulfillment order left, is reported as already done and nothing is sent.
=======================================================================================================================================
*/

const config = require('../config/config');
const logger = require('./logger');

const TIMEOUT_MS = 30000;

// Same trail as the route (ERROR level so it survives production's LOG_LEVEL=error — see routes/order-status-customer-fulfil.js).
const trail = (msg) => logger.error(`[fulfil] ${msg}`);

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function isConfigured() {
  const { shop, fulfilClientId, fulfilClientSecret } = config.shopify;
  return Boolean(shop && fulfilClientId && fulfilClientSecret);
}

// The cached 24h token (see the header). One fetch in flight at a time, so a list-wide run doesn't ask for it per order.
let cached = null;   // { token, expiresAt }
let fetching = null;

async function accessToken() {
  if (cached && Date.now() < cached.expiresAt) return cached.token;
  if (!fetching) {
    fetching = (async () => {
      const { shop, fulfilClientId, fulfilClientSecret } = config.shopify;
      let res;
      try {
        res = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: fulfilClientId, client_secret: fulfilClientSecret }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        trail(`token request failed to send: ${err.message}`);
        throw coded('SHOPIFY_ERROR', `Shopify token request failed: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) {
        trail(`token refused: HTTP ${res.status} ${JSON.stringify({ ...body, access_token: undefined }).slice(0, 300)}`);
        throw coded('SHOPIFY_ERROR', `Shopify wouldn't issue the fulfill token (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}) — check SHOPIFY_FULFIL_CLIENT_ID / _SECRET and that the app is installed`);
      }
      const life = (Number(body.expires_in) || 86399) * 1000;
      cached = { token: body.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 };
      trail(`new token issued (scope=${body.scope ?? '?'}, expires_in=${body.expires_in ?? '?'}s)`);
      return cached.token;
    })().finally(() => { fetching = null; });
  }
  return fetching;
}

// Same shape as utils/shopify.js → shopifyGraphQL (429 backoff, schema errors thrown) but on the fulfil app's token, with a timeout.
async function gql(queryStr, variables = {}) {
  if (!isConfigured()) {
    throw coded('SHOPIFY_NOT_CONFIGURED', 'Shopify fulfill needs SHOPIFY_FULFIL_CLIENT_ID and SHOPIFY_FULFIL_CLIENT_SECRET in bcweb-server/.env');
  }
  const { shop, apiVersion } = config.shopify;
  const url = `https://${shop}.myshopify.com/admin/api/${apiVersion}/graphql.json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'X-Shopify-Access-Token': await accessToken(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: queryStr, variables }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      if (err.code === 'SHOPIFY_ERROR') throw err;   // the token fetch's own coded error (a timeout's DOMException has a numeric code)
      trail(`Shopify request failed to send (attempt ${attempt}): ${err.name} ${err.message}`);
      throw coded('SHOPIFY_ERROR', `Shopify request failed: ${err.message}`);
    }
    // A token Shopify no longer accepts (revoked, app reinstalled): drop it and try once more with a fresh one.
    if (res.status === 401 && attempt < 3 && cached) {
      trail(`Shopify 401 on attempt ${attempt} — dropping the cached token and retrying`);
      cached = null;
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('Retry-After')) || 2;
      trail(`Shopify rate limited on attempt ${attempt}, retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      trail(`Shopify HTTP ${res.status} (request id ${res.headers.get('X-Request-Id') ?? '-'}): ${text.slice(0, 1000)}`);
      throw coded('SHOPIFY_ERROR', `Shopify HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' — check the bcweb fulfil app is installed with its fulfillment scopes' : ''}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.errors) {
      trail(`Shopify GraphQL errors (request id ${res.headers.get('X-Request-Id') ?? '-'}): ${JSON.stringify(json.errors).slice(0, 1000)}`);
      throw coded('SHOPIFY_ERROR', `Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
    }
    return json.data;
  }
  throw coded('SHOPIFY_ERROR', 'Shopify rate limit retries exhausted');
}

/*
 * findOrder(name) -> null | { id, name, fulfillmentStatus, cancelled, openFulfillmentOrderIds: [], fulfillmentOrders: [] }
 * By exact name. Shopify's `name:` search is loose, so the match is re-checked here. `fulfillmentOrders` is every one, open or not,
 * as { id, status, actions } — only for the log, so "nothing open to fulfill" says what Shopify did have.
 */
async function findOrder(name) {
  const data = await gql(
    `query($q: String!) {
       orders(first: 5, query: $q) {
         nodes {
           id name displayFulfillmentStatus cancelledAt
           fulfillmentOrders(first: 20) { nodes { id status supportedActions { action } } }
         }
       }
     }`,
    { q: `name:${name}` }
  );
  const nodes = data?.orders?.nodes || [];
  const o = nodes.find((n) => n.name === name);
  if (!o) {
    trail(`${name} not on Shopify — search "name:${name}" returned ${nodes.length ? nodes.map((n) => n.name).join(', ') : 'nothing'}`);
    return null;
  }
  return {
    id: o.id,
    name: o.name,
    fulfillmentStatus: o.displayFulfillmentStatus,
    cancelled: !!o.cancelledAt,
    fulfillmentOrders: (o.fulfillmentOrders?.nodes || []).map((f) => ({
      id: f.id, status: f.status, actions: (f.supportedActions || []).map((a) => a.action),
    })),
    openFulfillmentOrderIds: (o.fulfillmentOrders?.nodes || [])
      .filter((f) => (f.supportedActions || []).some((a) => a.action === 'CREATE_FULFILLMENT'))
      .map((f) => f.id),
  };
}

/*
 * fulfil(fulfillmentOrderIds, trackingInfo) -> { id, status, trackingInfo }
 * One fulfillmentCreate over all the given fulfillment orders, notifyCustomer true (owner, 2026-10-14). userErrors are thrown.
 */
async function fulfil(fulfillmentOrderIds, trackingInfo) {
  const data = await gql(
    `mutation($f: FulfillmentInput!) {
       fulfillmentCreate(fulfillment: $f) {
         fulfillment { id status trackingInfo { company number url } }
         userErrors { field message }
       }
     }`,
    {
      f: {
        lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({ fulfillmentOrderId: id })),
        trackingInfo,
        notifyCustomer: true,
      },
    }
  );
  const out = data?.fulfillmentCreate;
  const errs = out?.userErrors || [];
  if (errs.length) {
    trail(`fulfillmentCreate refused: ${JSON.stringify(errs)}`);
    throw coded('SHOPIFY_REFUSED', errs.map((e) => e.message).join('; '));
  }
  if (!out?.fulfillment) {
    trail(`fulfillmentCreate returned no fulfillment: ${JSON.stringify(out ?? null).slice(0, 500)}`);
    throw coded('SHOPIFY_REFUSED', 'Shopify returned no fulfillment');
  }
  return out.fulfillment;
}

const royalMailTracking = (number) => ({
  company: 'Royal Mail',
  number,
  url: `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(number)}`,
});
const FBA_TRACKING = { number: 'AMZCourier' };

module.exports = { isConfigured, findOrder, fulfil, royalMailTracking, FBA_TRACKING };
