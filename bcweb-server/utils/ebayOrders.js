/*
=======================================================================================================================================
Module: utils/ebayOrders.js
=======================================================================================================================================
Purpose: READ eBay orders for the Update Orders run (utils/orderSync.js, via the eBay channel). Network only — no database. The writes are
         utils/ebayOrderSync.js, inside the run's transaction; this runs BEFORE it, outside any transaction, exactly as the Shopify fetch
         does (a slow or failed eBay call must never hold a database transaction open).

WHAT IT RETURNS — fetchEbayOrders(heldOrderIds) -> { open, closed, unresolved, truncated, pages }
  open        every order eBay lists as still to post (getOrders, orderfulfillmentstatus NOT_STARTED|IN_PROGRESS, all pages), filtered by
              isOpen() below. These get inserted / refreshed.
  closed      [{ orderId, outcome: 'shipped' | 'cancelled' }] — for each EB order WE still hold (heldOrderIds) that is no longer on the
              open list, eBay is asked about THAT order (getOrder) and says what happened to it. Only an explicit answer archives:
  unresolved  held orders whose lookup failed or came back still open — left alone this run, never archived on a guess.

WHY LOOK EACH ONE UP rather than archive by absence the way Shopify does: absence can't tell POSTED (delete the pick — the shoe has
gone) from CANCELLED (give the shoe back to free stock), and getting that wrong either loses a pair from stock or leaves a phantom one.
eBay volumes are small, so one extra call per order that has just closed is cheap. Capped at LOOKUP_CAP per press; the rest wait.

TRUNCATED: getOrders is paged (200 a page, MAX_PAGES pages). If the pages ran out before the list did, `truncated` is true and NO
closed lookups are made — same rule as Shopify's archive guard: a partial read must never archive.

Fulfillment API reference: GET /sell/fulfillment/v1/order (getOrders) and /order/{orderId} (getOrder). Scope sell.fulfillment.
=======================================================================================================================================
*/

const { userToken, dropUserToken, isUserConfigured } = require('./ebayAuth');

const API = 'https://api.ebay.com/sell/fulfillment/v1';
const PAGE_LIMIT = 200;    // eBay's maximum for getOrders
const MAX_PAGES = 10;      // 2,000 open orders — far beyond today's volume; hitting it sets `truncated`
const LOOKUP_CAP = 25;     // getOrder calls per press for orders that have just closed
const TIMEOUT_MS = 30000;

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// One GET with the seller token. A 401 drops the cached token and retries once (it may have been revoked or rotated mid-life).
async function ebayGet(pathAndQuery) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(`${API}${pathAndQuery}`, {
        headers: { Authorization: `Bearer ${await userToken()}`, Accept: 'application/json', 'Accept-Language': 'en-GB' },
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      if (err.code) throw err;   // token problems arrive already coded
      throw coded('EBAY_ERROR', `eBay request failed: ${err.message}`);
    }
    if (res.status === 401 && attempt === 1) { dropUserToken(); continue; }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const first = Array.isArray(body.errors) && body.errors[0] ? ` — ${body.errors[0].message}` : '';
      throw coded('EBAY_ERROR', `eBay answered HTTP ${res.status}${first}`);
    }
    return body;
  }
  throw coded('EBAY_ERROR', 'eBay rejected the seller token twice');
}

/*
 * isOpen(order) — an order we should be picking and posting.
 *   paid (PAID, or PARTIALLY_REFUNDED — e.g. postage refunded, still has to go: the same reading Shopify's sync gives
 *   partially_refunded), not cancelled, and not yet fully posted (NOT_STARTED, or IN_PROGRESS = some lines posted).
 * A buyer's cancellation REQUEST (cancelState IN_PROGRESS) is still open — eBay hasn't cancelled it — but ebayOrderSync notes it so
 * nobody posts it without looking.
 */
function isOpen(order) {
  const pay = order.orderPaymentStatus;
  const cancel = order.cancelStatus && order.cancelStatus.cancelState;
  const ful = order.orderFulfillmentStatus;
  return (pay === 'PAID' || pay === 'PARTIALLY_REFUNDED') && cancel !== 'CANCELED' && (ful === 'NOT_STARTED' || ful === 'IN_PROGRESS');
}

// What happened to an order that has left the open list: 'cancelled', 'shipped', or null (eBay still shows it open — leave it).
function closedOutcome(order) {
  const cancel = order.cancelStatus && order.cancelStatus.cancelState;
  if (cancel === 'CANCELED' || order.orderPaymentStatus === 'FULLY_REFUNDED') return 'cancelled';
  if (order.orderFulfillmentStatus === 'FULFILLED') return 'shipped';
  return null;
}

async function fetchOpenOrders() {
  const filter = encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
  const orders = [];
  let pages = 0;
  let offset = 0;
  let more = true;
  while (more && pages < MAX_PAGES) {
    const body = await ebayGet(`/order?filter=${filter}&limit=${PAGE_LIMIT}&offset=${offset}`);
    pages += 1;
    const batch = Array.isArray(body.orders) ? body.orders : [];
    orders.push(...batch);
    offset += batch.length;
    more = Boolean(body.next) && batch.length > 0;
  }
  return { orders, pages, truncated: more };
}

/*
 * fetchEbayOrders(heldOrderIds) — see the header. heldOrderIds are eBay order numbers (no 'EB' prefix) of the EB orders currently in
 * orderstatus. Throws EBAY_NOT_CONFIGURED / EBAY_ERROR if the open-orders read fails; a failed single-order lookup only makes that order
 * `unresolved`.
 */
async function fetchEbayOrders(heldOrderIds = []) {
  const { orders, pages, truncated } = await fetchOpenOrders();
  const open = orders.filter(isOpen);
  const openIds = new Set(open.map((o) => o.orderId));

  const closed = [];
  const unresolved = [];
  if (!truncated) {
    const gone = heldOrderIds.filter((id) => !openIds.has(id));
    for (const orderId of gone.slice(0, LOOKUP_CAP)) {
      try {
        const order = await ebayGet(`/order/${encodeURIComponent(orderId)}`);
        const outcome = closedOutcome(order);
        if (outcome) closed.push({ orderId, outcome });
        else unresolved.push(orderId);
      } catch {
        unresolved.push(orderId);
      }
    }
    unresolved.push(...gone.slice(LOOKUP_CAP));
  }
  return { open, closed, unresolved, truncated, pages };
}

module.exports = { isConfigured: isUserConfigured, fetchEbayOrders, isOpen, closedOutcome };
