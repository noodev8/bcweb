/*
=======================================================================================================================================
API Route: product_images_delete
=======================================================================================================================================
Method: POST
Purpose: Remove one EXTRA image from a product's gallery (the Add / Modify Images strip). Deletes the product_images row and closes
         the gap (one transaction), pushes the gallery to Shopify if the product is live — telling the push to DROP this image's media,
         since a push otherwise keeps Shopify media we don't hold (utils/shopify.js buildFiles) — then deletes the file from one.com
         (best-effort, last: an orphaned file is harmless).

         The MAIN image (position 1) can't be deleted here: a live product must always have one. Replace it instead (/product-image).
         Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "0051791-ARIZONA",   // string, required
  "id": 13                        // integer, required — product_images.id
}

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0051791-ARIZONA",
  "images": [ … the whole gallery, as GET /product-images … ],
  "shopify": { "pushed": true, … } | null | { "pushed": false, … }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"          // no such image on that product
"MAIN_IMAGE"         // position 1 — replace it instead
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { loadGallery, closeGap, fileInUseElsewhere } = require('../utils/productGallery');
const { deleteImage } = require('../utils/sftp');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.post('/', verifyToken, async (req, res) => {
  try {
    const groupid = String((req.body || {}).groupid || '').trim();
    const id = Number((req.body || {}).id);
    if (!groupid || !Number.isInteger(id)) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and id are required' });

    const r = await db.query(`SELECT position, filename, shopify_media_id FROM product_images WHERE id = $1 AND groupid = $2`, [id, groupid]);
    if (!r.rows.length) return res.json({ return_code: 'NOT_FOUND', message: 'Image not found' });
    const img = r.rows[0];
    if (img.position === 1) return res.json({ return_code: 'MAIN_IMAGE', message: 'The main image can’t be deleted — replace it instead' });

    await withTransaction(async (client) => {
      await client.query(`DELETE FROM product_images WHERE id = $1`, [id]);
      await closeGap(client, groupid, img.position);
    });

    const shopifyResult = await shopify.pushIfLive(groupid, { dropMediaIds: img.shopify_media_id ? [img.shopify_media_id] : [] });

    try { if (!(await fileInUseElsewhere(db, img.filename, groupid))) await deleteImage(img.filename); }
    catch (e) { logger.error(`[product-images-delete] could not delete file ${img.filename}:`, e.message); }

    const images = await loadGallery(db, groupid);
    return res.json({ return_code: 'SUCCESS', groupid, images, shopify: shopifyResult });
  } catch (err) {
    logger.error('[product-images-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete the image' });
  }
});

module.exports = router;
