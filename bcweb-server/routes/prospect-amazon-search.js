/*
=======================================================================================================================================
API Route: prospect_amazon_search
=======================================================================================================================================
Method: GET
Purpose: The Prospects "Search Amazon" panel (owner, 2026-11-27: "is there a quicker, automated way?" → "yes, improve the prospects
         screen with what we have available"). The team used to type "Lunar boots women" into Amazon, then read rank, price and
         sellers off each page by hand. This answers one search page in one go, from Amazon's own Selling Partner API (the official API,
         not scraping — utils/amzSpApi.js):
           - Catalog Items searchCatalogItems: the listings (each is ONE SIZE — a child ASIN — with its parent), title, brand, size,
             colour and the sales rank in its category (and the broad group's)
           - Product Pricing getItemOffers, batched: Buy Box price (or the lowest offer if no Buy Box) and the sellers, FBA / FBM
           - "on our list / ours already": prospect + amzfeed by ASIN (the same two checks as prospect-asin-check)
           - supplier stock: utils/supplierStock.js — a Rieker-group code found in the listing, matched to the Rieker stock list
             (cost, sizes in stock). Lunar's GRS sends no list, so Lunar finds have none.
         REVIEWS ARE NOT HERE: Amazon's API does not give star ratings or review counts — the screen links to the page for that.
         No RRP either: Amazon's list price came back empty on every listing tried; the Rieker cost comes from the list.
         One search page = 20 sizes (Amazon's maximum); "More" passes next_token. The screen groups sizes into styles by parent.
         READ ONLY — writes nothing; "Add" on the screen goes through prospect-save as usual. Requires auth.
         Rates: catalog search 2/s; the offers batch ~1 per 10 s (shared with the hourly Buy Box reading) — amzSpApi waits and retries
         on a 429, and if the offers still fail the page comes back with ranks only (offers_error set) rather than failing.
=======================================================================================================================================
Request Query Params:
  q          (string, required) — the words, as typed into Amazon ("lunar boots women")
  brand      (string, optional) — Amazon's brand filter, exact ("Rieker"); cuts out other brands' listings that mention the word
  next_token (string, optional) — the next page of the same search

Success Response:
{ "return_code": "SUCCESS",
  "total": 309,                                   // Amazon's count of matching listings (sizes)
  "next_token": "…" | null,
  "offers_error": null | "…",                     // offers could not be read — ranks only on this page
  "supplier_lists": { "rieker": "2026-11-27" },   // the loaded supplier lists and their dates
  "items": [
    { "asin": "B0DFMKV8KN", "parent": "B0DFMXXXXX" | null, "title": "…", "brand": "Lunar", "size": "4 UK", "colour": "Burgundy",
      "rank": { "category": "Women's Boots", "rank": 619 } | null, "group_rank": { "category": "Fashion", "rank": 58211 } | null,
      "buybox": 53.46 | null, "lowest": 53.46 | null, "fba": 1, "fbm": 3,     // fba/fbm null when offers weren't read
      "have": "LUN-PARLOUR-BURG" | null,                                       // ours already (amzfeed groupid)
      "listed": { "id": 4, "name": "…", "archived": false } | null,             // on the Prospects list (line or a check's ASIN)
      "supplier": { "colour_sure": true, "styles": [ { "supplier": "rieker", "style": "44650-02", "season": "…", "cost": 30.05,
                    "sizes": { "38": "limited" }, "list_date": "2026-11-27" } ] } | null,
      "return_on_cost": { "price": 53.46, "cost": 30.05, "profit": 6.1, "on_cost_pct": 20.3 } | null }   // one-style match + a price
  ] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"AMAZON_ERROR"     // the catalog search itself failed (message says why)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const sp = require('../utils/amzSpApi');
const supplierStock = require('../utils/supplierStock');
const { returnOnCost } = require('../utils/prospect');
const { CATALOG_DATA, readItem, readOffers } = require('../utils/amzProspectRead');
const logger = require('../utils/logger');

router.use(verifyToken);

const PAGE = 20;   // searchCatalogItems' maximum, and the offers batch's

router.get('/', async (req, res) => {
  try {
    const q = String(req.query.q || '').trim().slice(0, 200);
    const brand = String(req.query.brand || '').trim().slice(0, 100);
    const nextToken = String(req.query.next_token || '').trim();
    if (!q) return res.json({ return_code: 'MISSING_FIELDS', message: 'Type what to search for' });
    const mkt = sp.marketplaceId();

    // ---- 1. The search: one page of sizes ----------------------------------------------------------------------------------------
    let found;
    try {
      found = await sp.spGet('/catalog/2022-04-01/items', {
        marketplaceIds: mkt, keywords: q, brandNames: brand || undefined, pageToken: nextToken || undefined,
        includedData: CATALOG_DATA, pageSize: PAGE,
      });
    } catch (err) {
      return res.json({ return_code: 'AMAZON_ERROR', message: err.message });
    }
    // Rank / price / sellers are read by utils/amzProspectRead.js — THE copy, shared with a line's "Check on Amazon".
    const items = (found.items || []).map(readItem);
    const asins = items.map((i) => i.asin);

    // ---- 2. Offers, supplier stock and our own two lists, side by side -----------------------------------------------------------
    let offersError = null;
    const offersP = asins.length
      ? sp.spPost('/batches/products/pricing/v0/itemOffers', {
        requests: asins.map((asin) => ({ uri: `/products/pricing/v0/items/${asin}/offers`, method: 'GET', MarketplaceId: mkt, ItemCondition: 'New' })),
      }).catch((err) => { offersError = err.message; return null; })
      : Promise.resolve(null);
    const [offers, supplier, lists, have, listed] = await Promise.all([
      offersP,
      supplierStock.lookup(items),
      supplierStock.supplierList(),
      query(`SELECT UPPER(TRIM(asin)) AS asin, MIN(groupid) AS groupid FROM amzfeed WHERE UPPER(TRIM(asin)) = ANY($1) GROUP BY 1`, [asins]),
      // On the list = the line's own ASIN or one typed on a check (as prospect-list's "have it" reads both).
      query(`
        SELECT DISTINCT ON (x.asin) x.asin, p.id, p.name, p.archived_at IS NOT NULL AS archived
          FROM (SELECT id AS prospect_id, asin FROM prospect WHERE asin = ANY($1)
                UNION SELECT prospect_id, asin FROM prospect_check WHERE asin = ANY($1)) x
          JOIN prospect p ON p.id = x.prospect_id
         ORDER BY x.asin, p.archived_at IS NOT NULL, p.id`, [asins]),
    ]);

    const offerBy = new Map();
    for (const r of offers?.responses || []) {
      const p = r.body?.payload;
      if (p?.ASIN) offerBy.set(p.ASIN, p.Summary || {});
    }
    const haveBy = new Map(have.rows.map((r) => [r.asin, r.groupid]));
    const listedBy = new Map(listed.rows.map((r) => [r.asin, { id: r.id, name: r.name, archived: r.archived }]));

    for (const it of items) {
      Object.assign(it, readOffers(offerBy.get(it.asin)));
      it.have = haveBy.get(it.asin) ?? null;
      it.listed = listedBy.get(it.asin) ?? null;
      it.supplier = supplier.get(it.asin) ?? null;
      // RETURN ON COST at this size's price (Buy Box, else the lowest offer) with the list's cost — THE Amazon formula via
      // utils/prospect.js, as on a saved line. Only when the match is ONE style (a colour-unsure match may span costs).
      const price = it.buybox ?? it.lowest;
      const sup = it.supplier && it.supplier.styles.length === 1 ? it.supplier.styles[0] : null;
      it.return_on_cost = sup && sup.cost && price ? returnOnCost(String(price), String(sup.cost)) : null;
      delete it.model;
      delete it.part;
    }

    res.json({
      return_code: 'SUCCESS', total: found.numberOfResults ?? items.length, next_token: found.pagination?.nextToken ?? null,
      offers_error: offersError, supplier_lists: lists, items,
    });
  } catch (err) {
    logger.error('[prospect-amazon-search] error:', err.message);
    res.json({ return_code: 'SERVER_ERROR', message: 'Search failed' });
  }
});

module.exports = router;
