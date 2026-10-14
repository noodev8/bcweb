/*
=======================================================================================================================================
API Route: collection_list
=======================================================================================================================================
Method: GET
Purpose: Collections screen — the collections (Shopify tags) the owner has made, for the chips along the top. Each with its style count
         and how many of those are NOT live on Shopify (`off`) — a style switched off keeps its tag on the store and keeps showing in the
         collection, so the count says so and the owner can find and remove them (owner, 2026-10-14). Rules in utils/collectionTags.js.

         READ-ONLY, database only. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "collections": [ { "tag": "clearance", "styles": 41, "off": 2 } ],   // alphabetical
  "max_tags": 3                                                         // tags allowed per style
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
const { verifyToken } = require('../middleware/verifyToken');
const { listCollections, MAX_TAGS } = require('../utils/collectionTags');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const collections = await listCollections();
    return res.json({ return_code: 'SUCCESS', collections, max_tags: MAX_TAGS });
  } catch (err) {
    logger.error('[collection-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load collections' });
  }
});

module.exports = router;
