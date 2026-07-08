/*
=======================================================================================================================================
API Route: product_image
=======================================================================================================================================
Method: POST  (multipart/form-data)
Purpose: Upload / replace a product's MAIN image. The whole pipeline runs server-side (the web app just posts the raw file):
           1. Accept an upload in any common format (jpeg / png / webp / avif) — held in memory (multer), size-capped.
           2. Convert it CLEANLY to 800x800 JPEG with sharp: auto-orient (EXIF), resize to FIT inside 800x800 (no crop, no
              distortion), pad the remainder to a square on a WHITE background, flatten away any transparency, encode JPEG q85.
           3. Generate the SEO filename from the product title + groupid, with a fresh per-upload version token (utils/imageName.js)
              so every upload has a UNIQUE filename/URL — this sidesteps the one.com CDN cache (a same-name overwrite would be served
              stale) and makes the new image appear immediately.
           4. SFTP the JPEG to the one.com host that backs images.brookfieldcomfort.com (utils/sftp.js).
           5. UPDATE skusummary.imagename, then delete the previous file from one.com (best-effort cleanup — one image per product).
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
const multer = require('multer');
const sharp = require('sharp');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { imageFilename } = require('../utils/imageName');
const { putImage, deleteImage } = require('../utils/sftp');
const logger = require('../utils/logger');
const shopify = require('../utils/shopify');

const UPDATED_EXPR = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;
const PUBLIC_BASE = 'https://images.brookfieldcomfort.com/';

// In-memory upload (we hand the buffer straight to sharp — nothing hits disk). 15MB cap; only the formats we can convert.
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    // Signal an unsupported type; the wrapper below turns this into INVALID_IMAGE.
    const e = new Error('Unsupported image type — use JPEG, PNG, WebP or AVIF');
    e.code = 'UNSUPPORTED_TYPE';
    cb(e);
  }
});

router.post('/', verifyToken, (req, res) => {
  // Run multer ourselves so its errors become our JSON envelope (never a raw 4xx).
  upload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.json({ return_code: 'IMAGE_TOO_LARGE', message: 'Image exceeds the 15MB limit' });
        }
        return res.json({ return_code: 'INVALID_IMAGE', message: uploadErr.message || 'Invalid image upload' });
      }

      const groupid = (req.body.groupid || '').trim();
      const bodyTitle = (req.body.title || '').trim();
      if (!groupid || !req.file) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and an image file are required' });
      }

      // Load the product (existence + stored title + current image, for the filename and old-file cleanup).
      const prod = await query(`
        SELECT ss.groupid, ss.imagename, t.shopifytitle
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

      // Convert to a clean 800x800 white-padded JPEG. failOn:'none' tolerates minor corruption; a hard decode failure -> INVALID_IMAGE.
      let jpeg;
      try {
        jpeg = await sharp(req.file.buffer, { failOn: 'none' })
          .rotate()                                                    // honour EXIF orientation before resizing
          .resize(800, 800, { fit: 'contain', background: { r: 255, g: 255, b: 255 } })
          .flatten({ background: { r: 255, g: 255, b: 255 } })         // drop alpha (JPEG) -> white
          .jpeg({ quality: 85 })
          .toBuffer();
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

      // Point the product at the new file.
      await withTransaction(async (client) => {
        await client.query(`UPDATE skusummary SET imagename = $2, updated = ${UPDATED_EXPR}, updated_date = now() WHERE groupid = $1`, [groupid, newName]);
      });

      // Best-effort: remove the previous file if the name changed (don't fail the request over cleanup).
      if (oldName && oldName !== newName) {
        try { await deleteImage(oldName); }
        catch (delErr) { logger.error(`[product-image] could not delete old image ${oldName}:`, delErr.message); }
      }

      // If the product is live on Shopify, re-push so the new image reaches the store (best-effort — never fails the upload).
      const shopifyResult = await shopify.pushIfLive(groupid);

      return res.json({ return_code: 'SUCCESS', groupid, imagename: newName, url: PUBLIC_BASE + newName, shopify: shopifyResult });
    } catch (err) {
      logger.error('[product-image] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to process image' });
    }
  });
});

module.exports = router;
