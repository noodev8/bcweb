/*
=======================================================================================================================================
API Route: collection_tag_set
=======================================================================================================================================
Method: POST
Purpose: Collections screen — put one collection's tag on chosen styles, or take it off. One style (a row's + / ×) or ticked rows /
         "All shown" in bulk. WRITES the collection_member row AND the Shopify tag, together, one style at a time (a Shopify failure rolls
         that style's row back, so the database never claims a tag Shopify hasn't got). Only that one tag is touched on Shopify; every
         other tag on a product is left alone. Rules in utils/collectionTags.js (owner, 2026-10-14):
           ADD     style must be LIVE ON SHOPIFY (skusummary.shopify = 1), found on Shopify by handle, and have fewer than 3 tags —
                   otherwise refused for that row ("Shopify is off" / "Already has 3 tags" / "Not found on Shopify").
           REMOVE  always works, whatever the flag. If Shopify no longer has the product the row is removed anyway, listed in notes.
         A failure on one style doesn't stop the rest — failed says which; sending them again is safe. One bclog line per batch,
         section 'Collections'. Requires auth.
=======================================================================================================================================
Request Payload:
{ "groupids": ["1019051-ARIZONA", "…"],   // 1-500 styles
  "tag": "clearance",                      // an existing collection
  "in": true }                             // true = add the tag, false = remove it

Success Response:
{ "return_code": "SUCCESS", "tag": "clearance", "in": true,
  "done":   ["1019051-ARIZONA"],
  "failed": [ { "groupid": "…", "error": "Shopify is off" } ],
  "notes":  [ { "groupid": "…", "note": "Not on Shopify — removed here only" } ] }
SUCCESS even when some styles failed — failed says which.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNKNOWN_COLLECTION"
"SHOPIFY_NOT_CONFIGURED"
"SHOPIFY_PUSH_FAILED"      // Shopify couldn't be read, so nothing was changed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { setTag, normaliseTag } = require('../utils/collectionTags');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_IDS = 500;   // same cap as shopify-clearance-set / pricing-park-bulk
const KNOWN = new Set(['UNKNOWN_COLLECTION', 'SHOPIFY_NOT_CONFIGURED', 'SHOPIFY_PUSH_FAILED']);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const bad = () => res.json({
      return_code: 'MISSING_FIELDS',
      message: `groupids (1-${MAX_IDS} style ids), tag and in (true/false) are required`,
    });
    if (!Array.isArray(body.groupids) || typeof body.in !== 'boolean' || typeof body.tag !== 'string') return bad();
    const ids = Array.from(new Set(body.groupids.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())));
    if (ids.length === 0 || ids.length > MAX_IDS) return bad();

    const r = await setTag(ids, body.tag, body.in, req.user.display_name);
    return res.json({
      return_code: 'SUCCESS', tag: normaliseTag(body.tag), in: body.in, done: r.done, failed: r.failed, notes: r.notes,
    });
  } catch (err) {
    logger.error('[collection-tag-set] error:', err.message);
    if (KNOWN.has(err.code)) return res.json({ return_code: err.code, message: err.message });
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update the collection' });
  }
});

module.exports = router;
