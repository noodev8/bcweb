/*
=======================================================================================================================================
API Route: product_images_move
=======================================================================================================================================
Method: POST
Purpose: Move one EXTRA image one place left or right in a product's gallery (the Add / Modify Images strip), then push the gallery to
         Shopify if the product is live (Shopify shows images in our order). Extra images move among positions 2..N only — the main
         (position 1) changes by Replace, never by moving. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "groupid": "0051791-ARIZONA",   // string, required
  "id": 13,                       // integer, required — product_images.id
  "direction": "left"             // "left" | "right"
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
"CANT_MOVE"          // the main image, or already at that end
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { loadGallery, swapPositions } = require('../utils/productGallery');
const shopify = require('../utils/shopify');
const logger = require('../utils/logger');

router.post('/', verifyToken, async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = String(body.groupid || '').trim();
    const id = Number(body.id);
    const step = body.direction === 'left' ? -1 : body.direction === 'right' ? 1 : 0;
    if (!groupid || !Number.isInteger(id) || !step) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid, id and direction (left|right) are required' });
    }

    const gallery = await loadGallery(db, groupid);
    const img = gallery.find((r) => r.id === id);
    if (!img) return res.json({ return_code: 'NOT_FOUND', message: 'Image not found' });
    const target = img.position + step;
    if (img.position === 1 || target < 2 || !gallery.some((r) => r.position === target)) {
      return res.json({ return_code: 'CANT_MOVE', message: 'That image can’t move that way' });
    }

    await withTransaction((client) => swapPositions(client, groupid, img.position, target));

    const shopifyResult = await shopify.pushIfLive(groupid);
    const images = await loadGallery(db, groupid);
    return res.json({ return_code: 'SUCCESS', groupid, images, shopify: shopifyResult });
  } catch (err) {
    logger.error('[product-images-move] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to move the image' });
  }
});

module.exports = router;
