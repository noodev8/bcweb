/*
=======================================================================================================================================
API Route: no_supply_set
=======================================================================================================================================
Method: POST
Purpose: "Can't get it" (owner, 2026-09-26) — the supplier has none of the style, so hide it from the ORDER SCREENS for three months,
         then let it come back on its own. A fact about the STYLE, not a channel: "if we can't get a style, we can't get it,
         regardless of where we're trying to sell it" (owner) — so the name carries no channel. Shopify Order reads it today; Amazon
         Order will read the same flag. The rule and why it is three months: utils/noSupply.js.

         Called with ONE style from an order screen (the button under a style) and with a TICKED BATCH from Back Office → Seasons (the
         bulk bar). Stamps three columns on skusummary and nothing else:
           no_supply_since = today (London)   — kept after the park lapses, so the style returns saying why
           no_supply_until = today + 3 months — off the order screens while this is in the future
           no_supply_by    = who did it        — req.user.display_name, resolved here, never sent by the client
         Re-marking a style already parked restarts its three months from today ("Still can't").

         NOT a product edit: no legacy `updated` stamp, no shopifychange, no price or season touched, and the style stays on every
         Repricing list. One bclog row per call (section "Can't get") in the same transaction, so the activity Log shows who marked what.
=======================================================================================================================================
Request Payload:
{ "groupids": ["0034791-MILANO", "1025583-UPPSALA"] }   // 1..MAX_BATCH. A single { "groupid": "…" } is accepted too.

Success Response:
{ "return_code": "SUCCESS", "since": "2026-09-26", "until": "2026-12-26", "by": "Andreas", "updated": ["0034791-MILANO", …] }
  updated = the styles actually marked (a groupid that isn't a style is simply not in it)
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"TOO_MANY"
"NOT_FOUND"        // none of the groupids is a style
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const { LONDON_TODAY_SQL } = require('../utils/sql');
const { NO_SUPPLY_MONTHS, NO_SUPPLY_UNTIL_SQL } = require('../utils/noSupply');
const logger = require('../utils/logger');

router.use(verifyToken);

// The whole catalogue is ~300 styles — same cap as the season bulk setter; it only stops a runaway client.
const MAX_BATCH = 500;

// The request's style list: `groupids`, or a lone `groupid` (an order screen's one-style button). Trimmed, blanks dropped, de-duplicated.
function readGroupids(body) {
  const raw = Array.isArray(body.groupids) ? body.groupids : body.groupid !== undefined ? [body.groupid] : [];
  return [...new Set(raw.map((g) => String(g || '').trim()).filter(Boolean))];
}

router.post('/', async (req, res) => {
  try {
    const groupids = readGroupids(req.body || {});
    if (groupids.length === 0) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids is required' });
    if (groupids.length > MAX_BATCH) {
      return res.json({ return_code: 'TOO_MANY', message: `At most ${MAX_BATCH} styles at a time` });
    }
    const who = req.user.display_name;

    const result = await withTransaction(async (client) => {
      const upd = await client.query(`
        UPDATE skusummary
           SET no_supply_since = ${LONDON_TODAY_SQL},
               no_supply_until = ${NO_SUPPLY_UNTIL_SQL},
               no_supply_by = $2
         WHERE groupid = ANY($1::text[])
         RETURNING groupid, no_supply_since::text AS since, no_supply_until::text AS until
      `, [groupids, who]);
      if (upd.rows.length > 0) {
        const names = upd.rows.map((r) => r.groupid);
        await writeBcLog(client, {
          who,
          section: "Can't get",
          log: `${names.length} style${names.length === 1 ? '' : 's'} until ${upd.rows[0].until}: ${names.join(', ')}`,
        });
      }
      return upd.rows;
    });

    if (result.length === 0) return res.json({ return_code: 'NOT_FOUND', message: 'None of those is a style' });
    logger.info(`[no-supply-set] ${result.length} marked can't-get for ${NO_SUPPLY_MONTHS} months by ${who}`);
    return res.json({
      return_code: 'SUCCESS', since: result[0].since, until: result[0].until, by: who, updated: result.map((r) => r.groupid),
    });
  } catch (err) {
    logger.error('[no-supply-set] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the style' });
  }
});

module.exports = router;
