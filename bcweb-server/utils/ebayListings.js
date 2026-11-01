/*
=======================================================================================================================================
Module: utils/ebayListings.js
=======================================================================================================================================
Purpose: What is LIVE on eBay right now, read from eBay — and the checks the eBay listings screen runs against our own stock. READ ONLY:
         nothing here writes to eBay or to the DB. The first of the three eBay listing builds (owner, 2026-11-01: "Start with read
         only" — Checking first, then Add with stock kept in step, then Remove).

THE READ — Trading API GetSellerList (utils/ebayTrading.js), every listing ending from now to 119 days out (eBay's window is 120 days at
most). That window holds every live listing: a Good 'Til Cancelled fixed-price listing's EndTime is its next monthly renewal. Paged 200
at a time. Only ListingStatus = Active is kept (a listing ended early can still sit in the window).
FIXED PRICE ONLY (owner, 2026-11-01: "We are going to not use auction ... We will deal with those existing ones manually for now"):
auctions and any other format are left out and only COUNTED (skipped) — the screen says how many, so none is forgotten.
Why GetSellerList and not the Inventory API: the listings made by the Seller Hub bulk upload exist only in the Trading world — the
Inventory API can't see them (it holds 12 unpublished drafts from the old Shopify connector instead, 2026-11-01). One call returns
everything the screen shows, watchers included (IncludeWatchCount). View counts are NOT available: GetSellerList leaves HitCount blank
and eBay's traffic report needs the Analytics scope, which the refresh token doesn't carry.

THE GRAIN: a LISTING has one or more LINES. A single-size listing is one line (the Item's own SKU — the CustomLabel, our code). A
variation listing (the planned one-listing-per-style, sizes inside — owner, 2026-11-01) has one line per Variation SKU. A line is what
gets matched to skumap and checked.

PRIVACY: the Item XML also carries the high bidder's user id and e-mail. Neither is read or passed on.

THE CHECKS (checkLine) — codes, so the screen owns the wording:
  PROBLEMS (fix them)
    unknown        the line's SKU is blank or not a live skumap code — an eBay sale of it would never reach orderstatus
    birkenstock    brand Birkenstock (or "Birkenstock" in the title) — never on eBay (distribution rules + VeRO; docs/ebay-clearance.md)
    oversell       eBay's available quantity is MORE than we hold (local #FREE + FBA live) — a second sale of a pair we haven't got.
                   The stock is NOT kept in step yet (that is the Add build), so a Shopify sale leaves eBay's count where it was.
  CHECKS (against the postage rules in docs/ebay-clearance.md)
    postage_paid   the listing charges postage — the rule is free postage built into the price
  INFO
    sold_out       eBay shows 0 available — the account is in eBay's out-of-stock control, so the listing stays alive but hidden
    more_held      we hold more than eBay shows (fine if on purpose)
"We hold" counts FBA stock too: FBA pairs go on eBay and ship by MCF (owner, 2026-10-31).
=======================================================================================================================================
*/

const { tradingCall, xmlBlock, xmlBlocks, xmlTag, xmlNum } = require('./ebayTrading');
const { isUserConfigured } = require('./ebayAuth');

const PAGE_SIZE = 200;
const MAX_PAGES = 10;           // 2,000 listings — far past the ~111 planned; a cap, not a limit we expect to meet
const WINDOW_DAYS = 119;

function formatOf(listingType) {
  if (listingType === 'Chinese') return 'auction';
  if (listingType === 'FixedPriceItem' || listingType === 'StoresFixedPrice') return 'fixed';
  return (listingType || 'unknown').toLowerCase();
}

// The size eBay shows: a variation's own specifics (the first name with "Size" in it), else the Item's "UK Shoe Size".
function sizeFrom(specificsXml) {
  for (const nv of xmlBlocks(specificsXml, 'NameValueList')) {
    if (/size/i.test(xmlTag(nv, 'Name'))) return xmlTag(nv, 'Value') || null;
  }
  return null;
}

