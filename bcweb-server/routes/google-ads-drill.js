/*
=======================================================================================================================================
API Route: google_ads_drill
=======================================================================================================================================
Method: GET
Purpose: Google Ads module — one style, opened out. Answers the question the grid cannot: "did moving this style change anything?"

         Requires auth. Read-only.

WHAT THIS ADDS THAT THE LIST DOES NOT
google-ads-styles already ships four windows per style, so the drill deliberately does NOT repeat them. It returns the three things
that only exist at this grain:

  1. `labelRuns`   — every bucket this style has actually served under, as Google reported it, with the money spent under each.
                     This is the module's evidence. "Under C00 it cost £340 and returned £1,900; under BIRK-WINNER it cost £48 and
                     returned nothing" is the sentence the whole screen exists to produce, and it is only available because
                     google_product_daily keeps Google's own per-day label (spec §2.4.6).
  2. `assignments` — our own change log: who moved it, from what, to what, when. Google records the label but never the decision.
  3. `daily`       — the day-by-day series: ad spend and clicks beside units and profit, so a spend change and a sales change can be
                     seen against each other rather than inferred from two windowed totals.

WHY THE LABEL RUNS ARE COLLAPSED, NOT LISTED PER DAY
A style that sat under `C00` for eight months has 230 rows saying so. Collapsed into one run with a date range and a total, it is one
line the operator can read. The collapse is by CONSECUTIVE label, not by DISTINCT label, so a style that went C00 -> none -> C00
shows three runs and not two — going back to a bucket is a different event from never having left it.

"Consecutive" is measured over the days the style was SERVED, not over the calendar. Google omits a day entirely when a style got no
impressions, so a quiet week leaves a hole in the dates; breaking a run on that hole would report a bucket change that never
happened. Ranking by served days means a run breaks only when the label is genuinely absent on a day the style WAS served. On
1005299-GIZEH this turned five spurious `C00` runs into one.

A run of one or two days with zero clicks and zero spend is real but not interesting — it is usually the tail of a transition. The
route returns it rather than filtering it, because "we spent nothing under that label" and "we have no data" are different facts and
only the client knows how much room it has to say so.

A LABEL-CHANGE DAY BELONGS TO BOTH RUNS. Google splits that day's activity across both labels and reports two rows (spec §2.4.7), so
the day appears at the end of one run and the start of the next, each with its own share of the spend. The runs' totals still sum to
the style's true total; only the date ranges overlap by a day. That is Google's reporting, faithfully carried through, not an
off-by-one.

`daily` IS SPARSE ON THE AD SIDE AND DENSE ON NEITHER
Google omits zero-impression days entirely and most styles do not sell every day, so a day appears only if SOMETHING happened. The
client draws gaps as zero; the route does not invent rows, because a fabricated zero is indistinguishable from a real one and this
data already has real holes worth seeing (spec §6.1).
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  groupid   REQUIRED — the style to open (skusummary.groupid)
  days      optional, default 180, max 400 — how far back `daily` reaches

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "1005299-GIZEH",
  "header": { "title": "...", "imagename": "birkenstock-gizeh.jpg", "segment": "GIZEH-SEG", "brand": "Birkenstock", "season": "Summer",
              "campaign": "standard", "googleLabel": "STANDARD", "googleLive": true,
              "stock": 23, "price": 57.00, "rrp": 80.00, "cost": 28.50,
              "adFloor": 63.65, "adCostPerSale": 7.46, "adFloorConfidence": "own", "belowAdFloor": true },
  "sizes": [ { "size": "38", "qty": 0 }, { "size": "39", "qty": 2 } ],   // EVERY size in skumap, 0 included, numeric order
  "labelRuns": [
    { "label": "C00", "from": "2025-08-01", "to": "2026-04-13", "days": 241,
      "impressions": 41200, "clicks": 903, "spend": 340.12, "conversions": 28.5, "convValue": 1900.40, "roas": 5.6 },
    { "label": null,  "from": "2026-04-01", "to": "2026-05-15", "days": 45, ... }
  ],
  "assignments": [ { "from": "standard", "to": "BIRK-HARVEST", "by": "Andreas", "at": "5 Sep 2026, 15:04" } ],
  "daily": [ { "date": "2026-09-04", "impressions": 130, "clicks": 3, "spend": 1.44,
               "conversions": 0, "convValue": 0, "units": 1, "revenue": 57.00, "profit": 9.10 } ]
}
  - `labelRuns` uses null for "Google reported no label" (stored as '' — see migrations/20260905b).
  - `assignments` is empty until the style is first moved through this screen; the log starts 2026-09-05 and cannot be backfilled.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"INVALID_DAYS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { safeNumeric } = require('../utils/sql');
const { getAdFloors } = require('../utils/adFloor');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const DEFAULT_DAYS = 180;
const MAX_DAYS = 400;

const round2 = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
const int = (v) => (v === null || v === undefined ? 0 : Number(v));

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').trim().toUpperCase();
    if (!groupid) return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });

    const days = req.query.days === undefined ? DEFAULT_DAYS : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return res.json({ return_code: 'INVALID_DAYS', message: `days must be a whole number between 1 and ${MAX_DAYS}` });
    }

    // ---- header ------------------------------------------------------------------------------------------------------------
    const headRes = await query(`
      SELECT ss.groupid,
             t.shopifytitle AS title,
             COALESCE(ss.segment, '') AS segment,
             COALESCE(ss.season, '')  AS season,
             COALESCE(ss.brand, '')   AS brand,
             NULLIF(ss.imagename, '') AS imagename,
             COALESCE(ss.googlecampaign, '') AS campaign,
             (ss.googlestatus = 1 AND ss.shopify = 1) AS google_live,
             COALESCE((SELECT SUM(qty) FROM localstock ls
                        WHERE ls.groupid = ss.groupid AND ls.ordernum = '#FREE'
                          AND COALESCE(ls.deleted, 0) = 0 AND ls.qty > 0), 0) AS stock,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')}          AS rrp,
             ${safeNumeric('ss.cost')}         AS cost
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid = $1
    `, [groupid]);

    if (headRes.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: `No style ${groupid}` });
    }
    const h = headRes.rows[0];

    // ---- label runs --------------------------------------------------------------------------------------------------------
    // Collapse consecutive days carrying the same label into one run. The classic gaps-and-islands shape: two row_numbers, one
    // partitioned by label, and their difference is constant within a run. Grouping on that difference gives runs that RESTART when
    // the style leaves a bucket and comes back — which distinguishes "went away and returned" from "never left", and those are
    // different facts about a campaign decision.
    //
    // The whole history is scanned, not the `days` window: a run that started fourteen months ago is exactly the comparison the
    // drill is for, and truncating it would silently understate what a bucket cost.
    const runsRes = await query(`
      WITH served AS (
        -- Every day this style appeared in a Google report AT ALL, numbered. Runs are computed over THIS sequence, not over the
        -- calendar.
        --
        -- Why: Google omits a day entirely when a style got no impressions, so a quiet week leaves a hole in the dates. Breaking a
        -- run on a calendar gap would report "left the bucket and came back" for a style that never moved — it simply was not shown
        -- for a few days. Ranking by served days means a run breaks only when the label is genuinely ABSENT on a day the style WAS
        -- served, which is the actual event worth reporting. (Verified on 1005299-GIZEH: five spurious C00 runs became one.)
        SELECT snapshot_date, ROW_NUMBER() OVER (ORDER BY snapshot_date) AS rn
        FROM (SELECT DISTINCT snapshot_date FROM google_product_daily WHERE groupid = $1) x
      ),
      d AS (
        SELECT g.snapshot_date, sv.rn, NULLIF(g.google_label, '') AS label,
               SUM(g.impressions) AS impressions, SUM(g.clicks) AS clicks, SUM(g.cost) AS cost,
               SUM(g.conversions) AS conversions, SUM(g.conv_value) AS conv_value
        FROM google_product_daily g
        JOIN served sv ON sv.snapshot_date = g.snapshot_date
        WHERE g.groupid = $1
        GROUP BY g.snapshot_date, sv.rn, NULLIF(g.google_label, '')
      ),
      grp AS (
        -- Islands computed PER LABEL over the SERVED-DAY sequence: the served-day rank minus the label's own row number is constant
        -- while the label holds on consecutive served days, and jumps when it does not.
        --
        -- It must be per-label and not a single ordering across all rows. A label-change day carries TWO rows (spec §2.4.7), so
        -- during a transition the days interleave; a single global ordering then breaks the run at every alternation and turns four
        -- real runs into twenty-four one-day fragments. Verified on 1005299-GIZEH, whose April 2026 transition did exactly that.
        --
        -- The consequence is that runs for different labels may OVERLAP in time. That is correct and is what the data says: for two
        -- weeks this style genuinely served under both labels.
        SELECT *,
               rn - ROW_NUMBER() OVER (PARTITION BY label ORDER BY rn) AS island
        FROM d
      )
      SELECT label,
             to_char(MIN(snapshot_date), 'YYYY-MM-DD') AS "from",
             to_char(MAX(snapshot_date), 'YYYY-MM-DD') AS "to",
             COUNT(*)              AS days,
             SUM(impressions)      AS impressions,
             SUM(clicks)           AS clicks,
             SUM(cost)             AS cost,
             SUM(conversions)      AS conversions,
             SUM(conv_value)       AS conv_value
      FROM grp
      GROUP BY label, island
      ORDER BY MIN(snapshot_date), label NULLS FIRST
    `, [groupid]);

    // ---- size curve --------------------------------------------------------------------------------------------------------
    // WHERE the holes are, not just how many. A style missing 45 and 46 is fine; the same count missing 38, 39 and 40 is why nobody
    // buys after clicking — most of the demand sits in the middle of the run. The grid's "4/11" says something is wrong; this says
    // whether it is the kind of wrong that should pause the style or the kind that should not.
    //
    // EVERY size in skumap, including the empty ones (that is the whole point), ordered numerically so the curve reads as a run
    // rather than as text — '9' must not sort after '10'.
    const curveRes = await query(`
      SELECT m.sz, COALESCE(ls.q, 0) AS qty
      FROM (SELECT substring(code from '[^-]+$') AS sz FROM skumap WHERE groupid = $1 GROUP BY 1) m
      LEFT JOIN (
        SELECT substring(code from '[^-]+$') AS sz, SUM(qty) AS q
        FROM localstock
        WHERE groupid = $1 AND ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY 1
      ) ls ON ls.sz = m.sz
      ORDER BY NULLIF(regexp_replace(m.sz, '[^0-9.]', '', 'g'), '')::numeric NULLS LAST, m.sz
    `, [groupid]);

    // ---- our assignment log ------------------------------------------------------------------------------------------------
    // Formatted to Europe/London server-side so the front end never handles the BST offset.
    const logRes = await query(`
      SELECT from_campaign, to_campaign, changed_by,
             to_char(changed_at AT TIME ZONE 'Europe/London', 'FMDD Mon YYYY, HH24:MI') AS at
      FROM google_campaign_assignment_log
      WHERE groupid = $1
      ORDER BY changed_at DESC
    `, [groupid]);

    // ---- daily series ------------------------------------------------------------------------------------------------------
    // FULL OUTER JOIN so a day with spend and no sales, or sales and no spend, both survive. An inner join here would silently drop
    // exactly the days worth looking at — money spent with nothing sold.
    const dailyRes = await query(`
      WITH a AS (
        SELECT snapshot_date AS d, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(cost) AS cost,
               SUM(conversions) AS conversions, SUM(conv_value) AS conv_value
        FROM google_product_daily
        WHERE groupid = $1 AND snapshot_date >= CURRENT_DATE - $2::int
        GROUP BY snapshot_date
      ),
      s AS (
        -- soldprice is PER-UNIT and stays POSITIVE on a return row (qty carries the sign), so a bare SUM(soldprice) both
        -- double-counts refunds and under-counts a multi-unit line. Measured 2026-09-06 over 365 Shopify days: £287,190 bare
        -- against £221,717 correct — a 30% overstatement. Fixed to match analytics-sales, the authoritative ledger.
        SELECT solddate AS d, SUM(qty) AS units, SUM(soldprice * qty) AS revenue, SUM(profit) AS profit
        FROM sales
        WHERE groupid = $1 AND channel = 'SHP' AND solddate >= CURRENT_DATE - $2::int
        GROUP BY solddate
      )
      SELECT to_char(COALESCE(a.d, s.d), 'YYYY-MM-DD') AS date,
             a.impressions, a.clicks, a.cost, a.conversions, a.conv_value,
             s.units, s.revenue, s.profit
      FROM a FULL OUTER JOIN s ON s.d = a.d
      ORDER BY COALESCE(a.d, s.d)
    `, [groupid, days]);

    // One style, so one batched call of size one (utils/adFloor.js owns the window and the confidence rules).
    const floor = (await getAdFloors([groupid])).get(groupid) || null;

    return res.json({
      return_code: 'SUCCESS',
      groupid: h.groupid,
      header: {
        title: h.title,
        // Bare filename; the client builds https://images.brookfieldcomfort.com/<imagename>, same as the Inventory browse.
        imagename: h.imagename,
        segment: h.segment,
        season: h.season,
        brand: h.brand,
        campaign: h.campaign,
        // The most recent run's label is what Google currently reports — no separate query needed for it.
        googleLabel: runsRes.rows.length ? runsRes.rows[runsRes.rows.length - 1].label : null,
        googleLive: h.google_live,
        stock: int(h.stock),
        price: h.price === null ? null : Number(h.price),
        rrp: h.rrp === null ? null : Number(h.rrp),
        cost: h.cost === null ? null : Number(h.cost),
        // Ad floor (utils/adFloor.js) — shown beside Price because that is the number it judges. Fixed 90-day basis, so it does not
        // move with this drill's `days` window; advisory only, nothing enforces it. null = not enough ad data to say.
        adFloor: floor ? floor.adFloor : null,
        adCostPerSale: floor ? floor.adCostPerSale : null,
        adFloorConfidence: floor ? floor.confidence : 'none',
        belowAdFloor: floor && floor.adFloor !== null && h.price !== null && Number(h.price) < floor.adFloor,
      },
      sizes: curveRes.rows.map((r) => ({ size: r.sz, qty: int(r.qty) })),
      labelRuns: runsRes.rows.map((r) => {
        const spend = round2(r.cost);
        const convValue = round2(r.conv_value);
        return {
          label: r.label,
          from: r.from,
          to: r.to,
          days: int(r.days),
          impressions: int(r.impressions),
          clicks: int(r.clicks),
          spend,
          conversions: round2(r.conversions),
          convValue,
          roas: spend > 0 ? Math.round((convValue / spend) * 10) / 10 : null,
        };
      }),
      assignments: logRes.rows.map((r) => ({
        from: r.from_campaign,
        to: r.to_campaign,
        by: r.changed_by,
        at: r.at,
      })),
      daily: dailyRes.rows.map((r) => ({
        date: r.date,
        impressions: int(r.impressions),
        clicks: int(r.clicks),
        spend: round2(r.cost),
        conversions: round2(r.conversions),
        convValue: round2(r.conv_value),
        units: int(r.units),
        revenue: round2(r.revenue),
        profit: round2(r.profit),
      })),
    });
  } catch (err) {
    logger.error('[google-ads-drill] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the style' });
  }
});

module.exports = router;
