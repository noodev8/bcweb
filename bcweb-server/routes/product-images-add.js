/*
=======================================================================================================================================
API Route: product_images_add
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Add EXTRA images to a product's gallery (the Add / Modify Images strip). Up to 10 files per call; each is processed by the
         shared utils/productImage.processImage (square, white, 2048 max, never enlarged, JPEG), uploaded to one.com with an SEO name
         (<title>-<groupid>-brookfield-comfort-<view|position>-<version>.jpg — the view word comes from the uploaded file's name when it
         is on the whitelist, e.g. Birkenstock's "1015090_sole.jpg"), and appended to product_images after the existing images.
         Then, if the product is live, the whole gallery is pushed to Shopify (utils/shopify.pushIfLive — best-effort, never fails the add).

         The MAIN image is not added here — it goes through /product-image (Replace). A product with an imagename but no main row yet
         gets that row created first, so positions always start at 1 = main.

         One bad file doesn't sink the batch: files that fail are reported in `failed`, the rest are kept. Requires auth.
=======================================================================================================================================
Request (multipart/form-data):
  images   (file[], required) - 1..10 images (jpeg/png/webp/avif, 25MB each)
  groupid  (text, required)
  title    (text, optional)   - on-screen title for the SEO filename/alt; falls back to the stored shopifytitle

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0051791-ARIZONA",
  "added": 2,
  "failed": [ { "name": "broken.jpg", "message": "Could not read that image file" } ],
  "images": [ … the whole gallery, as GET /product-images … ],
  "shopify": { "pushed": true, … } | null | { "pushed": false, "error": "…", "message": "…" }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"            // at least one image added
"MISSING_FIELDS"     // no groupid or no files
"NOT_FOUND"          // no such product
"NO_MAIN_IMAGE"      // the product has no main image yet — upload that first
"INVALID_IMAGE"      // unsupported type, or none of the files could be read
"IMAGE_TOO_LARGE"    // a file exceeds the size cap
"TOO_MANY_FILES"     // more than 10 files
"SFTP_ERROR"         // none could be uploaded to one.com
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { runUpload } = require('../utils/imageUpload');
const { processImage, viewFromName, imageAlt } = require('../utils/productImage');
const { imageFilename } = require('../utils/imageName');
const { putImage } = require('../utils/sftp');
const { loadGallery } = require('../utils/productGallery');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

const MAX_FILES = 10;

router.post('/', verifyToken, async (req, res) => {
  try {
    const uploadErr = await runUpload(req, res, 'images', MAX_FILES);
    if (uploadErr) return res.json(uploadErr);

    const groupid = String(req.body.groupid || '').trim();
    const files = req.files || [];
    if (!groupid || !files.length) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and at least one image are required' });

    const prod = await db.query(`
      SELECT ss.imagename, t.shopifytitle FROM skusummary ss LEFT JOIN title t ON t.groupid = ss.groupid WHERE ss.groupid = $1
    `, [groupid]);
    if (!prod.rows.length) return res.json({ return_code: 'NOT_FOUND', message: 'Product not found' });
    const title = String(req.body.title || '').trim() || prod.rows[0].shopifytitle || '';

    // Positions start at 1 = main. A product whose main predates product_images gets its main row now (size unknown -> NULL).
    let gallery = await loadGallery(db, groupid);
    if (!gallery.some((r) => r.position === 1)) {
      if (!prod.rows[0].imagename) return res.json({ return_code: 'NO_MAIN_IMAGE', message: 'Upload the main image first' });
      await db.query(`
        INSERT INTO product_images (groupid, position, filename, alt, source_name, created_by) VALUES ($1, 1, $2, $3, $2, $4)
        ON CONFLICT (groupid, position) DO NOTHING
      `, [groupid, prod.rows[0].imagename, imageAlt(title), req.user.display_name]);
      gallery = await loadGallery(db, groupid);
    }

    // Sequential, so positions and version tokens stay in upload order.
    let pos = Math.max(...gallery.map((r) => r.position)) + 1;
    let added = 0;
    let sftpFailures = 0;
    const failed = [];
    for (const file of files) {
      let processed;
      try {
        processed = await processImage(file.buffer);
      } catch (e) {
        failed.push({ name: file.originalname, message: 'Could not read that image file' });
        continue;
      }
      const view = viewFromName(file.originalname);
      const filename = imageFilename(title, groupid, `${Date.now().toString(36)}${pos}`, view || String(pos));
      try {
        await putImage(filename, processed.buffer);
      } catch (e) {
        logger.error(`[product-images-add] sftp upload failed for ${groupid}:`, e.message);
        sftpFailures++;
        failed.push({ name: file.originalname, message: 'Could not upload to the image server' });
        continue;
      }
      await db.query(`
        INSERT INTO product_images (groupid, position, filename, view, alt, width, height, source_name, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [groupid, pos, filename, view, imageAlt(title, view), processed.width, processed.height, file.originalname, req.user.display_name]);
      added++;
      pos++;
    }

    if (!added) {
      return sftpFailures
        ? res.json({ return_code: 'SFTP_ERROR', message: 'Could not upload the images to the server', failed })
        : res.json({ return_code: 'INVALID_IMAGE', message: 'None of the files could be read', failed });
    }

    const shopifyResult = await shopify.pushIfLive(groupid);
    const images = await loadGallery(db, groupid);
    return res.json({ return_code: 'SUCCESS', groupid, added, failed, images, shopify: shopifyResult });
  } catch (err) {
    logger.error('[product-images-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to add images' });
  }
});

module.exports = router;
