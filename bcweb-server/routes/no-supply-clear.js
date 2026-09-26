/*
=======================================================================================================================================
API Route: no_supply_clear
=======================================================================================================================================
Method: POST
Purpose: UNPARK — take "Can't get it" off style(s) (routes/no-supply-set.js, rules in utils/noSupply.js): all three no_supply_*
         columns back to NULL. The screens call the act "Unpark" (owner, 2026-09-26 — "Clear" clashed with the bulk bar's own Clear,
         which empties the ticks); the route keeps its clear name because that is what it does to the columns. A style-level fact, so
         no channel in the name. Called:
           - from an order screen: a parked style's Unpark (the supplier came back early), and the X on the "Couldn't get it — <date>"
             note a style carries once its park has lapsed (the operator's "yes, I can get it"),
           - by an order screen after Confirm Basket lands an order line for a flagged style — a style you've just ordered is plainly
             one you can get,
           - from Back Office → Seasons: the bulk bar's Unpark on ticked rows (usually on the Can't get view).
         Idempotent: clearing a style with no flag changes nothing. One bclog row per call (section "Can't get") for the styles that
         actually carried a flag — clearing nothing logs nothing. Touches nothing else on skusummary.
=======================================================================================================================================
Request Payload:
{ "groupids": ["0034791-MILANO"] }   // 1..MAX_BATCH. A single { "groupid": "…" } is accepted too.

Success Response:
{ "return_code": "SUCCESS", "cleared": ["0034791-MILANO"] }   // the styles that carried a flag and no longer do
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
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

const MAX_BATCH = 500;

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

    const cleared = await withTransaction(async (client) => {
      // Only rows that carry something — so `cleared` (and the log) name real changes, not every groupid sent.
      const upd = await client.query(`
        UPDATE skusummary
           SET no_supply_since = NULL, no_supply_until = NULL, no_supply_by = NULL
         WHERE groupid = ANY($1::text[])
           AND (no_supply_since IS NOT NULL OR no_supply_until IS NOT NULL OR no_supply_by IS NOT NULL)
         RETURNING groupid
      `, [groupids]);
      const names = upd.rows.map((r) => r.groupid);
      if (names.length > 0) {
        await writeBcLog(client, {
          who,
          section: "Can't get",
          log: `unparked ${names.length} style${names.length === 1 ? '' : 's'}: ${names.join(', ')}`,
        });
      }
      return names;
    });

    if (cleared.length > 0) logger.info(`[no-supply-clear] ${cleared.length} cleared by ${who}`);
    return res.json({ return_code: 'SUCCESS', cleared });
  } catch (err) {
    logger.error('[no-supply-clear] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to clear the style' });
  }
});

module.exports = router;
