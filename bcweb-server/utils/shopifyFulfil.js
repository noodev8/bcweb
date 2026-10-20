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
        throw coded('SHOPIFY_ERROR', `Shopify token request failed: ${err.message}`);
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.access_token) {
        throw coded('SHOPIFY_ERROR', `Shopify wouldn't issue the fulfil token (HTTP ${res.status}${body.error ? `, ${body.error}` : ''}) — check SHOPIFY_FULFIL_CLIENT_ID / _SECRET and that the app is installed`);
      }
      const life = (Number(body.expires_in) || 86399) * 1000;
      cached = { token: body.access_token, expiresAt: Date.now() + life - 5 * 60 * 1000 };
      return cached.token;
    })().finally(() => { fetching = null; });
  }
  return fetching;
}

// Same shape as utils/shopify.js → shopifyGraphQL (429 backoff, schema errors thrown) but on the fulfil app's token, with a timeout.
async function gql(queryStr, variables = {}) {
  if (!isConfigured()) {
    throw coded('SHOPIFY_NOT_CONFIGURED', 'Shopify fulfil needs SHOPIFY_FULFIL_CLIENT_ID and SHOPIFY_FULFIL_CLIENT_SECRET in bcweb-server/.env');
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
      throw coded('SHOPIFY_ERROR', `Shopify request failed: ${err.message}`);
    }
    // A token Shopify no longer accepts (revoked, app reinstalled): drop it and try once more with a fresh one.
    if (res.status === 401 && attempt < 3 && cached) {
      cached = null;
      continue;
    }
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get('Retry-After')) || 2;
      logger.info(`[shopifyFulfil] rate limited, retrying in ${wait}s`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw coded('SHOPIFY_ERROR', `Shopify HTTP ${res.status}${res.status === 401 || res.status === 403 ? ' — check the bcweb fulfil app is installed with its fulfillment scopes' : ''}: ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    if (json.errors) throw coded('SHOPIFY_ERROR', `Shopify: ${JSON.stringify(json.errors).slice(0, 300)}`);
    return json.data;
  }
  throw coded('SHOPIFY_ERROR', 'Shopify rate limit retries exhausted');
}

/*
 * findOrder(name) -> null | { id, name, fulfillmentStatus, cancelled, openFulfillmentOrderIds: [] }
 * By exact name. Shopify's `name:` search is loose, so the match is re-checked here.
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
  const o = (data?.orders?.nodes || []).find((n) => n.name === name);
  if (!o) return null;
  return {
    id: o.id,
    name: o.name,
    fulfillmentStatus: o.displayFulfillmentStatus,
    cancelled: !!o.cancelledAt,
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
  if (errs.length) throw coded('SHOPIFY_REFUSED', errs.map((e) => e.message).join('; '));
  if (!out?.fulfillment) throw coded('SHOPIFY_REFUSED', 'Shopify returned no fulfillment');
  return out.fulfillment;
}

const royalMailTracking = (number) => ({
  company: 'Royal Mail',
  number,
  url: `https://www.royalmail.com/track-your-item#/tracking-results/${encodeURIComponent(number)}`,
});
const FBA_TRACKING = { number: 'AMZCourier' };

module.exports = { isConfigured, findOrder, fulfil, royalMailTracking, FBA_TRACKING };
