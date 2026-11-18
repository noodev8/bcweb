/*
=======================================================================================================================================
API Route: style_price
=======================================================================================================================================
Method: GET
Purpose: The read behind the Style price screen (/pricing/style-price, owner 2026-11-18): ONE style, every size, every channel's price
         side by side — "one place to see the stock and prices and one place to set a single price, then adjust any size/channel".
         READ ONLY. The screen stages prices on screen and commits them through the channels' OWN writes (W1 /pricing-apply, W-S1
         /pricing-size-price-set|-clear, W-A1 /amz-apply, /amz-review, /pricing-park, /ebay-size-price, /ebay-list) — no pricing rule
         lives here; this route only says, per size and channel, whether a price can be set there and what it is now.

PER CHANNEL, PER SIZE — `open` = the screen may set a price there (else the cell is grey):
  shopify  the style price (style grain), plus the size's own size price when one is in force (utils/sizePrice.js ACTIVE_SQL — THE copy).
           open = the size has stock (utils/sizePrice.js stockSql: local #FREE + FBA live) — a size price needs stock; a sold-out size
           just follows the style price.
  amazon   open = the size has an amzfeed row (listed by us; FBA-only). Price = amzfeed.amzprice as live on Amazon. fbafee = skumap.fba
           (the FBA FEE — CLAUDE.md), for the below-cost flag (cost + FBA fee).
  ebay     state as utils/clearanceList.js: 'never' Birkenstock (brand ILIKE 'birk%'); 'on' the size is on the style's LIVE BCWEB
           listing (its own price, else the listing's); 'style' the style is listed but this size isn't on it (Update Orders adds
           in-stock sizes by itself); 'could' the style isn't on eBay. open = 'on', or 'could' AND the size is one the List would send.
  The header's `ebay_list` (only when the style isn't on eBay and isn't Birkenstock) is utils/ebayCandidates.js's own read of the style
  — the Style / material defaults for the List form, its readiness (`missing`) and the sizes it would list. Read WITHOUT a live eBay
  read (fast); /ebay-list re-checks eBay live at the moment of listing, so a listing made outside BCWEB is still caught there.

Sizes come from skumap (full range, sold-out sizes read 0 — CLAUDE.md), one row per code (DISTINCT ON — skumap can hold 2+ per code).
Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required)

Success Response:
{ "return_code": "SUCCESS",
  "header": { "groupid", "title", "imagename", "brand", "birk": false, "cost": 21.4, "rrp": 55,
              "shopify": { "live": true, "price": 46.95, "review": "2026-12-01" },
              "ebay": { "item_id": "2876…" | null, "uplift": 4.5 },
              "ebay_list": null | { "status": "ready"|"todo"|"missing", "missing": [...], "style": "Trainer", "material": "Leather"|null,
                                    "sizes": { "<code>": 40.79 } } },     // code -> the List's default price (utils/ebayListingRules.js)
  "rows": [ { "code", "size", "local": 3, "fba": 2,
              "shopify": { "open": true, "size_price": null, "kind": null },
              "amazon":  { "open": true, "price": 41.99, "fbafee": 3.06, "review": null },
              "ebay":    { "state": "on", "open": true, "price": 44.49 } } ] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { ACTIVE_SQL, stockSql } = require('../utils/sizePrice');
const { loadCandidates } = require('../utils/ebayCandidates');
const { SHOPIFY_UPLIFT } = require('../utils/ebayListingRules');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').trim();
    if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });

    // NB: no backticks inside these SQL template literals (CLAUDE.md).
    const head = await query(`
      SELECT s.groupid, t.shopifytitle AS title, s.imagename, NULLIF(TRIM(s.brand), '') AS brand,
             COALESCE(s.brand, '') ILIKE 'birk%'    AS birk,
             ${safeNumeric('s.cost')}               AS cost,
             ${safeNumeric('s.rrp')}                AS rrp,
             ${safeNumeric('s.shopifyprice')}       AS price,
             COALESCE(s.shopify, 0) = 1             AS shopify_live,
             s.next_shopify_price_review::text      AS shopify_review,
             (SELECT e.item_id FROM ebay_listing e WHERE e.groupid = s.groupid AND e.ended_at IS NULL
               ORDER BY e.listed_at DESC LIMIT 1)   AS ebay_item
      FROM skusummary s
      LEFT JOIN title t ON t.groupid = s.groupid
      WHERE s.groupid = $1
    `, [groupid]);
    if (!head.rows.length) return res.json({ return_code: 'NOT_FOUND', message: `No style ${groupid}` });
    const h = head.rows[0];

    const r = await query(`
      WITH c AS (SELECT DISTINCT ON (m.code) m.code, m.optionsize, m.fba, m.next_amz_price_review
                   FROM skumap m WHERE m.groupid = $1 AND COALESCE(m.deleted, 0) = 0
                  ORDER BY m.code, m.next_amz_price_review DESC NULLS LAST),
      loc AS (SELECT code, SUM(qty) AS qty FROM localstock
               WHERE groupid = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0 GROUP BY code)
      SELECT c.code,
             SUBSTRING(c.code FROM '[^-]*$') AS eu,
             NULLIF(btrim(regexp_replace(COALESCE(c.optionsize, ''), '^[0-9]+--', '')), '') AS sizedisplay,
             COALESCE(loc.qty, 0)::int        AS local,
             COALESCE(af.fba, 0)::int         AS fba,
             ${stockSql('c.code')}            AS stock,
             sp.price                         AS size_price,
             sp.kind                          AS size_kind,
             af.listed                        AS amz_listed,
             af.amzprice                      AS amz_price,
             ${safeNumeric('c.fba')}          AS fbafee,
             c.next_amz_price_review::text    AS amz_review,
             els.code IS NOT NULL             AS on_ebay,
             COALESCE(els.price, el.price)    AS ebay_price
        FROM c
        LEFT JOIN loc ON loc.code = c.code
        LEFT JOIN (${ACTIVE_SQL}) sp ON sp.code = c.code
        LEFT JOIN LATERAL (SELECT MAX(a.amzlive) FILTER (WHERE a.amzlive > 0) AS fba, MAX(${safeNumeric('a.amzprice')}) AS amzprice,
                                  COUNT(*) > 0 AS listed
                             FROM amzfeed a WHERE a.code = c.code) af ON true
        LEFT JOIN LATERAL (SELECT e.id, e.price FROM ebay_listing e
                            WHERE e.groupid = $1 AND e.ended_at IS NULL ORDER BY e.listed_at DESC LIMIT 1) el ON true
        LEFT JOIN ebay_listing_size els ON els.ebay_listing_id = el.id AND els.code = c.code
       ORDER BY CASE WHEN SUBSTRING(c.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN 0 ELSE 1 END,
                CASE WHEN SUBSTRING(c.code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN SUBSTRING(c.code FROM '[^-]*$')::numeric END,
                c.code
    `, [groupid]);

    // eBay List readiness — only when the style could be listed (not Birkenstock, not already live on eBay).
    let ebayList = null;
    if (!h.birk && !h.ebay_item) {
      const { rows } = await loadCandidates({ onEbayCodes: [], groupid, full: false });
      const cand = rows[0];
      if (cand) {
        ebayList = {
          status: cand.status,
          missing: cand.missing,
          style: cand.style?.value || '',
          material: cand.material?.value || null,
          sizes: Object.fromEntries(cand.sizes.map((z) => [z.code, z.price])),
        };
      }
    }

    const rows = r.rows.map((x) => {
      const ebayState = h.birk ? 'never' : x.on_ebay ? 'on' : h.ebay_item ? 'style' : 'could';
      return {
        code: x.code,
        size: x.sizedisplay || x.eu || x.code,
        local: Number(x.local) || 0,
        fba: Number(x.fba) || 0,
        shopify: { open: Number(x.stock) > 0, size_price: num(x.size_price), kind: x.size_kind || null },
        amazon: { open: !!x.amz_listed, price: num(x.amz_price), fbafee: num(x.fbafee), review: x.amz_review || null },
        ebay: {
          state: ebayState,
          open: ebayState === 'on' || (ebayState === 'could' && !!ebayList && ebayList.sizes[x.code] !== undefined),
          price: ebayState === 'on' ? num(x.ebay_price) : null,
        },
      };
    });

    return res.json({
      return_code: 'SUCCESS',
      header: {
        groupid: h.groupid,
        title: h.title || null,
        imagename: h.imagename || null,
        brand: h.brand,
        birk: h.birk,
        cost: num(h.cost),
        rrp: num(h.rrp),
        shopify: { live: h.shopify_live, price: num(h.price), review: h.shopify_review || null },
        // uplift: a size with no Amazon price goes on eBay at the Shopify price + this (THE rule, ebayListingRules → sizePriceFor) —
        // the screen shows a not-yet-listed size's price from it.
        ebay: { item_id: h.ebay_item || null, uplift: SHOPIFY_UPLIFT },
        ebay_list: ebayList,
      },
      rows,
    });
  } catch (err) {
    logger.error('[style-price] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the style' });
  }
});

module.exports = router;
