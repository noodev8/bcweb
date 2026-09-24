/*
=======================================================================================================================================
API Route: pricing_drill
=======================================================================================================================================
Method: GET
Purpose: Stage 2 — drill-down for one style. Returns everything the decision screen needs (see CLAUDE.md, "drill-down"):
           - header  : current price (now), rrp, cost, min/max bounds, stock, GROSS margin, cooldown date, title, tags.
           - timeline: one row per distinct price the style has SOLD at, newest first (latest era on top), with units, PACE (/wk) and NET PROFIT/wk, all app-side.
           - weeks   : 6-week zero-filled velocity (units, avg sold price, net profit per week), oldest→newest — the TREND ("is it slowing
                       this week?"), ported from amz-drill so both drills share one Velocity view (drill-evidence-spec §4, block 2).
           - bands   : units sold at each distinct price over 60 days, ascending price, with NET profit-per-unit — the resistance / "how high
                       can I go" guardrail (drill-evidence-spec §3/§4, ported from amz-drill so both drills share one Units-by-price view).
           - sizes   : remaining stock by size (code suffix after the last '-'; see S5), each with Amazon's price and stock for that size — a guardrail
                       before a CUT (CLAUDE.md) and, since 2026-09-15, the Amazon reference the retired match-Amazon autopilot used to
                       act on. Shopify is priced independently of Amazon; Amazon is shown, never obeyed (advisory — nothing blocks).

Why pace is computed here (not in SQL): total units mislead across periods of different length. Pace makes eras comparable.
  per_wk   = units / weeks
  weeks    = max(span_days, 7) / 7           <- floor at 1 week so a tiny era / single sale doesn't show a wild number (CLAUDE.md)
  span_days = last_sale_date - first_sale_date  (for that price)
The cleaner signal for going higher is a price step where pace HELD (a rise with no slowdown) — the UI surfaces units + pace so the
user can read that; we do not editorialise here.

Schema landmines respected: prices are VARCHAR (can hold junk) -> read via safeNumeric() (S3). Stock from localstock, never stockvariants.
Size = the code's suffix after the last '-' (S5 says why not RIGHT(code,2)). Human name from title.shopifytitle, not the overloaded colour tag (CLAUDE.md).
=======================================================================================================================================
Request Query Params:
  groupid (string, required)
  days    (int, optional)   - timeline lookback window; default 90 (S4)

Success Response:
{
  "return_code": "SUCCESS",
  "header": {
    "groupid": "ABC123", "title": "Arizona Birko-Flor",
    "now": 36.95, "cost": 20.83, "rrp": 50.00, "minp": 35.99, "maxp": 45.00,
    "margin": 16.12, "margin_pct": 44,        // GROSS: now - cost, and as % of price (null if now/cost unknown)
    "stock": 8, "colour": "Brown", "width": "Narrow", "season": "SS25",
    "imagename": "arizona-birko-flor-brown.jpg",  // product image filename (served from images.brookfieldcomfort.com) or null
    "next_review": "2026-07-10",              // cooldown date (or null)
    "ad_floor": 71.55,                        // ADVISORY price floor: below this the style stops paying for its own Google ads
    "ad_cost_per_sale": 12.76,                // Google spend / units over the window — what one customer cost
    "ad_floor_confidence": "own",             // 'own' | 'segment' (an ESTIMATE from neighbours) | 'none' (render nothing)
    "ad_floor_basis": { "clicks": 309, "units": 12, "spend": 153.17, "days": 90 },
    "below_ad_floor": false,                  // now < ad_floor. Advisory — pricing-apply does NOT enforce it
    "match_amazon": false,                    // RETIRED 2026-09-15 — always false now (see the note at the mapping below)
    "amazon_lowest": 37.30,                   // cheapest live Amazon size (null if none in stock)      "amazon_highest": 41.09,                  // dearest live Amazon size                           |- ADVISORY CONTEXT only
    "amazon_live_total": 184                  // units Amazon holds across in-stock sizes           /
  },
  "timeline": [
    { "price": 32.95, "units": 17, "profit": 90.44, "profit_wk": 33, "first_at": "2026-04-01", "last_at": "2026-04-20",
      "span_days": 19, "weeks": 2.71, "per_wk": 6.3, "is_current": false },
    ... // newest first (by each price's first sale date); is_current=true when price == header.now. profit/profit_wk are NET (from
    ... // sales.profit, not price-cost); profit_wk = era £/wk = the "best price" ranking; null when the era has no profit data.
  ],
  "weeks": [
    { "week_start": "2026-06-01", "units": 4, "avg_price": 57.87, "profit": 89.60 },
    { "week_start": "2026-06-08", "units": 6, "avg_price": 65.00, "profit": 177.48 }
    // oldest -> newest (a trend reads left-to-right; NOT the timeline's "latest on top" rule); zero-filled so a gap week reads 0
  ],
  "bands": [
    { "price": 57.87, "units": 12, "profit_per_unit": 22.40, "first": "2026-05-16", "last": "2026-05-29" },
    { "price": 65.00, "units": 18, "profit_per_unit": 29.58, "first": "2026-06-01", "last": "2026-06-30" }
    // ascending price (ceiling reads top-down); profit_per_unit is NET (sales.profit / units), null when no profit data
  ],
  "sizes": [ { "size": "38", "qty": 3, "amz_price": 40.39, "amz_live": 36 },
             { "size": "39", "qty": 5, "amz_price": null,  "amz_live": 0 } ],  // oldest-first by size
    // amz_price/amz_live = what Amazon charges and holds for THAT size. amz_price null = size not on Amazon FBA (render "—", not 0).
  "days": 90
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();

// UK VAT at 20% on a VAT-inclusive price: gross / 1.2 = the ex-VAT amount, the same convention utils/shopifyProfit.js and
// utils/amzProfit.js use. See the margin note in this file's header for why the DIAL carries it.
const VAT_MULTIPLIER = 1.2;
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { getAdFloors } = require('../utils/adFloor');
const logger = require('../utils/logger');

router.use(verifyToken);

// pg returns numeric as a string (to preserve precision). Coerce to a JS number for money we only ever show to 2dp. null-safe.
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Format a pg 'date' (parsed to a JS Date at local midnight) as YYYY-MM-DD using local components (avoids UTC day-shift). null-safe.
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

router.get('/', async (req, res) => {
  try {
    const { groupid } = req.query;
    const days = Number.parseInt(req.query.days, 10) > 0 ? Number.parseInt(req.query.days, 10) : 90;

    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // ---- S3: header (CLAUDE.md) — stock derived from localstock. Prices are legacy VARCHARs that can hold junk (e.g. rrp='RRP'),
    // so cast them with safeNumeric (returns NULL on non-numeric) rather than a plain ::numeric that would 500 the request. ----
    const headerResult = await query(`
      SELECT
        ${safeNumeric('ss.shopifyprice')}    AS now,
        ${safeNumeric('ss.cost')}            AS cost,
        ${safeNumeric('ss.rrp')}             AS rrp,
        ${safeNumeric('ss.minshopifyprice')} AS minp,
        ${safeNumeric('ss.maxshopifyprice')} AS maxp,
        ss.colour, ss.width, ss.season, ss.next_shopify_price_review,
        ss.imagename,
        ss.match_amazon_price AS match_amazon,
        -- The style's live Amazon price SPREAD and stock, over in-stock sizes only (amzlive>0), read via safeNumeric (amzprice is a
        -- junk-prone VARCHAR). Amazon prices per SIZE, so there is no single "the Amazon price" — the low/high pair is the honest
        -- summary and the per-size detail is in sizes[] below. CONTEXT, NOT A RULE (2026-09-15): the retired amz-match autopilot used
        -- amazon_lowest as a target to pin shopifyprice to; now it is only shown, because the same price nets roughly twice as much on
        -- Shopify (no referral fee) and matching down gave that away. amzfeed is READ ONLY (CLAUDE.md).
        (SELECT MIN(${safeNumeric('a.amzprice')}) FROM amzfeed a
          WHERE a.groupid = ss.groupid AND COALESCE(a.amzlive,0) > 0) AS amazon_lowest,
        (SELECT MAX(${safeNumeric('a.amzprice')}) FROM amzfeed a
          WHERE a.groupid = ss.groupid AND COALESCE(a.amzlive,0) > 0) AS amazon_highest,
        COALESCE((SELECT SUM(COALESCE(a.amzlive,0)) FROM amzfeed a
          WHERE a.groupid = ss.groupid AND COALESCE(a.amzlive,0) > 0),0) AS amazon_live_total,
        t.shopifytitle,
        COALESCE((SELECT SUM(l.qty) FROM localstock l
                  WHERE l.groupid=ss.groupid AND l.ordernum='#FREE'
                    AND COALESCE(l.deleted,0)=0 AND l.qty>0),0) AS stock
      FROM skusummary ss
      LEFT JOIN title t ON t.groupid = ss.groupid
      WHERE ss.groupid = $1
    `, [groupid]);

    if (headerResult.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    const h = headerResult.rows[0];
    const now = num(h.now);
    const cost = num(h.cost);
    // Margin is EX-VAT (2026-08-31): shopifyprice is the VAT-inclusive price the customer pays, and the ~1/6 of it that goes to HMRC
    // was never ours to count. This stays a HIGH-LEVEL DIAL — it deliberately does NOT carry postage, packing, the payment fee or the
    // returns haircut (that is what sales.profit is for, on the Analytics and Brands screens); those are constants that do not move as
    // the operator nudges, so they would shift the number without informing the decision. VAT is the exception because it moves where
    // ZERO is: gross margin reads 0% at price = cost, but the real breakeven is price = cost x 1.2. On live data 8 priced styles sat in
    // that band — e.g. 1029777-FLORIDA at 44.00 on 39.58 cost read +10.0% while actually being -7.9%. Below ~17% the old dial had the
    // WRONG SIGN, which is exactly the end of the range a price cut walks into. Owner's call, deliberately scoped to VAT only.
    const netNow = now === null ? null : now / VAT_MULTIPLIER;
    const margin = netNow !== null && cost !== null ? Math.round((netNow - cost) * 100) / 100 : null;
    const marginPct = margin !== null && netNow ? Math.round((margin / netNow) * 100) : null;

    const header = {
      groupid,
      title: h.shopifytitle || null,
      now,
      cost,
      rrp: num(h.rrp),
      minp: num(h.minp),
      maxp: num(h.maxp),
      margin,
      margin_pct: marginPct,
      stock: Number(h.stock),
      colour: h.colour || null,
      width: h.width || null,
      season: h.season || null,
      // Filename only (or null) — served from https://images.brookfieldcomfort.com/<imagename> on the web side, same as the other
      // screens. Purely so the operator can eyeball what they're pricing; not used in any decision logic.
      imagename: h.imagename || null,
      next_review: toIsoDate(h.next_shopify_price_review),
      // Auto-match-to-Amazon state. RETIRED 2026-09-15 (owner): the cron that acted on the flag is rem'd out and every row was set
      // back to false, so this is false everywhere and the UI is switched off behind AMZ_MATCH_UI. Kept (not deleted) so the feature
      // revives by flipping that flag back on.
      match_amazon: h.match_amazon === true,
      // Amazon as CONTEXT for a Shopify decision: the live price spread across in-stock sizes and how many units sit behind it. The
      // per-size breakdown is in sizes[]; these three give the screen a one-line summary without it re-deriving min/max itself.
      amazon_lowest: num(h.amazon_lowest),
      amazon_highest: num(h.amazon_highest),
      amazon_live_total: Number(h.amazon_live_total)
    };

    // ---- Ad floor — the price below which the style stops paying for its own Google advertising (utils/adFloor.js). ----
    // ADVISORY ONLY. It is not a bound: pricing-apply does not check it and will not refuse a price beneath it (owner's call — a hard
    // block on an estimate over drifting ad data eventually refuses a price that was right). It sits beside `margin` because it
    // answers the question `margin` cannot: the margin can look healthy and still be smaller than what the click cost to buy.
    // `confidence` is load-bearing for the UI — 'segment' is an estimate borrowed from the style's neighbours and must be rendered as
    // one, and 'none' means show nothing at all rather than implying the (separately enforced) below-cost bound is an ad floor.
    const floors = await getAdFloors([groupid]);
    const floor = floors.get(groupid) || null;
    header.ad_floor = floor ? floor.adFloor : null;
    header.ad_cost_per_sale = floor ? floor.adCostPerSale : null;
    header.ad_floor_confidence = floor ? floor.confidence : 'none';
    header.ad_floor_basis = floor ? { clicks: floor.clicks, units: floor.units, spend: floor.spend, days: floor.windowDays } : null;
    // Below the floor the unit is sold at a loss once the click is paid for. Precomputed so the screen does not re-derive the
    // comparison (and cannot get it wrong when the floor is null).
    header.below_ad_floor = header.ad_floor !== null && now !== null && now < header.ad_floor;

    // ---- S4: pricing timeline (CLAUDE.md) — verbatim. Pace computed app-side below. ----
    const timelineResult = await query(`
      SELECT soldprice, SUM(qty) AS units, SUM(profit) AS profit, MIN(solddate) AS first_at, MAX(solddate) AS last_at
      FROM sales
      WHERE groupid=$1 AND channel='SHP' AND qty>0 AND soldprice>0
        AND solddate >= CURRENT_DATE - $2::int
      GROUP BY soldprice
      ORDER BY MIN(solddate) DESC
    `, [groupid, days]);

    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    const timeline = timelineResult.rows.map((r) => {
      const price = num(r.soldprice);
      const units = Number(r.units);
      const first = r.first_at instanceof Date ? r.first_at : new Date(r.first_at);
      const last = r.last_at instanceof Date ? r.last_at : new Date(r.last_at);
      // span_days = last - first for this price. weeks floored at 1 (CLAUDE.md). per_wk = units / weeks.
      const spanDays = Math.round((last - first) / MS_PER_DAY);
      const weeks = Math.max(spanDays, 7) / 7;
      const perWk = Math.round((units / weeks) * 10) / 10; // 1 dp is enough for a pace figure
      // Profit velocity (spec §2.4/§4, step 2): NET £/wk at this price, from the sales.profit column (already net of fees/shipping —
      // NOT price-cost, which is the gross margin the header shows). This is what actually ranks prices: margin × pace in one number.
      // SUM(profit) is null only if every row's profit is null (no profit data for this era) → profit_wk null, don't fabricate a 0.
      const profit = num(r.profit);
      const profitWk = profit !== null ? Math.round(profit / weeks) : null; // whole £/wk — a rate needs no pence
      return {
        price,
        units,
        profit: profit !== null ? Math.round(profit * 100) / 100 : null, // era total, 2dp
        profit_wk: profitWk,
        first_at: toIsoDate(r.first_at),
        last_at: toIsoDate(r.last_at),
        span_days: spanDays,
        weeks: Math.round(weeks * 100) / 100,
        per_wk: perWk,
        // Label the current price's row end "now" in the UI. A just-changed price shows no row until something sells.
        is_current: now !== null && price === now
      };
    });

    // ---- S5: size curve — size = everything after the LAST '-' of the code, NOT RIGHT(code,2). ----
    // RIGHT(code,2) (the CLAUDE.md rule) is only right for two-digit EU sizes. Half sizes break it: 25511-41-022-37.5, -38.5 and
    // -40.5 all came out as '.5' and were summed into ONE size (found 2026-09-24 when the price card's size run showed ".5  3");
    // UK-sized codes like 233103-BBK-8 came out as '-8'. ~10% of live skumap codes are half sizes. The suffix after the last '-' is
    // the size as the code spells it, for every format.
    // Show EVERY size the style comes in, with 0 for sold-out sizes: a sold-out core (e.g. 38/39 gone) is exactly the guardrail
    // signal we want to SEE before a cut (CLAUDE.md). localstock holds in-stock rows only (a size that sells out has no row — there are no
    // qty<=0/deleted rows), so the size universe comes from skumap (the per-groupid size map). We take every non-deleted size in
    // skumap and LEFT JOIN the sellable stock (pre-aggregated per size so multiple stock rows per code don't fan out the join),
    // defaulting to 0.
    //
    // Each size also carries what Amazon is charging for it and how many units Amazon holds (2026-09-15, replacing the retired
    // match-Amazon autopilot). Amazon prices per SIZE while Shopify prices per STYLE, so the operator setting one Shopify price needs
    // to see the whole Amazon spread — a single "Amazon price" does not exist, and the old autopilot's answer (pin to the cheapest
    // in-stock size) let one thin size set the price for the style. Aggregated per size before the join for the same reason the stock
    // side is: multiple amzfeed rows for a code must not fan the size rows out. amzfeed is READ ONLY (CLAUDE.md).
    const sizesResult = await query(`
      SELECT sizes.size, COALESCE(st.qty, 0) AS qty, af.amz_price, COALESCE(af.amz_live, 0) AS amz_live
      FROM (
        SELECT DISTINCT SUBSTRING(code FROM '[^-]*$') AS size
        FROM skumap WHERE groupid=$1 AND COALESCE(deleted,0)=0
      ) sizes
      LEFT JOIN (
        SELECT SUBSTRING(code FROM '[^-]*$') AS size, SUM(qty) AS qty FROM localstock
        WHERE groupid=$1 AND ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY SUBSTRING(code FROM '[^-]*$')
      ) st ON st.size = sizes.size
      LEFT JOIN (
        SELECT SUBSTRING(code FROM '[^-]*$') AS size,
               MAX(${safeNumeric('amzprice')})     AS amz_price,
               SUM(COALESCE(amzlive,0))            AS amz_live
        FROM amzfeed WHERE groupid=$1
        GROUP BY SUBSTRING(code FROM '[^-]*$')
      ) af ON af.size = sizes.size
      ORDER BY sizes.size
    `, [groupid]);
    // amz_price is null when the size is not on Amazon FBA at all (or the feed price is junk) — the UI must render that as "—", never
    // as 0. amz_live 0 means listed but out of stock, which is a different fact and worth showing as such.
    const sizes = sizesResult.rows.map((r) => ({
      size: r.size,
      qty: Number(r.qty),
      amz_price: num(r.amz_price),
      amz_live: Number(r.amz_live)
    }));

    // ---- Velocity trend (drill-evidence-spec §4, block 2) — 6 weeks of units/avg-price/net-profit, zero-filled so a gap week reads 0
    // (not a hidden hole), oldest→newest (a trend is read left-to-right; this is NOT the timeline's "latest on top" rule). Mirror of
    // amz-drill's weeks[] query but for channel='SHP' grouped by groupid. Answers "is it slowing THIS week?" — the cumulative bands can't.
    const weeksResult = await query(`
      WITH wk AS (
        SELECT generate_series(date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks',
                               date_trunc('week', CURRENT_DATE), INTERVAL '1 week')::date AS week_start
      ),
      s AS (
        SELECT date_trunc('week', solddate)::date AS week_start,
               SUM(CASE WHEN qty>0 THEN qty ELSE 0 END)::int AS units,
               ROUND(AVG(CASE WHEN qty>0 THEN soldprice END)::numeric, 2) AS avg_price,
               ROUND(SUM(profit)::numeric, 2) AS profit
        FROM sales
        WHERE channel='SHP' AND groupid=$1 AND solddate >= date_trunc('week', CURRENT_DATE) - INTERVAL '5 weeks'
        GROUP BY 1
      )
      SELECT to_char(wk.week_start, 'YYYY-MM-DD') AS week_start,
             COALESCE(s.units,0) AS units, s.avg_price, COALESCE(s.profit,0) AS profit
      FROM wk LEFT JOIN s USING (week_start)
      ORDER BY wk.week_start
    `, [groupid]);
    const weeks = weeksResult.rows.map((r) => ({
      week_start: r.week_start, units: Number(r.units),
      avg_price: num(r.avg_price), profit: Number(r.profit),
    }));

    // ---- Units-by-price bands (drill-evidence-spec §4, block 3) — the resistance guardrail, mirror of amz-drill's bands but for
    // channel='SHP' grouped by groupid. Fixed 60-day window (independent of the timeline's `days`), ascending price so the ceiling
    // reads top-down. profit_per_unit = NET SUM(profit)/SUM(qty) at that price (from sales.profit, not price-cost) → the band shows
    // reward as well as volume; NULLIF guards the divide, and it's null when the era carries no profit data.
    const bandsResult = await query(`
      SELECT soldprice AS price,
             SUM(qty)::int AS units,
             ROUND(SUM(profit)::numeric / NULLIF(SUM(qty), 0), 2) AS profit_per_unit,
             to_char(MIN(solddate), 'YYYY-MM-DD') AS first,
             to_char(MAX(solddate), 'YYYY-MM-DD') AS last
      FROM sales
      WHERE groupid=$1 AND channel='SHP' AND qty>0 AND soldprice>0
        AND solddate >= CURRENT_DATE - 60
      GROUP BY soldprice
      ORDER BY soldprice
    `, [groupid]);
    const bands = bandsResult.rows.map((r) => ({
      price: num(r.price),
      units: Number(r.units),
      profit_per_unit: num(r.profit_per_unit),
      first: r.first,
      last: r.last,
    }));

    return res.json({ return_code: 'SUCCESS', header, timeline, weeks, bands, sizes, days });
  } catch (err) {
    logger.error('[pricing-drill] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load style detail' });
  }
});

module.exports = router;
