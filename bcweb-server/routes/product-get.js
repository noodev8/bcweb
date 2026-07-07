/*
=======================================================================================================================================
API Route: product_get
=======================================================================================================================================
Method: GET
Purpose: Stage 2a of the Add / Modify Product module. Given a groupid (chosen from the search list), return the full product HEADER so
         the front end can display the legacy "Add / Modify" fields. Read-only — editing/saving is a later increment.

         The header is spread across three tables, all 1:1 on groupid (verified): skusummary (the row), title (the shopify title) and
         attributes (gender/producttype — note: `attributes` has a polluted schema, so we SELECT only its real columns, never *). We
         gather them in ONE query via LEFT JOINs (no N+1). Price columns on skusummary are legacy VARCHAR that can hold junk, so they
         are read through safeNumeric (NULL on non-numeric) rather than a bare ::numeric (which throws). Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required) - the exact product key (from the search results)

Success Response:
{
  "return_code": "SUCCESS",
  "product": {
    "groupid": "0128221-GIZEH",
    "brand": "Birkenstock",
    "colour": "White",
    "segment": "EVA-SEG",
    "season": "Summer",
    "width": "Regular",
    "material": "EVA",
    "imagename": "Birkenstock-...-0128221-GIZEH-brookfield-comfort.jpg",  // bare filename; web builds the image URL. null if none
    "gender": "Unisex",                 // from attributes; null if no attributes row
    "producttype": "Sandals",           // from attributes; null if no attributes row
    "title": "Birkenstock Gizeh EVA Sandals White Regular Fit",   // title.shopifytitle; null if none
    "cost": 18.75,                      // numeric or null (legacy varchar via safeNumeric)
    "rrp": 45.00,                       // numeric or null
    "price": 35.0,                      // shopifyprice, numeric or null
    "tax": true,                        // skusummary.tax 1/0 -> bool
    "shopify": true                     // skusummary.shopify 1/0 -> bool
  },
  "sizes": [                            // from skumap, one per variant, in legacy size order
    { "code": "0128221-GIZEH-35", "barcode": null, "sizeDisplay": "35 EU / 2.5 UK", "uksize": "2.5 UK" },
    { "code": "0128221-GIZEH-36", "barcode": "4052001424459", "sizeDisplay": "36 EU / 3.5 UK", "uksize": "3.5 UK" }
    // ...
  ]
}
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
const logger = require('../utils/logger');

// All Add / Modify routes require a logged-in user.
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // Exact key, chosen from the search list. Trim defensively.
    const groupid = (req.query.groupid || '').trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // One query, three tables. LEFT JOINs so a product with no title/attributes row still returns (those fields come back null).
    // safeNumeric guards the legacy varchar price columns; $1 is bound (injection-safe). safeNumeric args are hard-coded column names.
    const result = await query(`
      SELECT
        ss.groupid,
        ss.brand,
        ss.colour,
        ss.segment,
        ss.season,
        ss.width,
        ss.material,
        ss.imagename,
        a.gender,
        a.producttype,
        t.shopifytitle,
        ${safeNumeric('ss.cost')}          AS cost,
        ${safeNumeric('ss.rrp')}           AS rrp,
        ${safeNumeric('ss.shopifyprice')}  AS price,
        ss.tax,
        ss.shopify
      FROM skusummary ss
      LEFT JOIN title t      ON t.groupid = ss.groupid
      LEFT JOIN attributes a ON a.groupid = ss.groupid
      WHERE ss.groupid = $1
    `, [groupid]);

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `No product with groupid ${groupid}` });
    }

    // Sizes for this product (skumap, one row per variant). Second FIXED query (not per-row, so not an N+1) rather than JOINing —
    // a JOIN would multiply the header row by the number of sizes. Two derived columns, both validated as 100% consistent in the data:
    //   - Barcode:      ean has a trailing 'B' marker in every non-blank row -> strip it; blank ean -> null.
    //   - Size Display: optionsize always starts with an "<seq>--" ordering prefix (e.g. '101--35 EU / 2.5 UK') -> strip the prefix.
    //   - uksize: returned as-is (feeds the Google Merchant feed's size field).
    // Ordered by that numeric sequence prefix = the legacy screen's size order.
    const sizeResult = await query(`
      SELECT
        code,
        NULLIF(regexp_replace(ean, 'B$', ''), '')        AS barcode,
        regexp_replace(optionsize, '^[0-9]+--', '')      AS sizedisplay,
        uksize
      FROM skumap
      WHERE groupid = $1 AND COALESCE(deleted, 0) = 0
      ORDER BY (split_part(optionsize, '--', 1))::int
    `, [groupid]);

    const sizes = sizeResult.rows.map((s) => ({
      code: s.code,
      barcode: s.barcode || null,
      sizeDisplay: s.sizedisplay || null,
      // uksize feeds the Google Merchant feed (size / size_system=UK) — carried through so new sizes can populate it.
      uksize: s.uksize || null
    }));

    const r = result.rows[0];
    const product = {
      groupid: r.groupid,
      brand: r.brand || null,
      colour: r.colour || null,
      segment: r.segment || null,
      season: r.season || null,
      width: r.width || null,
      material: r.material || null,
      // Bare filename; the web app builds the URL (https://images.brookfieldcomfort.com/<imagename>).
      imagename: r.imagename || null,
      gender: r.gender || null,
      producttype: r.producttype || null,
      title: r.shopifytitle || null,
      cost: r.cost === null ? null : Number(r.cost),
      rrp: r.rrp === null ? null : Number(r.rrp),
      price: r.price === null ? null : Number(r.price),
      // Legacy 0/1 integer flags -> booleans for a clean client contract.
      tax: r.tax === 1,
      shopify: r.shopify === 1
    };

    return res.json({ return_code: 'SUCCESS', product, sizes });
  } catch (err) {
    logger.error('[product-get] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load product' });
  }
});

module.exports = router;
