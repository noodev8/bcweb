/*
=======================================================================================================================================
API Route: no_supply_clear
=======================================================================================================================================
Method: POST
Purpose: RELEASE — take "Can't get it" off sizes (routes/no-supply-set.js; the one table and its rules: utils/noSupply.js). Deletes
         their no_supply_size rows, live or lapsed. The screens call the act "Release" (owner, 2026-09-26 — not "Clear", which clashed
         with the bulk bar's own Clear, and not "Unpark", because "parked" means a pricing review date); the route keeps its clear name.
         No channel in the name — one supplier. Called:
           - codes     Amazon Order: a size's Release, the X on its "Couldn't get it — <date>" note, an order landing for a marked size;
                       Shopify Order: an order landing for a marked size
           - groupids  WHOLE STYLES — every row of each: Shopify Order's style-block Release / X, Back Office → Seasons' bulk Release
         Both may come in one call. Idempotent: releasing something unmarked changes nothing. One bclog row per kind that actually
         carried a mark — releasing nothing logs nothing.
=======================================================================================================================================
Request Payload:
{ "codes": ["0034791-MILANO-38"] }   // 0..MAX_BATCH sizes
{ "groupids": ["0034791-MILANO"] }   // 0..MAX_BATCH whole styles (a lone { "groupid": "…" } too); at least one of the two

Success Response:
{ "return_code": "SUCCESS", "cleared": ["0034791-MILANO-38", "0034791-MILANO"] }   // the sizes / styles that carried a mark
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"TOO_MANY"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { clearSizes, clearStyles } = require('../utils/noSupply');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_BATCH = 500;

// A request list, trimmed, blanks dropped, de-duplicated. `groupids` also accepts a lone `groupid`.
function readList(body, many, one) {
  const raw = Array.isArray(body[many]) ? body[many] : one && body[one] !== undefined ? [body[one]] : [];
  return [...new Set(raw.map((g) => String(g || '').trim()).filter(Boolean))];
}

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const codes = readList(body, 'codes');
    const groupids = readList(body, 'groupids', 'groupid');
    if (codes.length === 0 && groupids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'codes or groupids is required' });
    }
    if (codes.length > MAX_BATCH || groupids.length > MAX_BATCH) {
      return res.json({ return_code: 'TOO_MANY', message: `At most ${MAX_BATCH} at a time` });
    }
    const who = req.user.display_name;

    const cleared = await withTransaction(async (client) => [
      ...(await clearSizes(client, codes, who)),
      ...(await clearStyles(client, groupids, who)),
    ]);

    if (cleared.length > 0) logger.info(`[no-supply-clear] ${cleared.length} released by ${who}`);
    return res.json({ return_code: 'SUCCESS', cleared });
  } catch (err) {
    logger.error('[no-supply-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to release it' });
  }
});

module.exports = router;
