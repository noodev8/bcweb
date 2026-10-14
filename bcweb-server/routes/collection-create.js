/*
=======================================================================================================================================
API Route: collection_create
=======================================================================================================================================
Method: POST
Purpose: Collections screen — make a new collection, i.e. a new tag the screen can put on styles. Owner, 2026-10-14: "I am responsible
         for creating the collection in Shopify UI" — so this creates NOTHING on Shopify; the owner builds the smart collection there
         ("Product tag is equal to <tag>"). Tags are picked from this list everywhere else, never typed per row, so a typo can't make a
         silent new tag. Rules in utils/collectionTags.js:
           - lower-case a-z, 0-9 and '-', 2-40 characters (typed input is trimmed and lower-cased first);
           - refused if already a collection (TAG_EXISTS);
           - refused if products on Shopify already carry the tag (TAG_IN_USE) — they were tagged outside this app, and the database
             would not know they are in it. Pick another name.
         One bclog line, section 'Collections'. Requires auth.
=======================================================================================================================================
Request Payload:
{ "tag": "caprice-push" }

Success Response:
{ "return_code": "SUCCESS", "tag": "caprice-push" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"TAG_INVALID"
"TAG_EXISTS"
"TAG_IN_USE"
"SHOPIFY_NOT_CONFIGURED"
"SHOPIFY_PUSH_FAILED"      // Shopify couldn't be read to check the tag, so nothing was created
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { createCollection } = require('../utils/collectionTags');
const logger = require('../utils/logger');

router.use(verifyToken);

const KNOWN = new Set(['TAG_INVALID', 'TAG_EXISTS', 'TAG_IN_USE', 'SHOPIFY_NOT_CONFIGURED', 'SHOPIFY_PUSH_FAILED']);

router.post('/', async (req, res) => {
  try {
    const tag = req.body && req.body.tag;
    if (typeof tag !== 'string' || tag.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'tag is required' });
    }
    const r = await createCollection(tag, req.user.display_name);
    return res.json({ return_code: 'SUCCESS', tag: r.tag });
  } catch (err) {
    logger.error('[collection-create] error:', err.message);
    if (KNOWN.has(err.code)) return res.json({ return_code: err.code, message: err.message });
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to create the collection' });
  }
});

module.exports = router;
