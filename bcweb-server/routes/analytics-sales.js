/*
=======================================================================================================================================
API Route: analytics_sales   (Analytics module — "Sales")
=======================================================================================================================================
Method: GET
Purpose: The sales ledger an analyst opens to answer "how are we doing?" — the raw sale lines for a chosen window and channel, each with
         the PROFIT the owner's downstream P&L already computed, plus a summary strip (net profit is the headline, with revenue, units and
         margin supporting). Replaces the legacy PowerBuilder "Sales" screen, but reframed for analysis rather than data entry:
           - windowed. TWO tiers by design:
               * SHORT windows (Today / Yesterday / 3 days) return the summary AND the line list — the "is today's trade healthy?" pulse.
               * LONG windows (7 / 30 / 90 days) are SUMMARY-ONLY — the honest net-profit / revenue / units totals over the horizon, with
                 NO line list (the point is the headline; a 30-90d list would be thousands of rows). The rows query is skipped entirely in
                 this mode (nothing fetched), and the response carries `summaryOnly:true` so the UI hides the table and explains why.
             (A product SEARCH overrides the window either way — see below.)
           - channel-filtered (All / Shopify / Amazon — "All" also folds in the minor CM3 channel so the totals reconcile),
           - NARROWED BY SEARCH STEPS (`has` / `not`), the Inventory-style filter ported here (owner, 2026-07-25). Instead of one debounced
             box, the operator commits terms one at a time and each ANDs onto the last ("ARIZONA" -> not "EVA" -> "BLACK"). Every step is
             applied HERE, in SQL, not in the browser — the browser only ever holds the capped page of lines, so a client-side narrowing
             step would be filtering a 200-row sample of a possibly-thousand-row set and the headline totals computed from it would be a
             partial number wearing an honest label. Server-side, the summary below stays an uncapped aggregate of the fully-narrowed set
             no matter how many steps are on. Measured cost of the worst case (whole table, no date bound, a contains AND a not-contains,
             no usable index): ~28ms on a 17.7k-row / 9MB table that lives in shared buffers — so there is nothing to optimise here and
             deliberately no trigram index (revisit past ~500k rows).
               * `has` is a loose SUBSTRING (operators type partials — "ARIZ" must find "Arizona").
               * `not` is the exact MIRROR — also a plain substring, so anything containing the term is dropped. Mirrors Inventory.
                 Was `\y…\y` whole-word until 2026-08-25; that could not drop "Womens …" for `not=WOMEN`, because the boundary falls
                 between "n" and "s". Cost of the change: excluding "SAND" also drops "SANDALS" — accepted, see the loop below.
             A `has` step (>= 3 chars on the FIRST one) flips the screen into PRODUCT MODE: the preset window is replaced by a rolling
             LAST 12 MONTHS, newest-first, capped at 200 lines — because a search means "how is this product doing lately?", and a
             recent-year lens gauges current performance without blending in last season (the table only reaches back to Aug 2024 anyway,
             so "all time" would be ~24 months = two seasons in one total). The summary covers that 12-month matched set, `lines` reports
             how many lines actually matched (so the UI can say "latest 200 of 318" honestly), and `products` (distinct styles matched)
             warns when a loose term spans more than one product. A `not`-only search does NOT flip modes — it just narrows the window
             you are already looking at,
           - RETURNS INCLUDED. Unlike the pricing module (which is positive-lines-only, because it's about velocity), a sales/profit
             report must show refunds — a return is a real negative-profit line — and NET them into the totals. The summary therefore
             breaks units into sold / returned / net, mirroring the legacy footer (Sold / Returned / Net).

         Two queries share one filter (window + channel + search):
           - SUMMARY aggregates over the WHOLE window (never bounded by the row cap) so the headline totals stay honest even when the
             table below is truncated.
           - ROWS returns up to `limit` in the requested ORDER (fetch limit+1 to detect truncation, like pricing-sales), for the on-screen
             table and the client-side CSV export.

         SORTING IS DONE HERE, IN SQL (owner, 2026-08-03: "can we have a sort on the columns"), for the same reason the search steps are —
         the browser only ever holds the capped page. A client-side sort would re-order that page, which is fine while the whole set fits
         but silently wrong the moment it doesn't: ordering by date ASCENDING in the browser gives you the oldest of the LATEST 200, i.e.
         the middle of the set wearing the label "oldest". Sorted in SQL, the cap and the order are applied together and ascending really
         does return the oldest rows. Only the two columns the operator asked for are sortable (`date`, `product`); the money columns were
         not requested and would each need a NULL policy, so they stay out until they're wanted.

Schema notes (CLAUDE.md): `sales.solddate` is a bare DATE and `ordertime` a 'HH:MM' VARCHAR (blank on some legacy rows) — we order by
solddate, then ordertime (NULLS LAST), then id. `soldprice` and `profit` are NUMERIC; `profit` is populated downstream (100% coverage) so
we surface it as-is rather than re-deriving. Returns are negative-`qty` lines. Revenue = SUM(soldprice*qty) (returns subtract).

MARGIN IS NET-OVER-NET (2026-08-31). `soldprice` is the VAT-INCLUSIVE price the customer paid; `profit` has already had the VAT taken out
of it (utils/shopifyProfit.js and utils/amzProfit.js both deduct price/6). Dividing one by the other mixed a net numerator into a gross
denominator and understated every margin on this screen by ~2.7 points. Margin% is now profit / netRevenue, where netRevenue =
revenue / 1.2, at BOTH grains (summary and per line). REVENUE ITSELF IS STILL REPORTED GROSS — that is the number that reconciles with
Shopify, Seller Central and the bank — with `netRevenue` alongside it so the margin can be checked by hand. Same rule, same constant and
same reasoning as routes/brand-overview.js (rule 3 in its header); the two screens are read side by side and must not disagree.
`sales.collectedvat` exists but is populated on CM3 rows only (and is exactly 1/6 there), so the /6 convention the two profit utils
already use is the one source of truth — do not switch to the column until it is backfilled on SHP and AMZ. Size = RIGHT(code,2). Window bounds are computed in SQL off CURRENT_DATE (the anchor the rest of the app trusts).
Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, optional)  - 'all' (default, incl. CM3) | 'shp' | 'amz'. Case-insensitive.
  window  (string, optional)  - 'today' (default) | 'yesterday' | '3d' (these carry the line list) | '7d' | '30d' | '90d' (SUMMARY-ONLY —
                                totals with no rows). No custom range by design. IGNORED when a `has` step is active (product mode = last 12 months).
  has     (string[], optional)- repeatable. Each term ANDs a substring match over product name / groupid / SKU code (case-insensitive).
                                The FIRST one must be >= 3 chars (a 1-2 char opener would drag back most of the table); later ones, which
                                only narrow what the first matched, have no minimum. Any `has` term flips to product mode (last 12 months).
  not     (string[], optional)- repeatable. Each term ANDs a WHOLE-WORD exclusion over the same three fields. Does not flip modes on its
                                own, so it can narrow the current window's lines.
  search  (string, optional)  - legacy alias for a single `has` term (kept so older callers/links keep working).
  limit   (int, optional)     - pulse-mode row cap; default 500, clamped to [1, 5000]. Product mode is fixed at 200.
                                Terms are capped at MAX_TERMS each; extras are ignored.
  sort    (string, optional)  - 'date' (default) | 'product'. Which column the rows are ordered by. Ignored in summary-only mode (no rows).
  dir     (string, optional)  - 'desc' (default) | 'asc'. Anything else falls back to 'desc', so the legacy newest-first call is unchanged.

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "all", "window": "3d", "searchActive": false, "summaryOnly": false, "from": "2026-07-11", "to": "2026-07-13", "search": null,
  "has": ["ARIZONA"], "not": ["EVA"], "sort": "date", "dir": "desc",
  "summary": { "unitsSold": 812, "unitsReturned": 19, "unitsNet": 793, "orders": 640, "lines": 318,
               // revenue is GROSS (inc VAT, as the customer paid); netRevenue is the same trade ex-VAT and is the denominator of marginPct
               "revenue": 41234.55, "netRevenue": 34362.13, "profit": 6120.11, "marginPct": 17.8, "products": 137 },
  "rows": [
    { "solddate": "2026-07-11", "ordertime": "21:37", "channel": "SHP", "code": "0051753-ARIZONA-36", "size": "36",
      "groupid": "0051753-ARIZONA", "productname": "Birkenstock Arizona ...", "brand": "Birkenstock", "ordernum": "BC18292",
      "qty": 1, "soldprice": 64.95, "profit": 10.07, "marginPct": 18.6 },   // margin vs the line's EX-VAT revenue
    ... // newest first
  ],
  "limit": 500, "count": 500, "truncated": true
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

// UK VAT at 20% on a VAT-inclusive price: gross / 1.2 = the ex-VAT amount. The same convention (VAT = price/6) that
// utils/shopifyProfit.js and utils/amzProfit.js already use to build sales.profit — margin has to come out of the same model its
// numerator did. Mirrors VAT_MULTIPLIER in routes/brand-overview.js; see the header before changing this to sales.collectedvat.
const VAT_MULTIPLIER = 1.2;
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Render a DATE/timestamp as a local 'YYYY-MM-DD' (avoids the UTC-midnight shift a bare DATE gets when serialised through JS Date).
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// The window presets, in two tiers:
//   SHORT — today / yesterday / 3 days — carry the line list (the range is tiny, so the row list stays practical and the scan cheap).
//   LONG  — 7 / 30 / 90 days — SUMMARY-ONLY: we want the net-profit / revenue totals over a longer horizon WITHOUT listing thousands of
//           rows, so in these windows the rows query is skipped and the UI shows totals only. Still no custom range on purpose (an
//           open-ended range invites full-table scans).
const SHORT_WINDOWS = new Set(['today', 'yesterday', '3d']);
const LONG_WINDOWS = new Set(['7d', '30d', '90d']);
const WINDOWS = new Set([...SHORT_WINDOWS, ...LONG_WINDOWS]);

// The text every search step is matched against: the same three fields the single-box search always covered, concatenated so one
// predicate spans all of them (and so a whole-word `not` can't be fooled by a term that straddles two of them). COALESCE because
// productname/groupid/code are all nullable on legacy rows and a NULL would swallow the whole expression.
const HAY = `(COALESCE(s.productname,'') || ' ' || COALESCE(s.groupid,'') || ' ' || COALESCE(s.code,''))`;

// The sortable columns, as a WHITELIST of ORDER BY fragments keyed by the name the client sends. A whitelist rather than interpolation
// because an ORDER BY can't be parameterised — `$1` there would sort by the constant, not the column — so the only safe way to accept a
// column name from a client is to never use the client's string in the SQL at all.
//
// `%s` is where the direction lands. Both orderings end in `id %s`, which is what makes the list STABLE: without a unique tiebreak,
// two rows sharing a date (or a product) can come back in either order between two identical requests, and paging past the cap would
// then be able to show a row twice or not at all.
//   date    — the natural ledger order: day, then time within the day. ordertime is blank on some legacy rows, so it's NULLS LAST in
//             both directions (a missing time is the least useful row either way — it should never lead the list).
//   product — the value the Product column actually DISPLAYS (`code`, falling back to groupid), so what you see is what it sorted on.
//             Because code ends in the EU size, this also lands a style's sizes in size order underneath it. Ties fall back to newest
//             first, which keeps each product's block reading like the date view.
const SORTS = {
  date:    'solddate %s, ordertime %s NULLS LAST, id %s',
  product: "COALESCE(NULLIF(code,''), groupid) %s NULLS LAST, solddate DESC, id DESC",
};

// Belt-and-braces cap on how many terms one request may carry. The operator UI can't produce more than a handful, and each term is
// another predicate on the scan — this just stops a hand-built URL turning into a silly query.
const MAX_TERMS = 8;

// A repeatable query param arrives as a string (one value) or an array (several). Normalise to a trimmed, non-empty, de-duplicated
// list. `has[]=`-style keys are accepted too, in case a client serialises arrays that way.
function toTerms(raw, rawBracket) {
  const src = raw !== undefined ? raw : rawBracket;
  const list = Array.isArray(src) ? src : src === undefined || src === null ? [] : [src];
  const out = [];
  for (const v of list) {
    const t = String(v).trim();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_TERMS) break;
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    // Channel: 'all' (no filter, so CM3 is included) | 'shp' -> 'SHP' | 'amz' -> 'AMZ'. Anything else falls back to 'all'.
    const rawChannel = String(req.query.channel || 'all').toLowerCase();
    const channel = rawChannel === 'shp' || rawChannel === 'amz' ? rawChannel : 'all';
    const channelAll = channel === 'all';
    const channelCode = channel === 'shp' ? 'SHP' : channel === 'amz' ? 'AMZ' : null;

    // Window: one of the presets. Default 'today' (the freshest pulse; one click to yesterday / 3 days / the longer totals).
    let window = String(req.query.window || 'today').toLowerCase();
    if (!WINDOWS.has(window)) window = 'today';

    // Sort. Both fall back to the legacy newest-first ordering on anything unrecognised, so an old caller (or a hand-typed URL) gets
    // exactly the response it always got rather than an error.
    const rawSort = String(req.query.sort || 'date').toLowerCase();
    const sort = Object.prototype.hasOwnProperty.call(SORTS, rawSort) ? rawSort : 'date';
    const dir = String(req.query.dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    // The direction is substituted from OUR OWN two-value derivation above, never from the request string.
    const orderBy = SORTS[sort].replace(/%s/g, dir.toUpperCase());

    // Search steps. `has` terms narrow by substring, `not` terms exclude by whole word; all of them AND together. The legacy single
    // `search` param folds in as a leading `has` so old callers keep working.
    const hasTerms = toTerms(req.query.has, req.query['has[]']);
    const notTerms = toTerms(req.query.not, req.query['not[]']);
    const legacySearch = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (legacySearch && !hasTerms.includes(legacySearch)) hasTerms.unshift(legacySearch);

    // The FIRST `has` term still has to clear 3 chars — a 1-2 char opener matches most of the table, which is the half-typed-fragment
    // case the old debounce guarded against. Below that we drop ALL the has terms and stay in window pulse mode (the UI enforces the
    // same rule before it ever submits, so this is the backstop). Later terms only narrow what the first already matched, so they carry
    // no minimum — "38" is a perfectly good second step.
    if (hasTerms.length > 0 && hasTerms[0].length < 3) hasTerms.length = 0;

    // TWO MODES, and only a `has` term switches them. Product mode ignores the preset window and pulls the matched set across a rolling
    // LAST 12 MONTHS, because a product search means "how is this doing lately?". A `not`-only search deliberately does NOT flip: it
    // narrows the lines of whatever window you are already on ("today's sales, excluding EVA"), which is the other half of what the two
    // boxes are for.
    const searchActive = hasTerms.length > 0;

    // Row cap (the SUMMARY is never capped — it stays honest over the whole set). Product mode is capped at 200 latest lines: enough
    // that a couple of narrowing steps usually leave the set COMPLETE on screen (and so the CSV export is complete too), while still
    // fencing off the busiest style, which carries ~1.6k lines in 12 months. Pulse mode defaults to 500 (the window is tiny anyway).
    let limit;
    if (searchActive) {
      limit = 200;
    } else {
      limit = Number.parseInt(req.query.limit, 10);
      if (!(limit > 0)) limit = 500;
      if (limit > 5000) limit = 5000;
    }

    // Shared filter CTE, reused by both the summary and the rows query. Window bounds are resolved off CURRENT_DATE in SQL (the anchor
    // the rest of the app trusts) so "today" means the DB's today. In product mode ($2=searchActive) the preset window is replaced by a
    // rolling LAST 12 MONTHS bound — recent enough to gauge how a style is performing NOW (a lifetime total drags in dead seasons and
    // scans far more rows), while still deep enough to see a full year's shape. The short windows end at CURRENT_DATE except 'yesterday',
    // which is that single prior day.
    // The search steps become one parameterised predicate each, appended to the shared filter. Built before the CTE string so the
    // placeholder numbers stay in step with the params array (the row query's LIMIT then takes the next index after these).
    const filterParams = [window, searchActive, channelAll, channelCode];
    const termClauses = [];
    for (const t of hasTerms) {
      filterParams.push(`%${t}%`);
      termClauses.push(`AND ${HAY} ILIKE $${filterParams.length}`);
    }
    for (const t of notTerms) {
      // NOT is the exact mirror of the ILIKE above — a plain substring over the whole haystack, the legacy PowerBuilder rule
      // (`Pos(...) > 0` -> drop the row) the operator works to, and the same rule the Inventory screen uses. This replaced a
      // `!~* '\y…\y'` POSIX word-boundary test on 2026-08-25: \y could not drop "Womens …" when you excluded WOMEN (the boundary
      // falls between "n" and "s"). Cost: excluding "SAND" now also drops "SANDALS" — knowingly accepted by the owner.
      filterParams.push(`%${t}%`);
      termClauses.push(`AND ${HAY} NOT ILIKE $${filterParams.length}`);
    }
    const termSql = termClauses.length > 0 ? `\n          ${termClauses.join('\n          ')}` : '';

    const filterCte = `
      WITH b AS (
        SELECT
          CASE $1
            WHEN 'today'     THEN CURRENT_DATE
            WHEN 'yesterday' THEN CURRENT_DATE - 1
            WHEN '3d'        THEN CURRENT_DATE - 2
            WHEN '7d'        THEN CURRENT_DATE - 6
            WHEN '30d'       THEN CURRENT_DATE - 29
            WHEN '90d'       THEN CURRENT_DATE - 89
          END AS from_date,
          CASE $1
            WHEN 'yesterday' THEN CURRENT_DATE - 1
            ELSE CURRENT_DATE
          END AS to_date
      ),
      f AS (
        SELECT s.*
        FROM sales s, b
        WHERE (
              ($2::bool AND s.solddate >= (CURRENT_DATE - INTERVAL '12 months'))   -- product mode: rolling last 12 months
              OR (NOT $2::bool AND s.solddate >= b.from_date AND s.solddate <= b.to_date)  -- pulse mode: the chosen preset window
            )
          AND ($3::bool OR s.channel = $4)${termSql}
      )`;

    // Summary-only when a LONG window is chosen in pulse mode — totals with no line list. A search always shows its (capped) lines, so it
    // is never summary-only even on a long-labelled window (the window is ignored in product mode anyway).
    const summaryOnly = !searchActive && LONG_WINDOWS.has(window);

    // SUMMARY — the honest headline over the whole matched set (returns netted in). Units split sold / returned / net; revenue and profit
    // net returns; margin = profit / ex-VAT revenue (NULL when revenue is 0). `orders` counts distinct order numbers that contain a SALE (qty>0)
    // only — a refund whose original sale sat outside the window would otherwise land here as a return-only "order" and push Orders ABOVE
    // units sold, which reads as an error (owner confusion, 2026-07-13). Returns are already surfaced in the units sold/returned split, so
    // they don't also need to inflate the order count. We return BOTH the window bounds and the actual data span (min/max solddate) so the
    // UI can label pulse mode with the window and product mode with the item's first->last sale. `products` = distinct styles matched:
    // in product mode, > 1 warns the operator the total spans multiple products (refine to isolate one).
    const summaryResult = await query(
      `${filterCte}
       SELECT
         (SELECT to_char(from_date, 'YYYY-MM-DD') FROM b) AS window_from,
         (SELECT to_char(to_date,   'YYYY-MM-DD') FROM b) AS window_to,
         to_char(MIN(solddate), 'YYYY-MM-DD')                          AS data_from,
         to_char(MAX(solddate), 'YYYY-MM-DD')                          AS data_to,
         COUNT(*)::int                                                 AS lines,
         COUNT(DISTINCT groupid)                                       AS products,
         COALESCE(SUM(qty) FILTER (WHERE qty > 0), 0)::int              AS units_sold,
         COALESCE(-SUM(qty) FILTER (WHERE qty < 0), 0)::int             AS units_returned,
         COALESCE(SUM(qty), 0)::int                                     AS units_net,
         COUNT(DISTINCT ordernum) FILTER (WHERE qty > 0 AND ordernum IS NOT NULL AND ordernum <> '') AS orders,
         COALESCE(SUM(soldprice * qty), 0)::numeric                     AS revenue,
         COALESCE(SUM(profit), 0)::numeric                             AS profit
       FROM f`,
      filterParams
    );

    // ROWS — in the requested order, capped. Fetch limit+1 to detect truncation without a COUNT. SKIPPED entirely in summary-only mode (a
    // long window wants totals, not thousands of lines) — we return an empty list and let the UI explain why.
    // NOTE the cap is applied AFTER the sort, so `truncated` means "these are the first `limit` rows IN THIS ORDER" — a different set of
    // rows per sort, not the same set re-arranged. The UI's truncation badge is worded off `sort`/`dir` for that reason.
    const rowsResult = summaryOnly
      ? { rows: [] }
      : await query(
          `${filterCte}
           SELECT solddate, ordertime, channel, code, RIGHT(code, 2) AS size, groupid, productname, brand, ordernum,
                  qty, soldprice, profit
           FROM f
           ORDER BY ${orderBy}
           LIMIT $${filterParams.length + 1}::int`,
          [...filterParams, limit + 1]
        );

    const truncated = !summaryOnly && rowsResult.rows.length > limit;
    const rows = rowsResult.rows.slice(0, limit).map((r) => {
      const qty = Number(r.qty);
      const soldprice = num(r.soldprice);
      const profit = num(r.profit);
      // Per-line margin against that line's EX-VAT revenue: profit is already net of VAT, so the denominator has to be too (see the
      // header). Null when revenue is 0 (can't divide) — UI shows "—". Guarded on the gross figure, which is zero exactly when the
      // net one is, so the null case stays obvious.
      const revenue = soldprice === null ? null : soldprice * qty;
      const marginPct = revenue && revenue !== 0 && profit !== null
        ? Math.round((profit / (revenue / VAT_MULTIPLIER)) * 1000) / 10
        : null;
      return {
        solddate: toIsoDate(r.solddate),
        ordertime: r.ordertime || null,
        channel: r.channel,                 // 'SHP' | 'AMZ' | 'CM3'
        code: r.code || null,
        size: r.size || null,
        groupid: r.groupid || null,
        productname: r.productname || null,
        // Stamped onto the sale line at booking time (orderSync copies skusummary.brand), so no join — and it stays right even if the
        // style is re-branded later. Nullable: legacy rows and some non-Shopify channels never had it set.
        brand: r.brand || null,
        ordernum: r.ordernum || null,
        qty,
        soldprice,
        profit,
        marginPct,
      };
    });

    const s = summaryResult.rows[0] || {};
    const revenueTotal = num(s.revenue) || 0;
    const profitTotal = num(s.profit) || 0;
    const products = Number(s.products) || 0;
    const summary = {
      unitsSold: Number(s.units_sold) || 0,
      unitsReturned: Number(s.units_returned) || 0,
      unitsNet: Number(s.units_net) || 0,
      orders: Number(s.orders) || 0,
      lines: Number(s.lines) || 0,   // matched lines BEFORE the row cap — lets the UI say "latest 200 of 318" honestly

      revenue: revenueTotal,
      // The same trade ex-VAT. Exposed rather than left implicit so the UI can name the denominator on screen — a Margin tile sitting
      // under a gross Revenue tile otherwise looks like it disagrees with it.
      netRevenue: Math.round((revenueTotal / VAT_MULTIPLIER) * 100) / 100,
      profit: profitTotal,
      marginPct: revenueTotal !== 0 ? Math.round((profitTotal / (revenueTotal / VAT_MULTIPLIER)) * 1000) / 10 : null,
      products,                       // distinct styles matched (product mode: >1 = the total spans multiple products)
    };

    // Date label bounds: pulse mode shows the window; product mode shows the item's actual first->last sale span (data min/max).
    const from = searchActive ? (s.data_from || null) : (s.window_from || null);
    const to = searchActive ? (s.data_to || null) : (s.window_to || null);

    return res.json({
      return_code: 'SUCCESS',
      channel,
      window,
      searchActive,
      summaryOnly,      // true = long window, totals only (no rows); UI hides the table and explains
      from,
      to,
      search: hasTerms[0] || null,   // legacy echo: the leading `has` term
      has: hasTerms,
      not: notTerms,
      sort,             // echoed AFTER the fallback, so the UI can tell when its request was rejected and re-label the truncation badge
      dir,
      summary,
      rows,
      limit,
      count: rows.length,
      truncated,
    });
  } catch (err) {
    logger.error('[analytics-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Sales' });
  }
});

module.exports = router;
