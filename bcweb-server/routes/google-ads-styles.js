/*
=======================================================================================================================================
API Route: google_ads_styles
=======================================================================================================================================
Method: GET
Purpose: Google Ads module — the whole payload. Every sellable style once, with its campaign bucket, what we hold, what it sold, and
         what Google spent on it, across five windows. The screen renders the list and then filters, sorts and switches window
         CLIENT-SIDE with no round-trip.

         Requires auth. Read-only.

WHY THE WHOLE LIST SHIPS AT ONCE, AND ALL FIVE WINDOWS WITH IT
~284 styles. Same call shape as inv-styles and birk-stock: one fetch, then every Contains / Does-not-contain narrowing happens in the
browser. The five windows ship TOGETHER, pre-aggregated, for the same reason birk-stock ships live and incoming separately — the
window switch has to be instant, and a refetch per window would make the screen feel like a report instead of a tool.

A window is cheap here and that is not an accident: each one is a set of FILTER clauses on a pass the query is already making, so
the marginal cost of the fifth was one more test applied to rows already being read. What is NOT cheap is an arbitrary date range,
which cannot be pre-aggregated and would put a round-trip on the switch — that is a different feature and would have to say so.

THE WINDOWS (docs/google-ads-spec.md §3)
  d7    last 7 days    — the week just gone. Added 2026-09-06 (owner). A pause or a bucket move takes a day to reach Google and a few
        more to show, so on d30 the effect of last week's decision is one quarter of a window three-quarters made of the decision it
        replaced. d7 is where "did that work" is answerable. It is also the noisiest window on the screen — see below.
  d30   last 30 days   — what is happening now; the working window
  d90   last 90 days   — the season; damps the noise on a style selling two a month
  d365  last 365 days  — the year, for a style that only sells in one of them
  ly30  the SAME 30 days one year ago — the winter comparison the whole module exists for. "Zermatt did X last November" is not
        answerable from any other window, and it is the question the owner is actually asking.

WHAT d7 COSTS, AND WHAT IT DOES NOT
It does NOT drag in Google's revision lag, which is the failure a seven-day ad window usually has. Google keeps revising
`conversions` / `conv_value` upward for weeks, so a week just gone reads badly low on both — but neither reaches this screen's grid.
Every figure it renders is either OURS (units, revenue, profit, from `sales`, final the moment the order lands) or Google's `cost`,
which is also final. The two revised fields are still returned as evidence and are still only drawn in the drill, over its own
180-day window, where the lag is immaterial.

What d7 does cost is sample size. A style selling two a month reads 0 units across most weeks, so on d7 the LOSERS end of the list
fills with styles that are simply between sales. That is the window working, not a fault, and it is why d30 remains the default and
why d90 exists at all.

EVERY WINDOW IS ANCHORED TO `asOf`, NOT TO TODAY (2026-09-06)
This is the fix for a distortion that had been in the route since it shipped and that d7 made four times worse.

    asOf   = the newest COMPLETE day of ad data — MAX(snapshot_date) among rows captured AFTER that day had ended
    window = solddate / snapshot_date BETWEEN asOf - (N - 1) AND asOf     -- inclusive, exactly N days, BOTH sides

Two faults, one anchor:

  1. THE TWO SIDES USED TO END ON DIFFERENT DAYS. Sales land in `sales` as they happen, so today was always in the sales half of the
     window; the Google report only ever covers completed days, so today was never in the ad half. Every window therefore set N days
     of sales against N-minus-something days of cost, and Kept came out high by exactly the gap. The gap is not a fixed day, either:
     imports are manual and may be weekly or quarterly (see GoogleAdsImport), and google_campaign_daily has already silently lost 22
     days once. With a five-day-old import, d7 was showing seven days of sales against two days of spend — Kept roughly tripled, and
     nothing on the screen said so. Anchoring both sides to the last day BOTH can speak for makes that structurally impossible.

  2. EVERY WINDOW WAS ONE DAY TOO LONG. `solddate >= CURRENT_DATE - 7` spans EIGHT dates, not seven (day -7 through day 0). d30 was 31
     days, d365 was 366, ly30 was 31. Tolerable while nothing was compared against anything; fatal the moment two adjacent periods
     are put side by side, because they would share a day and count it twice. BETWEEN asOf - (N-1) AND asOf is exactly N.

  3. THE NEWEST DAY IN THE TABLE IS USUALLY A PART DAY, so it is not eligible to be the anchor. A report downloaded at 14:38 contains
     that same day, ending at 14:38 — the backfill of 2026-09-05 carried £10.92 of cost against a £40-a-day run rate, because the day
     was not over. Anchoring to MAX(snapshot_date) would therefore have set a whole Saturday of sales against six hours of Saturday
     ad cost: the same fault as (1), smaller. A day is COMPLETE only if we hold a row for it captured on a LATER calendar day, which
     is exactly what the WHERE clause in the asof CTE tests. Nothing new is stored to make that work — imported_at is refreshed on
     every upsert (utils/googleAdsImport.js), so a part day re-imported later becomes eligible on its own, with no repair step.

     Europe/London, not UTC: "had the day finished when we pulled it" is a wall-clock question, and a 00:30 BST import is the
     previous evening's work.

WHAT ANCHORING COSTS: today's trading is off the screen, and so is any part of a day already downloaded, until the next import. That
is the trade, and it is the right way round — the alternative is a Kept figure that silently inflates as the import ages. It also
makes staleness VISIBLE rather than merely reported: the window label stops advancing when imports stop, so a dead feed shows up as a
date that will not move instead of as a number that quietly improves.

WHAT GOOGLE ACTUALLY DELAYS (measured 2026-09-06, not assumed)
  cost / clicks / impressions   NOT delayed. The product report and the campaign report are separate downloads and their daily cost
                                agreed to the penny on all ten overlapping days. A finished day is final at once.
  conversions / conv_value      revised upward for weeks. Never reaches this screen's grid — see the d7 note above.
  impression share / lost-IS    DELAYED, and by more than the three days usually quoted: at the 2026-09-05 import the last populated
                                day was 2026-08-29, six days back. It lives only in google_campaign_daily and only on the Ads-campaign
                                table, so it never touches Kept. Note NULL there is ambiguous — Google also censors the metric on
                                low-volume days — and volume was falling over that stretch, so read a run of nulls as "unknown",
                                which is how the AVG already treats it.

WHEN THE ADS API LANDS (spec §8) this does not become unnecessary. Google reports ad activity for completed days and Shopify sales are
live; that asymmetry is structural, not an artefact of manual uploads. A nightly pull turns an unbounded, invisible skew into a fixed
one-day one — which is still a seventh of d7. Keep reading MAX(snapshot_date) rather than hard-coding `CURRENT_DATE - 1`: the maximum
is self-healing, whereas a hard-coded yesterday starts lying the moment a cron run dies on an expired token, and this module has
already had that exact failure once.

`ly30` IS ANCHORED TOO, so it stays a like-for-like partner of d30: 30 days ending asOf - 365. It is still 365 and not 364. A 364-day
shift is 52 whole weeks and would line the weekdays up, which matters most on the shortest windows — that is a live question for when
the period-over-period comparison lands, and changing it here would have moved a shipped number for no reason.

THE HEADLINE NUMBER IS `profitAfterSpend`, NOT ROAS (spec §3.2)
A tROAS floor of 400-650% is a REVENUE target. August 2026 cleared 9x revenue ROAS while Google spend was 89% of all Shopify net
profit. Revenue ROAS is reported because it is what the Ads UI bids on; profit after ad spend is reported because it is what the
business earns. The screen leads on the second.

SALES ARE SHOPIFY ONLY (`channel = 'SHP'`), DELIBERATELY
Google Shopping ads point at brookfieldcomfort.com, so Shopify is the channel they can plausibly have caused. This is a deliberate
departure from birk-stock, which uses SHP + CM3: including CM3 here would put revenue Google could not have driven on the same row as
Google's spend and make `profitAfterSpend` flatter. Amazon is excluded for the same reason, more obviously.

`profit` IS `sales.profit` — the NET per-unit figure (after payment fee, packing, postage and the returns haircut, from
utils/shopifyProfit.js). NOT the gross measure birk-stock uses. Subtracting ad spend from a gross margin would produce a number that
looks like profit and is not, on the one screen where that mistake costs money. The two measures differ by a lot: on the current book
35 Birk styles clear £1000 gross and only 6 clear it net.

WHAT `googleLabel` IS
The most recent `custom_label_0` Google actually reported for the style, with the day it was last seen. NOT our `campaign` — that is
`skusummary.googlecampaign`, what we say. The screen shows both, and the disagreement is the point: it is ~a day of ordinary
propagation lag, or it is a feed that has stopped landing. 23 styles sat on a dead 'birk-winner' label for four months because
nothing compared the two.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 284,
  "asOf": "2026-09-05",                  // the last day BOTH sales and ad spend can speak for; every window ends here
  "daysOld": 1,                          // CURRENT_DATE - asOf. 0 is only possible once the ad data reaches today
  "windows": { "d7": {...}, "d30": {...}, "d90": {...}, "d365": {...}, "ly30": { "from": "2025-08-06", "to": "2025-09-05" } },
  "rows": [
    {
      "groupid": "0034701-MILANO",
      "title": "Birkenstock Milano Sandals Black",       // title.shopifytitle; null if none
      "segment": "MILANO-SEG",
      "season": "Summer",                                 // skusummary.season — UNRELIABLE, see spec §1; shown, not trusted
      "brand": "Birkenstock",
      "campaign": "standard",                             // skusummary.googlecampaign — what WE say
      "googleLabel": "BIRK-WINNER",                       // what GOOGLE last reported; null if never seen
      "googleLabelAt": "2026-09-05",                      // the day that label was last seen
      "googleLive": true,                                 // googlestatus = 1 AND shopify = 1 — is it in the feed at all
      "stock": 12,                                        // FREE local units (ordernum '#FREE') PLUS live FBA units — see the
                                                           // `stock` CTE. FBA can dispatch a Shopify order (owner, 2026-09-06), so
                                                           // it counts as sellable stock for this ad, not a separate channel's
      "sizesListed": 11,                                  // sizes the style carries in skumap
      "sizesInStock": 4,                                  // of those, how many have a buyable unit in EITHER pool — see `sizes`
      "price": 57.00, "rrp": 80.00, "cost": 28.50,        // safeNumeric — null when the legacy varchar holds junk
      "d7":   { ... },
      "d30":  { "units": 7, "revenue": 399.00, "profit": 62.30,
                "impressions": 4210, "clicks": 93, "spend": 41.55, "conversions": 3.25, "convValue": 210.40,
                "profitAfterSpend": 20.75, "roas": 5.1 },
      "d90":  { ... }, "d365": { ... }, "ly30": { ... }
    }
  ]
}
  - Every window carries the same keys. A style with no sales and no spend reads zeroes, never nulls, so the client can sort on any
    of them without null handling.
  - Every window is [asOf - (N-1), asOf] INCLUSIVE — exactly N days, ending on the last day the ad data covers, NOT on today. The
    `windows.*.from` / `.to` bounds are the truth about what was measured; render those rather than assuming "to today".
  - `roas` is convValue / spend (Google's own attributed revenue over Google's own cost), null when spend is 0. It is NOT
    revenue / spend — mixing our revenue with Google's cost would silently credit ads with organic sales.
  - `profitAfterSpend` = our net Shopify profit − Google spend. The one number the screen leads on.
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
const { safeNumeric } = require('../utils/sql');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// The five windows, in days back from today. ly30 is handled separately — it is a RANGE one year back, not a length.
const D7 = 7;
const D30 = 30;
const D90 = 90;
const D365 = 365;

// ly30 is a RANGE one year back, not a length: the 30 days ending LY_BACK days before asOf. Expressed as two offsets so the SQL
// reads as one BETWEEN and the arithmetic happens here, once, where it can be checked.
//   LY_BACK = 365  the end of the year-ago window. NOT 364 — see the header; 364 would be 52 whole weeks and would align weekdays,
//                  which is a live question for the period-over-period work and not a change to make in passing.
//   LY_FROM = 394  its start: 365 + 30 - 1, so the window is exactly 30 days like d30. It was 395 before anchoring, i.e. 31 days.
// LY_FROM is also the outer bound on both source scans: it is the oldest day any window needs.
const LY_BACK = 365;
const LY_FROM = LY_BACK + D30 - 1;

const round2 = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
const int = (v) => (v === null || v === undefined ? 0 : Number(v));

/** Assemble one window's block from the flat SQL row. Zeroes rather than nulls so every column is sortable client-side. */
function win(r, k) {
  const profit = round2(r[`${k}_profit`]);
  const spend = round2(r[`${k}_spend`]);
  const convValue = round2(r[`${k}_convvalue`]);
  return {
    units: int(r[`${k}_units`]),
    revenue: round2(r[`${k}_revenue`]),
    profit,
    impressions: int(r[`${k}_impressions`]),
    clicks: int(r[`${k}_clicks`]),
    spend,
    conversions: round2(r[`${k}_conversions`]),
    convValue,
    // The headline. Our net Shopify profit minus what Google charged to get it.
    profitAfterSpend: round2(profit - spend),
    // Google's attributed revenue over Google's cost — both sides from Google, so the ratio means something. null when nothing was
    // spent: 0 spend is not "infinite ROAS", it is "not applicable", and a 0 there would sort to the bottom as if it were terrible.
    roas: spend > 0 ? Math.round((convValue / spend) * 10) / 10 : null,
  };
}

