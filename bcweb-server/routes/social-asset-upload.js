/*
=======================================================================================================================================
API Route: social_asset_upload
=======================================================================================================================================
Method: POST
Purpose: Social module — upload one finished marketing graphic. Validates it, normalises it to JPEG, SFTPs it to the social webroot on
         one.com (social.brookfieldcomfort.com) and records a `social_asset` row. Returns the public URL, which is what Meta will later
         fetch server-side at publish time.

         Modelled directly on routes/product-image.js — same multer-in-memory -> sharp -> putImage shape, same "upload before you write
         the DB row" ordering. The differences are deliberate and listed below.

WHY A UUID FILENAME
         Never the uploaded name. No collisions, no path tricks from a hostile filename, and it defeats one.com's Varnish cache the same
         way product-image.js's version token does — a reused name gets served stale, a fresh one appears immediately. Assets are
         immutable (below), so we never overwrite and never need to think about the cache again.

WHY WE ENFORCE INSTAGRAM'S RULES IN v1, WHICH IS FACEBOOK-ONLY
         Aspect ratio between 4:5 and 1.91:1, and <= 8MB. Instagram is Phase 3. Discovering then that every asset ever stored is the
         wrong shape is an avoidable, annoying migration, and the cost of enforcing it now is one comparison. Facebook is happy with
         anything in that window.

WHY ASSETS ARE IMMUTABLE
         Nothing ever updates or replaces a social_asset row. Editing a queued post's image uploads a NEW file and repoints the post;
         the old file stays because a published post's Facebook copy still references the URL Meta fetched. Deleting it would not
         un-publish anything — it would just break the record of what went out.

         Requires auth. `uploaded_by` is resolved server-side from the JWT, never trusted from the client.
=======================================================================================================================================
Request (multipart/form-data):
  image        (file, optional)    - the finished graphic (jpeg/png/webp)
  source_url   (text, optional)    - ALTERNATIVE to `image`: point at a photo already public on images.brookfieldcomfort.com
                                      (Inventory's "Send to Social" handoff) instead of a browser upload. MUST be on that host —
                                      an arbitrary caller-supplied URL is not fetched (SSRF). Exactly one of `image`/`source_url`
                                      is required.
                                      Fetched here on the SERVER (that host sends no CORS headers, so the browser can't read it
                                      itself), then only VALIDATED (aspect/size) — never re-encoded or re-hosted on one.com. The
                                      photo is already sitting at a public URL Meta can fetch directly, the same way the
                                      Inventory screen displays it, so this path needs none of the ONECOM_SOCIAL_REMOTE_DIR /
                                      SOCIAL_ASSET_BASE_URL config the `image` path below does, and `public_url` on the stored
                                      row is that original URL, unchanged.

Success Response:
{
  "return_code": "SUCCESS",
  "asset": {
    "id": 7,
    "filename": "b3f1c2de-....jpg",
    "public_url": "https://social.brookfieldcomfort.com/b3f1c2de-....jpg",
    "width": 1200, "height": 628, "bytes": 148221,
    "uploaded_by": "Andreas", "created_at": "2026-08-01T18:20:00.000Z"
  }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"     // neither an image file nor source_url
"INVALID_SOURCE"     // source_url isn't on the allowed image host
"FETCH_FAILED"       // source_url didn't come back (network error / non-200)
"INVALID_IMAGE"      // unsupported type, or sharp couldn't decode it
"IMAGE_TOO_LARGE"    // over the 8MB Instagram ceiling
"BAD_ASPECT"         // outside the 4:5 .. 1.91:1 window
"SFTP_ERROR"         // upload/config failure talking to one.com
"NOT_CONFIGURED"     // ONECOM_SOCIAL_REMOTE_DIR / SOCIAL_ASSET_BASE_URL missing
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const crypto = require('crypto');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { putImage } = require('../utils/sftp');
const config = require('../config/config');
const logger = require('../utils/logger');

// Instagram's published limits, applied from day one (see header).
const MAX_BYTES = 8 * 1024 * 1024;
const MIN_RATIO = 4 / 5;        // 0.80 — tallest allowed (portrait)
const MAX_RATIO = 1.91;         //        widest allowed (landscape)

// Instagram quotes "1.91:1" as a rounded figure and accepts the standard sizes that sit a hair outside it. The canonical 1200x628
// social graphic is 1.9108 — without this tolerance the most common image size in the world would be rejected, which is exactly the
// kind of rule that makes a tool feel broken. 0.02 admits 1200x628 and 1080x566 while still refusing anything genuinely panoramic.
const RATIO_TOLERANCE = 0.02;

// The only host `source_url` may point at — the inventory image CDN. Fixed and not derived from any request input, so a caller
// cannot use this field to make the server fetch an arbitrary URL (SSRF).
const ALLOWED_SOURCE_PREFIX = 'https://images.brookfieldcomfort.com/';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  // Cap the SOURCE generously: a 12MB PNG can compress to well under the 8MB output ceiling, so rejecting on input size would turn
  // away images we can actually use. The real 8MB test is applied to the converted JPEG below.
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED.has(file.mimetype)) return cb(null, true);
    const e = new Error('Unsupported image type — use JPEG, PNG or WebP');
    e.code = 'UNSUPPORTED_TYPE';
    cb(e);
  }
});

router.post('/', verifyToken, (req, res) => {
  // Run multer ourselves so its errors become our JSON envelope (never a raw 4xx) — same as product-image.js.
  upload.single('image')(req, res, async (uploadErr) => {
    try {
      if (uploadErr) {
        if (uploadErr.code === 'LIMIT_FILE_SIZE') {
          return res.json({ return_code: 'IMAGE_TOO_LARGE', message: 'Image exceeds the 20MB source limit' });
        }
        return res.json({ return_code: 'INVALID_IMAGE', message: uploadErr.message || 'Invalid image upload' });
      }
      const sourceUrl = typeof req.body.source_url === 'string' ? req.body.source_url.trim() : '';
      if (!req.file && !sourceUrl) {
        return res.json({ return_code: 'MISSING_FIELDS', message: 'An image file is required' });
      }

      // ---- source_url path: an inventory product photo, already public on images.brookfieldcomfort.com --------------------------
      // No re-host here — that image is already sitting at a public URL Meta can fetch directly (the inventory screen reads it the
      // same way), so this path never touches one.com/SFTP and doesn't need ONECOM_SOCIAL_REMOTE_DIR/SOCIAL_ASSET_BASE_URL
      // configured at all. It only validates the photo and points the post straight at the existing URL.
      if (!req.file) {
        if (!sourceUrl.startsWith(ALLOWED_SOURCE_PREFIX)) {
          return res.json({ return_code: 'INVALID_SOURCE', message: 'source_url must be on the inventory image host' });
        }
        let buffer;
        try {
          const fetched = await fetch(sourceUrl);
          if (!fetched.ok) {
            return res.json({ return_code: 'FETCH_FAILED', message: `Could not fetch that image (${fetched.status})` });
          }
          buffer = Buffer.from(await fetched.arrayBuffer());
        } catch (fetchErr) {
          logger.error('[social-asset-upload] source_url fetch failed:', fetchErr.message);
          return res.json({ return_code: 'FETCH_FAILED', message: 'Could not fetch that image' });
        }

        let meta;
        try {
          // No .rotate()/re-encode — these are catalogue photos straight off the CDN, not phone camera EXIF, so the raw dimensions
          // are trustworthy. This is only a read (never stored), so it costs nothing beyond the decode.
          meta = await sharp(buffer, { failOn: 'none' }).metadata();
        } catch (imgErr) {
          logger.error('[social-asset-upload] sharp decode failed:', imgErr.message);
          return res.json({ return_code: 'INVALID_IMAGE', message: 'Could not read that image file' });
        }

        const ratio = meta.width / meta.height;
        if (ratio < MIN_RATIO - RATIO_TOLERANCE || ratio > MAX_RATIO + RATIO_TOLERANCE) {
          return res.json({
            return_code: 'BAD_ASPECT',
            message: `Image is ${meta.width}x${meta.height} (ratio ${ratio.toFixed(2)}). Needs to be between 4:5 (0.80, portrait) and 1.91:1 (landscape).`
          });
        }
        if (buffer.length > MAX_BYTES) {
          return res.json({
            return_code: 'IMAGE_TOO_LARGE',
            message: `Image is ${(buffer.length / 1024 / 1024).toFixed(1)}MB — the limit is 8MB.`
          });
        }

        // public_url IS the original CDN url — nothing was re-hosted, so there is nothing else it could point at.
        const filename = sourceUrl.split('/').pop() || sourceUrl;
        const ins = await query(
          `INSERT INTO social_asset (filename, public_url, width, height, bytes, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           RETURNING id, filename, public_url, width, height, bytes, uploaded_by, created_at`,
          [filename, sourceUrl, meta.width, meta.height, buffer.length, req.user.display_name]
        );

        logger.info(`[social-asset-upload] source_url ${sourceUrl} (${meta.width}x${meta.height}, ${buffer.length}B) by ${req.user.display_name}`);
        return res.json({ return_code: 'SUCCESS', asset: ins.rows[0] });
      }

      // ---- multipart file path: a manually picked graphic, converted and re-hosted on one.com (unchanged) ----------------------
      if (!config.social.remoteDir || !config.social.assetBaseUrl) {
        return res.json({
          return_code: 'NOT_CONFIGURED',
          message: 'Social image hosting is not configured (ONECOM_SOCIAL_REMOTE_DIR / SOCIAL_ASSET_BASE_URL)'
        });
      }

      // Normalise to JPEG. .rotate() honours EXIF orientation FIRST — otherwise a portrait phone photo measures as landscape and the
      // aspect check below judges the wrong shape. flatten() drops alpha to white, since JPEG has none.
      let jpeg, meta;
      try {
        jpeg = await sharp(req.file.buffer, { failOn: 'none' })
          .rotate()
          .flatten({ background: { r: 255, g: 255, b: 255 } })
          .jpeg({ quality: 88 })
          .toBuffer();
        meta = await sharp(jpeg).metadata();
      } catch (imgErr) {
        logger.error('[social-asset-upload] sharp decode failed:', imgErr.message);
        return res.json({ return_code: 'INVALID_IMAGE', message: 'Could not read that image file' });
      }

      // Measure the CONVERTED image — that is the file Meta will fetch, so it is the one the limits apply to.
      const ratio = meta.width / meta.height;
      if (ratio < MIN_RATIO - RATIO_TOLERANCE || ratio > MAX_RATIO + RATIO_TOLERANCE) {
        return res.json({
          return_code: 'BAD_ASPECT',
          message: `Image is ${meta.width}x${meta.height} (ratio ${ratio.toFixed(2)}). Needs to be between 4:5 (0.80, portrait) and 1.91:1 (landscape).`
        });
      }
      if (jpeg.length > MAX_BYTES) {
        return res.json({
          return_code: 'IMAGE_TOO_LARGE',
          message: `Converted image is ${(jpeg.length / 1024 / 1024).toFixed(1)}MB — the limit is 8MB.`
        });
      }

      const filename = `${crypto.randomUUID()}.jpg`;

      // Upload FIRST. If this fails we never write a social_asset row, so the table can never point at a file that isn't there.
      try {
        await putImage(filename, jpeg, config.social.remoteDir);
      } catch (sftpErr) {
        logger.error('[social-asset-upload] sftp upload failed:', sftpErr.message);
        return res.json({ return_code: 'SFTP_ERROR', message: 'Could not upload the image to the image host' });
      }

      // Store the resolved public_url rather than deriving it on read: if the host ever moves, already-published posts must keep
      // pointing at the URL Meta actually fetched.
      const publicUrl = `${config.social.assetBaseUrl}/${filename}`;
      const ins = await query(
        `INSERT INTO social_asset (filename, public_url, width, height, bytes, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, filename, public_url, width, height, bytes, uploaded_by, created_at`,
        [filename, publicUrl, meta.width, meta.height, jpeg.length, req.user.display_name]
      );

      logger.info(`[social-asset-upload] ${filename} (${meta.width}x${meta.height}, ${jpeg.length}B) by ${req.user.display_name}`);
      return res.json({ return_code: 'SUCCESS', asset: ins.rows[0] });
    } catch (err) {
      logger.error('[social-asset-upload] error:', err.message);
      return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to process image' });
    }
  });
});

module.exports = router;
