/*
=======================================================================================================================================
Module: utils/ebayPolicies.js
=======================================================================================================================================
Purpose: The three eBay business policies and the stock location every BCWEB listing uses — found BY NAME at run time, so no policy ID
         lives in code or .env. scripts/ebay-setup.js creates them once (copying the three policies the trial listings use, then
         applying the owner's decisions); this module only reads.

THE POLICIES (owner decisions, 2026-11-01):
  postage  "BCWEB Free Tracked 48 same day"   Royal Mail Tracked 48, FREE to the buyer (owner, 2026-11-02 — the price is the Amazon
                                               price, utils/ebayListingRules.js), dispatch SAME DAY (handling 0; eBay's 2pm cut-off is
                                               already set on the account). A copy of the £4.50 policy below with the cost set to 0.
           (was "BCWEB £4.50 Tracked 48 same day", 2026-11-01 — £4.50 per order, no extra for a second pair; kept on eBay, unused)
  returns  "BCWEB Returns 30 days"             30 days, buyer pays return postage — the trial's terms
  payment  "eBay Payments"                     eBay's managed payments — the trial's own policy, used as it is: eBay refuses a second
                                               payment policy with identical settings ("Duplicate Policy"), and there is nothing to change
New postage and returns policies rather than editing the trial's: the 6 live trial auctions use the old postage policy until they end on 6 Nov, and changing
it would change what those buyers were promised.

LOCATION: the account's one enabled inventory location (Welshpool) — the first ENABLED one eBay returns.
Cached in-process for an hour; resolveSetup() throws EBAY_SETUP_MISSING when a policy is missing (run scripts/ebay-setup.js).
=======================================================================================================================================
*/

const { ebayRest } = require('./ebayRest');

const NAMES = {
  fulfillment: 'BCWEB Free Tracked 48 same day',
  return: 'BCWEB Returns 30 days',
  payment: 'eBay Payments',
};
const PAID_FULFILLMENT = 'BCWEB £4.50 Tracked 48 same day';   // the 2026-11-01 policy — the free one is copied from it
const MARKET = 'EBAY_GB';
const CACHE_MS = 60 * 60 * 1000;

let cached = null;   // { setup, at }

async function resolveSetup() {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.setup;
  const [f, r, p, loc] = await Promise.all([
    ebayRest('GET', `/sell/account/v1/fulfillment_policy?marketplace_id=${MARKET}`),
    ebayRest('GET', `/sell/account/v1/return_policy?marketplace_id=${MARKET}`),
    ebayRest('GET', `/sell/account/v1/payment_policy?marketplace_id=${MARKET}`),
    ebayRest('GET', '/sell/inventory/v1/location'),
  ]);
  const find = (list, idKey, name) => {
    const hit = (list || []).find((x) => x.name === name);
    return hit ? hit[idKey] : null;
  };
  const setup = {
    fulfillmentPolicyId: find(f.body && f.body.fulfillmentPolicies, 'fulfillmentPolicyId', NAMES.fulfillment),
    returnPolicyId: find(r.body && r.body.returnPolicies, 'returnPolicyId', NAMES.return),
    paymentPolicyId: find(p.body && p.body.paymentPolicies, 'paymentPolicyId', NAMES.payment),
    merchantLocationKey: ((loc.body && loc.body.locations) || []).find((x) => x.merchantLocationStatus === 'ENABLED')?.merchantLocationKey || null,
  };
  const missing = Object.entries(setup).filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    const e = new Error(`eBay isn't set up for BCWEB listings yet (missing: ${missing.join(', ')}) — run scripts/ebay-setup.js`);
    e.code = 'EBAY_SETUP_MISSING';
    throw e;
  }
  cached = { setup, at: Date.now() };
  return setup;
}

module.exports = { resolveSetup, NAMES, MARKET, PAID_FULFILLMENT };
