/*
=======================================================================================================================================
API Route: google_ads_styles
=======================================================================================================================================
Method: GET
Purpose: Google Ads module — the whole payload. Every sellable style once, with its campaign bucket, what we hold, what it sold, and
         what Google spent on it, across four windows. The screen renders the list and then filters, sorts and switches window
         CLIENT-SIDE with no round-trip.

         Requires auth. Read-only.

WHY THE WHOLE LIST SHIPS AT ONCE, AND ALL FOUR WINDOWS WITH IT
~284 styles. Same call shape as inv-styles and birk-stock: one fetch, then every Contains / Does-not-contain narrowing happens in the
browser. The four windows ship TOGETHER, pre-aggregated, for the same reason birk-stock ships live and incoming separately — the
window switch has to be instant, and a refetch per window would make the screen feel like a report instead of a tool.

THE WINDOWS (docs/google-ads-spec.md §3)
  d30   last 30 days   — what is happening now; the working window
  d90   last 90 days   — the season; damps the noise on a style selling two a month
  d365  last 365 days  — the year, for a style that only sells in one of them
  ly30  the SAME 30 days one year ago — the winter comparison the whole module exists for. "Zermatt did X last November" is not
        answerable from any other window, and it is the question the owner is actually asking.

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
  "windows": { "d30": {...}, "d90": {...}, "d365": {...}, "ly30": { "from": "2025-08-06", "to": "2025-09-05" } },
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
      "stock": 12,                                        // FREE local units (ordernum '#FREE'), all sizes
      "sizesListed": 11,                                  // sizes the style carries in skumap
      "sizesInStock": 4,                                  // of those, how many have a buyable unit — see the `sizes` CTE
      "price": 57.00, "rrp": 80.00, "cost": 28.50,        // safeNumeric — null when the legacy varchar holds junk
      "d30":  { "units": 7, "revenue": 399.00, "profit": 62.30,
                "impressions": 4210, "clicks": 93, "spend": 41.55, "conversions": 3.25, "convValue": 210.40,
                "profitAfterSpend": 20.75, "roas": 5.1 },
      "d90":  { ... }, "d365": { ... }, "ly30": { ... }
    }
  ]
}
  - Every window carries the same keys. A style with no sales and no spend reads zeroes, never nulls, so the client can sort on any
    of them without null handling.
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

// The four windows, in days back from today. ly30 is handled separately — it is a RANGE one year back, not a length.
const D30 = 30;
const D90 = 90;
const D365 = 365;

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
    // One query, no N+1. Sales and ads are each aggregated to style grain ONCE, with the four windows produced by FILTER clauses in
    // the same pass — four separate scans of `sales` would be four times the work for the same rows.
    //
    // The `ly30` window is the same 30 days one year earlier: [today-395, today-365]. Not "days 365-395 ago" by accident — it is
    // written as an explicit BETWEEN so the intent survives a reader.
    const result = await query(`
      WITH stock AS (
        -- Sellable stock only: FREE rows, not deleted. Deliberately narrower than Inventory's "Local" (which counts picked units) —
        -- a unit picked for a customer is sold, and this screen is deciding whether to advertise what is left.
        SELECT groupid, SUM(qty) AS units
        FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
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
        SELECT m.groupid,
               COUNT(*)                                      AS listed,
               COUNT(*) FILTER (WHERE COALESCE(ls.q, 0) > 0) AS in_stock
        FROM (SELECT groupid, substring(code from '[^-]+$') AS sz FROM skumap GROUP BY groupid, substring(code from '[^-]+$')) m
        LEFT JOIN (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(qty) AS q
          FROM localstock
          WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) ls ON ls.groupid = m.groupid AND ls.sz = m.sz
        GROUP BY m.groupid
      ),
      sales_w AS (
        -- Shopify only (see the header). Positive and negative rows both counted: a return is a negative row in sales and must
        -- pull revenue and profit back down, or a heavily-returned style looks like a winner.
        SELECT groupid,
          SUM(qty)    FILTER (WHERE solddate >= CURRENT_DATE - ${D30})  AS d30_units,
          SUM(soldprice) FILTER (WHERE solddate >= CURRENT_DATE - ${D30}) AS d30_revenue,
          SUM(profit) FILTER (WHERE solddate >= CURRENT_DATE - ${D30})  AS d30_profit,
          SUM(qty)    FILTER (WHERE solddate >= CURRENT_DATE - ${D90})  AS d90_units,
          SUM(soldprice) FILTER (WHERE solddate >= CURRENT_DATE - ${D90}) AS d90_revenue,
          SUM(profit) FILTER (WHERE solddate >= CURRENT_DATE - ${D90})  AS d90_profit,
          SUM(qty)    FILTER (WHERE solddate >= CURRENT_DATE - ${D365}) AS d365_units,
          SUM(soldprice) FILTER (WHERE solddate >= CURRENT_DATE - ${D365}) AS d365_revenue,
          SUM(profit) FILTER (WHERE solddate >= CURRENT_DATE - ${D365}) AS d365_profit,
          SUM(qty)    FILTER (WHERE solddate BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_units,
          SUM(soldprice) FILTER (WHERE solddate BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_revenue,
          SUM(profit) FILTER (WHERE solddate BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_profit
        FROM sales
        WHERE channel = 'SHP' AND solddate >= CURRENT_DATE - 395
        GROUP BY groupid
      ),
      ads_w AS (
        SELECT groupid,
          SUM(impressions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D30})  AS d30_impressions,
          SUM(clicks)      FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D30})  AS d30_clicks,
          SUM(cost)        FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D30})  AS d30_spend,
          SUM(conversions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D30})  AS d30_conversions,
          SUM(conv_value)  FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D30})  AS d30_convvalue,
          SUM(impressions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D90})  AS d90_impressions,
          SUM(clicks)      FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D90})  AS d90_clicks,
          SUM(cost)        FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D90})  AS d90_spend,
          SUM(conversions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D90})  AS d90_conversions,
          SUM(conv_value)  FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D90})  AS d90_convvalue,
          SUM(impressions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D365}) AS d365_impressions,
          SUM(clicks)      FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D365}) AS d365_clicks,
          SUM(cost)        FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D365}) AS d365_spend,
          SUM(conversions) FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D365}) AS d365_conversions,
          SUM(conv_value)  FILTER (WHERE snapshot_date >= CURRENT_DATE - ${D365}) AS d365_convvalue,
          SUM(impressions) FILTER (WHERE snapshot_date BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_impressions,
          SUM(clicks)      FILTER (WHERE snapshot_date BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_clicks,
          SUM(cost)        FILTER (WHERE snapshot_date BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_spend,
          SUM(conversions) FILTER (WHERE snapshot_date BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_conversions,
          SUM(conv_value)  FILTER (WHERE snapshot_date BETWEEN CURRENT_DATE - 395 AND CURRENT_DATE - 365) AS ly30_convvalue
        FROM google_product_daily
        WHERE snapshot_date >= CURRENT_DATE - 395
        GROUP BY groupid
      ),
      last_label AS (
        -- The most recent label Google actually reported, and when. DISTINCT ON is the cheap "latest row per group" here; ordering
        -- puts a real label ahead of '' on the same day, because "Google reported no label today" is the less informative of the two
        -- when both appear on a label-change day.
        SELECT DISTINCT ON (groupid)
               groupid,
               NULLIF(google_label, '') AS label,
               to_char(snapshot_date, 'YYYY-MM-DD') AS seen
        FROM google_product_daily
        WHERE snapshot_date >= CURRENT_DATE - 395
        ORDER BY groupid, snapshot_date DESC, (google_label = '') ASC
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
        sw.d30_units, sw.d30_revenue, sw.d30_profit,
        sw.d90_units, sw.d90_revenue, sw.d90_profit,
        sw.d365_units, sw.d365_revenue, sw.d365_profit,
        sw.ly30_units, sw.ly30_revenue, sw.ly30_profit,
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
      d30: win(r, 'd30'),
      d90: win(r, 'd90'),
      d365: win(r, 'd365'),
      ly30: win(r, 'ly30'),
    }));

    // The window boundaries, so the screen can label its own switch honestly ("30 days to 5 Sep") rather than hard-coding dates that
    // drift out of step with what the server actually measured.
    const bounds = await query(`
      SELECT to_char(CURRENT_DATE - ${D30}, 'YYYY-MM-DD')  AS d30_from,
             to_char(CURRENT_DATE - ${D90}, 'YYYY-MM-DD')  AS d90_from,
             to_char(CURRENT_DATE - ${D365}, 'YYYY-MM-DD') AS d365_from,
             to_char(CURRENT_DATE - 395, 'YYYY-MM-DD')     AS ly30_from,
             to_char(CURRENT_DATE - 365, 'YYYY-MM-DD')     AS ly30_to,
             to_char(CURRENT_DATE, 'YYYY-MM-DD')           AS today
    `);
    const b = bounds.rows[0];

    return res.json({
      return_code: 'SUCCESS',
      count: rows.length,
      windows: {
        d30: { from: b.d30_from, to: b.today, label: 'Last 30 days' },
        d90: { from: b.d90_from, to: b.today, label: 'Last 90 days' },
        d365: { from: b.d365_from, to: b.today, label: 'Last 365 days' },
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
