/*
=======================================================================================================================================
API Route: pricing_drill
=======================================================================================================================================
Method: GET
Purpose: Stage 2 — drill-down for one style. Returns everything the decision screen needs (see CLAUDE.md, "drill-down"):
           - header  : current price (now), rrp, cost, min/max bounds, stock, GROSS margin, cooldown date, title, tags.
           - timeline: one row per distinct price the style has SOLD at, newest first (latest era on top), with units, PACE (/wk) and NET PROFIT/wk, all app-side.
           - bands   : units sold at each distinct price over 60 days, ascending price, with NET profit-per-unit — the resistance / "how high
                       can I go" guardrail (drill-evidence-spec §3/§4, ported from amz-drill so both drills share one Units-by-price view).
           - sizes   : remaining stock by EU size (RIGHT(code,2)) — a collapsible guardrail before a CUT (CLAUDE.md).

Why pace is computed here (not in SQL): total units mislead across periods of different length. Pace makes eras comparable.
  per_wk   = units / weeks
  weeks    = max(span_days, 7) / 7           <- floor at 1 week so a tiny era / single sale doesn't show a wild number (CLAUDE.md)
  span_days = last_sale_date - first_sale_date  (for that price)
The cleaner signal for going higher is a price step where pace HELD (a rise with no slowdown) — the UI surfaces units + pace so the
user can read that; we do not editorialise here.

Schema landmines respected: prices are VARCHAR (can hold junk) -> read via safeNumeric() (S3). Stock from localstock, never stockvariants.
Size = RIGHT(code,2). Human name from title.shopifytitle, not the overloaded colour tag (CLAUDE.md).
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
    "next_review": "2026-07-10"               // cooldown date (or null)
  },
  "timeline": [
    { "price": 32.95, "units": 17, "profit": 90.44, "profit_wk": 33, "first_at": "2026-04-01", "last_at": "2026-04-20",
      "span_days": 19, "weeks": 2.71, "per_wk": 6.3, "is_current": false },
    ... // newest first (by each price's first sale date); is_current=true when price == header.now. profit/profit_wk are NET (from
    ... // sales.profit, not price-cost); profit_wk = era £/wk = the "best price" ranking; null when the era has no profit data.
  ],
  "bands": [
    { "price": 57.87, "units": 12, "profit_per_unit": 22.40, "first": "2026-05-16", "last": "2026-05-29" },
    { "price": 65.00, "units": 18, "profit_per_unit": 29.58, "first": "2026-06-01", "last": "2026-06-30" }
    // ascending price (ceiling reads top-down); profit_per_unit is NET (sales.profit / units), null when no profit data
  ],
  "sizes": [ { "size": "38", "qty": 3 }, { "size": "39", "qty": 5 } ],  // oldest-first by size
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
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
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
    // Margin = now - cost, and as a % of the selling price (CLAUDE.md). null when we can't compute either side.
    const margin = now !== null && cost !== null ? Math.round((now - cost) * 100) / 100 : null;
    const marginPct = margin !== null && now ? Math.round((margin / now) * 100) : null;

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
      next_review: toIsoDate(h.next_shopify_price_review)
    };

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

    // ---- S5: size curve (CLAUDE.md) — size = RIGHT(code,2). ----
    // Show EVERY size the style comes in, with 0 for sold-out sizes: a sold-out core (e.g. 38/39 gone) is exactly the guardrail
    // signal we want to SEE before a cut (CLAUDE.md). localstock holds in-stock rows only (a size that sells out has no row — there are no
    // qty<=0/deleted rows), so the size universe comes from skumap (the per-groupid size map). We take every non-deleted size in
    // skumap and LEFT JOIN the sellable stock (pre-aggregated per size so multiple stock rows per code don't fan out the join),
    // defaulting to 0.
    const sizesResult = await query(`
      SELECT sizes.size, COALESCE(st.qty, 0) AS qty
      FROM (
        SELECT DISTINCT RIGHT(code,2) AS size
        FROM skumap WHERE groupid=$1 AND COALESCE(deleted,0)=0
      ) sizes
      LEFT JOIN (
        SELECT RIGHT(code,2) AS size, SUM(qty) AS qty FROM localstock
        WHERE groupid=$1 AND ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0
        GROUP BY RIGHT(code,2)
      ) st ON st.size = sizes.size
      ORDER BY sizes.size
    `, [groupid]);
    const sizes = sizesResult.rows.map((r) => ({ size: r.size, qty: Number(r.qty) }));

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

    return res.json({ return_code: 'SUCCESS', header, timeline, bands, sizes, days });
  } catch (err) {
    logger.error('[pricing-drill] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load style detail' });
  }
});

module.exports = router;
