/*
=======================================================================================================================================
API Route: analytics_ad_daily
=======================================================================================================================================
Method: GET
Purpose: Reports — one row per day: what Google spent, what Shopify sold. A short series, with one total across it.

         Requires auth. Read-only.

WHY THIS EXISTS: A DECISION TAKES DAYS TO SHOW AND A MONTH TO CONFIRM
This replaced Ad Payback on 2026-09-10. Nothing on the platform could answer "since I changed the budget, is the whole operation
keeping money?" at book level:
  - routes/analytics-ad-efficiency.js is monthly. August is ONE row at 8% kept. It cannot show that a change of course on 31 Aug
    worked, and would not show it until October.
  - routes/google-ads-styles.js has a d7 window, but it is per STYLE and never totals the book. It answers "which styles", not
    "is this working".
The gap between them is the day, at book level. The owner's own fortnight makes the case: 24-30 Aug ran £100+/day and kept
-£98/-£16/+£26/-£11/+£50/+£5/-£32; from 1 Sep spend fell to £18-£50/day and kept money almost every day, on the same stock and the
same styles. Six days to become visible here; three more weeks to become visible anywhere else.

WHAT WAS CUT FROM AD PAYBACK, AND WHY (owner, 2026-09-10)
Ad Payback listed the styles that sold on one chosen day, each with a trailing 30-day Google verdict beside it. It was presented to
staff and could not be explained, for a reason worth recording: EVERY OTHER LIST ON THIS PLATFORM HAS A MEMBERSHIP RULE THAT IS THE
JOB (WINNERS = price up, LOSERS = price down, TO PLACE = go and buy it, and the tab count is the queue). "Styles that happened to
sell yesterday" is not a job, so there was nothing to tell anyone to do about it.

Three things went, each for its own reason:
  1. THE PER-STYLE ROWS. Per-style ad work belongs on the Google Ads screen, which already has the windows, the thin-shelf flag and
     a list that can be cleared. This screen is the book, not the styles.
  2. THE TRAILING 30-DAY COLUMNS. They were the reason the screen mixed two time periods on one row, which is what confused the
     staff, and kept30 was already available per style on the Google Ads grid at d30.
  3. THE DAY PICKER. See the noise note below — a picker invites reading one row as a verdict, which is the one thing a row cannot
     carry.

`kept` IS ON THE ROW, BUT IT IS THE OWNER'S COLUMN AND IT COMES WITH TWO RULES (owner, 2026-09-10)
It was cut first and put back on the owner's call — "Kept is what I'll be interested in" — after the noise below was measured and
shown to them. It is on the row because the owner is the only reader of this screen and now knows what the column does; it would NOT
be safe on a screen staff read, which is the same distinction that got Ad Payback deleted.

The two rules exist because the measurement below is real and does not go away just because the column is wanted:
  1. A ROW'S KEPT IS NOT COLOURED. Profit was; kept is not. A red day here would be read as a bad day, and most red days are not bad
     days — they are quiet days. Colour is a verdict, and only the total earns one.
  2. A DAY WITH NO ADS STILL SHOWS ITS NUMBER. This was briefly built the other way — a dash, on the argument that "kept from
     advertising" is undefined with no advertising — and the owner overruled it the same day, correctly. Kept is profit minus ad
     spend; on a day with no ad spend we kept all of it, and £37.51 is a true statement about that day.
     The dash also introduced a real defect: the column stopped adding up to its own total. Total Kept counts every day, so hiding
     two of them left the visible rows summing to £343.99 against a headline of £431.48 — and a column that does not reconcile
     with the figure above it is the fastest way to lose a reader's trust in both.
     The "sorts to the top" worry behind the dash was wrong on its own terms as well: the list is DATE-ordered, so a paused day
     sits at the top because it is recent, not because its figure is large, and it moves down as days pass. The context a reader
     needs is already on the row — £0.00 in the spend cell and the "no ads" chip beside the date.

THE NOISE IS REAL AND THE FOOTER STATES IT
Spend and sales are different kinds of number and only one of them is smooth. Spend accrues over thousands of impressions and
hundreds of clicks, so it barely wobbles; units are a small integer count — 6.7/day on average over the fortnight to 6 Sep 2026,
ranging 0 to 13. Subtracting one from the other at day grain produces a figure dominated by the randomness of the sales side: over
that fortnight the daily kept swung -£98 to +£103 on a business that netted £286 for the whole period. One day's "verdict" is a
third of the fortnight's result in either direction, in both directions, at random.

Sundays make it worse and not randomly: 30 Aug 2026 drew the second-highest impressions of the fortnight and sold 3 units, because
Sunday is a browsing day and the buying lands midweek.

Measured on the fortnight to 9 Sep 2026: Thu 03 Sep kept £2.17 and Fri 04 Sep kept £102.53 on comparable spend, and Sun 30 Aug
(-£32.70) sits beside Mon 31 Aug (+£82.58) on identical advertising. Neither pair is a change in performance; both are the sales
count moving. So the row is a FACT to be scanned for shape, and the TOTAL is the only figure that carries a verdict — which is why
the total is the one that is sized and coloured like an answer.

WHY THERE IS NO THIN-SIZES COLUMN, THOUGH THE LEAK IS REAL (owner, 2026-09-10)
It was measured and it is large — over 24 Aug to 6 Sep 2026, £449 of £947 (47%) of all Google spend went to styles with fewer than
5 buyable sizes, and £394 went to 123 styles that sold nothing at all in the fortnight. It is not here anyway, for two reasons:
  1. The owner works thin styles on the Google Ads screen, which already flags them per style. A second place to read the same
     thing is a second place to disagree.
  2. IT CANNOT HONESTLY SIT ON A HISTORIC ROW. Shelf depth is a fact about NOW — per-style stock history is not kept anywhere
     (google_stock_track is whole-book: 334 daily rows, no groupid). Top up sizes next week and every past row's thin figure would
     silently rewrite itself, which is the same category error as the 1-day/30-day mix wearing a different hat: a column meaning a
     different period from its neighbours. Making it honest needs a per-style daily size snapshot, which was costed (~284 rows/day)
     and deliberately NOT built, because with the thin work living on the Google Ads screen it has no consumer.
If that snapshot is ever built, note it only works FORWARDS — nothing before it starts can be reconstructed.

DEAD SPEND IS A WINDOW FIGURE AND MUST NEVER BECOME A COLUMN (measured 2026-09-10, after the owner pushed back — rightly)
`deadSpend` is what went to styles that sold NOTHING across the whole window. The owner asked for it per day; it was measured at
both grains and it only survives one.

  AT DAY GRAIN IT IS THE SPEND COLUMN DRAWN TWICE. Correlation between a day's total spend and its spend-on-non-sellers, over the
  fortnight to 6 Sep 2026: r = 0.988. It cannot separate a bad day from an expensive one, and the counter-example is decisive —
  30 Aug carried £70.53 of it and LOST £32.70, while 24 Aug carried MORE (£99.85) and KEPT £20.57. It is also structurally pinned
  high (77-98% every day): ~280 styles advertise and 3-13 units sell, so nearly every style "sold nothing today" on nearly every
  day. That is the same 95%-noise trap that killed Ad Payback's one-day grid.

  AT WINDOW GRAIN IT IS ONE OF THE STRONGEST SIGNALS ON THE PLATFORM. Rolling 14-day windows back through the 2026 season, share of
  spend on styles that sold nothing in the window: 7% (to 28 Jun), 8% (12 Jul), 18% (26 Jul), 26% (9 Aug), 23% (23 Aug), 36%
  (6 Sep). Spend fell to a third over that stretch while the dead share QUINTUPLED. Nothing else on the platform shows that.

  THE % IS ONLY COMPARABLE AT A FIXED WINDOW LENGTH. It rises mechanically as the window shrinks (a 2-day window is nearly all
  "dead" because almost nothing sells in two days) and falls as it grows. Compare 14d against 14d, never 7d against 30d. The client
  shows the CASH figure for that reason — cash at least means the same thing at every length — with the styles count beside it.

COST PER SALE IS THE COLUMN THAT SAYS *WHY* A DAY WAS BAD (added 2026-09-10, owner)
Kept says a day lost money; it does not say whether that was a quiet day or an expensive one. Cost per sale does, and the spread is
wide enough to read at a glance — over the fortnight to 6 Sep 2026 an ordinary day ran £3.70 to £6.90 and Sunday 30 Aug ran £24.03
(197 clicks, 3 sales, £72.09). It is spend / units, both of which are already on the row; it earns a column anyway because nobody
divides £72.09 by 3 while scanning a list, and that division IS the finding.

`clicks` sits beside it to separate the two causes a high cost per sale can have: no traffic at all, or plenty of traffic that did
not convert. 3 Sep 2026 spent only £18.66 and still cost £9.33 a sale, because 74 clicks produced 2 orders — a conversion problem on
a small budget, which reads identically to a quiet day without the clicks column.

WHAT WAS MEASURED AND REJECTED FOR THIS JOB: "share of spend on styles that sold nothing that day". It is the figure that made
30 Aug legible in conversation (£70.53 of £72.09), and it is useless as a COLUMN because it is always high — 77% to 98% across every
day of that fortnight, with a perfectly ordinary 3 Sep at 95%. A column whose range is 77-98% cannot separate a good day from a bad
one. It is also structurally guaranteed: ~280 styles are advertised and 3-13 units sell, so almost every style "sold nothing today"
on almost every day. That is the same 95%-noise trap that killed Ad Payback's one-day grid, and it is per-STYLE work in any case —
the Google Ads screen's job, not this one's.

THE SERIES IS ANCHORED TO `asOf`, NOT TO TODAY
`asOf` = the newest COMPLETE day of ad data (MAX(snapshot_date) among rows captured after that day had ended) — the same definition
and the same SQL as routes/google-ads-styles.js and routes/analytics-ad-payback.js before it, so no two screens can disagree about
which days they are describing. The series runs [asOf - (days-1), asOf].

Running it to CURRENT_DATE instead would put one to three days at the top of the list carrying sales with no spend beside them —
every one of which would read as a spectacular day and none of which would be one. That is the exact distortion the anchor exists
to prevent, and on a list sorted newest-first it would sit where the eye lands first.

A ZERO-SPEND DAY IS FLAGGED, NOT SILENTLY AVERAGED (added 2026-09-10, from a live incident)
The owner switched Google off from 7 Sep 2026 while re-planning. Those days are COMPLETE by the asOf test — rows exist, imported the
following day — but hold zero impressions and zero cost. Both `google_product_daily` and `google_campaign_daily` agree independently,
so it is real and not a truncated import.

A day with no advertising is not a day where advertising was free, and the difference is invisible in a spend column: both read
£0.00. Left unflagged, a deliberate pause silently flatters every total that spans it — and the longer the pause runs, the better the
numbers look. `adsRan` (impressions > 0, not cost > 0 — a day can draw impressions and no billable click) lets the client mark those
rows and say how many of the period's days actually carried advertising. Read the totals against `daysWithAds`, not `days`.

SHOPIFY ONLY, GOOGLE ONLY — `channel = 'SHP'`, spend from `google_product_daily`, matching google-ads-styles and ad-efficiency so all
three report the same money. Google Shopping points at brookfieldcomfort.com, so Shopify is the revenue these ads can plausibly have
caused. `profit` is `sales.profit`, the NET per-unit figure after payment fee, packing, postage and the returns haircut
(utils/shopifyProfit.js) — NOT a gross margin, because subtracting ad spend from a gross margin produces a number that looks like
profit and is not.

RETURNS ARE EXCLUDED (`qty > 0`) — owner, 2026-09-10. THIS IS THE ONE PLACE THIS ROUTE DISAGREES WITH analytics-sales
The screen first ran net of returns, the way Sales does, and it was wrong here for three separate reasons. Any one of them would
have been enough; together they are decisive.

  1. A REFUND IS CHARGED TO THE WRONG DAY. It lands on `solddate` = the day it came BACK, weeks after the sale it reverses, so it
     has no relationship whatever to the advertising that ran that day. Measured on 7 Sep 2026: the screen showed -2 sold and
     -£31.00 kept; that Monday actually sold 3 units and kept £38.43, and the difference was five refunds for goods sold weeks
     earlier. 1 Sep read 4 sold / £33.96 against a true 9 sold / £64.16. On a screen whose only job is judging a day's advertising,
     that is not conservatism — it is a figure pointed at the wrong day.
  2. THEY ARE ALREADY COUNTED ONCE. utils/shopifyProfit.js takes a flat /1.2 "cover refunds" haircut off EVERY sale, so
     `sales.profit` is already net of expected returns; adding the reversal rows on top charges them twice. That util's own header
     documents this (measured 2026-09-08: 543 SHP reversals worth -£5,269 over a year against ~£7,826 suppressed by the haircut)
     and states that any consumer summing every row reads LOW. This route was such a consumer.
  3. THEY ARRIVE IN CLUMPS. Over the fortnight to 9 Sep 2026: zero returns on 8 of the 14 days, then 5 in a single day. That is a
     refund-processing rhythm, not a business signal, and at day grain it swamps the thing being measured.
Scale over that fortnight: Kept £589.42 excluding returns against £431.48 including them — £158, nearly all of it on three days.

WHAT THIS COSTS, AND IT MUST STAY VISIBLE: Ad Daily NO LONGER RECONCILES WITH Analytics > Sales, which includes returns and should.
They now answer different questions and will differ by exactly the refunds that landed in the window. The client footnotes it; do
not "fix" the divergence by putting returns back without re-reading the three reasons above.

There is precedent and this is not a lone exception: routes/birk-stock.js (Kept) and the pricing WINNERS / LOSERS bars already
filter qty > 0, and utils/shopifyProfit.js names them as the consumers that see the haircut alone and are internally consistent
because of it. This route now joins them.

Revenue is still SUM(soldprice * qty) and profit still SUM(profit) — the expressions are unchanged, only the row filter moved.
soldprice is stored POSITIVE on a return row and is PER UNIT, so a bare SUM(soldprice) would both add refunds to takings and
under-count multi-unit lines; with qty > 0 the multiplication now only matters for the second. Profit is summed raw, which
under-counts the 37 multi-unit lines in the table's history (£61 across the last year) — left alone deliberately. If it is ever
fixed it must be fixed in analytics-sales too, as SUM(profit * ABS(qty)).
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional, default 14, min 2, max 90 — how many days back, ending at the last COMPLETE day of ad data

Success Response:
{
  "return_code": "SUCCESS",
  "from": "2026-08-24",              // the series, inclusive
  "to": "2026-09-06",               // = asOf, the newest complete day of ad data
  "adDaysOld": 4,                   // CURRENT_DATE - to. How far behind today the series necessarily ends. 0 = up to date
  "totals": {
    "days": 14,
    "daysWithAds": 14,              // days that actually drew impressions — read the totals against THIS, not `days`
    "spend": 947.12,
    "units": 94,
    "revenue": 6450.83,
    "profit": 1233.41,
    "kept": 286.29,                 // profit - spend. The verdict, at the only grain that supports one
    "spendOnSellers": 158.42,       // the window's daily splits, summed
    "spendOnNonSellers": 788.70
  },
  "rows": [                         // NEWEST FIRST — the recent days are the ones being judged
    {
      "day": "2026-09-06",
      "label": "Sun 06 Sep",
      "spend": 49.63,
      "clicks": 129,
      "spendOnSellers": 9.30,       // of that day's spend, what went to styles that sold THAT DAY
      "spendOnNonSellers": 40.33,   // and what went to styles that did not. The two sum to `spend`
      "pctOnSellers": 19,           // the share that reached a style which sold that day — what the screen renders. NULL when
                                    // nothing was spent. 100% is structurally unreachable; see the note in the mapper.
      "stylesSold": 8,              // how many charged styles sold that day
      "stylesCharged": 203,         // how many styles drew any cost that day
      "units": 8,
      "costPerSale": 6.20,          // spend / units. NULL when nothing sold — undefined, not zero                   // units SOLD — returns are excluded entirely, not netted off
      "revenue": 572.01,
      "profit": 108.75,             // BEFORE ad spend — net of fees/postage/returns only
      "kept": 59.12,                // profit - spend. On a no-ads day this equals profit, which is correct — see rule 2
      "adsRan": true                // false = no impressions at all. Not a day where advertising was free
    }
  ]
}
  - Every day in [from, to] returns a row, including days with no sales and no spend. A gap in the series would be read as "nothing
    happened" when it means "nothing was recorded", and those are different.
  - If there is no complete ad day at all, `to` falls back to yesterday and every `spend` is 0 with `adsRan` false. The series still
    shows what sold.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"INVALID_DAYS"
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

// A fortnight. Long enough that the total means something (94 units over the fortnight to 6 Sep 2026) and short enough to read
// without scrolling — the screen is a series to be taken in at a glance, not a ledger to be searched.
const DEFAULT_DAYS = 14;
const MIN_DAYS = 2;    // one row cannot be a series, and the total would just restate it
const MAX_DAYS = 90;   // a season. Past this, use Ad Efficiency — a monthly series is the right shape for a longer question

const round2 = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

router.get('/', async (req, res) => {
  try {
    // ---- How many days ------------------------------------------------------------------------------------------------------
    const days = req.query.days === undefined ? DEFAULT_DAYS : Number(req.query.days);
    if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
      return res.json({
        return_code: 'INVALID_DAYS',
        message: `days must be a whole number between ${MIN_DAYS} and ${MAX_DAYS}`,
      });
    }

    // ---- The series ---------------------------------------------------------------------------------------------------------
    // One pass. `bounds` fixes the two dates every other CTE reads, so the spend half and the sales half cannot end on different
    // days — the fault that made every window on the Google Ads screen read high before it was anchored (see that route's header).
    const result = await query(`
      WITH bounds AS (
        SELECT b.to_day, b.to_day - $1::int + 1 AS from_day
        FROM (
          SELECT COALESCE((
            -- The newest COMPLETE day: we hold a row for it captured on a LATER calendar day, i.e. the day had ended before it was
            -- downloaded. The newest row in an import is normally a PART day (a report pulled at 14:38 covers that day to 14:38),
            -- and anchoring to it would set a whole day of sales against a few hours of cost.
            -- Europe/London, not UTC — "had the day finished when we pulled it" is a wall-clock question, and a 00:30 BST import is
            -- the previous evening's work.
            SELECT MAX(snapshot_date) FROM google_product_daily
            WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
          ), CURRENT_DATE - 1) AS to_day
        ) b
      ),
      days AS (
        -- Every date in the range, so a day with no sales and no spend still returns a row. LEFT JOINing onto a generated series
        -- rather than onto the data is what makes "nothing happened" distinguishable from "nothing was recorded".
        SELECT generate_series(b.from_day, b.to_day, INTERVAL '1 day')::date AS d FROM bounds b
      ),
      spend AS (
        -- The day's spend, split by whether THAT STYLE sold on THAT DAY (owner confirmed all three rules, 2026-09-10:
        -- same-day only; returns excluded (qty > 0); only styles actually charged that day are counted).
        --
        -- SAME-DAY IS THE ASSUMPTION THAT CARRIES THE MOST WEIGHT and it is deliberately simple: a click on Sunday that converts on
        -- Tuesday counts as non-selling spend on Sunday and selling spend on Tuesday. Google does not tell us which click caused
        -- which order, so any other rule would be invented rather than measured.
        --
        -- The inner aggregate is per style per day, because the split is a property of the STYLE and the SUM must happen after the
        -- classification, not before it.
        SELECT g.d,
               SUM(g.cost)                                          AS cost,
               SUM(g.clicks)                                        AS clicks,
               SUM(g.impressions)                                   AS impressions,
               SUM(g.cost) FILTER (WHERE sl.groupid IS NOT NULL)    AS cost_on_sellers,
               SUM(g.cost) FILTER (WHERE sl.groupid IS NULL)        AS cost_on_nonsellers,
               COUNT(*) FILTER (WHERE sl.groupid IS NOT NULL)::int  AS styles_sold,
               COUNT(*)::int                                        AS styles_charged
        FROM (
          SELECT g2.snapshot_date AS d, g2.groupid,
                 SUM(g2.cost) AS cost, SUM(g2.clicks) AS clicks, SUM(g2.impressions) AS impressions
          FROM google_product_daily g2 CROSS JOIN bounds b
          WHERE g2.snapshot_date BETWEEN b.from_day AND b.to_day
          GROUP BY g2.snapshot_date, g2.groupid
        ) g
        LEFT JOIN (
          SELECT s2.solddate AS d, s2.groupid
          FROM sales s2 CROSS JOIN bounds b2
          WHERE s2.channel = 'SHP' AND s2.qty > 0 AND s2.solddate BETWEEN b2.from_day AND b2.to_day
          GROUP BY s2.solddate, s2.groupid
        ) sl ON sl.groupid = g.groupid AND sl.d = g.d
        GROUP BY g.d
      ),
      sold AS (
        SELECT s.solddate AS d,
               SUM(s.qty)               AS units,
               SUM(s.soldprice * s.qty) AS revenue,
               SUM(s.profit)            AS profit
        FROM sales s CROSS JOIN bounds b
        -- qty > 0 EXCLUDES RETURNS. This is the one place this route knowingly disagrees with analytics-sales — see the header.
        WHERE s.channel = 'SHP' AND s.qty > 0 AND s.solddate BETWEEN b.from_day AND b.to_day
        GROUP BY s.solddate
      )
      SELECT
        to_char(days.d, 'YYYY-MM-DD')        AS day,
        to_char(days.d, 'Dy DD Mon')         AS label,
        COALESCE(sp.cost, 0)                 AS spend,
        COALESCE(sp.clicks, 0)               AS clicks,
        COALESCE(sp.cost_on_sellers, 0)      AS spend_on_sellers,
        COALESCE(sp.cost_on_nonsellers, 0)   AS spend_on_nonsellers,
        COALESCE(sp.styles_sold, 0)          AS styles_sold,
        COALESCE(sp.styles_charged, 0)       AS styles_charged,
        COALESCE(sl.units, 0)                AS units,
        COALESCE(sl.revenue, 0)              AS revenue,
        COALESCE(sl.profit, 0)              AS profit,
        -- impressions, NOT cost: a day can serve impressions and take no billable click, and that day DID advertise.
        (COALESCE(sp.impressions, 0) > 0)    AS ads_ran,
        to_char((SELECT from_day FROM bounds), 'YYYY-MM-DD') AS from_day,
        to_char((SELECT to_day FROM bounds), 'YYYY-MM-DD')   AS to_day,
        (CURRENT_DATE - (SELECT to_day FROM bounds))         AS ad_days_old
      FROM days
      LEFT JOIN spend sp ON sp.d = days.d
      LEFT JOIN sold  sl ON sl.d = days.d
      ORDER BY days.d DESC
    `, [days]);

    // The range reaches the client even on a period with no data at all, because `days` is generated and therefore never empty.
    const head = result.rows[0];

    const rows = result.rows.map((r) => ({
      day: r.day,
      label: r.label,
      spend: round2(r.spend) ?? 0,
      clicks: Number(r.clicks),
      // The two halves are rounded independently and therefore may each be a penny off their own share, but they are summed from
      // the same source as `spend` and reconcile with it to the penny in the data (verified across the fortnight to 6 Sep 2026).
      spendOnSellers: round2(r.spend_on_sellers) ?? 0,
      spendOnNonSellers: round2(r.spend_on_nonsellers) ?? 0,
      // THE SHARE, NOT THE CASH, IS WHAT THE SCREEN RENDERS — measured 2026-09-10 over the 28 advertising days to 9 Sep:
      //   cash on non-sellers vs the day's Kept : r = -0.020  (no relationship whatever)
      //   SHARE            vs the day's Kept    : r = -0.479  (a real one)
      // The cash figure is 0.972 correlated with total spend, i.e. it is the Ad spend column drawn again, and it ranks days
      // BACKWARDS: 30 Aug carried £70.53 and lost £32.70 while 24 Aug carried £99.85 and kept £20.57. The share is scale-free and
      // separates them. Both cash halves are still returned for anyone who wants them.
      //
      // STATED POSITIVELY (owner, 2026-09-10): the share that DID reach a style which sold that day — "my target is 100% and I
      // want to see it grow". Computed from spendOnSellers directly rather than as 100 - the other share, so it cannot round to
      // 101 or 99 against its own cash figure.
      //
      // !! 100% IS NOT REACHABLE AND THE NUMBER SHOULD NOT BE READ AS A PERCENTAGE OF A REACHABLE TARGET. ~200 styles draw spend
      // on a normal day and 3-13 of them sell, so most of the book cannot sell on any given day whatever is done. Measured ceiling
      // over the 30 days to 9 Sep 2026: best day 41%, median 19%. What moves it is CONCENTRATION — fewer styles carrying the
      // spend — which is exactly the lever the 2026-09 re-plan is pulling, so it is a fair thing to track. Just not to 100.
      pctOnSellers: Number(r.spend) > 0
        ? Math.round((100 * Number(r.spend_on_sellers)) / Number(r.spend))
        : null,
      stylesSold: Number(r.styles_sold),
      stylesCharged: Number(r.styles_charged),
      units: Number(r.units),
      // What one sale cost in advertising. Derivable from the two cells beside it, but £72.09 / 3 is not arithmetic anyone does
      // while scanning, and this is the number that separates a quiet day from a bad one: over the fortnight to 6 Sep 2026 a good
      // day ran £3.70-£6.90 and 30 Aug ran £24.03. NULL when nothing sold — the true value is undefined, not zero, and a day that
      // spent £18 for no sale must not read as the cheapest day on the screen.
      costPerSale: Number(r.units) > 0 ? round2(Number(r.spend) / Number(r.units)) : null,
      revenue: round2(r.revenue) ?? 0,
      profit: round2(r.profit) ?? 0,
      // Always computed, including on days that carried no advertising: with nothing spent we kept all of it, and the total
      // counts those days too — so suppressing them would stop the column adding up to its own headline (rule 2).
      kept: round2(Number(r.profit) - Number(r.spend)),
      adsRan: Boolean(r.ads_ran),
    }));

    // Summed from the rounded rows so the total is exactly what the column adds up to. A total computed independently in SQL can
    // differ from its own column by a penny or two, and a figure that does not add up is a figure nobody trusts again.
    const totals = rows.reduce(
      (a, r) => ({
        days: a.days + 1,
        daysWithAds: a.daysWithAds + (r.adsRan ? 1 : 0),
        spend: round2(a.spend + r.spend),
        clicks: a.clicks + r.clicks,
        spendOnSellers: round2(a.spendOnSellers + r.spendOnSellers),
        spendOnNonSellers: round2(a.spendOnNonSellers + r.spendOnNonSellers),
        units: a.units + r.units,
        revenue: round2(a.revenue + r.revenue),
        profit: round2(a.profit + r.profit),
      }),
      { days: 0, daysWithAds: 0, spend: 0, clicks: 0, spendOnSellers: 0, spendOnNonSellers: 0, units: 0, revenue: 0, profit: 0 }
    );

    return res.json({
      return_code: 'SUCCESS',
      from: head.from_day,
      to: head.to_day,
      adDaysOld: Number(head.ad_days_old),
      totals: {
        ...totals,
        kept: round2(totals.profit - totals.spend),
        pctOnSellers: totals.spend > 0 ? Math.round((100 * totals.spendOnSellers) / totals.spend) : null,
        costPerSale: totals.units > 0 ? round2(totals.spend / totals.units) : null,
      },
      rows,
    });
  } catch (error) {
    logger.error('analytics-ad-daily failed', error);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not build the daily ad series' });
  }
});

module.exports = router;