router.get('/', async (req, res) => {
  try {
    // One query, no N+1. Sales and ads are each aggregated to style grain ONCE, with the five windows produced by FILTER clauses in
    // the same pass — five separate scans of `sales` would be five times the work for the same rows. It is also why adding d7 was
    // free: the rows were already being read, and a FILTER is one more test applied to each as it goes past.
    //
    // The `ly30` window is the same 30 days one year earlier: [today-395, today-365]. Not "days 365-395 ago" by accident — it is
    // written as an explicit BETWEEN so the intent survives a reader.
    const result = await query(`
      WITH asof AS (
        -- THE ANCHOR (see the header). The last day both halves of every window can speak for: the newest COMPLETE day of ad data.
        -- "Complete" = we hold a row for it captured on a later calendar day, i.e. the day had ended before it was downloaded. The
        -- newest row in the table is normally a PART day, because a report pulled at 14:38 includes that day up to 14:38.
        -- LEAST ignores NULLs in Postgres, so a table with no eligible day at all falls back to CURRENT_DATE rather than wiping
        -- every window out — a catalogue with no ad data should still show what it sold.
        SELECT LEAST(CURRENT_DATE, (
                 SELECT MAX(snapshot_date) FROM google_product_daily
                 WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
               )) AS d
      ),
      stock AS (
        -- Sellable stock: local FREE rows PLUS live FBA units (owner, 2026-09-06 — a Shopify order can be dispatched from FBA via
        -- Amazon multi-channel fulfilment, so a unit sitting at Amazon is still sellable through the Shopify ad this screen is
        -- scoring, not a separate channel's stock. amzfeed already carries groupid, so it needs no join (same shape as
        -- analytics-stock-position-list.js / analytics-new-additions.js, which sum the same two pools for the same reason).
        -- Deliberately narrower than Inventory's "Local" (which counts picked units) — a unit picked for a customer is sold, and
        -- this screen is deciding whether to advertise what is left.
        SELECT groupid, SUM(units) AS units FROM (
          SELECT groupid, SUM(qty) AS units
          FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid
          UNION ALL
          SELECT groupid, SUM(amzlive) AS units
          FROM amzfeed
          WHERE amzlive > 0
          GROUP BY groupid
        ) both_pools
        GROUP BY groupid
      ),
      sizes AS (
        -- HOW MUCH OF THE SIZE RUN IS ACTUALLY BUYABLE. Added 2026-09-06 because the grid could say a style was losing money but not
        -- why, and the commonest cause is not advertising at all — it is advertising an empty shelf. Real example from the same day:
        -- 0151181-ARIZONA took 117 clicks and made ONE sale at £79 of ad cost, with sizes 38, 39 and 40 all empty. People clicked,
        -- found nothing in their size, and left. Pausing that is right; repricing it would have been pointless.
        --
        -- Contrast 1017724-BEND, 8 of 9 sizes in stock and still converting at 1.4% — a price problem, where pausing would have
        -- hidden something fixable. Identical on every other column; opposite actions. This is the column that tells them apart.
        --
        -- skumap is the full run (one row per variant); localstock holds in-stock rows only, so the LEFT JOIN is what makes an
        -- unstocked size count as listed-but-empty rather than vanish. Size is the code's last dash-segment, as in inv-styles.
        --
        -- A size can be "in stock" via EITHER pool — FBA dispatch fulfils a Shopify order the same as the local shelf does (see
        -- the stock CTE above), so a size sitting only at Amazon must not read as an empty shelf here.
        SELECT m.groupid,
               COUNT(*)                                                              AS listed,
               COUNT(*) FILTER (WHERE COALESCE(ls.q, 0) + COALESCE(az.q, 0) > 0)     AS in_stock
        FROM (SELECT groupid, substring(code from '[^-]+$') AS sz FROM skumap GROUP BY groupid, substring(code from '[^-]+$')) m
        LEFT JOIN (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(qty) AS q
          FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) ls ON ls.groupid = m.groupid AND ls.sz = m.sz
        LEFT JOIN (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(amzlive) AS q
          FROM amzfeed
          WHERE amzlive > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) az ON az.groupid = m.groupid AND az.sz = m.sz
        GROUP BY m.groupid
      ),
      sales_w AS (
        -- Shopify only (see the header). Positive and negative rows both counted: a return is a negative row in sales and must
        -- pull revenue and profit back down, or a heavily-returned style looks like a winner.
        SELECT s.groupid,
          -- REVENUE IS SUM(soldprice * qty), NOT SUM(soldprice) (fixed 2026-09-06). soldprice is PER-UNIT and stays POSITIVE on a
          -- return row — qty carries the sign — so the bare sum both double-counted every refund and under-counted a multi-unit
          -- line. Over 365 Shopify days that read £287,190 against a true £221,717: a 30% overstatement, live since this route
          -- shipped. profitAfterSpend and Kept never touched it, so no triage decision was made on the wrong number. Proof
          -- soldprice is per-unit: 0128201-GIZEH-44 has a qty-1 and a qty-2 line on 2026-07-03 with the identical 36.10, and
          -- utils/orderSync.js writes it straight from the Shopify line price. Matches analytics-sales, the authoritative ledger.
          SUM(s.qty)       FILTER (WHERE s.solddate BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_units,
          SUM(s.soldprice * s.qty) FILTER (WHERE s.solddate BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_revenue,
          SUM(s.profit)    FILTER (WHERE s.solddate BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_profit,
          SUM(s.qty)       FILTER (WHERE s.solddate BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_units,
          SUM(s.soldprice * s.qty) FILTER (WHERE s.solddate BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_revenue,
          SUM(s.profit)    FILTER (WHERE s.solddate BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_profit,
          SUM(s.qty)       FILTER (WHERE s.solddate BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_units,
          SUM(s.soldprice * s.qty) FILTER (WHERE s.solddate BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_revenue,
          SUM(s.profit)    FILTER (WHERE s.solddate BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_profit,
          SUM(s.qty)       FILTER (WHERE s.solddate BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_units,
          SUM(s.soldprice * s.qty) FILTER (WHERE s.solddate BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_revenue,
          SUM(s.profit)    FILTER (WHERE s.solddate BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_profit,
          SUM(s.qty)       FILTER (WHERE s.solddate BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_units,
          SUM(s.soldprice * s.qty) FILTER (WHERE s.solddate BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_revenue,
          SUM(s.profit)    FILTER (WHERE s.solddate BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_profit
        FROM sales s CROSS JOIN asof a
        WHERE s.channel = 'SHP' AND s.solddate BETWEEN a.d - ${LY_FROM} AND a.d
        GROUP BY s.groupid
      ),
      ads_w AS (
        SELECT g.groupid,
          SUM(g.impressions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_impressions,
          SUM(g.clicks)      FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_clicks,
          SUM(g.cost)        FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_spend,
          SUM(g.conversions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_conversions,
          SUM(g.conv_value)  FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D7 - 1} AND a.d)   AS d7_convvalue,
          SUM(g.impressions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_impressions,
          SUM(g.clicks)      FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_clicks,
          SUM(g.cost)        FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_spend,
          SUM(g.conversions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_conversions,
          SUM(g.conv_value)  FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D30 - 1} AND a.d)  AS d30_convvalue,
          SUM(g.impressions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_impressions,
          SUM(g.clicks)      FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_clicks,
          SUM(g.cost)        FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_spend,
          SUM(g.conversions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_conversions,
          SUM(g.conv_value)  FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D90 - 1} AND a.d)  AS d90_convvalue,
          SUM(g.impressions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_impressions,
          SUM(g.clicks)      FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_clicks,
          SUM(g.cost)        FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_spend,
          SUM(g.conversions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_conversions,
          SUM(g.conv_value)  FILTER (WHERE g.snapshot_date BETWEEN a.d - ${D365 - 1} AND a.d) AS d365_convvalue,
          SUM(g.impressions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_impressions,
          SUM(g.clicks)      FILTER (WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_clicks,
          SUM(g.cost)        FILTER (WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_spend,
          SUM(g.conversions) FILTER (WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_conversions,
          SUM(g.conv_value)  FILTER (WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d - ${LY_BACK}) AS ly30_convvalue
        FROM google_product_daily g CROSS JOIN asof a
        WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d
        GROUP BY g.groupid
      ),
      last_label AS (
        -- The most recent label Google actually reported, and when. DISTINCT ON is the cheap "latest row per group" here; ordering
        -- puts a real label ahead of '' on the same day, because "Google reported no label today" is the less informative of the two
        -- when both appear on a label-change day.
        SELECT DISTINCT ON (g.groupid)
               g.groupid,
               NULLIF(g.google_label, '') AS label,
               to_char(g.snapshot_date, 'YYYY-MM-DD') AS seen
        FROM google_product_daily g CROSS JOIN asof a
        WHERE g.snapshot_date BETWEEN a.d - ${LY_FROM} AND a.d
        ORDER BY g.groupid, g.snapshot_date DESC, (g.google_label = '') ASC
      )
      SELECT
        ss.groupid,
        t.shopifytitle AS title,
        COALESCE(ss.segment, '')  AS segment,
        COALESCE(ss.season, '')   AS season,
        COALESCE(ss.brand, '')    AS brand,
        COALESCE(ss.googlecampaign, '') AS campaign,
        ll.label AS google_label,
        ll.seen  AS google_label_at,
        (ss.googlestatus = 1 AND ss.shopify = 1) AS google_live,
        COALESCE(st.units, 0) AS stock,
        COALESCE(sz.listed, 0)   AS sizes_listed,
        COALESCE(sz.in_stock, 0) AS sizes_in_stock,
        ${safeNumeric('ss.shopifyprice')} AS price,
        ${safeNumeric('ss.rrp')}          AS rrp,
        ${safeNumeric('ss.cost')}         AS cost,
        sw.d7_units, sw.d7_revenue, sw.d7_profit,
        sw.d30_units, sw.d30_revenue, sw.d30_profit,
        sw.d90_units, sw.d90_revenue, sw.d90_profit,
        sw.d365_units, sw.d365_revenue, sw.d365_profit,
        sw.ly30_units, sw.ly30_revenue, sw.ly30_profit,
        aw.d7_impressions, aw.d7_clicks, aw.d7_spend, aw.d7_conversions, aw.d7_convvalue,
        aw.d30_impressions, aw.d30_clicks, aw.d30_spend, aw.d30_conversions, aw.d30_convvalue,
        aw.d90_impressions, aw.d90_clicks, aw.d90_spend, aw.d90_conversions, aw.d90_convvalue,
        aw.d365_impressions, aw.d365_clicks, aw.d365_spend, aw.d365_conversions, aw.d365_convvalue,
        aw.ly30_impressions, aw.ly30_clicks, aw.ly30_spend, aw.ly30_conversions, aw.ly30_convvalue
      FROM skusummary ss
      LEFT JOIN title      t  ON t.groupid  = ss.groupid
      LEFT JOIN stock      st ON st.groupid = ss.groupid
      LEFT JOIN sizes      sz ON sz.groupid = ss.groupid
      LEFT JOIN sales_w    sw ON sw.groupid = ss.groupid
      LEFT JOIN ads_w      aw ON aw.groupid = ss.groupid
      LEFT JOIN last_label ll ON ll.groupid = ss.groupid
      -- The sellable catalogue, not just the Google-live subset. A style with shopify = 1 but googlestatus = 0 is a real state the
      -- operator needs to SEE (it is off Google entirely), and filtering it out here would make it invisible rather than obvious.
      WHERE ss.shopify = 1
      ORDER BY ss.groupid
    `);

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title,
      segment: r.segment,
      season: r.season,
      brand: r.brand,
      campaign: r.campaign,
      googleLabel: r.google_label,
      googleLabelAt: r.google_label_at,
      googleLive: r.google_live,
      stock: int(r.stock),
      sizesListed: int(r.sizes_listed),
      sizesInStock: int(r.sizes_in_stock),
      price: r.price === null ? null : Number(r.price),
      rrp: r.rrp === null ? null : Number(r.rrp),
      cost: r.cost === null ? null : Number(r.cost),
      d7: win(r, 'd7'),
      d30: win(r, 'd30'),
      d90: win(r, 'd90'),
      d365: win(r, 'd365'),
      ly30: win(r, 'ly30'),
    }));

    // The window boundaries, so the screen can label its own switch honestly ("30 days to 5 Sep") rather than hard-coding dates that
    // drift out of step with what the server actually measured.
    const bounds = await query(`
      WITH asof AS (
        SELECT LEAST(CURRENT_DATE, (
                 SELECT MAX(snapshot_date) FROM google_product_daily
                 WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
               )) AS d
      )
      SELECT to_char(d - ${D7 - 1}, 'YYYY-MM-DD')   AS d7_from,
             to_char(d - ${D30 - 1}, 'YYYY-MM-DD')  AS d30_from,
             to_char(d - ${D90 - 1}, 'YYYY-MM-DD')  AS d90_from,
             to_char(d - ${D365 - 1}, 'YYYY-MM-DD') AS d365_from,
             to_char(d - ${LY_FROM}, 'YYYY-MM-DD')  AS ly30_from,
             to_char(d - ${LY_BACK}, 'YYYY-MM-DD')  AS ly30_to,
             -- The window END, named as_of and NOT today on purpose: it is the last day the ad data covers, and on a stale import
             -- that is not today. The old name is why the client could print, in good faith, a range nothing had measured.
             to_char(d, 'YYYY-MM-DD')               AS as_of,
             (CURRENT_DATE - d)                     AS days_old
      FROM asof
    `);
    const b = bounds.rows[0];

    return res.json({
      return_code: 'SUCCESS',
      count: rows.length,
      // The anchor, surfaced so the client can caption itself and say how old the reading is. `daysOld` is 0 only once the ad data
      // reaches today, which under manual import never happens and under a nightly API pull will still normally be 1.
      asOf: b.as_of,
      daysOld: Number(b.days_old),
      // The labels stay short names for the windows; `from`/`to` carry the truth about what was measured. A client that prints
      // "Last 30 days" beside "7 Aug - 5 Sep" while today is 6 Sep is telling the reader everything they need.
      windows: {
        d7: { from: b.d7_from, to: b.as_of, label: 'Last 7 days' },
        d30: { from: b.d30_from, to: b.as_of, label: 'Last 30 days' },
        d90: { from: b.d90_from, to: b.as_of, label: 'Last 90 days' },
        d365: { from: b.d365_from, to: b.as_of, label: 'Last 365 days' },
        ly30: { from: b.ly30_from, to: b.ly30_to, label: 'Same 30 days last year' },
      },
      rows,
    });
  } catch (err) {
    logger.error('[google-ads-styles] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the style list' });
  }
});

module.exports = router;
