/*
=======================================================================================================================================
Module: utils/ebayPublish.js
=======================================================================================================================================
Purpose: Put a style on eBay — one fixed-price listing, its in-stock sizes as the variations — through the Inventory API, and add a size
         to a live listing later. WRITES TO EBAY. Two callers:
           publishStyle  POST /ebay-list (routes/ebay-list.js) — has already re-checked the style (utils/ebayCandidates.js) and owns
                         the DB record
           addSizes      the stock sync (utils/ebayStockSync.js) — a size of a listed style that has come into stock since (owner,
                         2026-11-01: "add them automatically")
         Both build each size, offer and photo list from the SAME functions below, so a size added later reads exactly like one listed
         on day one.

THE CALLS (all idempotent, so a press / run that failed half-way simply goes again):
  1. PUT inventory_item/{code}           per size: title, description, photos, brand, MPN (= groupid), EAN, condition NEW (= "New with
                                         box" in shoes), quantity = our Stock (local + FBA live), the style's item specifics + "UK Shoe
                                         Size"
  2. PUT inventory_item_group/{groupid}  the style: title, HTML description (Shopify description + the owner's footer), photos, the
                                         shared item specifics, ALL its sizes, "varies by UK Shoe Size"
  3. offer per size                      an existing offer for the SKU is UPDATED, otherwise one is created: EBAY_GB, FIXED_PRICE, GTC,
                                         the category, the three BCWEB policies, the Welshpool location, THE SIZE'S OWN price (z.price —
                                         per size since 2026-11-02: its Amazon price, else Shopify + £4.50), the quantity
  4. POST offer/publish_by_inventory_item_group  -> eBay's listing number (the same one again when a live listing gains a size)
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

// Everything a size and an offer are built from — one loadCandidates({ full: true }) row + what the form confirmed.
function listingParts(cand, { style, material, categoryId }) {
  return {
    cand,
    categoryId: String(categoryId),
    imageUrls: (cand.images || []).slice(0, MAX_IMAGES).map((f) => `${IMAGE_BASE}/${encodeURI(f)}`),
    html: descriptionHtml(cand.description),
    shared: {
      Brand: [cand.brand],
      Department: [cand.department],
      Colour: [cand.colour],
      'Upper Material': [material],
      Style: [style],
      ...(cand.type ? { Type: [cand.type] } : {}),
    },
  };
}

// 1. One size.
async function putItem(parts, z) {
  const { cand } = parts;
  await ebayRest('PUT', `${INV}/inventory_item/${encodeURIComponent(z.code)}`, {
    availability: { shipToLocationAvailability: { quantity: z.local + z.fba } },
    condition: 'NEW',
    product: {
      title: cand.title,
      description: cand.description,
      brand: cand.brand,
      mpn: cand.groupid,
      ean: [z.ean],
      imageUrls: parts.imageUrls,
      aspects: { ...parts.shared, 'UK Shoe Size': [z.uk_size] },
    },
  });
}

// 3. One size's offer — update the one eBay has for the SKU, or create it. -> offerId
async function upsertOffer(parts, z, setup) {
  const offer = {
    sku: z.code,
    marketplaceId: MARKET,
    format: 'FIXED_PRICE',
    listingDuration: 'GTC',
    availableQuantity: z.local + z.fba,
    categoryId: parts.categoryId,
    listingDescription: parts.html,
    listingPolicies: {
      fulfillmentPolicyId: setup.fulfillmentPolicyId,
      returnPolicyId: setup.returnPolicyId,
      paymentPolicyId: setup.paymentPolicyId,
    },
    merchantLocationKey: setup.merchantLocationKey,
    pricingSummary: { price: { value: Number(z.price).toFixed(2), currency: 'GBP' } },
  };
  let offerId = null;
  try {
    const found = await ebayRest('GET', `${INV}/offer?sku=${encodeURIComponent(z.code)}&marketplace_id=${MARKET}`);
    const mine = ((found.body && found.body.offers) || []).find((o) => o.marketplaceId === MARKET);
    if (mine) offerId = mine.offerId;
  } catch (err) {
    if (err.status !== 404) throw err;   // 404 "This Offer is not available" = no offer yet
  }
  if (offerId) {
    // A published offer refuses a changed SKU / marketplace / format in the body — send them all the same; eBay accepts them unchanged.
    await ebayRest('PUT', `${INV}/offer/${offerId}`, offer);
    return offerId;
  }
  const made = await ebayRest('POST', `${INV}/offer`, offer);
  return made.body && made.body.offerId;
}

// 2. The style's group, listing these sizes. -> nothing
async function putGroup(parts, sizes) {
  const { cand } = parts;
  await ebayRest('PUT', `${INV}/inventory_item_group/${encodeURIComponent(cand.groupid)}`, {
    title: cand.title,
    description: parts.html,
    imageUrls: parts.imageUrls,
    aspects: parts.shared,
    variantSKUs: sizes.map((z) => z.code),
    variesBy: { specifications: [{ name: 'UK Shoe Size', values: sizes.map((z) => z.uk_size) }] },
  });
}

// 4. Publish (or re-publish) the style. -> { itemId, warnings }
async function publishGroup(groupid) {
  const pub = await ebayRest('POST', `${INV}/offer/publish_by_inventory_item_group`, { inventoryItemGroupKey: groupid, marketplaceId: MARKET });
  const itemId = pub.body && pub.body.listingId;
  if (!itemId) {
    const e = new Error('eBay published the listing but returned no listing number');
    e.code = 'EBAY_ERROR';
    throw e;
  }
  const warnings = ((pub.body && pub.body.warnings) || []).map((w) => w.longMessage || w.message).filter(Boolean);
  return { itemId: String(itemId), warnings };
}

/*
 * publishStyle({ cand, style, material, setup }) -> { itemId, sizes: [{ code, offerId, qty, price }], warnings }
 *   cand   one loadCandidates({ full: true }) row — status not 'missing', every size carrying the price it goes on at (z.price, the
 *          form's figure already applied by the caller); setup = utils/ebayPolicies.js → resolveSetup()
 */
