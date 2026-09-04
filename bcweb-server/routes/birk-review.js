/*
=======================================================================================================================================
API Route: birk_review
=======================================================================================================================================
Method: POST
Purpose: Birkenstock module — park a style out of the re-order sheet for 1, 2 or 3 months. The port of the legacy PowerBuilder screen's
         "1 2 3" buttons (review-date.txt), which are the only buttons on that screen that ever wrote anything.

         THE JOB: once a style has been ORDERED from Birkenstock there is nothing more to decide about it this season, but it goes on
         reading as a re-order candidate — sold 60, holding 12, red — for as long as the delivery takes to land. That is noise sitting
         on top of the exact list the owner is trying to work down. Parking it says "dealt with, ask me again in N months".

         Requires auth. THIS ROUTE WRITES.

THE COLUMN IS skusummary.check_stock (a real DATE), which is what the legacy screen wrote and what the owner's own performance query
already reads ("AND (ss.check_stock IS NULL OR ss.check_stock <= CURRENT_DATE) -- due for review"). Nothing else in BCWEB touches it:
the Pricing modules park on next_shopify_price_review / next_amz_price_review, which are a DIFFERENT decision (when to look at the
PRICE again) on a different cadence. Two review clocks on one row is not duplication — they answer two questions.

THE DATE IS THE 1st OF THE MONTH, N MONTHS AHEAD — not today + 30N days. Straight from the legacy code, and it is the right rule for
this screen rather than an accident of it: Birkenstock is bought against a season and the owner works the sheet in monthly passes, so
every style parked in the same pass should come back on the same day. Day-count parking would dribble them back one at a time through
the month. The legacy handled the December rollover by hand; date_trunc + an interval does it for free.

WHAT IT DOES NOT DO — deliberate, both of them:
  - NO LOG ROW. pricing-park writes to price_change_log because a hold is a pricing decision that gets scored later. This is not a
    pricing decision and there is no table that scores it; the stamp on the row IS the record, exactly as it was in PowerBuilder.
  - NO UNPARK. The owner asked for 1, 2 and 3 and nothing else. A park is cleared by parking again over the top (any of the three
    re-stamps the date), or it simply expires. If "bring it back now" is ever wanted it is a fourth button, not a hidden behaviour.

MANY STYLES AT ONCE, where the legacy did one. The screen has a multi-select (click / ctrl-click / shift-click) because an order is
placed for a handful of styles in one sitting, and parking them one round-trip at a time would be four seconds of clicking to record
one decision. All of them move in ONE transaction: a half-applied park would leave the owner believing a batch was dealt with when
some of it is still live on the sheet.
=======================================================================================================================================
Request Payload:
{
  "groupids": ["0034703-MILANO", "0129423-ARIZONA"],   // array of strings, required, 1..500
  "months":   1                                         // integer, required, 1 | 2 | 3
}

Success Response:
{
  "return_code": "SUCCESS",
  "months": 1,
  "review": "2026-10-01",     // the date stamped on every style in the batch
  "updated": 2                // rows actually stamped; < groupids.length means some ids matched nothing
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_MONTHS"
"TOO_MANY"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

// The three the owner asked for, and only these. Kept as a list rather than a range test so the set is stated in one place and a
// fourth button has to be a deliberate edit here.
const ALLOWED_MONTHS = [1, 2, 3];

// A ceiling on the batch. The whole Birkenstock catalogue is ~176 styles, so this is not a real limit on the screen — it is a guard
// against a malformed body turning one request into an unbounded UPDATE.
const MAX_BATCH = 500;

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const monthsRaw = body.months;
    const idsRaw = body.groupids;

    if (!Array.isArray(idsRaw) || idsRaw.length === 0 || monthsRaw === undefined || monthsRaw === null) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids (non-empty array) and months are required' });
    }

    // De-duplicate and drop anything that is not a usable string. The client sends a Set, so duplicates should not happen — but a
    // repeated id would make `updated` overcount and quietly misreport how much was parked.
    const groupids = [...new Set(idsRaw.filter((g) => typeof g === 'string' && g.trim() !== '').map((g) => g.trim()))];
    if (groupids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupids contained no usable ids' });
    }
    if (groupids.length > MAX_BATCH) {
      return res.json({ return_code: 'TOO_MANY', message: `At most ${MAX_BATCH} styles can be parked at once` });
    }

    const months = Number(monthsRaw);
    if (!ALLOWED_MONTHS.includes(months)) {
      return res.json({ return_code: 'INVALID_MONTHS', message: 'months must be 1, 2 or 3' });
    }

    // One statement for the whole batch: = ANY($1) over the id array, so the transaction holds a single UPDATE regardless of how many
    // styles were marked. The date is computed IN POSTGRES rather than in Node — the API and the DB do not necessarily share a
    // timezone, and "the 1st of next month" resolved against a server sitting in UTC at 23:30 BST would come out a month early on the
    // last day of a month. CURRENT_DATE is the database's own day, which is the day the owner is working in.
    const result = await withTransaction(async (client) =>
      client.query(
        `UPDATE skusummary
            SET check_stock = (date_trunc('month', CURRENT_DATE) + ($2::int * INTERVAL '1 month'))::date
          WHERE groupid = ANY($1::text[])
        RETURNING groupid, check_stock::text AS review`,
        [groupids, months]
      )
    );

    // Cast to text in SQL and read the string straight through — never hand a pg DATE to toISOString(), which parses it as local
    // midnight and slides the day back one under BST (CLAUDE.md).
    const review = result.rows.length > 0 ? result.rows[0].review : null;

    logger.info(`[birk-review] ${req.user.display_name} parked ${result.rows.length} style(s) until ${review} (${months}m)`);
    return res.json({ return_code: 'SUCCESS', months, review, updated: result.rows.length });
  } catch (err) {
    logger.error('[birk-review] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to set the review date' });
  }
});

module.exports = router;
