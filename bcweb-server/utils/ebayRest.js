/*
=======================================================================================================================================
Module: utils/ebayRest.js
=======================================================================================================================================
Purpose: One caller for eBay's REST "Sell" APIs (Inventory, Account) with the SELLER's token — used by the listing build
         (utils/ebayPublish.js), the policy lookup (utils/ebayPolicies.js) and scripts/ebay-setup.js. (ebayOrders / ebayFulfil keep their
         own callers; they predate this one and work.)

LANGUAGE HEADERS: the Inventory API refuses a request with error 25709 "Invalid value for header Accept-Language" unless both
Accept-Language and Content-Language are en-GB — Node's fetch sends "*" by default (found 2026-11-01).
A 401 drops the cached token and retries once. Any other non-2xx throws EBAY_ERROR carrying eBay's own messages (err.ebayErrors), because
eBay's text ("The item specific Colour is missing") is what the operator needs to see.
=======================================================================================================================================
*/

const { userToken, dropUserToken } = require('./ebayAuth');

const BASE = 'https://api.ebay.com';
const TIMEOUT_MS = 60000;

/*
 * ebayRest(method, path, body?) -> { status, body }
 *   path  e.g. '/sell/inventory/v1/offer?sku=ABC' — appended to https://api.ebay.com
 *   2xx (incl. 204 with no body) resolves; anything else throws EBAY_ERROR.
 */
async function ebayRest(method, path, body) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await userToken()}`,
          Accept: 'application/json',
          'Accept-Language': 'en-GB',
          'Content-Language': 'en-GB',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const e = new Error(`eBay ${method} ${path.split('?')[0]} failed: ${err.message}`);
      e.code = 'EBAY_ERROR';
      throw e;
    }
    if (res.status === 401 && attempt === 1) { dropUserToken(); continue; }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const errors = (json && Array.isArray(json.errors)) ? json.errors : [];
      const msg = errors.map((x) => x.longMessage || x.message).filter(Boolean).join(' · ') || `HTTP ${res.status}`;
      const e = new Error(`eBay: ${msg}`);
      e.code = 'EBAY_ERROR';
      e.status = res.status;
      e.ebayErrors = errors;
      throw e;
    }
    return { status: res.status, body: json };
  }
  const e = new Error('eBay refused the seller token twice');
  e.code = 'EBAY_ERROR';
  throw e;
}

module.exports = { ebayRest };
