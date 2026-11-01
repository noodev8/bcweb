/*
=======================================================================================================================================
API Route: ebay_listings
=======================================================================================================================================
Method: GET
Purpose: The eBay listings screen (/ebay, owner 2026-11-01: "Start with read only") — every listing LIVE on eBay now, read from eBay
         (utils/ebayListings.js → GetSellerList), each line matched to our code in skumap and to the stock we hold, with the checks
         from utils/ebayListings.js → checkLine. READ ONLY: nothing is written to eBay or the DB, and nothing is stored — the screen
         calls this only when Refresh is pressed (or the page is opened).

         Per line, from BCWEB: groupid, brand, Shopify title and price, local sellable stock (localstock #FREE — CLAUDE.md, never
         stockvariants), FBA live (amzfeed.amzlive), and the profit a sale at the eBay price would book (utils/ebayProfit.js — THE EBY
         formula, Royal Mail even for FBA), and OUR eBay sales of the last 30 days, net (sales channel EBY, by code). FIXED PRICE ONLY (owner, 2026-11-01) — auctions are counted in summary.skipped and
         handled by hand in Seller Hub. Codes are matched
         exactly against live (not deleted) skumap rows.

         Order: listings with a problem first, then by code.

Requires auth.
=======================================================================================================================================
Request: GET /ebay-listings

Success Response:
{
  "return_code": "SUCCESS",
  "read_at": "2026-11-01T19:30:00.000Z",
  "truncated": false,
  "summary": { "listings": 4, "skipped": 6, "problems": 0, "checks": 0, "watchers": 5 },
  "listings": [ {
      "item_id": "287691986997", "title": "…", "url": "https://www.ebay.co.uk/itm/…", "format": "fixed",
      "started": "…Z", "ends": "…Z", "duration": "GTC", "watchers": 2, "category": "…",
      "postage": { "service": "UK_RoyalMailTracked", "cost": 0, "free": true, "policy": "…", "dispatch_days": 2 },
      "returns": { "within": "30 days", "paid_by": "Buyer" },
      "flags": ["…"],                                     // every line's flags, once each
      "lines": [ { "sku": "M014A-10", "ebay_size": null, "size": "10", "ebay_price": 11.99, "ebay_qty": 1, "ebay_sold": 0, "ebay_available": 1,
                   "known": true, "groupid": "M014A", "brand": "Goor", "shopify_title": "…", "shopify_price": 19.99,
                   "local": 1, "fba": 0, "sold_30d": 0, "profit": -1.23, "flags": [] } ]
  } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"EBAY_NOT_CONFIGURED"   the eBay keys / refresh token are missing from .env
"EBAY_ERROR"            eBay couldn't be read (message says why)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { fetchActiveListings, checkLine, PROBLEM_FLAGS, CHECK_FLAGS } = require('../utils/ebayListings');
const { unlistedSizes } = require('../utils/ebayStockSync');
const { ebayProfit } = require('../utils/ebayProfit');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

router.get('/', async (req, res) => {
  let read;
  try {
    read = await fetchActiveListings();
  } catch (err) {
    const code = err.code === 'EBAY_NOT_CONFIGURED' ? 'EBAY_NOT_CONFIGURED' : 'EBAY_ERROR';
    logger.error('[ebay-listings] eBay read failed:', err.message);
    return res.json({ return_code: code, message: err.message });
  }

  try {
    const { listings, skipped, truncated } = read;
    const codes = [...new Set(listings.flatMap((l) => l.lines.map((x) => x.sku)).filter(Boolean))];

    // One query for every code on eBay: is it ours, which style, and what we hold.
    const result = codes.length === 0 ? { rows: [] } : await query(`
      WITH m AS (
        SELECT DISTINCT ON (code) code, groupid FROM skumap
        WHERE code = ANY($1::text[]) AND COALESCE(deleted, 0) = 0
        ORDER BY code, groupid
      ),
      loc AS (
        SELECT code, SUM(qty) AS qty FROM localstock
        WHERE code = ANY($1::text[]) AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY code
      ),
      fba AS (
        SELECT code, SUM(COALESCE(amzlive, 0)) AS qty FROM amzfeed WHERE code = ANY($1::text[]) GROUP BY code
      ),
      sold AS (
        -- OUR eBay sales in the last 30 days, net (owner, 2026-11-01: "change it to our own sales of 30d") — the EBY rows Update
        -- Orders books, by code, whichever listing they came through. Not eBay's QuantitySold, which counts since the listing went live.
        SELECT code, SUM(qty) AS qty FROM sales
        WHERE code = ANY($1::text[]) AND channel = 'EBY' AND solddate >= CURRENT_DATE - 30
        GROUP BY code
      )
      SELECT m.code, m.groupid,
             NULLIF(TRIM(ss.brand), '') AS brand,
             t.shopifytitle AS shopify_title,
             ${safeNumeric('ss.shopifyprice')} AS shopify_price,
             ${safeNumeric('ss.cost')} AS cost,
             COALESCE(loc.qty, 0) AS local,
             COALESCE(fba.qty, 0) AS fba,
             GREATEST(COALESCE(sold.qty, 0), 0) AS sold_30d
      FROM m
      LEFT JOIN skusummary ss ON ss.groupid = m.groupid
      LEFT JOIN title t       ON t.groupid  = m.groupid
      LEFT JOIN loc           ON loc.code   = m.code
      LEFT JOIN fba           ON fba.code   = m.code
      LEFT JOIN sold          ON sold.code  = m.code
    `, [codes]);
    const ours = new Map(result.rows.map((r) => [r.code, r]));

    // BCWEB listings with a size of the style in stock that isn't on them (utils/ebayStockSync.js → unlistedSizes) — normally added at
    // the next Update Orders; one that stays was skipped (no UK size / barcode, or a clashing UK size). Flag 'size_not_listed'.
    const unlisted = new Map((await unlistedSizes(listings.map((l) => l.item_id))).map((u) => [u.item_id, u.codes]));

    const summary = { listings: 0, skipped, problems: 0, checks: 0, watchers: 0 };
    const out = listings.map((l) => {
      const lines = l.lines.map((x) => {
        const o = x.sku ? ours.get(x.sku) : null;
        const cost = o ? num(o.cost) : null;
        // Profit of ONE sale at eBay's price, plus any postage the buyer pays (0 under the free-postage rule).
        const postage = l.postage.cost || 0;
        const profit = x.ebay_price === null || cost === null ? null
          : ebayProfit({ price: x.ebay_price, postage, cost, orderTotal: x.ebay_price + postage, orderUnits: 1 });
        const line = {
          ...x,
          // A variation's size is eBay's own; a single-size listing comes back from GetSellerList without its item specifics, so
          // its size is our code's suffix after the last '-' (CLAUDE.md: never RIGHT(code, 2)).
          size: x.ebay_size || (x.sku && x.sku.includes('-') ? x.sku.slice(x.sku.lastIndexOf('-') + 1) : null),
          known: Boolean(o),
          groupid: o ? o.groupid : null,
          brand: o ? o.brand : null,
          shopify_title: o ? o.shopify_title : null,
          shopify_price: o ? num(o.shopify_price) : null,
          local: o ? Number(o.local) : 0,
          fba: o ? Number(o.fba) : 0,
          sold_30d: o ? Number(o.sold_30d) : 0,
          profit: round2(profit),
        };
        line.flags = checkLine(line, l.postage, l.title);
        return line;
      });
      // A variation listing's sizes in size order — eBay returns them in its own order. Numeric sizes first, then the rest.
      const sizeKey = (x) => { const n = Number(x.size); return Number.isFinite(n) ? n : Infinity; };
      lines.sort((a, b) => sizeKey(a) - sizeKey(b) || String(a.sku || '').localeCompare(String(b.sku || '')));
      const notListed = unlisted.get(l.item_id) || [];
      const flags = [...new Set([...lines.flatMap((x) => x.flags), ...(notListed.length ? ['size_not_listed'] : [])])];

      summary.listings += 1;
      if (flags.some((f) => PROBLEM_FLAGS.has(f))) summary.problems += 1;
      if (flags.some((f) => CHECK_FLAGS.has(f))) summary.checks += 1;
      summary.watchers += l.watchers || 0;

      const rest = { ...l };
      delete rest.status;   // always 'Active' here
      return { ...rest, flags, not_listed: notListed, lines };
    });

    // Problems first, then by our code (the screen leads with it).
    const rank = (l) => (l.flags.some((f) => PROBLEM_FLAGS.has(f)) ? 0 : 1);
    const codeOf = (l) => (l.lines[0] && (l.lines[0].groupid || l.lines[0].sku)) || '';
    out.sort((a, b) => rank(a) - rank(b) || codeOf(a).localeCompare(codeOf(b)) || a.title.localeCompare(b.title));

    return res.json({ return_code: 'SUCCESS', read_at: new Date().toISOString(), truncated, summary, listings: out });
  } catch (err) {
    logger.error('[ebay-listings] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the eBay listings' });
  }
});

module.exports = router;
