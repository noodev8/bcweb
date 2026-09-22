/*
=======================================================================================================================================
API Route: analytics_new_additions_trend
=======================================================================================================================================
Method: GET
Purpose: Analytics module — the PRODUCTION side of the New screen. Not "what is in the catalogue" (that is the list below it) but "how
         much new product did we make, and how fast are we making it" — month by month, this year against last, so the pace through the
         year is readable at a glance.

         Source: product_event_log, NOT skusummary.created_at. This distinction is the whole reason the table exists. product-delete
         HARD-deletes the skusummary row, so created_at can only ever count SURVIVORS — a style built in March and killed in June reads
         as though the work never happened. For a production read that is the wrong denominator: the killed line still cost an
         afternoon, and it is the most informative one. The log keeps the event after the product is gone.

         THE BACKFILL BOUNDARY (LOG_LIVE_FROM) is the honest caveat this route is obliged to carry. The log was installed on
         2026-09-22 and seeded from the catalogue as it stood that day, so every month BEFORE it is a FLOOR, not a true count —
         anything created and deleted before that date is unrecoverable. Months from that date on are true. The route returns the
         boundary so the chart can mark it rather than quietly presenting two different qualities of number as one series.

THE RULING WINDOW IS ROLLING 12 MONTHS, NOT THE CALENDAR YEAR (owner, 2026-09-22). The headline used to read "PRODUCTS MADE IN
2026" off the current year's total, which put the SAME METRIC on a different ruler from the Winners screen's "added" tile (rolling
12 months, utils/portfolio.js) — 122 on one screen against 132 on the other, both correct, never equal. That is precisely the drift
the winner-bar work of the same day existed to remove, and the owner had already settled the principle for Winners: "We dont want
calendar years. We said, we would use 12 month rolling?" A number meant to drive the work cannot reset to nothing every January.

         So `pace` is rolling and the HEADLINE renders from it. THE MONTHLY CHART STAYS CALENDAR — it is a pace-through-the-year
         view with a prior-year overlay, and months only mean anything against the same months last year. The two coexist honestly
         because they answer different questions; what must never happen again is the same QUESTION answered on two rulers.

         `pace` reads product_event_log with the SAME predicates as utils/portfolio.js, so the rolling figure here and the Winners
         screen's "added" tile are the same number by construction, not by coincidence. If you change one, change both.

         Grain: calendar month, bucketed on EUROPE/LONDON wall clock, not UTC. The pg session runs Etc/UTC while the box runs BST, so a
         product created at 00:30 BST on the 1st would otherwise fall into the previous month (see the same trap in CLAUDE.md's date
         landmines).

         The NEW vs COPY split (built from scratch vs cloned colourway — genuinely different units of work) is returned but is only
         populated from the boundary forward: backfilled rows carry source 'BACKFILL' because the catalogue does not record which way a
         style was born. Deletions are returned per month for the same window; they will read 0 until the first delete happens through
         the app. Requires auth.
=======================================================================================================================================
Request Query Params:
  years  optional integer >= 1 — how many calendar years to return, counting back from the current one (default 2). Clamp [1, 5].

Success Response:
{
  "return_code": "SUCCESS",
  "logLiveFrom": "2026-09-22",          // months before this are a floor, not a true count
  "throughMonth": 9,                    // last month with real elapsed time in the current year (1-12)
  "pace": {                             // THE HEADLINE FIGURES — rolling, never calendar. See THE RULING WINDOW below.
    "rolling12": 132,                   // created in the last 12 months
    "rollingPrior12": 45,               // the 12 months before that, so the delta is a like-for-like span
    "thisMonth": 17,                    // this calendar month so far (Europe/London)
    "monthlyAvg12": 11,                 // rolling12 / 12, rounded — what an ordinary month looks like
    "lastAdded": "2026-09-19",          // the most recent CREATED event, null if the log is empty
    "daysSinceLast": 3                  // CURRENT_DATE - lastAdded. THE PROMPT: it grows every quiet day
  },
  "years": [
    { "year": 2025, "total": 40,
      "months": [ { "month": 1, "created": 10, "new": 0, "copy": 0, "deleted": 0 }, ... ] },   // always 12 entries, zero-filled
    { "year": 2026, "total": 121, "months": [ ... ] }
  ]
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
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// The date product_event_log went live and was seeded from the catalogue. Before it: survivors only (a floor). From it: every creation,
// including ones later deleted. A named constant rather than a query param — it is a fact about the data, not a preference, and the
// chart is required to show it. If the log is ever re-seeded, this moves with it.
const LOG_LIVE_FROM = '2026-09-22';

// Default span. Two years is this business's useful history: the log's backfill only reaches 2022 and the older a backfilled year is,
// the more deletion-thinned it is, so a wide window would present its weakest numbers as though they were its best.
const DEFAULT_YEARS = 2;
const MAX_YEARS = 5;

router.get('/', async (req, res) => {
  try {
    const raw = parseInt(req.query.years, 10);
    const years = Number.isInteger(raw) && raw >= 1 ? Math.min(raw, MAX_YEARS) : DEFAULT_YEARS;

    // THE PACE FIGURES. A separate, tiny read rather than arithmetic over the monthly buckets above, because a ROLLING window does
    // not line up with calendar months: "the last 12 months" on 22 September is 23 Sep -> 22 Sep, which no sum of month buckets can
    // express. Same predicates as utils/portfolio.js (see the header) so this cannot drift from the Winners screen.
    //
    // Dates are cast to text IN SQL — never hand a pg DATE to toISOString(), which parses it as local midnight and shifts the day
    // back one through BST (CLAUDE.md's date landmine).
    const pacePromise = query(
      `
      SELECT COUNT(*) FILTER (WHERE event = 'CREATED'
               AND event_at >= CURRENT_DATE - INTERVAL '12 months')::int AS rolling12,
             COUNT(*) FILTER (WHERE event = 'CREATED'
               AND event_at >= CURRENT_DATE - INTERVAL '24 months'
               AND event_at <  CURRENT_DATE - INTERVAL '12 months')::int AS rolling_prior12,
             COUNT(*) FILTER (WHERE event = 'CREATED'
               AND (event_at AT TIME ZONE 'Europe/London')
                   >= date_trunc('month', now() AT TIME ZONE 'Europe/London'))::int AS this_month,
             to_char(MAX(event_at) FILTER (WHERE event = 'CREATED'), 'YYYY-MM-DD') AS last_added,
             (CURRENT_DATE - MAX(event_at) FILTER (WHERE event = 'CREATED')::date)::int AS days_since_last
        FROM product_event_log
      `
    );

    // One grouped pass over the log. AT TIME ZONE 'Europe/London' converts the stored timestamptz to UK wall clock BEFORE the year and
    // month are taken, so months bucket the way the operator experienced them.
    const result = await query(
      `
      SELECT EXTRACT(YEAR  FROM (event_at AT TIME ZONE 'Europe/London'))::int  AS yr,
             EXTRACT(MONTH FROM (event_at AT TIME ZONE 'Europe/London'))::int  AS mo,
             COUNT(*) FILTER (WHERE event = 'CREATED')                          AS created,
             COUNT(*) FILTER (WHERE event = 'CREATED' AND source = 'NEW')       AS created_new,
             COUNT(*) FILTER (WHERE event = 'CREATED' AND source = 'COPY')      AS created_copy,
             COUNT(*) FILTER (WHERE event = 'DELETED')                          AS deleted
        FROM product_event_log
       WHERE (event_at AT TIME ZONE 'Europe/London')
             >= date_trunc('year', (now() AT TIME ZONE 'Europe/London')) - make_interval(years => $1::int - 1)
       GROUP BY 1, 2
      `,
      [years]
    );

    // Awaited here rather than at its declaration so the two reads overlap on the wire.
    const paceRow = (await pacePromise).rows[0] || {};

    // Zero-fill to 12 months per year so the chart never has to reason about gaps — a month with no new product is a real 0 and must
    // plot as one, not as a missing point the line skips over.
    const thisYear = new Date().getFullYear();
    const firstYear = thisYear - (years - 1);
    const byYear = new Map();
    for (let y = firstYear; y <= thisYear; y++) {
      byYear.set(y, {
        year: y,
        total: 0,
        months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, created: 0, new: 0, copy: 0, deleted: 0 }))
      });
    }
    for (const r of result.rows) {
      const bucket = byYear.get(r.yr);
      if (!bucket) continue; // a row outside the requested window (shouldn't happen — the WHERE covers it)
      const m = bucket.months[r.mo - 1];
      m.created = Number(r.created);
      m.new = Number(r.created_new);
      m.copy = Number(r.created_copy);
      m.deleted = Number(r.deleted);
      bucket.total += m.created;
    }

    return res.json({
      return_code: 'SUCCESS',
      logLiveFrom: LOG_LIVE_FROM,
      // The current month counts as "through" — it is in progress, and the chart draws the current year's line only this far rather
      // than letting it flatline across the rest of a year that hasn't happened yet.
      throughMonth: new Date().getMonth() + 1,
      pace: {
        rolling12: Number(paceRow.rolling12) || 0,
        rollingPrior12: Number(paceRow.rolling_prior12) || 0,
        thisMonth: Number(paceRow.this_month) || 0,
        // What an ordinary month looks like, so "17 this month" has something to be judged against. Derived from rolling12 rather
        // than stored, so it can never disagree with the figure beside it.
        monthlyAvg12: Math.round((Number(paceRow.rolling12) || 0) / 12),
        // null, not a date, when nothing has ever been created — the screen shows a dash rather than inventing a day.
        lastAdded: paceRow.last_added || null,
        daysSinceLast: paceRow.days_since_last === null || paceRow.days_since_last === undefined
          ? null
          : Number(paceRow.days_since_last),
      },
      years: Array.from(byYear.values())
    });
  } catch (err) {
    logger.error('[analytics-new-additions-trend] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the additions trend' });
  }
});

module.exports = router;
