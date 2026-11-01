/*
=======================================================================================================================================
Script: scripts/ebay-setup.js — run ONCE (re-running is safe: a policy that already exists by name is left alone)
=======================================================================================================================================
Purpose: Creates the three eBay business policies every BCWEB listing uses (utils/ebayPolicies.js has the names and the why), each a
         copy of the policy the trial listings already use, with the owner's 2026-11-01 decisions applied:
           postage  copy of "UK_RoyalMailTracked £4.50" (259653332025) -> dispatch SAME DAY (handling 0), and no extra postage for a
                    second pair in the same order (one £4.50 per order, like Shopify)
           returns  copy of "Returns Accepted,Buyer,30 days#0" (158744810025), unchanged
           payment  none made — the existing "eBay Payments" (182888761025) is used as it is: eBay refuses a copy with identical
                    settings ("Duplicate Policy", 2026-11-01)
         Copies, not edits: the trial listings (6 auctions until 6 Nov, 4 fixed price until re-listed) keep what they were listed with.
         Creates only — nothing is changed or deleted. Prints the new IDs.

Usage (from bcweb-server):  node scripts/ebay-setup.js
=======================================================================================================================================
*/

require('dotenv').config();
const { ebayRest } = require('../utils/ebayRest');
const { NAMES, MARKET } = require('../utils/ebayPolicies');

const SOURCE = { fulfillment: '259653332025', return: '158744810025', payment: '182888761025' };
const KIND = {
  fulfillment: { path: 'fulfillment_policy', list: 'fulfillmentPolicies', id: 'fulfillmentPolicyId' },
  return: { path: 'return_policy', list: 'returnPolicies', id: 'returnPolicyId' },
  payment: { path: 'payment_policy', list: 'paymentPolicies', id: 'paymentPolicyId' },
};

// What a create accepts: the source policy minus its own id / derived fields, under the new name.
function copyOf(kind, src) {
  const body = { ...src };
  delete body[KIND[kind].id];
  delete body.description;
  body.name = NAMES[kind];
  body.marketplaceId = MARKET;
  if (kind === 'fulfillment') {
    body.handlingTime = { value: 0, unit: 'DAY' };                         // same day (eBay's 2pm cut-off is set on the account)
    body.shippingOptions = (body.shippingOptions || []).map((o) => ({
      ...o,
      shippingServices: (o.shippingServices || []).map((s) => ({
        ...s,
        additionalShippingCost: { value: '0.00', currency: (s.shippingCost && s.shippingCost.currency) || 'GBP' },   // one £4.50 per order
      })),
    }));
  }
  return body;
}

(async () => {
  for (const kind of ['fulfillment', 'return', 'payment']) {
    // payment: only check the existing policy is there (see the header).
    const k = KIND[kind];
    const list = (await ebayRest('GET', `/sell/account/v1/${k.path}?marketplace_id=${MARKET}`)).body[k.list] || [];
    const existing = list.find((x) => x.name === NAMES[kind]);
    if (existing) { console.log(`${kind}: already there — "${NAMES[kind]}" ${existing[k.id]}`); continue; }
    const src = list.find((x) => x[k.id] === SOURCE[kind]);
    if (kind === 'payment') throw new Error(`payment: no policy named "${NAMES.payment}" — set one up in Seller Hub`);
    if (!src) throw new Error(`${kind}: the source policy ${SOURCE[kind]} is gone — nothing to copy`);
    const made = await ebayRest('POST', `/sell/account/v1/${k.path}`, copyOf(kind, src));
    console.log(`${kind}: created "${NAMES[kind]}" ${made.body && made.body[k.id]}`);
  }
  console.log('Done.');
})().catch((e) => { console.error('ERROR', e.message); process.exit(1); });
