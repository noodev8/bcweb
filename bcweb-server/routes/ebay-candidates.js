/*
=======================================================================================================================================
API Route: ebay_candidates
=======================================================================================================================================
Method: GET
Purpose: The "Not on eBay" view of the eBay listings screen (/ebay?view=not) — step 1 of the Add build (owner, 2026-11-01). Every style
         that could go on eBay and isn't there yet, each with a READINESS check against the listing rules (utils/ebayListingRules.js —
         the same rules the List button will use in step 2). READ ONLY: nothing is written to eBay or to the DB.

MEMBERSHIP: a style (skusummary groupid) that
  - has STOCK: at least one size with sellable local stock (localstock #FREE — CLAUDE.md, never stockvariants) or FBA live
    (amzfeed.amzlive) — the same Stock figure as the On eBay view and the planned stock sync
  - is not Birkenstock (brand ILIKE 'birk%') — never on eBay
  - has NO size on eBay now — fixed price or auction (utils/ebayListings.js → fetchActiveListings, read live; skippedSkus covers the
    auctions). Styles with a trial listing are left out and counted (on_ebay_styles); they are re-listed through Add in step 4.

PER STYLE: title (Shopify), brand, the eBay category / department / Style / material the rules give, Shopify price and the eBay profit
at it (utils/ebayProfit.js, THE EBY formula, with the £4.50 postage the buyer pays), stock (local + FBA), photos (product_images),
whether a Shopify description exists, and its IN-STOCK sizes — code, UK size (skumap.uksize, never the code suffix), barcode
(skumap.ean, trailing B stripped), local, FBA. skumap can hold two rows for one code: the one with a UK size (then a barcode) wins.

READINESS:
  missing (blocks listing)  category · photos · description · price · uk_size (an in-stock size has none) · barcode (an in-stock size
                            has none) · title_long (over eBay's 80)
  todo (the form asks)      material — the listing form will take it and save it back to skusummary.material (owner, option A)
  ready                     neither

Order: most stock first, then groupid (as AMZ loaded).

Requires auth.
=======================================================================================================================================
Request: GET /ebay-candidates

Success Response:
{
  "return_code": "SUCCESS",
  "read_at": "…Z",
  "on_ebay_styles": 4,
  "summary": { "styles": 106, "ready": 80, "todo": 20, "missing": 6 },
  "rows": [ {
      "groupid": "40535-FRISCO-BLACK", "title": "…", "brand": "Free Spirit", "gender": "Womens", "producttype": "Sandals",
      "category": { "id": 62107, "name": "Women's Sandals" } | null, "department": "Women",
      "style": { "value": "Walking", "from": "title" } | null, "material": { "value": "Leather", "from": "stored" } | null,
      "type": null, "colour": "Black",
      "price": 59.95, "rrp": 70, "profit": 12.34, "photos": 4, "has_description": true, "title_length": 52,
      "local": 3, "fba": 1, "stock": 4,
      "sizes": [ { "code": "…-37", "uk_size": "4", "ean": "…", "local": 1, "fba": 0 } ],
      "missing": [], "todo": ["material"], "status": "ready" | "todo" | "missing"
  } ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"EBAY_NOT_CONFIGURED"   the eBay keys / refresh token are missing from .env
"EBAY_ERROR"            eBay couldn't be read (message says why) — without it we can't tell what is already listed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { fetchActiveListings } = require('../utils/ebayListings');
const { ebayProfit } = require('../utils/ebayProfit');
const rules = require('../utils/ebayListingRules');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const round2 = (v) => (v === null ? null : Math.round(v * 100) / 100);

router.get('/', async (req, res) => {
  // What is on eBay now — every SKU, fixed price and auction alike.
  let onEbayCodes;
  try {
    const read = await fetchActiveListings();
    onEbayCodes = [...new Set([...read.listings.flatMap((l) => l.lines.map((x) => x.sku)), ...read.skippedSkus].filter(Boolean))];
  } catch (err) {
    const code = err.code === 'EBAY_NOT_CONFIGURED' ? 'EBAY_NOT_CONFIGURED' : 'EBAY_ERROR';
    logger.error('[ebay-candidates] eBay read failed:', err.message);
    return res.json({ return_code: code, message: err.message });
  }

  try {
    const result = await query(`
      WITH sz AS (
        -- One skumap row per live code: the one with a UK size, then a barcode, wins (a code can have two rows).
        SELECT DISTINCT ON (m.code) m.code, m.groupid, NULLIF(TRIM(m.uksize), '') AS uksize,
               NULLIF(regexp_replace(TRIM(COALESCE(m.ean, '')), 'B$', ''), '') AS ean
        FROM skumap m
        WHERE COALESCE(m.deleted, 0) = 0
        ORDER BY m.code, (NULLIF(TRIM(m.uksize), '') IS NULL), (NULLIF(TRIM(m.ean), '') IS NULL), m.sku
      ),
      loc AS (
        SELECT code, SUM(qty) AS qty FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY code
      ),
      fba AS (
        SELECT code, SUM(amzlive) AS qty FROM amzfeed WHERE COALESCE(amzlive, 0) > 0 GROUP BY code
      ),
      lines AS (
        SELECT sz.groupid, sz.code, sz.uksize, sz.ean, COALESCE(loc.qty, 0) AS local, COALESCE(fba.qty, 0) AS fba
        FROM sz
        LEFT JOIN loc ON loc.code = sz.code
        LEFT JOIN fba ON fba.code = sz.code
        WHERE COALESCE(loc.qty, 0) + COALESCE(fba.qty, 0) > 0
      ),
      per AS (
        SELECT groupid, SUM(local) AS local, SUM(fba) AS fba,
               json_agg(json_build_object('code', code, 'uksize', uksize, 'ean', ean, 'local', local, 'fba', fba)
                 ORDER BY CASE WHEN SUBSTRING(code FROM '[^-]*$') ~ '^[0-9]+([.][0-9]+)?$' THEN SUBSTRING(code FROM '[^-]*$')::numeric END NULLS LAST,
                          code) AS sizes
        FROM lines GROUP BY groupid
      )
      SELECT ss.groupid,
             t.shopifytitle AS title,
             NULLIF(TRIM(ss.brand), '') AS brand,
             a.gender, a.producttype,
             ss.material, NULLIF(TRIM(ss.colourmap), '') AS colour,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,
             ${safeNumeric('ss.cost')} AS cost,
             (SELECT COUNT(*) FROM product_images pi WHERE pi.groupid = ss.groupid) AS photos,
             EXISTS (SELECT 1 FROM shopify_description d WHERE d.handle = ss.handle AND NULLIF(TRIM(d.description), '') IS NOT NULL) AS has_description,
             EXISTS (SELECT 1 FROM skumap x WHERE x.groupid = ss.groupid AND x.code = ANY($1::text[])) AS on_ebay,
             per.local, per.fba, per.sizes
      FROM per
      JOIN skusummary ss ON ss.groupid = per.groupid
      LEFT JOIN title t  ON t.groupid  = ss.groupid
      LEFT JOIN LATERAL (SELECT gender, producttype FROM attributes WHERE groupid = ss.groupid LIMIT 1) a ON true
      WHERE COALESCE(ss.brand, '') NOT ILIKE 'birk%'
      ORDER BY per.local + per.fba DESC, ss.groupid
    `, [onEbayCodes]);

    let onEbayStyles = 0;
    const rows = [];
    for (const r of result.rows) {
      if (r.on_ebay) { onEbayStyles += 1; continue; }
      const title = r.title || '';
      const price = num(r.price);
      const cost = num(r.cost);
      const sizes = (r.sizes || []).map((z) => ({
        code: z.code, uk_size: rules.ukSizeFor(z.uksize), ean: z.ean || null, local: Number(z.local) || 0, fba: Number(z.fba) || 0,
      }));
      const category = rules.categoryFor(r.gender, r.producttype, title);
      const material = rules.materialFor(r.material, title);

      const missing = [];
      if (!category) missing.push('category');
      if (Number(r.photos) === 0) missing.push('photos');
      if (!r.has_description) missing.push('description');
      if (price === null || price <= 0) missing.push('price');
      if (sizes.some((z) => !z.uk_size)) missing.push('uk_size');
      if (sizes.some((z) => !z.ean)) missing.push('barcode');
      if (!title) missing.push('title');
      else if (title.length > rules.TITLE_MAX) missing.push('title_long');
      const todo = material ? [] : ['material'];

      rows.push({
        groupid: r.groupid,
        title: r.title || null,
        brand: r.brand,
        gender: r.gender || null,
        producttype: r.producttype || null,
        category,
        department: rules.departmentFor(r.gender),
        style: rules.styleFor(r.gender, r.producttype, title),
        material,
        type: rules.typeFor(r.gender, r.producttype, title),
        colour: r.colour,
        price,
        rrp: num(r.rrp),
        profit: price === null || cost === null ? null
          : round2(ebayProfit({ price, postage: rules.POSTAGE, cost, orderTotal: price + rules.POSTAGE, orderUnits: 1 })),
        photos: Number(r.photos),
        has_description: r.has_description === true,
        title_length: title.length,
        local: Number(r.local), fba: Number(r.fba), stock: Number(r.local) + Number(r.fba),
        sizes,
        missing,
        todo,
        status: missing.length ? 'missing' : todo.length ? 'todo' : 'ready',
      });
    }

    const summary = {
      styles: rows.length,
      ready: rows.filter((x) => x.status === 'ready').length,
      todo: rows.filter((x) => x.status === 'todo').length,
      missing: rows.filter((x) => x.status === 'missing').length,
    };
    return res.json({ return_code: 'SUCCESS', read_at: new Date().toISOString(), on_ebay_styles: onEbayStyles, summary, rows });
  } catch (err) {
    logger.error('[ebay-candidates] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the styles not on eBay' });
  }
});

module.exports = router;
