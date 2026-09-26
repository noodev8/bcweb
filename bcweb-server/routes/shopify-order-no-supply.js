/*
=======================================================================================================================================
API Route: shopify_order_no_supply
=======================================================================================================================================
Method: POST
Purpose: "Can't get it" on Shopify Order (owner, 2026-09-26) — the supplier has none of this style, so park it off the order screen
         until a re-check date, then let it come back on its own. STYLE level (owner's choice over per-size).

         Stamps three columns on skusummary (migrations/20260926_no_supply.sql) and nothing else:
           no_supply_since = today (London)   — kept after the park lapses, so the style returns saying why
           no_supply_until = the re-check day — the style is hidden from Shopify Order while this is in the future
           no_supply_by    = who did it        — req.user.display_name, resolved here, never sent by the client

         WHY AN EXPIRY AND NO "FOREVER": the owner doesn't want "too much to remember". Season used to do this job (it hid a style
         and brought it back by the calendar) but season also decides WINNERS vs HARVEST and feeds the Seasons screen, so supply
         gets its own fact. Every park lapses; nothing disappears for good and nothing has to be switched back by hand.

         NOT a product edit: no legacy `updated` stamp, no shopifychange, no price or season touched, and the style stays on every
         Repricing list — "I can't buy any more, but I can price what I do have." Re-marking an already-parked style simply moves
         the dates (since = today, until = the new re-check day).
=======================================================================================================================================
Request Payload:
{
  "groupid": "0034791-MILANO",   // required
  "until": "season"              // required — "season" = the next season changeover (1 April / 1 September, the season rule's own
                                 //   boundaries — utils/portfolioStatus.js), or "3m" = three months from today
}

Success Response:
{ "return_code": "SUCCESS", "groupid": "0034791-MILANO", "since": "2026-09-26", "until": "2027-04-01", "by": "Andreas" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { LONDON_TODAY_SQL, nextSeasonStartSql } = require('../utils/portfolioStatus');
const logger = require('../utils/logger');

router.use(verifyToken);

// The re-check periods on offer, as SQL date expressions. A closed set — the client names one, it never sends a date.
const UNTIL_SQL = {
  season: nextSeasonStartSql(),
  '3m': `(${LONDON_TODAY_SQL} + INTERVAL '3 months')::date`,
};

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const groupid = typeof body.groupid === 'string' ? body.groupid.trim() : '';
    const untilSql = UNTIL_SQL[body.until];
    if (!groupid || !untilSql) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and until ("season" or "3m") are required' });
    }

    // Dates rendered to text in SQL — never a pg DATE through toISOString() (CLAUDE.md: the BST day-shift).
    const result = await withTransaction(async (client) => client.query(`
      UPDATE skusummary
         SET no_supply_since = ${LONDON_TODAY_SQL},
             no_supply_until = ${untilSql},
             no_supply_by = $2
       WHERE groupid = $1
       RETURNING no_supply_since::text AS since, no_supply_until::text AS until, no_supply_by AS by
    `, [groupid, req.user.display_name]));

    if (result.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `${groupid} isn't a style` });
    }
    const r = result.rows[0];
    logger.info(`[shopify-order-no-supply] ${groupid} parked until ${r.until} by ${req.user.display_name}`);
    return res.json({ return_code: 'SUCCESS', groupid, since: r.since, until: r.until, by: r.by });
  } catch (err) {
    logger.error('[shopify-order-no-supply] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to mark the style' });
  }
});

module.exports = router;
