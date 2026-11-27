/*
=======================================================================================================================================
Util: amzProspectRead — THE copy of how Prospects reads an Amazon listing (owner, 2026-11-27)
=======================================================================================================================================
Purpose: One reading of rank / price / sellers for the Prospects screen, shared by the "Search Amazon" panel
         (routes/prospect-amazon-search.js) and the "Check on Amazon" button on a line (routes/prospect-check-amazon.js), so both say
         the same thing. Amazon calls go through utils/amzSpApi.js.
         RANK = the OVERALL group rank ("Fashion"), never the sub-category's (owner, 2026-11-27: "Margo boots is 89 in country boots
         and 865k in fashion. Its the fashion listing I need") — the sub-category is kept as `rank` for reference only.
         PRICE = the Buy Box (new), else the lowest new offer when nobody has the Buy Box.
         SELLERS = new offers counted by how they ship, FBA and FBM.
=======================================================================================================================================
Exports:
  CATALOG_DATA               the includedData a catalog call needs for readItem
  readItem(item)             -> { asin, parent, title, brand, size, colour, model, part, rank, group_rank } from a catalog item
  readOffers(summary)        -> { buybox, lowest, fba, fbm } from getItemOffers' Summary (no Summary -> all null)
  sellersText(o)             -> '1 FBA · 3 FBM' | '' — how a check stores sellers
  rankText(n)                -> '865,412' — how a check stores the rank
  readOne(asin)              -> { item, offers } | throws — one listing, both calls (the line's button)
=======================================================================================================================================
*/

const sp = require('./amzSpApi');

const CATALOG_DATA = 'summaries,salesRanks,attributes,relationships';

const first = (a) => (Array.isArray(a) && a.length ? a[0] : null);
const val = (attr) => first(attr)?.value ?? null;
const amount = (p) => (p && Number.isFinite(Number(p.Amount)) ? Number(p.Amount) : null);

function readItem(it) {
  const s = first(it.summaries) || {};
  const a = it.attributes || {};
  const ranks = first(it.salesRanks) || {};
  const cls = first(ranks.classificationRanks);
  const grp = first(ranks.displayGroupRanks);
  const parent = (first(it.relationships)?.relationships || []).find((r) => r.parentAsins)?.parentAsins?.[0] ?? null;
  return {
    asin: it.asin, parent, title: s.itemName || '', brand: s.brand || null, size: s.size || null, colour: s.color || null,
    model: s.modelNumber || val(a.model_number), part: val(a.part_number),
    rank: cls ? { category: cls.title, rank: cls.rank } : null,
    group_rank: grp ? { category: grp.title, rank: grp.rank } : null,
  };
}

function readOffers(sum) {
  if (!sum) return { buybox: null, lowest: null, fba: null, fbm: null };
  // No offers at all = 0 / 0 (a dead listing), not null.
  const count = (ch) => (sum.NumberOfOffers || []).filter((o) => o.condition === 'new' && o.fulfillmentChannel === ch)
    .reduce((n, o) => n + (o.OfferCount || 0), 0);
  const buybox = amount(first((sum.BuyBoxPrices || []).filter((b) => String(b.condition).toLowerCase() === 'new'))?.LandedPrice)
    ?? amount(first(sum.BuyBoxPrices)?.LandedPrice);
  const lows = (sum.LowestPrices || []).map((l) => amount(l.LandedPrice)).filter((n) => n !== null);
  return { buybox, lowest: lows.length ? Math.min(...lows) : null, fba: count('Amazon'), fbm: count('Merchant') };
}

const sellersText = (o) => (o.fba === null || o.fba === undefined ? '' : `${o.fba} FBA · ${o.fbm} FBM`);
const rankText = (n) => Number(n).toLocaleString('en-GB');

async function readOne(asin) {
  const mkt = sp.marketplaceId();
  const it = await sp.spGet(`/catalog/2022-04-01/items/${asin}`, { marketplaceIds: mkt, includedData: CATALOG_DATA });
  let offers = readOffers(null);
  try {
    const o = await sp.spGet(`/products/pricing/v0/items/${asin}/offers`, { MarketplaceId: mkt, ItemCondition: 'New' });
    offers = readOffers(o?.payload?.Summary);
  } catch { /* price and sellers unread — the rank alone is still worth saving */ }
  return { item: readItem(it), offers };
}

module.exports = { CATALOG_DATA, readItem, readOffers, sellersText, rankText, readOne };
