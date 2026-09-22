/*
=======================================================================================================================================
API Route: portfolio_snapshot_update
=======================================================================================================================================
Method: POST
Purpose: Winners screen — the "Update now" button. Recomputes the headline portfolio figures (utils/portfolio.js) and UPSERTs them as
         TODAY's row in `portfolio_snapshot`, then prunes anything past the 2-year retention. That stored series is what the trend
         chart under the hero count is drawn from.

         MANUAL TRIGGER ONLY — no cron. Viewing the screen (GET /portfolio-winners) computes today's figures live and stores nothing,
         so merely opening the page never appends a point. Recording one is a deliberate press. Same read/update split as Stock
         Position and Birk Availability, and for the same reason: a series that grew on every page view would be a record of
         browsing habits, not of the business.

WHAT A SNAPSHOT MEANS, AND WHY IT IS NOT JUST A CACHE
         The winner count for a past date could be recomputed from `sales` at any time — the prior-year figure on the screen is
         exactly that. A stored row is a different thing: IT IS WHAT WE SAID ON THE DAY. A recomputation is what the books say NOW
         about then, and the two drift as late-booked sales, refunds and corrections land. The trend line is meant to show the
         reading the business was steering by, so it is built from the stored rows only. Do not backfill this table to make the
         chart look fuller — see the migration header (migrations/20260922_portfolio_snapshot.sql) for what to do instead.

         ⚠ THE BAR IS NOT STORED WITH THE ROW. Every count is taken against WINNER_PROFIT_BAR / MATURITY_DAYS as they stood on the
           day. Moving either makes the chart show a step that looks like the business moved when only the ruler did. If a bar ever
           changes, clear the table or start storing the bar — the warning sits on the constant in utils/portfolio.js too.

           THIS IS WHY THE SCREEN'S BAR TOGGLE CANNOT REACH THIS ROUTE. The Winners screen can read the count at £300, £500 or
           £1,000 (GET /portfolio-winners returns summary.bars), but what gets RECORDED is always summary.winner_count, which is
           the tracked £200 bar — computeWinners() spreads bars[0] onto summary precisely so that this INSERT cannot accidentally
           follow the display. Do not "helpfully" add a bar parameter to this POST: one series, one ruler, or the trend is a lie.

         Growth safeguard (why this is bounded):
           - snapshot_date is the PK and we UPSERT it, so repeated presses in one day OVERWRITE today's row, never append.
           - The prune removes rows older than 2 years in the same transaction. Max size ~730 rows, permanently.

         Wrapped in withTransaction (upsert + prune as one unit), matching the module's sibling snapshot writers. The compute itself
         is a read; only our own snapshot table is mutated. NOTHING in the product tables is touched by this route.

         Requires auth.
=======================================================================================================================================
Request Payload: none (POST)

Success Response:
{
  "return_code": "SUCCESS",
  "date": "2026-09-21",               // the row that was written, AS THE DB DATED IT (not this process's idea of today)
  "summary": {                        // the figures as recorded — identical to what GET /portfolio-winners returns live
    "winner_count": 80, "winner_count_prior_year": 58,
    "joined_this_year": 38, "left_this_year": 16, "total_profit_12m": 52196.25
  },
  "contenders": {
    "young_styles": 99, "expected_winners": 20, "high_confidence_count": 14
  },
  "pruned": 0                         // rows removed for being older than 2 years
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { computeWinners, computeContenders } = require('../utils/portfolio');
const logger = require('../utils/logger');

router.use(verifyToken);

// NOTE: there is deliberately NO todayIso() helper here. The date this route reports is the one the DATABASE stamped, read back
// via RETURNING — see the warning below.
//
// ⚠ THE DB AND THIS PROCESS DISAGREE ABOUT WHAT DAY IT IS, FOR ONE HOUR A NIGHT THROUGH BST.
//   The Postgres session runs Etc/UTC while the box runs Europe/London, so between midnight BST and midnight UTC, CURRENT_DATE is
//   still yesterday while `new Date()` here has already rolled over. An earlier version of this route computed the date in JS and
//   echoed it: the response said 2026-09-22 while the row it had just written was keyed 2026-09-21. Harmless-looking, but the
//   screen then reports a reading under a date that does not exist in the table, and "latest reading" would name the wrong day.
//   CURRENT_DATE is the authority for this whole module (the 12-month windows and every age calculation key off it), so the row's
//   own date is the only honest answer. Never reintroduce a JS-side "today" here.

router.post('/', async (req, res) => {
  try {
    // 1) Compute both halves. The contender figures are stored alongside the headline because they are the LEADING half of the
    //    same story — high_confidence_count moving is what winner_count will do in six months — and three integers are cheap.
    //    Both are read-only and independent, so they run together.
    const [{ summary }, { summary: contenders }] = await Promise.all([computeWinners(), computeContenders()]);

    // 2) Upsert today's row + prune past the retention, atomically. Latest press of the day wins.
    const written = await withTransaction(async (client) => {
      const ins = await client.query(
        `INSERT INTO portfolio_snapshot
           (snapshot_date, winner_count, winner_count_prior_year, joined_this_year, left_this_year,
            total_profit_12m, young_styles, expected_winners, high_confidence_count, total_styles, created_at)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         ON CONFLICT (snapshot_date)
         DO UPDATE SET winner_count            = EXCLUDED.winner_count,
                       winner_count_prior_year = EXCLUDED.winner_count_prior_year,
                       joined_this_year        = EXCLUDED.joined_this_year,
                       left_this_year          = EXCLUDED.left_this_year,
                       total_profit_12m        = EXCLUDED.total_profit_12m,
                       young_styles            = EXCLUDED.young_styles,
                       expected_winners        = EXCLUDED.expected_winners,
                       high_confidence_count   = EXCLUDED.high_confidence_count,
                       total_styles            = EXCLUDED.total_styles,
                       created_at              = now()
         -- Report back the date the DB actually stamped, cast to text in SQL — never toISOString() a pg DATE.
         RETURNING to_char(snapshot_date, 'YYYY-MM-DD') AS date`,
        [
          summary.winner_count,
          summary.winner_count_prior_year,
          summary.joined_this_year,
          summary.left_this_year,
          summary.total_profit_12m,
          contenders.young_styles,
          contenders.expected_winners,
          contenders.high_confidence_count,
          // The denominator for the share, stored as it stands TODAY — see migrations/20260922b. Never backfilled.
          summary.total_styles,
        ]
      );

      const del = await client.query(
        `DELETE FROM portfolio_snapshot WHERE snapshot_date < CURRENT_DATE - INTERVAL '2 years'`
      );
      return { date: ins.rows[0].date, pruned: del.rowCount || 0 };
    });

    return res.json({ return_code: 'SUCCESS', date: written.date, summary, contenders, pruned: written.pruned });
  } catch (err) {
    logger.error('[portfolio-snapshot-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record portfolio snapshot' });
  }
});

module.exports = router;