function parseItem(itemXml) {
  // Cut the Variations block out before reading the Item's own fields — it repeats SKU / StartPrice / QuantitySold.
  const variationsXml = xmlBlock(itemXml, 'Variations');
  const own = variationsXml ? itemXml.replace(variationsXml, '') : itemXml;

  const status = xmlBlock(own, 'SellingStatus');
  const details = xmlBlock(own, 'ListingDetails');
  const shipping = xmlBlock(own, 'ShippingDetails');
  const firstService = xmlBlocks(shipping, 'ShippingServiceOptions')[0] || '';
  const profiles = xmlBlock(own, 'SellerProfiles');
  const returns = xmlBlock(own, 'ReturnPolicy');
  const format = formatOf(xmlTag(own, 'ListingType'));

  const postageCost = xmlNum(firstService, 'ShippingServiceCost');
  const listing = {
    item_id: xmlTag(own, 'ItemID'),
    title: xmlTag(own, 'Title'),
    url: xmlTag(details, 'ViewItemURL') || null,
    format,
    status: xmlTag(status, 'ListingStatus'),
    started: xmlTag(details, 'StartTime') || null,
    ends: xmlTag(details, 'EndTime') || null,       // fixed price GTC: the next monthly renewal
    duration: xmlTag(own, 'ListingDuration') || null,
    watchers: xmlNum(own, 'WatchCount') ?? 0,
    category: xmlTag(xmlBlock(own, 'PrimaryCategory'), 'CategoryName') || null,
    postage: {
      service: xmlTag(firstService, 'ShippingService') || null,
      cost: postageCost,
      free: postageCost === 0 || xmlTag(firstService, 'FreeShipping') === 'true',
      policy: xmlTag(xmlBlock(profiles, 'SellerShippingProfile'), 'ShippingProfileName') || null,
      dispatch_days: xmlNum(own, 'DispatchTimeMax'),
    },
    returns: {
      within: xmlTag(returns, 'ReturnsWithin') || null,
      paid_by: xmlTag(returns, 'ShippingCostPaidBy') || null,
    },
    lines: [],
  };

  const variations = variationsXml ? xmlBlocks(variationsXml, 'Variation') : [];
  if (variations.length) {
    for (const v of variations) {
      const qty = xmlNum(v, 'Quantity') ?? 0;
      const sold = xmlNum(xmlBlock(v, 'SellingStatus'), 'QuantitySold') ?? 0;
      listing.lines.push({
        sku: xmlTag(v, 'SKU') || null,
        ebay_size: sizeFrom(xmlBlock(v, 'VariationSpecifics')),
        ebay_price: xmlNum(v, 'StartPrice'),
        ebay_qty: qty, ebay_sold: sold, ebay_available: Math.max(qty - sold, 0),
      });
    }
  } else {
    const qty = xmlNum(own, 'Quantity') ?? 0;
    const sold = xmlNum(status, 'QuantitySold') ?? 0;
    listing.lines.push({
      sku: xmlTag(own, 'SKU') || null,
      ebay_size: sizeFrom(xmlBlock(own, 'ItemSpecifics')),
      ebay_price: xmlNum(own, 'StartPrice'),
      ebay_qty: qty, ebay_sold: sold, ebay_available: Math.max(qty - sold, 0),
    });
  }
  return listing;
}

/*
 * fetchActiveListings() -> { listings, skipped, skippedSkus, truncated } — listings = fixed price only; skipped = how many live listings
 * of any other format (auctions); skippedSkus = the SKUs (our codes) inside those, so "is this style on eBay?" counts them too
 * Throws EBAY_NOT_CONFIGURED / EBAY_ERROR (utils/ebayTrading.js).
 */
async function fetchActiveListings() {
  if (!isUserConfigured()) {
    const e = new Error('eBay needs EBAY_CLIENT_ID, EBAY_CLIENT_SECRET and EBAY_REFRESH_TOKEN in bcweb-server/.env');
    e.code = 'EBAY_NOT_CONFIGURED';
    throw e;
  }
  const from = new Date();
  const to = new Date(from.getTime() + WINDOW_DAYS * 86400000);
  const listings = [];
  let skipped = 0;
  const skippedSkus = [];
  let truncated = false;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const xml = await tradingCall('GetSellerList',
      `<EndTimeFrom>${from.toISOString()}</EndTimeFrom><EndTimeTo>${to.toISOString()}</EndTimeTo>` +
      '<DetailLevel>ReturnAll</DetailLevel><IncludeWatchCount>true</IncludeWatchCount><IncludeVariations>true</IncludeVariations>' +
      `<Pagination><EntriesPerPage>${PAGE_SIZE}</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination>`);
    for (const itemXml of xmlBlocks(xmlBlock(xml, 'ItemArray'), 'Item')) {
      const l = parseItem(itemXml);
      if (l.status !== 'Active') continue;
      if (l.format === 'fixed') listings.push(l);
      else { skipped += 1; for (const x of l.lines) if (x.sku) skippedSkus.push(x.sku); }
    }
    if (xmlTag(xml, 'HasMoreItems') !== 'true') break;
    if (page === MAX_PAGES) truncated = true;
  }
  return { listings, skipped, skippedSkus, truncated };
}

/*
 * checkLine(line, postage, listingTitle) -> flag codes (see the header) — fixed-price lines only
 *   line          a listing line already joined to BCWEB: { known, brand, local, fba, ebay_available, ... } — local = sellable
 *                 (#FREE) pairs, fba = FBA live
 *   postage       the listing's postage ({ cost, free })
 *   listingTitle  eBay's title — catches a Birkenstock listed under a code we don't know
 */
function checkLine(line, postage, listingTitle) {
  const flags = [];
  const held = (line.local || 0) + (line.fba || 0);
  if (!line.known) flags.push('unknown');
  if (/^birk/i.test(line.brand || '') || /birkenstock/i.test(listingTitle || '')) flags.push('birkenstock');
  if (line.known && line.ebay_available > held) flags.push('oversell');
  if (postage.cost !== null && postage.cost > 0) flags.push('postage_paid');
  if (line.ebay_available === 0) flags.push('sold_out');
  if (line.known && held > line.ebay_available) flags.push('more_held');
  return flags;
}

const PROBLEM_FLAGS = new Set(['unknown', 'birkenstock', 'oversell']);
const CHECK_FLAGS = new Set(['postage_paid']);

module.exports = { fetchActiveListings, checkLine, PROBLEM_FLAGS, CHECK_FLAGS };
