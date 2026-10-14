/*
=======================================================================================================================================
API Route: shopify_clearance_set
=======================================================================================================================================
Method: POST
Purpose: Winners → Slow: put the owner's CHOSEN styles into the clearance collection, or take them out (the Shopify `clearance` tag).
         Owner, 2026-10-14: "The slow screen simply shows what is SLOW and whether it is in a clearance collection or not. Then its up
         to me to choose what is in or out the collection." One style (the row's Add / Remove) or ticked rows in bulk. Any style LIVE ON
         SHOPIFY can go in — sitting or not; an OFF style is refused for its row, but Remove always works (the Collections screen's
         rules, utils/collectionTags.js, since 2026-10-14 — the database row and the Shopify tag change together). Slow's one-click "Update collection" (POST /shopify-clearance-apply) was removed 2026-10-14; nothing removes
         automatically any more. WRITES TO THE LIVE SHOP (the `clearance` tag only; every other tag is left alone). One bclog line,
         section 'Collections'. Rules in utils/clearanceTag.js.

         THE PRICE IS NOT HERE. Remove on one style offers an optional new price ("Perhaps continue to allow repricing if I remove from a
         collection"); the screen sends a normal W1 (POST /pricing-apply) AFTER this succeeds — same bounds, log and Shopify push as any
         price change. Kept apart so a price change never rides on a tag call.

         ONE STYLE AT A TIME: each style's row and Shopify tag change together in their own small transaction; a failure on one doesn't
         stop the rest — `failed` says which, and sending them again is safe (adding a tag twice / removing an absent tag is a no-op).

         Requires auth.
=======================================================================================================================================
Request Payload:
{ "groupids": ["1019051-ARIZONA", "…"],   // 1-500 styles
  "in": true }                             // true = into the collection, false = out

Success Response:
{ "return_code": "SUCCESS", "in": true, "done": ["1019051-ARIZONA"], "failed": [ { "groupid": "…", "error": "Not found on Shopify" } ] }
SUCCESS even when some styles failed — `failed` says which.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"SHOPIFY_NOT_CONFIGURED"
"SHOPIFY_PUSH_FAILED"      // Shopify couldn't be read, so nothing was changed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { addToCollection, removeFromCollection } = require('../utils/clearanceTag');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_IDS = 500;   // same cap as pricing-park-bulk / amz-review

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    if (!Array.isArray(body.groupids) || typeof body.in !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupids (1-${MAX_IDS} style ids) and in (true/false) are required` });
    }
    const ids = Array.from(new Set(body.groupids.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim())));
    if (ids.length === 0 || ids.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `groupids (1-${MAX_IDS} style ids) and in (true/false) are required` });
    }

    const op = body.in ? addToCollection : removeFromCollection;
    const r = await op(ids, req.user.display_name);
    return res.json({ return_code: 'SUCCESS', in: body.in, done: r.done, failed: r.failed });
  } catch (err) {
    logger.error('[shopify-clearance-set] error:', err.message);
    if (err.code === 'SHOPIFY_NOT_CONFIGURED' || err.code === 'SHOPIFY_PUSH_FAILED') {
      return res.json({ return_code: err.code, message: err.message });
    }
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update the clearance collection' });
  }
});

module.exports = router;
