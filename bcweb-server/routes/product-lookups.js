/*
=======================================================================================================================================
API Route: product_lookups
=======================================================================================================================================
Method: GET
Purpose: Supply the option lists for the Add / Modify edit dropdowns (edit Stage 1). One call returns every list the screen needs:
           - brands       : from the `brand` lookup table (brand.brand), alphabetical
           - colours      : from the `colour` lookup table (colour.colour), alphabetical
           - productTypes : from the `producttype` lookup table (producttype.producttype), alphabetical
           - segments     : DISTINCT skusummary.segment (non-blank), alphabetical  [owner: "the DISTINCT list of segments ... sorted"]
           - genders      : fixed list Womens / Mens / Unisex          [owner-specified, not a table]
           - seasons      : fixed list Summer / Winter / Any            [owner-specified, not a table]

         NOTE: the lookup tables can be INCOMPLETE relative to live data — e.g. some products carry brand 'Lazy Dogz' which is not in
         the brand table. The front end therefore merges a product's CURRENT value into its dropdown so an edit never silently drops an
         off-list value. Requires auth.
=======================================================================================================================================
Request Query Params: (none)

Success Response:
{
  "return_code": "SUCCESS",
  "lookups": {
    "brands": ["Birkenstock", ...],
    "colours": ["Beige", ...],
    "productTypes": ["<Other>", "Boots", ...],
    "segments": ["ACCESSORY", ...],
    "genders": ["Womens", "Mens", "Unisex"],
    "seasons": ["Summer", "Winter", "Any"]
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Fixed lists the owner specified directly (no table). Order is intentional (not alphabetical).
const GENDERS = ['Womens', 'Mens', 'Unisex'];
const SEASONS = ['Summer', 'Winter', 'Any'];

router.get('/', async (req, res) => {
  try {
    // Three tiny lookup tables + the distinct-segments query. Independent, so run them in parallel.
    const [brands, colours, productTypes, segments] = await Promise.all([
      query(`SELECT brand       AS v FROM brand       WHERE brand       IS NOT NULL AND brand       <> '' ORDER BY brand`),
      query(`SELECT colour      AS v FROM colour      WHERE colour      IS NOT NULL AND colour      <> '' ORDER BY colour`),
      query(`SELECT producttype AS v FROM producttype WHERE producttype IS NOT NULL AND producttype <> '' ORDER BY producttype`),
      // Segments come from the products themselves (no dedicated table): DISTINCT, non-blank, alphabetical.
      query(`SELECT DISTINCT segment AS v FROM skusummary WHERE segment IS NOT NULL AND segment <> '' ORDER BY segment`),
    ]);

    const lookups = {
      brands: brands.rows.map((r) => r.v),
      colours: colours.rows.map((r) => r.v),
      productTypes: productTypes.rows.map((r) => r.v),
      segments: segments.rows.map((r) => r.v),
      genders: GENDERS,
      seasons: SEASONS,
    };

    return res.json({ return_code: 'SUCCESS', lookups });
  } catch (err) {
    logger.error('[product-lookups] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load lookups' });
  }
});

module.exports = router;
