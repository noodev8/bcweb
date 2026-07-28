/*
=======================================================================================================================================
Module: utils/shopifyOrders.js
=======================================================================================================================================
Purpose: The ONE place the bcweb server READS orders from Shopify. Sibling of utils/shopify.js (which owns the product WRITE side via
         GraphQL productSet) — separate file because it is a different token, a different API, and a different direction of travel.

WHY REST, NOT GRAPHQL. utils/shopify.js talks GraphQL because productSet has no REST equivalent. This one deliberately calls the same
REST endpoint, at the same pinned version (2024-01), that C:\scripts\orders\update_orders.py calls — because the two are parallel
implementations of one business process and must see byte-identical payloads. A field that GraphQL names differently, or that a newer
REST version renames, would silently diverge the two systems. See config/config.js -> shopify.ordersApiVersion.

WHY A SEPARATE TOKEN. Reading orders needs `read_orders`; the product push needs `write_products`. Those are two different custom-app
tokens in Shopify and they are NOT interchangeable — SHOPIFY_ORDERS_ACCESS_TOKEN is required here and nothing else uses it.

PAGINATION — THE ONE PLACE THIS IMPROVES ON THE PYTHON. update_orders.py sends limit=250 and never follows the `Link` header. Below
250 open unfulfilled orders that is invisible; above it, the run sees a truncated list and then ARCHIVES every order it didn't see
(phase C), because "not in the fetched set" is how archiving is decided. This module follows `Link: rel="next"` to completion and
reports `truncated` if it ever hits its own page ceiling, so the caller can refuse to archive rather than mass-archive. The outcome
below 250 orders is identical to the Python's; above it, it is correct instead of destructive.
=======================================================================================================================================
*/

const config = require('../config/config');
const logger = require('./logger');

// Page ceiling. 250 orders/page x 20 = 5,000 open unfulfilled orders, which is far beyond anything this business will see; it exists
// only so a pathological response (or a Link-header loop) can't spin forever inside a request. Hitting it sets `truncated`.
const MAX_PAGES = 20;
const PAGE_SIZE = 250;

// A coded error the route maps to a return_code — same pattern as utils/shopify.js.
function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// True when the order-read credentials are present. The route short-circuits on this with a clear message rather than a 401 from Shopify.
function isConfigured() {
  const { shop, ordersAccessToken } = config.shopify;
  return Boolean(shop && ordersAccessToken);
}

function requireConfig() {
  const { shop, ordersAccessToken, ordersApiVersion } = config.shopify;
  const missing = [];
  if (!shop) missing.push('SHOPIFY_SHOP');
  if (!ordersAccessToken) missing.push('SHOPIFY_ORDERS_ACCESS_TOKEN');
  if (missing.length) {
    throw coded('SHOPIFY_NOT_CONFIGURED', `Shopify order sync not configured — missing ${missing.join(', ')} in bcweb-server/.env`);
  }
  return { shop, accessToken: ordersAccessToken, apiVersion: ordersApiVersion };
}

/*
 * parseNextLink(linkHeader) -> url | null
 * Shopify paginates with an RFC-5988 Link header:
 *   <https://shop.myshopify.com/admin/api/2024-01/orders.json?limit=250&page_info=xyz>; rel="next"
 * There may be a rel="previous" too, in either order, so we match on the rel rather than taking the first URL.
 */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/*
 * shopifyRestGet(url) -> { body, linkHeader }
 * One GET with the same 429 backoff utils/shopify.js uses. Throws a coded error on transport failure or a non-OK status; the caller
 * treats anything thrown as "the fetch failed, write nothing".
 */
async function shopifyRestGet(url) {
  const { accessToken } = requireConfig();
  const headers = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetch(url, { method: 'GET', headers });
    } catch (err) {
      throw coded('SHOPIFY_FETCH_FAILED', `Shopify request failed: ${err.message}`);
    }

    if (res.status === 429 && attempt < maxAttempts) {
      const retryAfter = Number(res.headers.get('Retry-After')) || 5;
      logger.info(`[shopifyOrders] rate limited (429), retrying in ${retryAfter}s (attempt ${attempt}/${maxAttempts})`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 401/403 here almost always means the wrong token (the product one) or a missing read_orders scope — say so, since the raw
      // Shopify body is unhelpful and this is the single most likely first-run failure.
      const hint = (res.status === 401 || res.status === 403)
        ? ' — check SHOPIFY_ORDERS_ACCESS_TOKEN is the read_orders token, not SHOPIFY_ACCESS_TOKEN'
        : '';
      throw coded('SHOPIFY_FETCH_FAILED', `Shopify HTTP ${res.status}${hint}: ${text.slice(0, 300)}`);
    }

    return { body: await res.json(), linkHeader: res.headers.get('Link') || res.headers.get('link') };
  }
  throw coded('SHOPIFY_FETCH_FAILED', 'Shopify rate limit retries exhausted');
}

/*
 * fetchUnfulfilledOrders() -> { orders, pages, truncated }
 *
 * The exact query update_orders.py runs: every OPEN order that is still UNFULFILLED. Note what is deliberately NOT filtered here —
 * `financial_status`. The Python fetches all of them and filters in code so it can accept BOTH "paid" and "partially_refunded"
 * (the latter is what a refunded-shipping order becomes, and those still have to be picked and posted). Filtering server-side would
 * force one value and quietly drop the other. Keep the filtering in orderSync.js where it is visible and commented.
 *
 * `truncated` true = we stopped at MAX_PAGES with more pages outstanding. The caller MUST NOT archive on a truncated fetch.
 */
async function fetchUnfulfilledOrders() {
  const { shop, apiVersion } = requireConfig();
  let url = `https://${shop}.myshopify.com/admin/api/${apiVersion}/orders.json`
          + `?fulfillment_status=unfulfilled&status=open&limit=${PAGE_SIZE}`;

  const orders = [];
  let pages = 0;
  let truncated = false;

  while (url) {
    const { body, linkHeader } = await shopifyRestGet(url);
    const batch = (body && body.orders) || [];
    orders.push(...batch);
    pages += 1;

    const next = parseNextLink(linkHeader);
    if (!next) break;
    if (pages >= MAX_PAGES) {
      // More pages exist but we're stopping. Flagged, never silent — the Python's failure mode was exactly this without the flag.
      truncated = true;
      logger.error(`[shopifyOrders] stopped at the ${MAX_PAGES}-page ceiling with more pages outstanding (${orders.length} orders read)`);
      break;
    }
    url = next;
  }

  logger.info(`[shopifyOrders] fetched ${orders.length} unfulfilled orders over ${pages} page(s)${truncated ? ' (TRUNCATED)' : ''}`);
  return { orders, pages, truncated };
}

module.exports = { isConfigured, fetchUnfulfilledOrders, parseNextLink };
