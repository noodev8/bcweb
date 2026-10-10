/*
=======================================================================================================================================
API Route: shopify_clearance_apply
=======================================================================================================================================
Method: POST
Purpose: Reports → Stock vs Sales, "Update collection" (one click, no preview — owner, 2026-10-10). Syncs the Shopify `clearance` tag
         to the sitting list: tags the sitting styles that aren't tagged, untags every tagged product that isn't sitting. WRITES TO THE LIVE SHOP (product tags only).
         The rules live in utils/clearanceTag.js.

         PLANS ON THE SERVER at the moment of the click — the request carries no list, so the browser can't tag something the rule
         doesn't say to. The response reports what was actually done.

         NOT A DB TRANSACTION: the writes are Shopify calls, one per product, and can't be rolled back together. A failure on one product
         doesn't stop the rest; failures come back in `failed`, and pressing the button again retries them (the sync is idempotent).
         One bclog line per run, section 'Clearance Tags', under the operator's login name.

         Requires auth.
=======================================================================================================================================
Request Payload: {} (nothing — see above)

Success Response:
{
  "return_code": "SUCCESS",
  "tag": "clearance",
  "added":   [ { "groupid": "…", "handle": "…", "title": "…" } ],
  "removed": [ { "groupid": "…" | null, "handle": "…", "title": "…" } ],
  "failed":  [ { "groupid": "…", "handle": "…", "title": "…", "action": "add" | "remove", "error": "…" } ],
  "missing": [ { "groupid": "…", "handle": "…", "title": "…" } ]
}
SUCCESS even when some products failed — the run happened; `failed` says which.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"SHOPIFY_NOT_CONFIGURED"
"SHOPIFY_PUSH_FAILED"      // the PLAN couldn't be read from Shopify, so nothing was changed
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { applySync } = require('../utils/clearanceTag');
const logger = require('../utils/logger');

router.use(verifyToken);

const strip = ({ product_id, ...rest }) => rest;   // eslint-disable-line no-unused-vars

router.post('/', async (req, res) => {
  try {
    const r = await applySync(req.user.display_name);
    return res.json({
      return_code: 'SUCCESS',
      tag: r.tag,
      added: r.added.map(strip),
      removed: r.removed.map(strip),
      failed: r.failed.map(strip),
      missing: r.missing.map(strip),
    });
  } catch (err) {
    logger.error('[shopify-clearance-apply] error:', err.message);
    if (err.code === 'SHOPIFY_NOT_CONFIGURED' || err.code === 'SHOPIFY_PUSH_FAILED') {
      return res.json({ return_code: err.code, message: err.message });
    }
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update clearance tags' });
  }
});

module.exports = router;
