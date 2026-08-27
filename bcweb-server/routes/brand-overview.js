/*
=======================================================================================================================================
API Route: brand_overview   (Brands module — overview)
=======================================================================================================================================
Method: GET
Purpose: One screen answering "which brands actually make us money?" — revenue, net profit, margin and units per BRAND over a long
         window (12 months by default, 6 months the alternative), each against THE SAME WINDOW ONE YEAR EARLIER so each brand
         reads as a level AND a direction.

         WHY LAST YEAR AND NOT THE PRECEDING BLOCK: this is a seasonal business — ~95% of Shopify sales are Birkenstock, a summer
         sandal. Comparing Mar-Aug against the Sep-Feb before it measures the seasons, not the brands (on live data at the time of
         writing that read +524% for Birkenstock, which tells nobody anything they can act on). Year-on-year holds the season
         constant, so a move in the number is a move in the BRAND. On the 12-month window the two definitions coincide anyway.

         Why a long window and only two of them: brand mix moves at the pace of buying decisions, not daily trade. A 30-day brand
         table is mostly seasonal noise (Birkenstock is a summer sandal business), and the sales table only reaches back to Aug 2024
         anyway — so 12 months is "a full season cycle" and 6 months is "the current half". Anything shorter belongs on Analytics ->
         Sales, which is the pulse screen; this one is the shape of the business.

         THREE deliberate rules, all owner calls (2026-08-27):
           1. SKECHERS IS EXCLUDED ENTIRELY — not folded into Others, not shown greyed: gone, as if it never sold. It is a brand we
              are not trading forward on, and over the last year it made a small LOSS on ~£9k of revenue; leaving it in the table
              invited the "what are we doing about Skechers?" conversation on every read. `excluded` in the response names it so the
              UI can footnote what the totals leave out rather than silently under-reporting them.
           2. THE LONG TAIL FOLDS INTO ONE "Others" ROW. Below OTHERS_SHARE_PCT of window revenue a brand is a rounding error (a
              one-pair-a-month house brand), and a dozen of them turn the table into a scroll. They are summed into a single row
              that carries its own revenue/profit/units plus the LIST of brands inside it, so nothing is hidden — the detail is one
              disclosure away instead of always on screen. Others is never itself folded and always sorts last.
           3. RETURNS ARE INCLUDED AND NETTED, exactly as Analytics -> Sales does it. A refund is a real negative-profit line; a
              brand overview that ignored them would flatter the brands that get sent back most, which is precisely the thing this
              screen exists to expose. Units break out into sold / returned / net for the same reason.

         BRAND comes from `sales.brand` — stamped onto the line at booking (orderSync copies skusummary.brand), so it stays right
         even if the style is re-branded later. Legacy/oddball rows can have it blank (4 lines in the last year at the time of
         writing), so we fall back to the style's CURRENT brand via skusummary, and only then to '(unknown)'. The fallback is a
         LEFT JOIN — a sale whose style has since been deleted must still count toward the totals.

         CHANNEL-FILTERED (All / Shopify / Amazon), the same three-way split and the same codes as Analytics -> Sales, so the two
         screens can be read side by side: 'all' also folds in the minor CM3 channel so the totals reconcile with the ledger there.
         It matters more here than it looks: the same brand carries a different margin per channel (Amazon takes an FBA fee out of
         every unit), so "which brands earn" has a different answer per channel and a blended-only view would hide it.

         Read-only. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)
Query params:
  months  optional integer — 12 (default) or 6. Anything else falls back to 12; there is deliberately no custom range (see above).
  channel optional string  — 'all' (default, incl. CM3) | 'shp' | 'amz'. Case-insensitive; anything else falls back to 'all'.
                             Mirrors analytics-sales.js exactly.

Success Response:
{
  "return_code": "SUCCESS",
  "months": 12, "channel": "all",
  "from": "2025-08-27", "to": "2026-08-27",            // current window, `to` = today inclusive (today's trade counts)
  "priorFrom": "2024-08-27", "priorTo": "2025-08-27",  // THE SAME WINDOW ONE YEAR EARLIER — see the header for why, not the
                                                       // immediately-preceding block of the same length
  "excluded": ["Skechers"],                            // brands left out of every number on this screen
  "othersSharePct": 1,                                 // the fold threshold, so the UI can explain the Others row honestly
  "totals": { "revenue": 413000.12, "profit": 55120.44, "marginPct": 13.3,
              "unitsSold": 8600, "unitsReturned": 190, "unitsNet": 8410,
              "priorRevenue": 380100.00, "priorProfit": 49000.10, "brands": 19 },
  "rows": [
    { "brand": "Birkenstock", "isOthers": false, "brands": null,
      "revenue": 207659.02, "profit": 32645.28, "marginPct": 15.7, "profitPerUnit": 9.69,
      "unitsSold": 3400, "unitsReturned": 31, "unitsNet": 3369, "lines": 4327,
      "revenueSharePct": 50.3, "profitSharePct": 59.2,
      "priorRevenue": 190000.00, "priorProfit": 30100.00,
      "revenueChangePct": 9.3, "profitChangePct": 8.5 },
    ...,
    { "brand": "Others", "isOthers": true, "brands": ["Goor", "Hotter", ...], ... }   // always last
  ]
}
  - marginPct / share / change are all rounded to 1dp app-side; null rather than 0 where the divisor is 0 or the prior window has
    no trade at all (a brand's FIRST season is not "+100%", it is "no comparison" — the UI shows "new").
  - profitPerUnit is per NET unit (returns already netted out), null when net units is 0 — a brand that sold 4 and had 4 come back
    has no meaningful per-unit figure.
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

// Brands that never appear on this screen, at all (rule 1 in the header). Compared upper-cased, so casing in the data doesn't
// matter. A named constant rather than a query param: it is a standing business decision, not a view option the operator picks.
const EXCLUDED_BRANDS = ['Skechers'];

// A brand holding less than this share of window revenue folds into Others (rule 2). 1% of a ~£400k year is ~£4k — roughly a pair
// a week. Above it a brand is worth a line of its own; below it, it is noise that costs a row.
const OTHERS_SHARE_PCT = 1;

// The three channels the screen offers. 'all' is every row INCLUDING the minor CM3 channel, so it reconciles with Analytics ->
// Sales rather than quietly being "Shopify + Amazon only".
const ALLOWED_CHANNELS = ['all', 'shp', 'amz'];

// Only two windows, both long. See the header for why there is no custom range.
const ALLOWED_MONTHS = [6, 12];
const DEFAULT_MONTHS = 12;

// NUMERIC comes back from pg as a string — Number() it, and keep null as null (a missing figure is not 0).
function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function round1(v) {
  return v === null ? null : Math.round(v * 10) / 10;
}
// Percentage of a total, null when the total is 0 (can't divide) — the UI renders those as "—" rather than a misleading 0.0%.
function pctOf(part, total) {
  if (!total) return null;
  return round1((part / total) * 100);
}
// Period-on-period change. null when the prior window had NO revenue/profit at all: a brand's first season is "new", not "+100%".
function changePct(now, prior) {
  if (prior === null || prior === 0) return null;
  return round1(((now - prior) / Math.abs(prior)) * 100);
}
// pg DATE -> 'YYYY-MM-DD' without the toISOString() timezone landmine (CLAUDE.md).
function toIso(d) {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const requested = parseInt(req.query.months, 10);
    const months = ALLOWED_MONTHS.includes(requested) ? requested : DEFAULT_MONTHS;

    const rawChannel = String(req.query.channel || 'all').toLowerCase();
    const channel = ALLOWED_CHANNELS.includes(rawChannel) ? rawChannel : 'all';
    // Passed as a pair rather than interpolated: $3 short-circuits the test on 'all', $4 is the code to match otherwise. Same
    // shape analytics-sales.js uses, for the same reason — one parameterised query, no string-built SQL.
    const channelAll = channel === 'all';
    const channelCode = channel === 'shp' ? 'SHP' : channel === 'amz' ? 'AMZ' : null;

    // ONE pass over both windows. The CTE pulls 2x the window (current + prior) and every aggregate below is a FILTER over it, so
    // the table is scanned once rather than twice — and, more importantly, both halves are computed off exactly the same brand
    // resolution and exclusion rules, which two separate queries would only agree on by hand.
    //
    // Window bounds are computed in SQL off CURRENT_DATE (the anchor the rest of the app trusts) rather than in Node, so a request
    // that lands either side of midnight can't disagree with itself. `to` is today INCLUSIVE — today's trade counts.
    const result = await query(
      `WITH bounds AS (
         SELECT CURRENT_DATE                                             AS to_date,
                CURRENT_DATE - make_interval(months => $1::int)          AS from_date,
                -- Same window, shifted back a year (not the preceding block) — see the header: it holds the season constant.
                CURRENT_DATE - make_interval(years => 1)                    AS prior_to_date,
                CURRENT_DATE - make_interval(years => 1, months => $1::int) AS prior_from_date
       ),
       lines AS (
         SELECT COALESCE(NULLIF(TRIM(s.brand), ''), NULLIF(TRIM(k.brand), ''), '(unknown)') AS brand,
                s.solddate, s.qty, s.soldprice, s.profit
           FROM sales s
           -- LEFT: a sale whose style has since been deleted still counts. The join is only ever a FALLBACK for a blank stamp.
           LEFT JOIN skusummary k ON k.groupid = s.groupid
          CROSS JOIN bounds b
          -- Both windows in one scan. On the 6-month view this also drags in the gap between them, which neither FILTER below
          -- matches — still cheaper than a second pass, and the FILTERs are explicit about their bounds rather than leaning on
          -- "everything before the window start".
          WHERE s.solddate >= b.prior_from_date
            AND s.solddate <= b.to_date
            AND ($3::bool OR s.channel = $4)   -- channel: true on 'all' (CM3 included), else the one code
       ),
       kept AS (
         SELECT * FROM lines
          WHERE UPPER(brand) <> ALL ($2::text[])   -- Skechers, upper-cased so data casing doesn't matter
       )
       SELECT brand,
              COUNT(*) FILTER (WHERE solddate >= b.from_date)                              AS lines,
              COALESCE(SUM(qty)          FILTER (WHERE solddate >= b.from_date AND qty > 0), 0) AS units_sold,
              COALESCE(-SUM(qty)         FILTER (WHERE solddate >= b.from_date AND qty < 0), 0) AS units_returned,
              COALESCE(SUM(qty)          FILTER (WHERE solddate >= b.from_date), 0)             AS units_net,
              COALESCE(SUM(soldprice * qty) FILTER (WHERE solddate >= b.from_date), 0)          AS revenue,
              COALESCE(SUM(profit)       FILTER (WHERE solddate >= b.from_date), 0)             AS profit,
              COALESCE(SUM(soldprice * qty) FILTER (WHERE solddate BETWEEN b.prior_from_date AND b.prior_to_date), 0) AS prior_revenue,
              COALESCE(SUM(profit)          FILTER (WHERE solddate BETWEEN b.prior_from_date AND b.prior_to_date), 0) AS prior_profit
         FROM kept
         CROSS JOIN bounds b
        GROUP BY brand
        ORDER BY revenue DESC NULLS LAST, brand`,
      [months, EXCLUDED_BRANDS.map((b) => b.toUpperCase()), channelAll, channelCode]
    );

    const boundsResult = await query(
      `SELECT CURRENT_DATE                                             AS to_date,
              CURRENT_DATE - make_interval(months => $1::int)          AS from_date,
              CURRENT_DATE - make_interval(years => 1)                    AS prior_to_date,
              CURRENT_DATE - make_interval(years => 1, months => $1::int) AS prior_from_date`,
      [months]
    );
    const b = boundsResult.rows[0];

    // Shape every brand first, folding comes after — the fold threshold is a share of the WINDOW TOTAL, which isn't known until
    // every brand has been summed.
    const all = result.rows.map((r) => ({
      brand: r.brand,
      lines: Number(r.lines) || 0,
      unitsSold: Number(r.units_sold) || 0,
      unitsReturned: Number(r.units_returned) || 0,
      unitsNet: Number(r.units_net) || 0,
      revenue: num(r.revenue) || 0,
      profit: num(r.profit) || 0,
      priorRevenue: num(r.prior_revenue) || 0,
      priorProfit: num(r.prior_profit) || 0,
    }));

    // A brand can appear in last year's window and have nothing in this one (dropped, or discontinued). It stays in the list with
    // zeroes — it will fold into Others on a 0% share, which is the honest place for it: it made nothing this window.
    const totalRevenue = all.reduce((n, x) => n + x.revenue, 0);
    const totalProfit = all.reduce((n, x) => n + x.profit, 0);

    const named = [];
    const tail = [];
    for (const x of all) {
      const share = pctOf(x.revenue, totalRevenue);
      // Threshold test against the RAW share, not the rounded one, so a brand sitting on 0.96% doesn't get promoted by rounding.
      if (totalRevenue > 0 && (x.revenue / totalRevenue) * 100 >= OTHERS_SHARE_PCT) named.push({ ...x, share });
      else tail.push({ ...x, share });
    }

    function shape(x, isOthers, brands) {
      const marginPct = x.revenue ? round1((x.profit / x.revenue) * 100) : null;
      return {
        brand: isOthers ? 'Others' : x.brand,
        isOthers,
        brands: brands || null,
        revenue: Math.round(x.revenue * 100) / 100,
        profit: Math.round(x.profit * 100) / 100,
        marginPct,
        profitPerUnit: x.unitsNet ? Math.round((x.profit / x.unitsNet) * 100) / 100 : null,
        unitsSold: x.unitsSold,
        unitsReturned: x.unitsReturned,
        unitsNet: x.unitsNet,
        lines: x.lines,
        revenueSharePct: pctOf(x.revenue, totalRevenue),
        profitSharePct: pctOf(x.profit, totalProfit),
        priorRevenue: Math.round(x.priorRevenue * 100) / 100,
        priorProfit: Math.round(x.priorProfit * 100) / 100,
        revenueChangePct: changePct(x.revenue, x.priorRevenue),
        profitChangePct: changePct(x.profit, x.priorProfit),
      };
    }

    const rows = named.map((x) => shape(x, false, null));
    if (tail.length > 0) {
      const folded = tail.reduce((acc, x) => ({
        brand: 'Others',
        lines: acc.lines + x.lines,
        unitsSold: acc.unitsSold + x.unitsSold,
        unitsReturned: acc.unitsReturned + x.unitsReturned,
        unitsNet: acc.unitsNet + x.unitsNet,
        revenue: acc.revenue + x.revenue,
        profit: acc.profit + x.profit,
        priorRevenue: acc.priorRevenue + x.priorRevenue,
        priorProfit: acc.priorProfit + x.priorProfit,
      }), { lines: 0, unitsSold: 0, unitsReturned: 0, unitsNet: 0, revenue: 0, profit: 0, priorRevenue: 0, priorProfit: 0 });
      // Biggest first inside the fold, so the disclosure reads as a continuation of the table above it.
      const insideNames = [...tail].sort((p, q) => q.revenue - p.revenue).map((x) => x.brand);
      rows.push(shape(folded, true, insideNames));
    }

    const totals = {
      revenue: Math.round(totalRevenue * 100) / 100,
      profit: Math.round(totalProfit * 100) / 100,
      marginPct: totalRevenue ? round1((totalProfit / totalRevenue) * 100) : null,
      unitsSold: all.reduce((n, x) => n + x.unitsSold, 0),
      unitsReturned: all.reduce((n, x) => n + x.unitsReturned, 0),
      unitsNet: all.reduce((n, x) => n + x.unitsNet, 0),
      priorRevenue: Math.round(all.reduce((n, x) => n + x.priorRevenue, 0) * 100) / 100,
      priorProfit: Math.round(all.reduce((n, x) => n + x.priorProfit, 0) * 100) / 100,
      brands: all.filter((x) => x.revenue !== 0 || x.unitsNet !== 0).length,
    };

    return res.json({
      return_code: 'SUCCESS',
      months,
      channel,
      from: toIso(b.from_date),
      to: toIso(b.to_date),
      priorFrom: toIso(b.prior_from_date),
      priorTo: toIso(b.prior_to_date),
      excluded: EXCLUDED_BRANDS,
      othersSharePct: OTHERS_SHARE_PCT,
      totals,
      rows,
    });
  } catch (err) {
    logger.error('[brand-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load brand overview' });
  }
});

module.exports = router;
