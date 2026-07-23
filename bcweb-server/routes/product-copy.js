/*
=======================================================================================================================================
API Route: product_copy
=======================================================================================================================================
Method: POST
Purpose: CLONE an existing product to a brand-new groupid — the legacy "Copy" button. Not used often, but it saves re-typing a whole
         style when a new one is nearly identical to an old one. THE headline use case: copying a Birkenstock to make its opposite-width
         twin (e.g. the Narrow Arizona -> the Regular one), where everything but the barcodes and the width is the same.

         What we deliberately copy vs reset (owner-confirmed — "be careful with what we copy, ensure the user enters the right info"):
           COPIED  — skusummary header incl. ALL pricing (cost/rrp/shopifyprice/min/max/tax), brand/colour/segment/season/width/material,
                     supplier; attributes (gender/producttype); the size list (skumap: optionsize/display, uksize, cost & amazon seed
                     values). The title is copied too (see the Birkenstock width rule below).
           RESET   — `shopify = 0` (the copy is NOT live; pushing to Shopify/Amazon stays a deliberate later user action). Review dates
                     (`next_shopify_price_review`, skumap.`next_amz_price_review`) cleared. A fresh unique `handle`. A fresh sku (blanked;
                     the Amazon export re-mints it) and a per-size googleid = the new code.
           BLANKED — the per-size BARCODE (`ean`). Each physical variant has its own unique EAN; the Regular twin's barcodes are NOT the
                     Narrow's, and copying them across would create duplicate barcodes. The operator adds the real ones afterwards.

         BIRKENSTOCK TITLE (owner decision): the width word in the title ("… Narrow Fit" / "… Regular Fit") is replaced with the
         `<Narrow/Regular>` PLACEHOLDER — the same token the Generate button emits. This is the safety mechanism: a title containing
         `<…>` is rejected by product-update and can't be pushed to Shopify, so the copy physically cannot go live until the operator
         consciously sets the correct width. Non-Birkenstock titles are copied verbatim (there's no width to disambiguate).

         The IMAGE is cloned too, but OUT OF BAND (after the DB transaction commits) and BEST-EFFORT: we download the source JPEG from
         one.com and re-upload it under a NEW filename derived from the new product, then point `imagename` at it. This gives the copy
         its OWN image file so it's immune to the original later being re-imaged (the "safest option" the owner asked for). If the
         download/upload fails the product still lands with no image and the operator uploads one — the clone is never rolled back for it.

         All the destructive/creative work (four INSERTs) runs inside withTransaction so a partial clone can never land. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "sourceGroupid": "1031465-ARIZONA",   // string, required — the product to clone (must exist)
  "newGroupid":    "1031466-ARIZONA"    // string, required — the new product key (upper-cased; must NOT already exist)
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "1031466-ARIZONA",
  "handle":  "birkenstock-arizona-...-1031466-arizona",
  "image":   { "copied": true, "imagename": "birkenstock-...-1031466-arizona-brookfield-comfort-lm3k9x.jpg" }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    // sourceGroupid or newGroupid missing
"SAME_GROUPID"      // source and target are the same key
"NOT_FOUND"         // the source product doesn't exist
"ALREADY_EXISTS"    // the target groupid already exists (pick another)
"HANDLE_TAKEN"      // the copied title + new groupid slugify to a handle already in use (tweak the title after copying)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { imageFilename } = require('../utils/imageName');
const { getImage, putImage } = require('../utils/sftp');
const logger = require('../utils/logger');

router.use(verifyToken);

// Legacy `updated`/`created` stamp: 'YYYYMMDD HH24:MI:SS' in UK wall-clock (matches existing rows regardless of server tz).
const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

// Slugify "<title>-<groupid>" into a Shopify handle — identical to product-create's routine (keep them in step): lower-case, keep only
// [0-9a-z-], collapse runs of '-', trim, cap length. A copied title may still hold '<…>' placeholders — they slugify to '-' harmlessly.
function makeHandle(title, groupid) {
  const base = `${(title || '').trim()}-${groupid}`.toLowerCase();
  return base
    .replace(/[^0-9a-z-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 300);
}

// Birkenstock title width -> placeholder. Replace the standalone word Narrow/Regular with the '<Narrow/Regular>' token the Generate
// button uses, so the copied title can't go live until the operator sets the real width. Case-insensitive, whole word only. If the
// title carries no width word (unusual for Birkenstock) it's returned unchanged.
function placeholderWidth(title) {
  return String(title || '').replace(/\b(?:Narrow|Regular)\b/gi, '<Narrow/Regular>');
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const sourceGroupid = (body.sourceGroupid || '').trim();
    // Legacy upper-cases the groupid; keep keys consistent with the rest of the catalogue.
    const newGroupid = (body.newGroupid || '').trim().toUpperCase();

    if (!sourceGroupid || !newGroupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'sourceGroupid and newGroupid are required' });
    }
    if (sourceGroupid.toUpperCase() === newGroupid) {
      return res.json({ return_code: 'SAME_GROUPID', message: 'The new Group ID must differ from the source' });
    }

    // Values captured from within the transaction for the out-of-band image copy below.
    let handle = '';
    let newTitle = '';
    let sourceImageName = '';

    await withTransaction(async (client) => {
      // 1) Load the source header (skusummary + title). We SELECT explicit columns (never * on the polluted attributes table; skusummary
      //    is clean but we still list what we copy for clarity). brand drives the Birkenstock width rule.
      const src = await client.query(`
        SELECT ss.brand, ss.imagename, t.shopifytitle, t.googletitleb
        FROM skusummary ss LEFT JOIN title t ON t.groupid = ss.groupid
        WHERE ss.groupid = $1
      `, [sourceGroupid]);
      if (src.rows.length === 0) {
        const e = new Error('NOT_FOUND'); e.code = 'NOT_FOUND'; throw e;
      }
      const brand = src.rows[0].brand || '';
      sourceImageName = src.rows[0].imagename || '';
      const srcTitle = src.rows[0].shopifytitle || '';
      const googletitleb = src.rows[0].googletitleb || '-';

      // Birkenstock -> swap the width word for the '<Narrow/Regular>' placeholder; other brands copy the title verbatim.
      newTitle = brand.toUpperCase() === 'BIRKENSTOCK' ? placeholderWidth(srcTitle) : srcTitle;
      handle = makeHandle(newTitle, newGroupid);

      // 2) Guards (both roll the whole clone back): target must not exist; handle must be unique.
      const dup = await client.query(`SELECT 1 FROM skusummary WHERE UPPER(groupid) = $1 LIMIT 1`, [newGroupid]);
      if (dup.rows.length > 0) {
        const e = new Error('ALREADY_EXISTS'); e.code = 'ALREADY_EXISTS'; throw e;
      }
      const hClash = await client.query(`SELECT 1 FROM skusummary WHERE handle = $1 LIMIT 1`, [handle]);
      if (hClash.rows.length > 0) {
        const e = new Error('HANDLE_TAKEN'); e.code = 'HANDLE_TAKEN'; throw e;
      }

      // 3) skusummary — copy every header/pricing column from the source via INSERT ... SELECT, overriding only what must change:
      //    new groupid + handle, imagename blanked (set by the image copy below), shopify forced OFF, review date cleared, fresh stamps.
      await client.query(`
        INSERT INTO skusummary (
          groupid, brand, colour, colourmap, segment, season, width, material, supplier, imagename, handle,
          rrp, shopifyprice, minshopifyprice, maxshopifyprice, cost, tax, shopify, googlestatus, googlecampaign,
          created, updated, created_at, updated_date, next_shopify_price_review, shopifychange
        )
        SELECT
          $2, brand, colour, colourmap, segment, season, width, material, supplier, '', $3,
          rrp, shopifyprice, minshopifyprice, maxshopifyprice, cost, tax, 0, googlestatus, googlecampaign,
          ${UPDATED_EXPR}, ${UPDATED_EXPR}, now(), now(), NULL, 0
        FROM skusummary WHERE groupid = $1
      `, [sourceGroupid, newGroupid, handle]);

      // 4) title — shopifytitle = the (possibly placeholder'd) new title, googletitle mirrors it, googletitleb carried over.
      await client.query(`
        INSERT INTO title (groupid, shopifytitle, googletitle, googletitleb, updated)
        VALUES ($1, $2, $2, $3, ${UPDATED_EXPR})
      `, [newGroupid, newTitle, googletitleb]);

      // 5) attributes — only the two real columns (schema is polluted).
      await client.query(`
        INSERT INTO attributes (groupid, gender, producttype, updated)
        SELECT $2, gender, producttype, ${UPDATED_EXPR}
        FROM attributes WHERE groupid = $1
      `, [sourceGroupid, newGroupid]);

      // 6) skumap — clone every non-deleted size. New code/googleid = newGroupid + the size suffix; ean BLANKED (unique per variant);
      //    sku blanked (Amazon export re-mints it); next_amz_price_review cleared; sizes keep their optionsize order, uksize, cost and
      //    amazon seed values. We build each row in SQL from the source row so we never re-derive scaffold defaults.
      //    The size suffix is everything after the source groupid in `code` (code = '<groupid>-<size>'); prepend the new groupid.
      await client.query(`
        INSERT INTO skumap (
          updated, sku, groupid, optionsize, ean, search2, uksize, supplier, code, googleid,
          cost, amzprice, amzminprice, amzmaxprice, fba, deleted, googlestatus, googlecampaign,
          status, pricestatus, amzperformance, amz365, shp365, next_amz_price_review
        )
        SELECT
          ${UPDATED_EXPR}, '', $2::text, optionsize, '', '', uksize, supplier,
          $2::text || substring(code from char_length($1::text) + 1), $2::text || substring(code from char_length($1::text) + 1),
          cost, amzprice, amzminprice, amzmaxprice, fba, 0, googlestatus, googlecampaign,
          status, pricestatus, amzperformance, amz365, shp365, NULL
        FROM skumap WHERE groupid = $1 AND COALESCE(deleted, 0) = 0
      `, [sourceGroupid, newGroupid]);
    });

    // 7) Clone the image OUT OF BAND (post-commit) and BEST-EFFORT. Download the source file, re-upload under a fresh name derived from
    //    the new product, point imagename at it. Any failure here leaves the clone intact but image-less (operator uploads one).
    let image = { copied: false, imagename: null };
    if (sourceImageName) {
      try {
        const buf = await getImage(sourceImageName);
        // Strip any '<…>' placeholder from the title before it feeds the SEO filename (so we don't bake 'narrow-regular' into the URL).
        const cleanTitle = newTitle.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const version = Date.now().toString(36);
        const newName = imageFilename(cleanTitle, newGroupid, version);
        await putImage(newName, buf);
        await query(`UPDATE skusummary SET imagename = $2, updated = ${UPDATED_EXPR}, updated_date = now() WHERE groupid = $1`, [newGroupid, newName]);
        image = { copied: true, imagename: newName };
      } catch (imgErr) {
        // Non-fatal: the clone is already committed. Log and report copied:false so the UI can hint "add an image".
        logger.error(`[product-copy] image clone failed for ${newGroupid} (from ${sourceImageName}):`, imgErr.message);
      }
    }

    return res.json({ return_code: 'SUCCESS', groupid: newGroupid, handle, image });
  } catch (err) {
    if (err && err.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'The source product no longer exists' });
    }
    if (err && err.code === 'ALREADY_EXISTS') {
      return res.json({ return_code: 'ALREADY_EXISTS', message: 'A product with the new Group ID already exists — pick another' });
    }
    if (err && err.code === 'HANDLE_TAKEN') {
      return res.json({ return_code: 'HANDLE_TAKEN', message: 'That title + Group ID clash with an existing handle — tweak the title after copying' });
    }
    logger.error('[product-copy] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to copy product' });
  }
});

module.exports = router;
