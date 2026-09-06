/*
=======================================================================================================================================
API Route: google_ads_campaigns
=======================================================================================================================================
Method: GET
Purpose: Google Ads module — the campaign panel. Two different things, returned separately and deliberately not merged.

         Requires auth. Read-only.

THE DISTINCTION THIS ROUTE EXISTS TO KEEP STRAIGHT
A "campaign" means two different things in this module and conflating them would produce numbers that look authoritative and are not:

  `buckets`      OUR labels — skusummary.googlecampaign, the thing this screen writes, shipped as Google's custom_label_0. A bucket
                 is a SET OF STYLES. Its money is real (we sum the styles' own spend and profit), but it has no impression share,
                 because it is not a campaign in Google's account — it is a filter that a campaign may or may not be scoped to.

  `adsCampaigns` GOOGLE'S campaigns — the actual entities in the Ads account, from google_campaign_daily. These have impression
                 share and lost-IS, which exist ONLY at this grain. Today there is exactly one live campaign (STANDARD) containing
                 every bucket, which is precisely the situation the owner is deciding whether to change.

So a bucket cannot report impression share, and an Ads campaign cannot report per-style profit. Each side reports what it actually
knows. When the account is eventually split so that one campaign is scoped to one label, the two lists will line up by name — and
until then, pretending they do would be a fiction.

WHY THE LOST-IS COLUMNS ARE THE POINT (spec §3.1)
August 2026: STANDARD ran at 91.9% impression share with 0.0% lost to budget and 8.1% lost to rank. It is NOT budget-constrained —
moving budget between campaigns cannot buy impressions that are already being won. What a split buys is separate tROAS control.
Compare May 2026, when IVES lost 78.4% of its impressions to budget (starved, not bad) and BIRK-WINNER lost 40.2% to rank (a bid
problem a small campaign made worse). Those three numbers are why the earlier splits failed, and they belong on this panel.

BUCKET MEMBERSHIP IS TODAY'S, THE MONEY IS THE WINDOW'S — SAY SO ON SCREEN
A bucket's figures are "what the styles CURRENTLY in this bucket did over the window", not "what this bucket earned at the time". A
style moved yesterday brings its whole history with it. There is no honest alternative from this data alone — the per-style history
is real (google_product_daily keeps Google's own daily label), but attributing it needs the assignment log, which only starts from
2026-09-05. The client must label these as current-membership figures.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  days   optional, default 30, max 400 — the window for the money columns

Success Response:
{
  "return_code": "SUCCESS",
  "window": { "from": "2026-08-06", "to": "2026-09-05", "days": 30 },
  "buckets": [
    { "name": "standard", "archived": false, "notes": "...",
      "styles": 284, "stock": 3120, "units": 363, "revenue": 32316.00, "profit": 4122.10,
      "impressions": 383557, "clicks": 8672, "spend": 3645.11, "conversions": 316.22, "convValue": 20436.98,
      "profitAfterSpend": 476.99, "roas": 5.6,
      "stale": 23 }                       // members whose last Google-reported label is not this bucket
  ],
  "adsCampaigns": [
    { "campaign": "STANDARD", "days": 30, "clicks": 8672, "impressions": 383557, "cost": 3645.11,
      "conversions": null, "convValue": null,
      "searchImpShare": 91.9, "lostIsRank": 8.1, "lostIsBudget": 0.0 }
  ]
}
  - `buckets` includes every name in google_campaign PLUS any value found on skusummary.googlecampaign that is not in that table
    (an unmanaged name — shown so it can be adopted or cleaned up, never hidden).
  - Impression-share figures are AVERAGED over the days that reported one; days Google censored are excluded, not counted as zero.
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

const DEFAULT_DAYS = 30;
const MAX_DAYS = 400;

const round2 = (v) => (v === null || v === undefined ? 0 : Math.round(Number(v) * 100) / 100);
const int = (v) => (v === null || v === undefined ? 0 : Number(v));
const orNull = (v) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);

router.get('/', async (req, res) => {
  try {
    const days = req.query.days === undefined ? DEFAULT_DAYS : Number(req.query.days);
    if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
      return res.json({ return_code: 'INVALID_DAYS', message: `days must be a whole number between 1 and ${MAX_DAYS}` });
    }

    // ---- OUR buckets -------------------------------------------------------------------------------------------------------
    // Grouped on skusummary.googlecampaign, which is the thing the screen writes. FULL OUTER-ish shape via the UNION below so a
    // bucket that exists but currently holds no styles still appears (you have to be able to see an empty bucket to move things
    // into it), and a bucket name in use but absent from google_campaign appears too (unmanaged names must never be hidden).
    const bucketRes = await query(`
      WITH members AS (
        SELECT groupid, COALESCE(NULLIF(TRIM(googlecampaign), ''), '(none)') AS bucket
        FROM skusummary
        WHERE shopify = 1
      ),
      stock AS (
        SELECT groupid, SUM(qty) AS units
        FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY groupid
      ),
      sales_w AS (
        -- Shopify only, same reasoning as google-ads-styles: Google Shopping points at the Shopify store, so that is the revenue
        -- these ads can plausibly have caused.
        SELECT groupid, SUM(qty) AS units, SUM(soldprice) AS revenue, SUM(profit) AS profit
        FROM sales
        WHERE channel = 'SHP' AND solddate >= CURRENT_DATE - $1::int
        GROUP BY groupid
      ),
      ads_w AS (
        SELECT groupid, SUM(impressions) AS impressions, SUM(clicks) AS clicks, SUM(cost) AS cost,
               SUM(conversions) AS conversions, SUM(conv_value) AS conv_value
        FROM google_product_daily
        WHERE snapshot_date >= CURRENT_DATE - $1::int
        GROUP BY groupid
      ),
      last_label AS (
        SELECT DISTINCT ON (groupid) groupid, NULLIF(google_label, '') AS label
        FROM google_product_daily
        ORDER BY groupid, snapshot_date DESC, (google_label = '') ASC
      ),
      rolled AS (
        SELECT m.bucket,
               COUNT(*)                       AS styles,
               COALESCE(SUM(st.units), 0)     AS stock,
               COALESCE(SUM(sw.units), 0)     AS units,
               COALESCE(SUM(sw.revenue), 0)   AS revenue,
               COALESCE(SUM(sw.profit), 0)    AS profit,
               COALESCE(SUM(aw.impressions), 0) AS impressions,
               COALESCE(SUM(aw.clicks), 0)    AS clicks,
               COALESCE(SUM(aw.cost), 0)      AS spend,
               COALESCE(SUM(aw.conversions), 0) AS conversions,
               COALESCE(SUM(aw.conv_value), 0)  AS conv_value,
               -- Members whose most recent Google-reported label is NOT this bucket. Ordinary propagation lag accounts for ~a day
               -- of it; a persistent count is a feed that has stopped landing.
               COUNT(*) FILTER (WHERE ll.label IS NOT NULL AND UPPER(ll.label) <> UPPER(m.bucket)) AS stale
        FROM members m
        LEFT JOIN stock      st ON st.groupid = m.groupid
        LEFT JOIN sales_w    sw ON sw.groupid = m.groupid
        LEFT JOIN ads_w      aw ON aw.groupid = m.groupid
        LEFT JOIN last_label ll ON ll.groupid = m.groupid
        GROUP BY m.bucket
      )
      SELECT COALESCE(gc.name, r.bucket) AS name,
             COALESCE(gc.archived, false) AS archived,
             gc.notes,
             (gc.name IS NOT NULL)        AS managed,
             COALESCE(r.styles, 0) AS styles, COALESCE(r.stock, 0) AS stock,
             COALESCE(r.units, 0) AS units, COALESCE(r.revenue, 0) AS revenue, COALESCE(r.profit, 0) AS profit,
             COALESCE(r.impressions, 0) AS impressions, COALESCE(r.clicks, 0) AS clicks, COALESCE(r.spend, 0) AS spend,
             COALESCE(r.conversions, 0) AS conversions, COALESCE(r.conv_value, 0) AS conv_value,
             COALESCE(r.stale, 0) AS stale
      FROM google_campaign gc
      FULL OUTER JOIN rolled r ON r.bucket = gc.name
      ORDER BY COALESCE(r.spend, 0) DESC, 1
    `, [days]);

    // ---- GOOGLE's campaigns ------------------------------------------------------------------------------------------------
    // Impression share and lost-IS live ONLY here. AVG over the days that reported a figure — Google censors the metric on some
    // days ('--', '< 10%', '> 90%') and those arrive as NULL. AVG ignores NULLs, which is what we want: a censored day is unknown,
    // and averaging it in as 0 would drag a healthy campaign's share down for no reason.
    const adsRes = await query(`
      SELECT campaign,
             COUNT(*)                 AS days,
             SUM(clicks)              AS clicks,
             SUM(impressions)         AS impressions,
             SUM(cost)                AS cost,
             SUM(conversions)         AS conversions,
             SUM(conv_value)          AS conv_value,
             AVG(search_imp_share)    AS search_imp_share,
             AVG(lost_is_rank)        AS lost_is_rank,
             AVG(lost_is_budget)      AS lost_is_budget,
             COUNT(*) FILTER (WHERE search_imp_share IS NULL) AS censored_days
      FROM google_campaign_daily
      WHERE snapshot_date >= CURRENT_DATE - $1::int
      GROUP BY campaign
      ORDER BY SUM(cost) DESC
    `, [days]);

    const bounds = await query(
      `SELECT to_char(CURRENT_DATE - $1::int, 'YYYY-MM-DD') AS "from", to_char(CURRENT_DATE, 'YYYY-MM-DD') AS "to"`,
      [days]
    );

    const buckets = bucketRes.rows.map((r) => {
      const profit = round2(r.profit);
      const spend = round2(r.spend);
      const convValue = round2(r.conv_value);
      return {
        name: r.name,
        archived: r.archived,
        notes: r.notes,
        // false = the name is in use on skusummary but has no row in google_campaign. Shown, never hidden — an unmanaged name is
        // usually a typo, and a typo in this column reaches Google and matches nothing.
        managed: r.managed,
        styles: int(r.styles),
        stock: int(r.stock),
        units: int(r.units),
        revenue: round2(r.revenue),
        profit,
        impressions: int(r.impressions),
        clicks: int(r.clicks),
        spend,
        conversions: round2(r.conversions),
        convValue,
        profitAfterSpend: round2(profit - spend),
        roas: spend > 0 ? Math.round((convValue / spend) * 10) / 10 : null,
        stale: int(r.stale),
      };
    });

    const adsCampaigns = adsRes.rows.map((r) => ({
      campaign: r.campaign,
      days: int(r.days),
      clicks: int(r.clicks),
      impressions: int(r.impressions),
      cost: round2(r.cost),
      // Null, not 0, when the column has never been populated — these were only added to the export in 2026 and backfilling them as
      // zero would read as "this campaign converted nothing".
      conversions: r.conversions === null ? null : round2(r.conversions),
      convValue: r.conv_value === null ? null : round2(r.conv_value),
      searchImpShare: orNull(r.search_imp_share),
      lostIsRank: orNull(r.lost_is_rank),
      lostIsBudget: orNull(r.lost_is_budget),
      censoredDays: int(r.censored_days),
    }));

    return res.json({
      return_code: 'SUCCESS',
      window: { from: bounds.rows[0].from, to: bounds.rows[0].to, days },
      buckets,
      adsCampaigns,
    });
  } catch (err) {
    logger.error('[google-ads-campaigns] failed:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the campaign panel' });
  }
});

module.exports = router;