async function publishStyle({ cand, style, material, setup }) {
  const parts = listingParts(cand, { style, material, categoryId: cand.category.id });
  for (const z of cand.sizes) await putItem(parts, z);
  await putGroup(parts, cand.sizes);
  const sizes = [];
  for (const z of cand.sizes) sizes.push({ code: z.code, offerId: await upsertOffer(parts, z, setup), qty: z.local + z.fba, price: z.price });
  const { itemId, warnings } = await publishGroup(cand.groupid);
  return { itemId, sizes, warnings };
}

/*
 * addSizes({ cand, listing, listedSizes, newSizes, setup }) -> { itemId, sizes: [{ code, offerId, qty }] }
 *   cand         loadCandidates({ onEbayCodes: [], groupid, full: true }) row for the listed style
 *   listing      its ebay_listing row (style, material, category_id — what it was listed with)
 *   listedSizes  the sizes already on it — { code, uk_size } (kept in the group whatever their stock)
 *   newSizes     cand.sizes to add — each with a UK size, a barcode and a price (z.price — THE default, its Amazon price else Shopify +
 *                £4.50, as on the listing form), not clashing with a listed UK size (the caller checks)
 */
async function addSizes({ cand, listing, listedSizes, newSizes, setup }) {
  const parts = listingParts(cand, { style: listing.style, material: listing.material, categoryId: listing.category_id });
  for (const z of newSizes) await putItem(parts, z);
  await putGroup(parts, [...listedSizes, ...newSizes]);
  const sizes = [];
  for (const z of newSizes) sizes.push({ code: z.code, offerId: await upsertOffer(parts, z, setup), qty: z.local + z.fba, price: z.price });
  const { itemId } = await publishGroup(cand.groupid);
  return { itemId, sizes };
}

module.exports = { publishStyle, addSizes, descriptionHtml };
