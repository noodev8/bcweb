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

         DUD SIZES (owner, 2026-11-01 — a lower price for that size, set by hand): every line also carries its last NET sale and its
         IDLE DAYS — the Slow movers measure (utils/onShelf.js: since the later of the last net sale and the oldest held pair's
         arrival; null when nothing is held) — and, on a BCWEB listing (bcweb: true — made by the List button), the size's own price
         if one was set (own_price, ebay_listing_size.price). The screen highlights 90+ idle days and prices a size through
         POST /ebay-size-price.

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
                   "local": 1, "fba": 0, "sold_30d": 0, "last_sale": "2025-08-02" | null, "idle_days": 214 | null,
                   "own_price": 29.99 | null, "profit": -1.23, "flags": [] } ],
      "not_listed": [],                                  // in-stock codes not on this BCWEB listing (flag size_not_listed)
      "bcweb": true,                                     // made by BCWEB's List button — per-size prices allowed
      "traffic": { "views": 41, "impressions": 2210, "ctr": 1.4, "sold": 0 } | null   // last 30 days, per LISTING (utils/ebayTraffic.js)
  } ],
  "traffic": { "days": 30, "from": "20261006", "to": "20261104", "updated": "…", "error": null | "why views couldn't be read" }
}
summary also carries views / impressions (totals, null when traffic couldn't be read). Views FAIL SOFT — the listings load without them.
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
const { oldestHeldArrival, lastNetSales, idleSince } = require('../utils/onShelf');

// Whole days between two 'YYYY-MM-DD' strings, in UTC so BST never shifts a day (as utils/slowSizes.js).
const dayNo = (x) => { const [y, m, d] = x.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000; };
const { ebayProfit } = require('../utils/ebayProfit');
const { localStockWhere } = require('../utils/ebayListingRules');
const { fetchTraffic } = require('../utils/ebayTraffic');
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

    // VIEWS (owner, 2026-11-04) — eBay's traffic report for these listings, read alongside. FAILS SOFT: if it can't be read (most
    // likely a token minted before the analytics scope), the listings still load and traffic.error says why.
    let traffic = null;
    let trafficError = null;
    try {
      traffic = await fetchTraffic(listings.map((l) => l.item_id));
    } catch (err) {
      trafficError = err.message;
      logger.error('[ebay-listings] eBay traffic read failed:', err.message);
    }
    const codes = [...new Set(listings.flatMap((l) => l.lines.map((x) => x.sku)).filter(Boolean))];

    // One query for every code on eBay: is it ours, which style, and what we hold.
    const result = codes.length === 0 ? { rows: [] } : await query(`
      WITH m AS (
        SELECT DISTINCT ON (code) code, groupid FROM skumap
        WHERE code = ANY($1::text[]) AND COALESCE(deleted, 0) = 0
        ORDER BY code, groupid
      ),
      loc AS (
        SELECT code, SUM(qty) AS qty FROM localstock l
        WHERE code = ANY($1::text[]) AND ${localStockWhere('l')}
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

    // Which listings are BCWEB's own (made by the List button) — only those get the per-size price control on the screen, and their
    // sizes' own prices: ebay_listing_size.price SET BY HAND (price_set_at stamped by routes/ebay-size-price.js). Since 2026-11-02 every
    // size also records the price it was LISTED at (price_set_at NULL) — that's the normal per-size price, not an "own" one.
    const own = await query(`
      SELECT e.item_id, s.code, CASE WHEN s.price_set_at IS NOT NULL THEN s.price END AS price FROM ebay_listing e
      JOIN ebay_listing_size s ON s.ebay_listing_id = e.id
      WHERE e.ended_at IS NULL AND e.item_id = ANY($1::text[])
    `, [listings.map((l) => l.item_id)]);
    const bcwebItems = new Set(own.rows.map((r) => r.item_id));
    const ownPrice = new Map(own.rows.map((r) => [r.code, r.price === null ? null : Number(r.price)]));

    // IDLE DAYS per size — THE Slow movers measure (utils/onShelf.js): days since the LATER of the last NET sale (any channel) and
    // the oldest held pair's arrival, so a size restocked last week isn't a dud. Held = our Stock (local + FBA live). The screen
    // highlights 90 days or more (owner, 2026-11-01). A size with no stock has no idle days (nothing to clear).
    const held = new Map(result.rows.map((r) => [r.code, Number(r.local) + Number(r.fba)]));
    const [shelf, lastSale, todayQ] = await Promise.all([
      oldestHeldArrival(held),
      lastNetSales([...held.keys()]),
      query(`SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS today`),
    ]);
    const today = todayQ.rows[0].today;

    const summary = { listings: 0, skipped, problems: 0, checks: 0, watchers: 0, views: traffic ? 0 : null, impressions: traffic ? 0 : null };
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
          last_sale: (x.sku && lastSale.get(x.sku)) || null,
          idle_days: (() => {
            const idle = x.sku ? idleSince(lastSale.get(x.sku) || null, shelf.get(x.sku)) : null;
            return idle ? dayNo(today) - dayNo(idle.since) : null;
          })(),
          own_price: x.sku && ownPrice.has(x.sku) ? ownPrice.get(x.sku) : null,
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
      const t = traffic ? (traffic.byItem.get(String(l.item_id)) || { views: 0, impressions: 0, ctr: null, sold: 0 }) : null;
      if (t) { summary.views += t.views || 0; summary.impressions += t.impressions || 0; }
      return { ...rest, flags, not_listed: notListed, bcweb: bcwebItems.has(l.item_id), traffic: t, lines };
    });

    // Problems first, then by our code (the screen leads with it).
    const rank = (l) => (l.flags.some((f) => PROBLEM_FLAGS.has(f)) ? 0 : 1);
    const codeOf = (l) => (l.lines[0] && (l.lines[0].groupid || l.lines[0].sku)) || '';
    out.sort((a, b) => rank(a) - rank(b) || codeOf(a).localeCompare(codeOf(b)) || a.title.localeCompare(b.title));

    const trafficInfo = traffic
      ? { days: traffic.days, from: traffic.from, to: traffic.to, updated: traffic.updated, error: null }
      : { days: null, from: null, to: null, updated: null, error: trafficError };
    return res.json({ return_code: 'SUCCESS', read_at: new Date().toISOString(), truncated, summary, traffic: trafficInfo, listings: out });
  } catch (err) {
    logger.error('[ebay-listings] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the eBay listings' });
  }
});

module.exports = router;
