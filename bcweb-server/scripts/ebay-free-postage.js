/*
=======================================================================================================================================
Script: scripts/ebay-free-postage.js   (one-off — move the LIVE BCWEB eBay listings to free postage at the Amazon price)
=======================================================================================================================================
Purpose: The owner's 2026-11-02 decision — every BCWEB eBay listing on FREE postage, each size at its Amazon price (else the Shopify price
         + £4.50; utils/ebayListingRules.js → sizePriceFor). New listings get that from the List button; this moves the ones listed
         before, in place: each size's offer gets the free postage policy ("BCWEB Free Tracked 48 same day" — made by
         scripts/ebay-setup.js) and its new price. eBay revises the live listing; its number, watchers and sales history stay.

A size whose price was SET BY HAND (ebay_listing_size.price_set_at — a dud size priced down) keeps that price; only its postage moves.
Quantities are not touched (the stock sync owns them).

DRY RUN by default: prints every size's price now → new and changes nothing. With --apply it sends, then records each size's price
(ebay_listing_size.price), the listing's lowest (ebay_listing.price), and a bclog row (section 'eBay').

Usage (from bcweb-server):
    node scripts/ebay-free-postage.js            show what would change
    node scripts/ebay-free-postage.js --apply    do it
=======================================================================================================================================
*/

require('dotenv').config();
const { pool, query } = require('../database');
const { ebayRest } = require('../utils/ebayRest');
const { resolveSetup } = require('../utils/ebayPolicies');
const { sizePriceFor } = require('../utils/ebayListingRules');
const { safeNumeric } = require('../utils/sql');
const { writeBcLog } = require('../utils/bclog');

const APPLY = process.argv.includes('--apply');
const INV = '/sell/inventory/v1';

// What updateOffer takes back — the offer as eBay holds it, minus the read-only fields, with the new postage + price.
function offerBody(o, fulfillmentPolicyId, price) {
  return {
    sku: o.sku,
    marketplaceId: o.marketplaceId,
    format: o.format,
    listingDuration: o.listingDuration,
    availableQuantity: o.availableQuantity,
    categoryId: o.categoryId,
    listingDescription: o.listingDescription,
    listingPolicies: { ...o.listingPolicies, fulfillmentPolicyId },
    merchantLocationKey: o.merchantLocationKey,
    pricingSummary: { price: { value: price.toFixed(2), currency: 'GBP' } },
  };
}

(async () => {
  const setup = await resolveSetup();   // throws if the free policy isn't on eBay yet — run scripts/ebay-setup.js
  const { rows } = await query(`
    SELECT e.id AS listing_id, e.groupid, e.item_id, s.code, s.offer_id, s.price, s.price_set_at,
           ${safeNumeric('ss.shopifyprice')} AS shopify_price, ${safeNumeric('a.amzprice')} AS amz_price
    FROM ebay_listing e
    JOIN ebay_listing_size s ON s.ebay_listing_id = e.id
    JOIN skusummary ss ON ss.groupid = e.groupid
    LEFT JOIN amzfeed a ON a.code = s.code
    WHERE e.ended_at IS NULL
    ORDER BY e.groupid, s.code`);
  if (!rows.length) { console.log('No live BCWEB listings.'); return; }

  const done = new Map();   // listing_id -> { groupid, item_id, prices: [] }
  for (const r of rows) {
    const offer = (await ebayRest('GET', `${INV}/offer/${r.offer_id}`)).body;
    const now = Number(offer.pricingSummary && offer.pricingSummary.price && offer.pricingSummary.price.value);
    const handSet = r.price_set_at !== null;
    const def = sizePriceFor(r.amz_price, r.shopify_price);
    const price = handSet ? Number(r.price) : def && def.price;
    const why = handSet ? 'kept (set by hand)' : def ? (def.from === 'amazon' ? 'Amazon price' : 'Shopify + £4.50') : 'NO PRICE — skipped';
    const policyNow = offer.listingPolicies && offer.listingPolicies.fulfillmentPolicyId;
    console.log(`${r.groupid}  ${r.code}  £${now.toFixed(2)} -> ${price ? `£${price.toFixed(2)}` : '—'}  (${why})${policyNow === setup.fulfillmentPolicyId ? '  already free postage' : ''}`);
    if (!price || !APPLY) continue;

    await ebayRest('PUT', `${INV}/offer/${r.offer_id}`, offerBody(offer, setup.fulfillmentPolicyId, price));
    if (!handSet) await query('UPDATE ebay_listing_size SET price = $1 WHERE ebay_listing_id = $2 AND code = $3', [price, r.listing_id, r.code]);
    const d = done.get(r.listing_id) || { groupid: r.groupid, item_id: r.item_id, prices: [] };
    d.prices.push(price);
    done.set(r.listing_id, d);
  }

  if (!APPLY) { console.log('\nDry run — nothing sent. Run with --apply to do it.'); return; }
  for (const [id, d] of done) {
    const low = Math.min(...d.prices);
    const high = Math.max(...d.prices);
    await query('UPDATE ebay_listing SET price = $1 WHERE id = $2', [low, id]);
    await writeBcLog(pool, {
      who: 'Claude (script)',
      section: 'eBay',
      log: `${d.groupid} (eBay item ${d.item_id}) moved to free postage at ${low === high ? `£${low.toFixed(2)}` : `£${low.toFixed(2)}–£${high.toFixed(2)}`} — ${d.prices.length} size${d.prices.length === 1 ? '' : 's'}`,
    });
    console.log(`Done: ${d.groupid} — ${d.prices.length} sizes`);
  }
})()
  .catch((e) => { console.error('ERROR', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
