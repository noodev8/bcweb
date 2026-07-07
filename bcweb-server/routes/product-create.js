/*
=======================================================================================================================================
API Route: product_create
=======================================================================================================================================
Method: POST
Purpose: Create a BRAND-NEW product (one groupid) — the "LOAD NEW" half of the legacy PowerBuilder save. This is the deliberately
         SIMPLE first cut: it writes the product HEADER only, so a new style exists in the catalogue and can then be fleshed out with
         the existing editors (sizes) and the price stage. It INSERTs, atomically (withTransaction), across three tables:
           - skusummary: the product row, with the legacy defaults (price columns seeded to a '0.00'/'RRP' placeholder — the real
             numbers come from the later price stage; shopify OFF; supplier resolved from the brand lookup, else the brand itself).
           - title:      shopifytitle (+ googletitle mirror, googletitleb '-'), matching how the legacy save seeds a new title row.
           - attributes: gender + producttype (the two real columns — `attributes` has a polluted schema, so we never SELECT-star or
             insert stray columns).
         NOT written here (later stages): sizes (skumap), and the real price/cost/rrp values.

         Guards (both cause a full rollback so nothing partial lands):
           - The groupid must NOT already exist (this route is create-only; editing an existing product goes through product-update).
           - The generated Shopify `handle` must be unique. The handle is slugified from "<title>-<groupid>" exactly like the legacy
             code (lower-case; keep only [0-9a-z-]; collapse repeated '-'), because the nightly Shopify export keys on it. A collision
             means two products would fight over the same Shopify URL, so we reject and ask the user to tweak the title.

         groupid is upper-cased (legacy convention). Other fields are stored as trimmed strings as-is (free-form legacy data; lookup
         tables can be incomplete, so we don't reject off-list brand/colour/etc). `updated`/`created` use the legacy
         'YYYYMMDD HH24:MI:SS' Europe/London wall-clock format to match existing rows. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid":     "0128999-NEWSTYLE", // string, required — the new product key (upper-cased server-side)
  "brand":       "Birkenstock",      // string, optional
  "colour":      "White",            // string, optional (also seeds colourmap)
  "segment":     "EVA-SEG",          // string, optional
  "season":      "Summer",           // string, optional
  "gender":      "Unisex",           // string, optional -> attributes
  "producttype": "Sandals",          // string, optional -> attributes
  "title":       "Birkenstock ..."   // string, optional -> title.shopifytitle (and drives the handle)
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128999-NEWSTYLE",
  "handle":  "birkenstock-any-detail-sandals-white-0128999-newstyle"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // no groupid
"INVALID_TITLE"     // title still contains <…> placeholders
"ALREADY_EXISTS"    // a product with this groupid already exists (use product-update instead)
"HANDLE_TAKEN"      // the slugified handle is already in use (ask the user to modify the title)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Legacy `updated`/`created` stamp: 'YYYYMMDD HH24:MI:SS' in UK wall-clock (matches existing rows regardless of server tz).
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// Slugify "<title>-<groupid>" into a Shopify handle, faithful to the legacy PowerBuilder routine: lower-case, keep only [0-9a-z-]
// (everything else becomes '-'), then collapse any run of '-' to a single one. We also trim leading/trailing '-' and cap length.
function makeHandle(title, groupid) {
  const base = `${(title || '').trim()}-${groupid}`.toLowerCase();
  return base
    .replace(/[^0-9a-z-]/g, '-') // disallowed char -> '-'
    .replace(/-+/g, '-')         // collapse '--...' -> '-'
    .replace(/^-+|-+$/g, '')     // trim leading/trailing '-'
    .slice(0, 300);
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    // Legacy upper-cases the groupid; keep that so keys stay consistent with the rest of the catalogue.
    const groupid = (body.groupid || '').trim().toUpperCase();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // Header fields — trimmed strings, blank allowed (mirrors the permissive product-update edit).
    const brand = (body.brand || '').trim();
    const colour = (body.colour || '').trim();
    const segment = (body.segment || '').trim();
    const season = (body.season || '').trim();
    const gender = (body.gender || '').trim();
    const producttype = (body.producttype || '').trim();
    const title = (body.title || '').trim();

    // Reject a title that still carries the generated placeholders (e.g. "<Any detail>", "<Narrow/Regular> Fit"). '<' or '>' must
    // never reach the Shopify listing — the user has to fill them in first. (Legacy PB save blocked '<' '>' in the title too.)
    if (/[<>]/.test(title)) {
      return res.json({ return_code: 'INVALID_TITLE', message: 'Title still contains <…> placeholders — fill them in before saving' });
    }

    const handle = makeHandle(title, groupid);

    await withTransaction(async (client) => {
      // 1) Create-only guard: the groupid must not already exist.
      const dup = await client.query(`SELECT 1 FROM skusummary WHERE UPPER(groupid) = $1 LIMIT 1`, [groupid]);
      if (dup.rows.length > 0) {
        const e = new Error('ALREADY_EXISTS'); e.code = 'ALREADY_EXISTS'; throw e;
      }

      // 2) Handle uniqueness — the nightly Shopify export keys on this, so a clash would collide two products' URLs.
      const hClash = await client.query(`SELECT 1 FROM skusummary WHERE handle = $1 LIMIT 1`, [handle]);
      if (hClash.rows.length > 0) {
        const e = new Error('HANDLE_TAKEN'); e.code = 'HANDLE_TAKEN'; throw e;
      }

      // 3) Resolve supplier from the brand lookup; fall back to the brand string itself (legacy behaviour).
      let supplier = brand;
      if (brand) {
        const b = await client.query(`SELECT supplier FROM brand WHERE brand = $1 LIMIT 1`, [brand]);
        if (b.rows[0] && b.rows[0].supplier) supplier = b.rows[0].supplier;
      }

      // 4) skusummary — the product row, with legacy defaults. Price columns are placeholder strings ('0.00' / 'RRP') filled in later
      //    by the price stage; shopify OFF; colourmap mirrors colour; google fields match the legacy new-row seed.
      // `created`/`updated` are the legacy TEXT stamps. `created_at` is our proper timestamptz (added going forward) — set explicitly
      // here (it also has a column DEFAULT now(), but we set it so intent is clear and it survives if the default is ever dropped).
      await client.query(`
        INSERT INTO skusummary (
          groupid, brand, colour, colourmap, segment, season, supplier, imagename, handle,
          rrp, shopifyprice, minshopifyprice, maxshopifyprice, cost,
          tax, shopify, googlestatus, googlecampaign, created, updated, created_at
        ) VALUES (
          $1, $2, $3, $3, $4, $5, $6, '', $7,
          '0.00', '0.00', '0.00', 'RRP', '0.00',
          1, 0, 1, 'standard', ${UPDATED_EXPR}, ${UPDATED_EXPR}, now()
        )
      `, [groupid, brand, colour, segment, season, supplier, handle]);

      // 5) title — shopifytitle (+ googletitle mirror, googletitleb '-'), matching the legacy new-title seed.
      await client.query(`
        INSERT INTO title (groupid, shopifytitle, googletitle, googletitleb, updated)
        VALUES ($1, $2, $2, '-', ${UPDATED_EXPR})
      `, [groupid, title]);

      // 6) attributes — only the two real columns.
      await client.query(`
        INSERT INTO attributes (groupid, gender, producttype, updated)
        VALUES ($1, $2, $3, ${UPDATED_EXPR})
      `, [groupid, gender, producttype]);
    });

    return res.json({ return_code: 'SUCCESS', groupid, handle });
  } catch (err) {
    if (err && err.code === 'ALREADY_EXISTS') {
      return res.json({ return_code: 'ALREADY_EXISTS', message: 'A product with this Group ID already exists' });
    }
    if (err && err.code === 'HANDLE_TAKEN') {
      return res.json({ return_code: 'HANDLE_TAKEN', message: 'That title produces a handle already in use — tweak the title slightly' });
    }
    logger.error('[product-create] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to create product' });
  }
});

module.exports = router;
