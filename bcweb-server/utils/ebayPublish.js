/*
=======================================================================================================================================
Module: utils/ebayPublish.js
=======================================================================================================================================
Purpose: Put ONE style on eBay — one fixed-price listing, its in-stock sizes as the variations — through the Inventory API. The only
         caller is POST /ebay-list (routes/ebay-list.js), which has already re-checked the style (utils/ebayCandidates.js) and owns the
         DB record. WRITES TO EBAY.

THE CALLS, in order (all idempotent, so a press that failed half-way can simply be pressed again):
  1. PUT inventory_item/{code}           one per in-stock size: title, description, photos, brand, MPN (= groupid), EAN, condition NEW
                                         (= "New with box" in shoes), quantity = our Stock (local + FBA live), and the item specifics —
                                         the style's own plus "UK Shoe Size"
  2. PUT inventory_item_group/{groupid}  the style: title, HTML description (Shopify description + the owner's footer), photos, the shared
                                         item specifics, the sizes, and "varies by UK Shoe Size"
  3. offer per size                      an existing (unpublished, from a failed press) offer for the SKU is UPDATED, otherwise one is
                                         created: EBAY_GB, FIXED_PRICE, GTC, the category, the three BCWEB policies, the Welshpool
                                         location, the price, the quantity
  4. POST offer/publish_by_inventory_item_group  -> eBay's listing number
The SKU on eBay is OUR CODE, so eBay orders come back through Update Orders onto the right stock.

THE DESCRIPTION is plain Shopify text (shopify_description.description, HTML-escaped) — not the Shopify HTML, which can carry links, and
eBay forbids links off eBay — then the FOOTER (utils/ebayListingRules.js) with its first sentence in bold, as the owner approved it.
PHOTOS: https://images.brookfieldcomfort.com/<product_images.filename>, in position order, at most 12. eBay copies them.
=======================================================================================================================================
*/

const { ebayRest } = require('./ebayRest');
const { MARKET } = require('./ebayPolicies');
const rules = require('./ebayListingRules');

const IMAGE_BASE = 'https://images.brookfieldcomfort.com';   // the same host as utils/shopify.js IMAGE_BASE
const MAX_IMAGES = 12;
const INV = '/sell/inventory/v1';

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function descriptionHtml(text) {
  const [first, ...rest] = rules.FOOTER.split('. ');
  const footer = `<p><strong>${esc(first)}.</strong> ${esc(rest.join('. '))}</p>`;
  const body = String(text || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return body + footer;
}

/*
 * publishStyle({ cand, price, style, material, setup }) -> { itemId, sizes: [{ code, offerId, qty }], warnings }
 *   cand      one loadCandidates({ full: true }) row — status not 'missing'
 *   price     £ (item only), style / material — as confirmed on the form
 *   setup     utils/ebayPolicies.js → resolveSetup()
 * Throws EBAY_ERROR with eBay's own messages.
 */
async function publishStyle({ cand, price, style, material, setup }) {
  const imageUrls = (cand.images || []).slice(0, MAX_IMAGES).map((f) => `${IMAGE_BASE}/${encodeURI(f)}`);
  const html = descriptionHtml(cand.description);
  const shared = {
    Brand: [cand.brand],
    Department: [cand.department],
    Colour: [cand.colour],
    'Upper Material': [material],
    Style: [style],
    ...(cand.type ? { Type: [cand.type] } : {}),
  };

  // 1. One inventory item per in-stock size.
  for (const z of cand.sizes) {
    await ebayRest('PUT', `${INV}/inventory_item/${encodeURIComponent(z.code)}`, {
      availability: { shipToLocationAvailability: { quantity: z.local + z.fba } },
      condition: 'NEW',
      product: {
        title: cand.title,
        description: cand.description,
        brand: cand.brand,
        mpn: cand.groupid,
        ean: [z.ean],
        imageUrls,
        aspects: { ...shared, 'UK Shoe Size': [z.uk_size] },
      },
    });
  }

  // 2. The style: the variation group.
  await ebayRest('PUT', `${INV}/inventory_item_group/${encodeURIComponent(cand.groupid)}`, {
    title: cand.title,
    description: html,
    imageUrls,
    aspects: shared,
    variantSKUs: cand.sizes.map((z) => z.code),
    variesBy: { specifications: [{ name: 'UK Shoe Size', values: cand.sizes.map((z) => z.uk_size) }] },
  });

  // 3. One offer per size — update a leftover unpublished one, or create.
  const sizes = [];
  for (const z of cand.sizes) {
    const qty = z.local + z.fba;
    const offer = {
      sku: z.code,
      marketplaceId: MARKET,
      format: 'FIXED_PRICE',
      listingDuration: 'GTC',
      availableQuantity: qty,
      categoryId: String(cand.category.id),
      listingDescription: html,
      listingPolicies: {
        fulfillmentPolicyId: setup.fulfillmentPolicyId,
        returnPolicyId: setup.returnPolicyId,
        paymentPolicyId: setup.paymentPolicyId,
      },
      merchantLocationKey: setup.merchantLocationKey,
      pricingSummary: { price: { value: price.toFixed(2), currency: 'GBP' } },
    };
    let offerId = null;
    try {
      const found = await ebayRest('GET', `${INV}/offer?sku=${encodeURIComponent(z.code)}&marketplace_id=${MARKET}`);
      const mine = ((found.body && found.body.offers) || []).find((o) => o.marketplaceId === MARKET);
      if (mine) offerId = mine.offerId;
    } catch (err) {
      if (err.status !== 404) throw err;   // 404 / "not available" = no offer yet
    }
    if (offerId) {
      await ebayRest('PUT', `${INV}/offer/${offerId}`, offer);
    } else {
      const made = await ebayRest('POST', `${INV}/offer`, offer);
      offerId = made.body && made.body.offerId;
    }
    sizes.push({ code: z.code, offerId, qty });
  }

  // 4. Publish the group as one listing.
  const pub = await ebayRest('POST', `${INV}/offer/publish_by_inventory_item_group`, {
    inventoryItemGroupKey: cand.groupid,
    marketplaceId: MARKET,
  });
  const itemId = pub.body && pub.body.listingId;
  if (!itemId) {
    const e = new Error('eBay published the listing but returned no listing number');
    e.code = 'EBAY_ERROR';
    throw e;
  }
  const warnings = ((pub.body && pub.body.warnings) || []).map((w) => w.longMessage || w.message).filter(Boolean);
  return { itemId: String(itemId), sizes, warnings };
}

module.exports = { publishStyle, descriptionHtml };
