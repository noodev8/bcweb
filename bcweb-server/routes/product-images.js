/*
=======================================================================================================================================
API Route: product_images
=======================================================================================================================================
Method: GET
Purpose: A product's whole gallery from OUR store (product_images, docs/product-images-plan.md) — position 1 is the main image (mirrors
         skusummary.imagename), 2.. are the extra images. Read by the Add / Modify screen's Images strip. Files are served at
         https://images.brookfieldcomfort.com/<filename>. Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required)

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "0051791-ARIZONA",
  "images": [
    { "id": 12, "position": 1, "filename": "birkenstock-…-brookfield-comfort.jpg", "view": null, "alt": "Birkenstock Arizona …",
      "width": 800, "height": 800, "on_shopify": true, "created_at": "2026-10-13T…" },
    { "id": 13, "position": 2, "filename": "birkenstock-…-brookfield-comfort-sole-mv66t.jpg", "view": "sole", … }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const db = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { loadGallery } = require('../utils/productGallery');
const logger = require('../utils/logger');

router.get('/', verifyToken, async (req, res) => {
  try {
    const groupid = String(req.query.groupid || '').trim();
    if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    const images = await loadGallery(db, groupid);
    return res.json({ return_code: 'SUCCESS', groupid, images });
  } catch (err) {
    logger.error('[product-images] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load images' });
  }
});

module.exports = router;
