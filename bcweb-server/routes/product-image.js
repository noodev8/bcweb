/*
=======================================================================================================================================
API Route: product_image
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Upload / replace a product's MAIN image. The whole pipeline runs server-side (the web app just posts the raw file):
           1. Accept an upload in any common format (jpeg / png / webp / avif) — held in memory, 25MB cap (utils/imageUpload.js).
           2. Convert it with the shared utils/productImage.js processImage: auto-orient (EXIF), square on a WHITE background, longest
              side capped at 2048 and NEVER enlarged (an 800 source stays 800), transparency flattened, JPEG. (800x800 q85 until
              2026-10-13 — see docs/product-images-plan.md.)
           3. Generate the SEO filename from the product title + groupid, with a fresh per-upload version token (utils/imageName.js)
              so every upload has a UNIQUE filename/URL — this sidesteps the one.com CDN cache (a same-name overwrite would be served
              stale) and makes the new image appear immediately.
           4. SFTP the JPEG to the one.com host that backs images.brookfieldcomfort.com (utils/sftp.js).
           5. UPDATE skusummary.imagename AND the product_images position-1 (main) row in one transaction — the two are kept in step
              by their writers, no triggers — then delete the previous file from one.com (best-effort cleanup).
         The site and the Google Merchant feed both read images.brookfieldcomfort.com/<imagename>, so no separate push to Google is
         needed. This route does NOT touch price/shopifychange.

         Order is deliberate: upload the new file FIRST, then update the DB, then delete the old file. If the upload fails we never
         touch the DB; if the old-file delete fails we just log it (an orphan is harmless). `title` may be sent from the client (the
         on-screen, possibly-unsaved title, matching the legacy behaviour); if omitted we fall back to the stored shopifytitle.
         Requires auth.
=======================================================================================================================================
Request (multipart/form-data):
  image    (file, required)   - the source image (jpeg/png/webp/avif)
  groupid  (text, required)   - the product key
  title    (text, optional)   - title to base the filename on; falls back to the stored shopifytitle

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0128221-GIZEH",
  "imagename": "birkenstock-gizeh-eva-sandals-white-0128221-gizeh-brookfield-comfort-lm3k9x.jpg",
  "url": "https://images.brookfieldcomfort.com/birkenstock-...-brookfield-comfort-lm3k9x.jpg"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"     // no groupid or no file
"INVALID_IMAGE"      // unsupported type, or sharp couldn't decode it
"IMAGE_TOO_LARGE"    // exceeds the size cap
"NOT_FOUND"          // no such product
"SFTP_ERROR"         // upload/config failure talking to one.com
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
const { processImage, imageAlt } = require('../utils/productImage');
const { putImage, deleteImage } = require('../utils/sftp');
const logger = require('../utils/logger');
const shopify = require('../utils/shopify');
const { runUpload } = require('../utils/imageUpload');
const { fileInUseElsewhere } = require('../utils/productGallery');

const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;
const PUBLIC_BASE = 'https://images.brookfieldcomfort.com/';

router.post('/', verifyToken, async (req, res) => {
  try {
    const uploadErr = await runUpload(req, res, 'image');
    if (uploadErr) return res.json(uploadErr);

    const groupid = (req.body.groupid || '').trim();
    const bodyTitle = (req.body.title || '').trim();
    if (!groupid || !req.file) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and an image file are required' });
    }

    // Load the product (existence + stored title + current image, for the filename and old-file cleanup) and the old main's Shopify
    // media id — the push must drop it, or it would be kept as "media we don't hold" (utils/shopify.js buildFiles).
    const prod = await query(`
      SELECT ss.groupid, ss.imagename, t.shopifytitle,
             (SELECT pi.shopify_media_id FROM product_images pi WHERE pi.groupid = ss.groupid AND pi.position = 1) AS old_media_id
      FROM skusummary ss LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid = $1
    `, [groupid]);
    if (prod.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    }
    const oldName = prod.rows[0].imagename || '';
    const title = bodyTitle || prod.rows[0].shopifytitle || '';
    // Fresh version token per upload -> a unique filename/URL every time. This dodges the one.com CDN cache (a same-name overwrite
    // would serve stale) and means the old file is always superseded and cleaned up below.
    const version = Date.now().toString(36);
    const newName = imageFilename(title, groupid, version);

    // Convert to our stored form (2048 max, never enlarged). A hard decode failure -> INVALID_IMAGE.
    let jpeg;
    let dims;
    try {
      const processed = await processImage(req.file.buffer);
      jpeg = processed.buffer;
      dims = { width: processed.width, height: processed.height };
    } catch (imgErr) {
      logger.error('[product-image] sharp decode failed:', imgErr.message);
      return res.json({ return_code: 'INVALID_IMAGE', message: 'Could not read that image file' });
    }

    // Push the new file FIRST (so a failure here never leaves the DB pointing at a missing image).
    try {
      await putImage(newName, jpeg);
    } catch (sftpErr) {
      logger.error('[product-image] sftp upload failed:', sftpErr.message);
      return res.json({ return_code: 'SFTP_ERROR', message: 'Could not upload the image to the server' });
    }

    // Point the product at the new file — skusummary.imagename and the main product_images row together. shopify_media_id resets:
    // the push below uploads the new file to Shopify and records the new id.
    await withTransaction(async (client) => {
      await client.query(`UPDATE skusummary SET imagename = $2, updated = ${UPDATED_EXPR}, updated_date = now() WHERE groupid = $1`, [groupid, newName]);
      await client.query(`
        INSERT INTO product_images (groupid, position, filename, view, alt, width, height, shopify_media_id, source_name, created_by)
        VALUES ($1, 1, $2, NULL, $3, $4, $5, NULL, $6, $7)
        ON CONFLICT (groupid, position) DO UPDATE SET
          filename = EXCLUDED.filename, view = NULL, alt = EXCLUDED.alt, width = EXCLUDED.width, height = EXCLUDED.height,
          shopify_media_id = NULL, source_name = EXCLUDED.source_name, created_at = now(), created_by = EXCLUDED.created_by
      `, [groupid, newName, imageAlt(title), dims.width, dims.height, req.file.originalname || null, req.user.display_name]);
    });

    // Best-effort: remove the previous file if the name changed and no other product (a width twin) still uses it.
    if (oldName && oldName !== newName) {
      try { if (!(await fileInUseElsewhere({ query }, oldName, groupid))) await deleteImage(oldName); }
      catch (delErr) { logger.error(`[product-image] could not delete old image ${oldName}:`, delErr.message); }
    }

    // If the product is live on Shopify, re-push so the new image reaches the store (best-effort — never fails the upload). The old
    // main's media is dropped; the rest of the gallery is untouched.
    const oldMediaId = prod.rows[0].old_media_id;
    const shopifyResult = await shopify.pushIfLive(groupid, { dropMediaIds: oldMediaId ? [oldMediaId] : [] });

    return res.json({ return_code: 'SUCCESS', groupid, imagename: newName, url: PUBLIC_BASE + newName, shopify: shopifyResult });
  } catch (err) {
    logger.error('[product-image] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to process image' });
  }
});

module.exports = router;
