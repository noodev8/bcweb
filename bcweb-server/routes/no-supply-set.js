/*
=======================================================================================================================================
API Route: no_supply_set
=======================================================================================================================================
Method: POST
Purpose: "Can't get it" (owner, 2026-09-26; per size since 2026-11-13) — the supplier has none of a SIZE, so hide it from the ORDER
         SCREENS for three months, then let it come back on its own. Not a channel fact (one supplier), so the name carries no channel.
         The rule, the one table and why it is three months: utils/noSupply.js (THE copy).

         Two ways in, ONE thing written — a no_supply_size row per size:
           codes     single sizes — Amazon Order (the button beside Cut on the selected sizes, or a row's detail line)
           groupids  WHOLE STYLES — a row for every live size of each (Shopify Order's style view, Back Office → Seasons' bulk bar).
                     A shortcut, not a second kind of mark.
         Each row: since = today (London), until = today + 3 months, marked_by = req.user.display_name (resolved here, never sent).
         Re-marking restarts the three months ("Still can't"). Lapsed rows past their keep are purged in the same transaction.

         NOT a product edit: no legacy `updated` stamp, no shopifychange, no price or season touched, and the style stays on every
         Repricing list. One bclog row per call (section "Can't get") in the same transaction, so the activity Log shows who marked what.
=======================================================================================================================================
Request Payload:
{ "codes": ["0034791-MILANO-38"] }                       // sizes, 1..MAX_BATCH
{ "groupids": ["0034791-MILANO", "1025583-UPPSALA"] }   // OR whole styles, 1..MAX_BATCH (a lone { "groupid": "…" } too). codes win if both.

Success Response:
{ "return_code": "SUCCESS", "since": "2026-11-13", "until": "2027-02-13", "by": "Andreas", "updated": ["0034791-MILANO-38", …] }
  updated = the SIZES actually marked (a code / groupid that isn't live is simply not in it)
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"TOO_MANY"
"NOT_FOUND"        // nothing sent matched a live size
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { NO_SUPPLY_MONTHS, markSizes, markStyles } = require('../utils/noSupply');
const logger = require('../utils/logger');

router.use(verifyToken);

// The whole catalogue is ~300 styles — same cap as the season bulk setter; it only stops a runaway client.
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
    const groupids = codes.length > 0 ? [] : readList(body, 'groupids', 'groupid');
    if (codes.length === 0 && groupids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'codes or groupids is required' });
    }
    if (codes.length > MAX_BATCH || groupids.length > MAX_BATCH) {
      return res.json({ return_code: 'TOO_MANY', message: `At most ${MAX_BATCH} at a time` });
    }
    const who = req.user.display_name;
    const rows = await withTransaction((client) => (codes.length > 0 ? markSizes(client, codes, who) : markStyles(client, groupids, who)));

    if (rows.length === 0) return res.json({ return_code: 'NOT_FOUND', message: 'Nothing there to mark' });
    logger.info(`[no-supply-set] ${rows.length} sizes marked can't-get for ${NO_SUPPLY_MONTHS} months by ${who}`);
    return res.json({
      return_code: 'SUCCESS', since: rows[0].since, until: rows[0].until, by: who, updated: rows.map((r) => r.code),
    });
  } catch (err) {
    logger.error('[no-supply-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark it' });
  }
});

module.exports = router;
