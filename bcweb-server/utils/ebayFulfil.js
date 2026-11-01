/*
=======================================================================================================================================
Module: utils/ebayFulfil.js
=======================================================================================================================================
Purpose: Marks an eBay order SHIPPED with its Royal Mail tracking number (Fulfillment API createShippingFulfillment). eBay emails the
         buyer itself. The only caller is the eBay channel's fulfil step (utils/ebayOrderSync.js → channel.fulfil), reached from the
         Fulfil buttons on Customer Orders (routes/order-status-customer-fulfil.js) — the same press that fulfils Shopify orders.

THE GUARD (it can't be dry-run, and the API can't undo it — a wrong tracking number is corrected by hand in Seller Hub). Before
sending, eBay is asked about the order:
  cancelled / fully refunded         -> skipped, nothing sent
  already FULFILLED, or it already has a shipping fulfillment (someone marked it by hand, or an earlier press)
                                     -> 'already', nothing sent — pressing again is safe
  a line on eBay we don't hold (a blank Custom label, so it never reached orderstatus) -> skipped: mark it by hand, so we never
                                        tell a buyer a pair went that we never packed
Otherwise every not-yet-shipped line goes in ONE fulfillment: by now every line we hold is packed (the route checks).

CARRIER: 'RoyalMail' — eBay's own code for Royal Mail on the UK site, read from the Trading API's GeteBayDetails
(ShippingCarrierDetails, site 3) on 2026-11-01, not guessed. FBA (MCF) orders never get here — the channel skips them (owner,
2026-11-01: marked by hand with Amazon's tracking; we don't hold it).

Scope: sell.fulfillment (the full scope, not .readonly) — the refresh token minted by scripts/ebay-token.js already carries it.
=======================================================================================================================================
*/

const { userToken, dropUserToken, isUserConfigured } = require('./ebayAuth');

// HOST: eBay's createShippingFulfillment page lists apiz.ebay.com, but on 2026-11-01 a read of /shipping_fulfillment answered 200 on
// api.ebay.com and 404 on apiz. So api.ebay.com first; the POST falls back to apiz ONLY on a 404 "resource not found" — a 404 means
// nothing was created, so the retry can't ship twice.
const API = 'https://api.ebay.com/sell/fulfillment/v1';
const APIZ = 'https://apiz.ebay.com/sell/fulfillment/v1';
const TIMEOUT_MS = 30000;
const ROYAL_MAIL = 'RoyalMail';

// One call with the seller token; a 401 drops the cached token and retries once. Returns { status, body }. Throws on anything not 2xx
// (err.status carries the HTTP status).
async function call(method, path, body, base = API) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${await userToken()}`, Accept: 'application/json', 'Accept-Language': 'en-GB',
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      throw new Error(`eBay request failed: ${err.message}`, { cause: err });
    }
    if (res.status === 401 && attempt === 1) { dropUserToken(); continue; }
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    if (!res.ok) {
      const first = json && Array.isArray(json.errors) && json.errors[0] ? ` — ${json.errors[0].message}` : '';
      const err = new Error(`eBay answered HTTP ${res.status}${first}`);
      err.status = res.status;
      throw err;
    }
    return { status: res.status, body: json };
  }
  throw new Error('eBay rejected the seller token twice');
}

// 'EB22-15343-31982' -> '22-15343-31982' (utils/ebayOrderSync.js → ordernumOf is the other direction)
const orderIdOf = (ordernum) => String(ordernum).replace(/^EB/, '');

/*
 * markShipped(ordernum, trackingNumber, heldCodes) -> { outcome: 'fulfilled'|'already'|'skipped', reason }
 *   heldCodes: the SKUs we hold for this order (orderstatus.shopifysku) — every eBay line must be one of them.
 * Throws on an eBay error (the route reports it as 'failed').
 */
async function markShipped(ordernum, trackingNumber, heldCodes) {
  const id = encodeURIComponent(orderIdOf(ordernum));
  const { body: order } = await call('GET', `/order/${id}`);

  const cancel = order.cancelStatus && order.cancelStatus.cancelState;
  if (cancel === 'CANCELED' || order.orderPaymentStatus === 'FULLY_REFUNDED') return { outcome: 'skipped', reason: 'Cancelled on eBay' };
  if (order.orderFulfillmentStatus === 'FULFILLED') return { outcome: 'already', reason: 'Already marked shipped on eBay' };

  const { body: existing } = await call('GET', `/order/${id}/shipping_fulfillment`);
  if (existing && Number(existing.total) > 0) {
    const nums = (existing.fulfillments || []).map((f) => f.shipmentTrackingNumber).filter(Boolean);
    return { outcome: 'already', reason: `eBay already has a shipment${nums.length ? ` (tracking ${nums.join(', ')})` : ''}` };
  }

  const held = new Set(heldCodes.map((c) => String(c).trim().toUpperCase()));
  const lines = (order.lineItems || []).filter((li) => li.lineItemFulfillmentStatus !== 'FULFILLED');
  const unknown = lines.filter((li) => !held.has(String(li.sku || '').trim().toUpperCase()));
  if (unknown.length) {
    return { outcome: 'skipped', reason: `eBay has ${unknown.length} line(s) we don't hold (no Custom label) — mark it shipped by hand` };
  }
  if (!lines.length) return { outcome: 'already', reason: 'Nothing left to ship on eBay' };

  const shipment = {
    lineItems: lines.map((li) => ({ lineItemId: li.lineItemId, quantity: Number(li.quantity) || 1 })),
    shippedDate: new Date().toISOString(),
    shippingCarrierCode: ROYAL_MAIL,
    trackingNumber
  };
  try {
    await call('POST', `/order/${id}/shipping_fulfillment`, shipment);
  } catch (err) {
    if (err.status !== 404) throw err;
    await call('POST', `/order/${id}/shipping_fulfillment`, shipment, APIZ);   // see HOST above
  }
  return { outcome: 'fulfilled', reason: null };
}

module.exports = { isConfigured: isUserConfigured, markShipped, orderIdOf, ROYAL_MAIL };
