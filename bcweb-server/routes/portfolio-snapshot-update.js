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

         ⚠ THE BAR TRAVELS WITH THE ROW (since migrations/20260922d). `bar_metric` / `bar_value` record the ruler each count was
           taken with, and GET /portfolio-winners draws only the rows matching the ruler in force. This exists because the bar DID
           change on 2026-09-22 — from £200 PROFIT to £1,500 GROSS REVENUE (see WINNER_BAR in utils/portfolio.js) — and without
           the stamp the chart would have shown a step that looked like the business moved when only the definition did. Rows are
           never rewritten or deleted when a bar changes: a snapshot is what we said on the day, and old rows stay true.

           THIS IS WHY THE SCREEN'S BAR TOGGLE CANNOT REACH THIS ROUTE. The Winners screen can read the count at £300, £500 or
           £1,000 (GET /portfolio-winners returns summary.bars), but what gets RECORDED is always summary.winner_count, which is
           the tracked £200 bar — computeWinners() spreads bars[0] onto summary precisely so that this INSERT cannot accidentally
           follow the display. Do not "helpfully" add a bar parameter to this POST: one series, one ruler, or the trend is a lie.

         Growth safeguard (why this is bounded):
           - snapshot_date is the PK and we UPSERT it, so repeated presses in one day OVERWRITE today's row, never append.
           - The prune removes rows older than 2 years in the same transaction. Max size ~730 rows, permanently.

         Wrapped in withTransaction (upsert + prune as one unit), matching the module's sibling snapshot writers. The compute itself
         is a read.

         ⚠ SINCE 2026-09-24 THIS PRESS ALSO RE-TAGS EVERY STYLE — skusummary.portfolio_status (WINNERS | STEADY | NEW | HARVEST |
           LOSERS; the rules are in utils/portfolioStatus.js). The owner asked for one button, not two: "when pressed, the latest
           tag is set". It runs in the SAME transaction as the snapshot, so a failed press leaves neither the trend point nor the
           tags half written. It writes only portfolio_status / _at / _revenue_12m / _units_12m — no legacy `updated` stamp, no
           shopifychange — and that is the ONLY write this route makes to a product table. It also upserts today's row in
           portfolio_status_snapshot (the five counts), which is what the screen's status graph draws.

           The old portfolio_snapshot row is STILL written (no screen draws it since 2026-09-24, when the Winners screen moved to
           the stored tags). Kept so that series does not gain a hole if it is ever wanted back; it costs one query.

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
  "pruned": 0,                        // rows removed for being older than 2 years
  "status": {                         // the tags just written to skusummary.portfolio_status, counted
    "counts": { "WINNERS": 73, "STEADY": 175, "NEW": 22, "HARVEST": 15, "LOSERS": 20 },
    "total": 305
  }
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
const { computeWinners, computeContenders, WINNER_METRIC, WINNER_BAR } = require('../utils/portfolio');
const { applyPortfolioStatus, recordStatusSnapshot } = require('../utils/portfolioStatus');
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
            total_profit_12m, young_styles, expected_winners, high_confidence_count, total_styles,
            bar_metric, bar_value, created_at)
         VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
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
                       bar_metric              = EXCLUDED.bar_metric,
                       bar_value               = EXCLUDED.bar_value,
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
          // THE RULER. Constants, not anything the request can influence — the screen's toggle must never reach this row.
          WINNER_METRIC,
          WINNER_BAR,
        ]
      );

      const del = await client.query(
        `DELETE FROM portfolio_snapshot WHERE snapshot_date < CURRENT_DATE - INTERVAL '2 years'`
      );

      // 3) Re-tag every style's portfolio status, in the same transaction — see the header — and record the five counts as
      //    today's point on the status trend (portfolio_status_snapshot), so the graph is exactly what was just tagged.
      const status = await applyPortfolioStatus(client);
      await recordStatusSnapshot(client, status);

      return { date: ins.rows[0].date, pruned: del.rowCount || 0, status };
    });

    return res.json({
      return_code: 'SUCCESS', date: written.date, summary, contenders, pruned: written.pruned, status: written.status,
    });
  } catch (err) {
    logger.error('[portfolio-snapshot-update] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record portfolio snapshot' });
  }
});

module.exports = router;
