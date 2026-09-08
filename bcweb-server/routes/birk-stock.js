/*
=======================================================================================================================================
API Route: birk_stock
=======================================================================================================================================
Method: GET
Purpose: Birkenstock module — the re-order screen. Returns EVERY Birkenstock style once, with what we hold, what is still to come from
         Birkenstock, and what it has sold in the last 365 days, split by size. Ported from the legacy PowerBuilder Birkenstock screen.

         THE QUESTION THIS SCREEN ANSWERS: Birkenstock is ordered ~6 months ahead and cannot be re-ordered on demand (CLAUDE.md), so
         the seasonal order is the ONE decision that sets the year. The operator is deciding "what do I put on the next order?" — which
         means holding sales against stock, size by size, and NOT re-ordering something already on the way.

         Requires auth. Read-only. Nothing here writes.

THE TWO QUANTITIES PER SIZE (the whole point of the screen — owner, 2026-09-04):
  - live     = what is on the shelf right now, ready to sell.
  - incoming = what is still to arrive on the Birkenstock pre-order book (birktracker: requested - arrived, floored at 0). An ARRIVED
               unit is already counted in live, so the raw requested would double-count it.
  The client shows live in LIVE mode and live + incoming in FULL mode. FULL is what stops an over-order: if the total already covers
  the sales, there is nothing to order. The two are shipped SEPARATELY (not pre-summed) precisely so the switch is a display change
  over one payload with no round-trip — the legacy screen's LIVE/FULL buttons were instant and these have to be too.

WHY THE WHOLE LIST SHIPS AT ONCE: ~176 styles. Same call shape as inv-styles — one fetch, then every Contains / Does-not-contain
narrowing, sort and mode switch happens in the browser. There is deliberately no term, mode or sort parameter.

DEFINITIONS (owner, 2026-09-04 — reconciled cell-by-cell against the legacy screen for 0129423-ARIZONA: Sold 39, Stock 45):
  - Stock (live) = localstock FREE rows only: ordernum = '#FREE', not deleted, qty > 0. Deliberately NARROWER than the Inventory
                   screen's "Local" (which includes picked units): a unit picked for a customer is sold, and counting it here would
                   tell the operator they have stock they are about to ship out of the door.
  - Sold 365     = SUM(skumap.shp365 + skumap.cmb365) across the style's variants — Shopify plus the CM3 shop. amz365 is excluded
                   because it is 0 on every Birkenstock row (Birk is not sold on Amazon); if that ever changes it becomes a decision,
                   not an oversight. These are maintained counters ON SKUMAP, not computed from `sales` — that is what the legacy
                   screen read and the two have to agree.
  - Review       = skusummary.check_stock, the "ask me again on" date the 1/2/3 buttons stamp (routes/birk-review.js). Shipped as a
                   plain date; the SCREEN decides what to do with it. Note it is NOT filtered on here — every style comes back parked
                   or not, because the sheet's ALL view deliberately shows parked styles too. Filtering server-side would make the
                   payload depend on which band the operator happens to be on, and the whole screen is built on one payload.
  - Sizes        = every size the style carries in skumap (EU, the last dash-segment of the code), so a sold-out MIDDLE size stays
                   visible in its column instead of the grid closing up. Birkenstock runs 35-48 with no half sizes.
  - Kept         = the style's NET profit over the same 365 days, less the Google spend that went on it. The banded measure. See the
                   block below for why it replaced gross profit on 2026-09-08.

THE BANDED MEASURE IS NOW `KEPT` — NET PROFIT LESS AD SPEND (owner, 2026-09-08). THIS REVERSED THE DECISION RECORDED BELOW, AND THE
OLD REASONING IS KEPT DELIBERATELY so nobody re-argues it from scratch.

WHAT CHANGED. When this screen was built, advertising was not measurable per style, so the choice was between a gross margin and
sales.profit — and gross won because expenses are near-flat per unit and would have shifted every row by about the same amount. Ad
spend is NOT flat per unit, and that is the whole point: measured over the last 365 days it is 32% of the gross figure this screen
ranked on, it varies from nothing to 38% of a style's gross, and 57 of 172 styles are NEGATIVE once their own spend is charged to
them. A cost that big and that uneven cannot be left out of a number whose job is to rank a buy.

WHY NOT GROSS MINUS ADS. Because that is neither figure: it charges one selling cost while ignoring the payment fee, packing, postage
and the returns haircut. sales.profit already carries all of those, so net-minus-ads is the only internally consistent answer, and it
is the one the owner chose. On the current book: gross GBP 70,408, net GBP 37,730, ad spend GBP 22,427, kept GBP 15,303.

WHAT IT COST. The named ladder had to be recalibrated — Top/High/Mid/Low were GBP 1000/750/500/250 against gross, which on kept would
have put two styles in Top. They are now GBP 300/200/100/0, chosen to cut the book at roughly the ranks the old ladder did (16/28/46
/85 of 172). The bottom rung is 0 rather than a positive step, because on a RE-ORDER sheet "did not lose money" is a real line and
gross could never draw it.

WHAT IT DID NOT CHANGE. The top of the buy barely moves: the top 10 styles by gross and by kept are the same 10, and the top 20 differ
by three. The value is not a different winners list, it is that the losers are now visible — a style can rank well on gross and still
be handing its margin to Google, and that is invisible on a gross measure.

--- the original reasoning, superseded above, retained for the argument ---

PROFIT HERE WAS GROSS PROFIT — AN INDICATION, NOT ACCOUNTING (owner, 2026-09-04). It started as a straight port of the owner's own
hand-written query (Birkenstock-Order-Performance.txt), which left its VAT adjustment switched off. THE VAT IS NOW TAKEN OUT (owner's
call, same day): sold prices on this book are VAT-INCLUSIVE and skusummary.cost is NET of VAT, so subtracting one from the other
compared two different things and inflated every row by a fifth of its revenue. Ex-VAT price minus cost is a like-for-like margin.

WHAT IS STILL IN IT, DELIBERATELY: the selling expenses. Payment fee, packing, postage and the returns haircut that utils/shopifyProfit
computes for `sales.profit` are NOT deducted here, at the owner's call. This figure's job is to RANK — best sellers first, then work
down the list as the order budget allows — and to say across seasons whether Birkenstock is still contributing or another brand has
overtaken it. Expenses are near-flat per unit, so removing them would shift every row by roughly the same amount and change the order
barely at all, while making this number look like an accounting figure it is not. It is a gross margin, and it reads high.

WHY NOT `sales.profit` (the net per-unit figure the Pricing screens use)? Because it answers a different question — what is left after
everything, on a unit — and it is a MUCH smaller number: on the current book 35 Birk styles clear 1000 by the gross measure and only 6
clear it net. The owner's threshold bands are set against the gross measure. Anyone tempted to unify the two should read this paragraph
and the one above it first: the difference is intentional, not drift.
                                            ^^^ THIS IS THE PARAGRAPH THAT WAS REVERSED. It was right that net is a much smaller number
and that the bands were set against gross; what it could not weigh was ad spend, which nothing measured per style at the time. Both
points were addressed rather than ignored — the bands were recalibrated, not stretched. See the block at the top.

WHAT WAS DROPPED FROM THE OWNER'S QUERY, DELIBERATELY: that query also gated on skusummary.shopify = 1, on the style having at least
one out-of-stock size, on `check_stock` being due, and on a minimum sold quantity. Those gates make it a REPRICING REVIEW list. This
screen's population is every Birkenstock style, full stop — dropping the top-grossing line from a re-order sheet because its stock
check is not due yet would hide the exact row the operator is deciding on. Only the profit arithmetic was taken.

`NULLIF(ss.cost,'')::numeric` in the original became safeNumeric(): cost is a legacy VARCHAR that can hold junk (CLAUDE.md), and a
bare cast THROWS on it. A style whose cost is unusable returns gross = null (not 0), so an unknown never reads on screen as "earned
nothing" and never satisfies a "greater than" threshold.

THE WINDOW IS 365 DAYS, not the original's 360, so the figure sits beside a Sold 365 measured over the same year. The two still will
not multiply out: Gross counts rows in `sales`, Sold 365 reads the maintained counters on skumap, and they disagree on some styles
(0034701-MILANO: 108 units sold vs a counter of 94). Both are right in their own terms; neither is derived from the other.

CHANNELS ARE SHP + CM3, where the original took SHP alone — the same pair Sold 365 is built from (shp365 + cmb365), so the money on a
row comes from the sales the row is already reporting. CM3 is ~20 Birkenstock rows a year; this is consistency, not volume.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 176,
  "adsAsOf": "2026-09-06",                                    // last COMPLETE day of Google ad data behind every `kept` below
  "adsDaysOld": 2,                                            // CURRENT_DATE - adsAsOf. Kept always reads HIGH by roughly this many
                                                              // days of spend, so the screen warns once it grows. Nothing is adjusted.
  "rows": [
    {
      "groupid": "0129423-ARIZONA",
      "title": "Birkenstock Arizona EVA Sandals Black Narrow Fit",   // title.shopifytitle; null if none
      "segment": "EVA-SEG",
      "review": "2026-10-01",                                 // skusummary.check_stock: parked out of the sheet until this date; null if never parked
      "sold365": 39,                                          // shp365 + cmb365, summed over the style's variants
      "kept": 412,                                            // THE BANDED MEASURE: 365-day net profit less this style's Google spend,
                                                              // whole pounds. null if there are no sales in the window or the cost is junk
      "adSpend": 188,                                         // Google spend over the same 365 days; a real 0 when the style was never advertised
      "gross": 1150,                                          // 365-day GROSS profit ex VAT. Still returned, NO LONGER RENDERED (owner,
                                                              // 2026-09-08): it is the legacy figure this screen was built on and the
                                                              // arithmetic is documented above, so it is kept as one ROUND() over data
                                                              // already selected rather than deleted and re-derived if it is ever wanted
      "live": 45,                                             // FREE local units, all sizes
      "incoming": 0,                                          // still to arrive on the Birk order book (requested - arrived)
      "liveSizes":     { "35": 3, "36": 10, "37": 8 },        // 0 for a size the style carries but has none of
      "incomingSizes": { "35": 0, "36": 0,  "37": 0 }         // same key set as liveSizes
    }
  ]
}

WHAT THIS DELIBERATELY DOES NOT REPORT: a slice of the Birkenstock order book is next-season styles not set up as products yet (the
same gap inv-styles carries), so those codes match nothing in skumap and their units cannot be shown against a style. An `unmapped`
count of them was returned and printed on the screen until 2026-09-04, and came out at the owner's call: it named units that have no
row to point at, so there was nothing on screen it could explain. If that gap ever needs surfacing it belongs on its own screen — a
list of the lines — not as a number beside a grid that cannot show them.
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
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One query, no N+1. Each source is pre-aggregated to (style, size) in its own CTE, then folded into a per-style JSON map keyed on
    // the size list skumap gives us — so a size with no stock and nothing on order still emits its 0 and keeps its column.
    const result = await query(`
      WITH styles AS (
        -- The population: every Birkenstock style. brand is the only test — no stock or sales filter, because a style that has sold
        -- 20 and holds none is exactly the row this screen exists to put in front of someone.
        -- cost comes along for the ride here (via safeNumeric — it is a legacy VARCHAR that can hold junk and would throw on a bare
        -- cast) because the gross figure below is the only thing that wants it, and this is the one place the style row is read.
        -- check_stock cast to TEXT here, never handed out as a pg DATE: JS would parse a bare DATE as local midnight and BST would
        -- slide it back a day (CLAUDE.md). It is the review stamp routes/birk-review.js writes — see there for what it means.
        SELECT s.groupid, t.shopifytitle AS title, s.segment, ${safeNumeric('s.cost')} AS cost, s.check_stock::text AS review
        FROM skusummary s
        LEFT JOIN title t ON t.groupid = s.groupid
        WHERE s.brand = 'Birkenstock'
      ),
      sizes AS (
        -- Every size the style carries. skumap is one row per variant; the size is the last dash-segment of the code (EU). Using the
        -- segment rather than RIGHT(code,2) keeps a half size like "10.5" readable if the brand ever ships one.
        SELECT m.groupid, substring(m.code from '[^-]+$') AS sz
        FROM skumap m
        JOIN styles st ON st.groupid = m.groupid
        GROUP BY m.groupid, substring(m.code from '[^-]+$')
      ),
      live AS (
        -- On the shelf, sellable NOW: FREE rows only. Not the Inventory screen's wider "Local" — see the header block.
        SELECT l.groupid, substring(l.code from '[^-]+$') AS sz, SUM(l.qty) AS units
        FROM localstock l
        JOIN styles st ON st.groupid = l.groupid
        WHERE l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
        GROUP BY l.groupid, substring(l.code from '[^-]+$')
      ),
      inc AS (
        -- Still to come on the Birkenstock order book. birktracker.code is already our own code grain ('1015470-ARIZONA-38'), so it
        -- joins to skumap directly and splits by size for free. requested MINUS arrived, floored at 0: an arrived unit is in the live CTE
        -- already, and a line that over-delivered must not read as negative incoming.
        SELECT m.groupid, substring(m.code from '[^-]+$') AS sz,
               SUM(GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0)) AS units
        FROM birktracker b
        JOIN skumap m ON m.code = b.code
        JOIN styles st ON st.groupid = m.groupid
        GROUP BY m.groupid, substring(m.code from '[^-]+$')
      ),
      sold AS (
        -- The 365-day counters held on skumap, summed over the style's variants. shp365 + cmb365 = Shopify + the CM3 shop (owner).
        SELECT m.groupid, SUM(COALESCE(m.shp365, 0) + COALESCE(m.cmb365, 0)) AS units
        FROM skumap m
        JOIN styles st ON st.groupid = m.groupid
        GROUP BY m.groupid
      ),
      perf AS (
        -- The money the style has actually made over the same 365 days: qty-weighted average sold price minus cost, times units.
        -- qty > 0 AND soldprice > 0 drops returns and zero-value rows, exactly as the owner's query does. See the header block for why
        -- this is gross rather than sales.profit, and for the four gates of the original query that are deliberately not here.
        SELECT s.groupid,
               SUM(s.soldprice * s.qty)::numeric / NULLIF(SUM(s.qty), 0) AS avg_price,
               SUM(s.qty)                                                AS units,
               -- The NET per-unit figure utils/shopifyProfit.js wrote on every row, summed: VAT, cost, payment fee, packing, postage
               -- and the returns haircut are all already inside it. Everything except advertising, which is what the ads CTE adds below.
               SUM(s.profit)                                             AS net_profit
        FROM sales s
        JOIN styles st ON st.groupid = s.groupid
        WHERE s.channel IN ('SHP', 'CM3')
          AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= CURRENT_DATE - 365
        GROUP BY s.groupid
      ),
      ads AS (
        -- Google spend over the SAME 365 days. Verified coverage before this was built: google_product_daily runs from 2025-08-01
        -- unbroken, so the window is fully covered rather than silently part-measured.
        --
        -- NO ROW MEANS ZERO, NEVER AN ESTIMATE (owner, 2026-09-08). The ad floor borrows a segment median when a style's own data is
        -- too thin, because it answers a HYPOTHETICAL — what would a customer cost. Kept measures WHAT HAPPENED, so imputing spend to
        -- a style that never spent would invent a loss, and would do it to exactly the styles selling organically: the best ones.
        -- On the current book the case does not arise at all (0 of the 172 Birkenstock styles that sold have no spend; 3 catalogue-
        -- wide), but the rule is what protects the number if it ever does.
        SELECT groupid, SUM(cost) AS spend
        FROM google_product_daily
        WHERE snapshot_date >= CURRENT_DATE - 365
        GROUP BY groupid
      ),
      grid AS (
        -- One row per style carrying both size maps and both totals. Built off the sizes CTE (the full size range) and LEFT JOINed to the
        -- two quantity sources, so the maps always share an identical key set — the client can read one map's keys and index the other.
        SELECT z.groupid,
               jsonb_object_agg(z.sz, COALESCE(live.units, 0)) AS live_sizes,
               jsonb_object_agg(z.sz, COALESCE(inc.units, 0))  AS incoming_sizes,
               SUM(COALESCE(live.units, 0))                    AS live_units,
               SUM(COALESCE(inc.units, 0))                     AS incoming_units
        FROM sizes z
        LEFT JOIN live ON live.groupid = z.groupid AND live.sz = z.sz
        LEFT JOIN inc  ON inc.groupid  = z.groupid AND inc.sz  = z.sz
        GROUP BY z.groupid
      )
      SELECT st.groupid, st.title, st.segment,
             st.review,
             COALESCE(sold.units, 0)                    AS sold365,
             -- EX VAT: UK VAT is 1/6 of a VAT-inclusive price, so price / 1.2 is the price the cost can honestly be subtracted from.
             -- The same 1/6 rule utils/shopifyProfit.js uses, written the other way round; if the VAT rate ever moves, both change.
             -- NULL (not 0) when the style has no sales in the window or an unusable cost — the client draws those as a dash.
             ROUND((perf.avg_price / 1.2 - st.cost) * perf.units, 0) AS gross,
             -- KEPT — the banded measure. Net profit less the style's own Google spend: what the style actually left behind.
             -- NULL when there are no sales in the window, exactly like gross, so "unknown" never reads as a confident zero and
             -- never satisfies a threshold. A style with sales but no ad spend is a real 0 deduction, not a null.
             ROUND(perf.net_profit - COALESCE(a.spend, 0), 0)         AS kept,
             ROUND(COALESCE(a.spend, 0), 0)                           AS ad_spend,
             COALESCE(grid.live_units, 0)               AS live_units,
             COALESCE(grid.incoming_units, 0)           AS incoming_units,
             COALESCE(grid.live_sizes, '{}'::jsonb)     AS live_sizes,
             COALESCE(grid.incoming_sizes, '{}'::jsonb) AS incoming_sizes
      FROM styles st
      LEFT JOIN grid ON grid.groupid = st.groupid
      LEFT JOIN sold ON sold.groupid = st.groupid
      LEFT JOIN perf ON perf.groupid = st.groupid
      LEFT JOIN ads  a  ON a.groupid   = st.groupid
      ORDER BY st.title NULLS LAST, st.groupid
    `);

    // pg hands SUM() back as a string (numeric/bigint) — coerce so the client sorts and compares without parsing. The jsonb maps are
    // built from those same aggregates, so their values need the same treatment.
    const toIntMap = (m) => {
      const out = {};
      for (const [k, v] of Object.entries(m || {})) out[k] = Number(v) || 0;
      return out;
    };

    const rows = result.rows.map((r) => ({
      groupid: r.groupid,
      title: r.title || null,
      segment: r.segment || null,
      // The parked-until date as 'YYYY-MM-DD', or null for a style that has never been parked. Passed through untouched: the client
      // compares it as a string against today, which is exact for ISO dates and cannot pick up a timezone on the way.
      review: r.review || null,
      sold365: Number(r.sold365) || 0,
      // null stays null: no sales in the window, or a cost we could not read. `Number(null) || 0` would have turned "unknown" into a
      // confident zero, which on a threshold screen means the row quietly fails every "over 1000" test for the wrong reason.
      gross: r.gross === null || r.gross === undefined ? null : Number(r.gross),
      // Same null discipline as gross, and for the same reason — see the note above it.
      kept: r.kept === null || r.kept === undefined ? null : Number(r.kept),
      adSpend: Number(r.ad_spend) || 0,
      live: Number(r.live_units) || 0,
      incoming: Number(r.incoming_units) || 0,
      liveSizes: toIntMap(r.live_sizes),
      incomingSizes: toIntMap(r.incoming_sizes),
    }));

    // ---- AD DATA FRESHNESS — a dead-feed alarm, not a correction ------------------------------------------------------------
    // Kept subtracts ad spend up to the last day we hold, while sales.profit is live to today. The gap therefore ALWAYS flatters
    // Kept, never the reverse, and on a screen whose job is to catch styles that lose money the bias points the wrong way. At the
    // normal 2-3 day lag that is noise (~2% of the book); at 30 days it is ~21% and nine extra styles climb above the zero rung,
    // which on a re-order sheet means ordering nine styles that actually lost money.
    //
    // THE POINT IS THE STOPPED FEED, NOT THE LAG. Imports are manual today and will be a cron when the Ads API lands; a cron that
    // dies on an expired token fails SILENTLY, and this module has already had that exact failure once (google_campaign_daily
    // silently lost 22 days). A date that stops moving is visible in a way that numbers quietly improving are not.
    //
    // "Complete" matches routes/google-ads-styles.js exactly — we hold a row for the day captured on a LATER calendar day, so a
    // part day (a report pulled at 14:38 contains that day up to 14:38) is not eligible. One definition of "how fresh is the ad
    // data" across both screens. NOT used to anchor the 365-day window: this is an indicator, and re-anchoring would silently
    // change the measure as well as report on it.
    const asOfRes = await query(`
      SELECT to_char(d, 'YYYY-MM-DD') AS as_of, (CURRENT_DATE - d) AS days_old
      FROM (
        SELECT LEAST(CURRENT_DATE, (
                 SELECT MAX(snapshot_date) FROM google_product_daily
                 WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
               )) AS d
      ) x
    `);
    const asOf = asOfRes.rows[0] || {};

    return res.json({
      return_code: 'SUCCESS',
      count: rows.length,
      // The last COMPLETE day of Google ad data behind every `kept` on this payload, and how stale that is. The screen renders the
      // date and warns on it; it does not adjust any figure.
      adsAsOf: asOf.as_of || null,
      adsDaysOld: asOf.days_old === undefined || asOf.days_old === null ? null : Number(asOf.days_old),
      rows,
    });
  } catch (err) {
    logger.error('[birk-stock] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Birkenstock stock' });
  }
});

module.exports = router;
