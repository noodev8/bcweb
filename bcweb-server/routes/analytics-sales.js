/*
=======================================================================================================================================
API Route: analytics_sales   (Analytics module — "Sales")
=======================================================================================================================================
Method: GET
Purpose: The sales ledger an analyst opens to answer "how are we doing?" — the raw sale lines for a chosen window and channel, each with
         the PROFIT the owner's downstream P&L already computed, plus a summary strip (net profit is the headline, with revenue, units and
         margin supporting). Replaces the legacy PowerBuilder "Sales" screen, but reframed for analysis rather than data entry:
           - windowed (Today / Yesterday / last 7·30·90 days / custom range) instead of only "24 hrs" / "30 Day",
           - channel-filtered (All / Shopify / Amazon — "All" also folds in the minor CM3 channel so the totals reconcile),
           - searchable to one product (matches product name, style groupid or SKU code). A search (>= 3 chars) flips the screen into
             PRODUCT MODE: the window is IGNORED and the match is pulled across ALL TIME, newest-first, hard-capped at 50 lines — because
             a search means "show me this product's whole story", not "within 3 days". The summary still covers the whole matched set
             (lifetime verdict), and `products` (distinct styles matched) warns when a loose term spans more than one product,
           - RETURNS INCLUDED. Unlike the pricing module (which is positive-lines-only, because it's about velocity), a sales/profit
             report must show refunds — a return is a real negative-profit line — and NET them into the totals. The summary therefore
             breaks units into sold / returned / net, mirroring the legacy footer (Sold / Returned / Net).

         Two queries share one filter (window + channel + search):
           - SUMMARY aggregates over the WHOLE window (never bounded by the row cap) so the headline totals stay honest even when the
             table below is truncated.
           - ROWS returns newest-first up to `limit` (fetch limit+1 to detect truncation, like pricing-sales), for the on-screen table
             and the client-side CSV export.

Schema notes (CLAUDE.md): `sales.solddate` is a bare DATE and `ordertime` a 'HH:MM' VARCHAR (blank on some legacy rows) — we order by
solddate, then ordertime (NULLS LAST), then id. `soldprice` and `profit` are NUMERIC; `profit` is populated downstream (100% coverage) so
we surface it as-is rather than re-deriving. Returns are negative-`qty` lines. Revenue = SUM(soldprice*qty) (returns subtract). Margin% =
profit / revenue. Size = RIGHT(code,2). Window bounds are computed in SQL off CURRENT_DATE (the anchor the rest of the app trusts).
Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, optional)  - 'all' (default, incl. CM3) | 'shp' | 'amz'. Case-insensitive.
  window  (string, optional)  - 'today' (default) | 'yesterday' | '3d'. Short-window only by design (no custom range). IGNORED when a
                                search is active (product mode spans all time).
  search  (string, optional)  - >= 3 chars flips to product mode: matches product name / groupid / SKU code (case-insensitive), all time,
                                capped at 50 latest lines. 0-2 chars = no search (pulse mode).
  limit   (int, optional)     - pulse-mode row cap; default 500, clamped to [1, 5000]. Product mode is fixed at 50.

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "all", "window": "3d", "searchActive": false, "from": "2026-07-11", "to": "2026-07-13", "search": null,
  "summary": { "unitsSold": 812, "unitsReturned": 19, "unitsNet": 793, "orders": 640,
               "revenue": 41234.55, "profit": 6120.11, "marginPct": 14.8, "products": 137 },
  "rows": [
    { "solddate": "2026-07-11", "ordertime": "21:37", "channel": "SHP", "code": "0051753-ARIZONA-36", "size": "36",
      "groupid": "0051753-ARIZONA", "productname": "Birkenstock Arizona ...", "ordernum": "BC18292",
      "qty": 1, "soldprice": 64.95, "profit": 10.07, "marginPct": 15.5 },
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

// This screen is deliberately SHORT-WINDOW only (today / yesterday / last 3 days) — it's the "is today's trade healthy?" pulse, and
// keeping the range tiny keeps the row list practical and the scan cheap. There is NO custom range on purpose (an open-ended range
// invites full-table scans). Longer-horizon analysis lives on the other analytics screens.
const WINDOWS = new Set(['today', 'yesterday', '3d']);

router.get('/', async (req, res) => {
  try {
    // Channel: 'all' (no filter, so CM3 is included) | 'shp' -> 'SHP' | 'amz' -> 'AMZ'. Anything else falls back to 'all'.
    const rawChannel = String(req.query.channel || 'all').toLowerCase();
    const channel = rawChannel === 'shp' || rawChannel === 'amz' ? rawChannel : 'all';
    const channelAll = channel === 'all';
    const channelCode = channel === 'shp' ? 'SHP' : channel === 'amz' ? 'AMZ' : null;

    // Window: one of the three short presets. Default 'today' (the freshest pulse; one click to yesterday / 3 days).
    let window = String(req.query.window || 'today').toLowerCase();
    if (!WINDOWS.has(window)) window = 'today';

    // Search: the screen has TWO modes. A search term (>= 3 chars after trim) flips it into PRODUCT MODE — the short window is ignored
    // and we pull the matched item's sales across ALL TIME (newest-first, hard-capped), because the point of a search is "show me this
    // product's whole story", not "this product within 3 days". A shorter fragment (0-2 chars) never fires a search (keeps half-typed
    // rubbish out) and the screen stays in window PULSE MODE. Wrapped in %...% for a contains match so a partial groupid/title works.
    const searchRaw = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const searchActive = searchRaw.length >= 3;
    const searchLike = searchActive ? `%${searchRaw}%` : null;

    // Row cap (the SUMMARY is never capped — it stays honest over the whole set). Product mode is HARD-capped at 50 latest lines (enough
    // to judge a product; a busy style could have thousands). Pulse mode defaults to 500 (the window is tiny anyway).
    let limit;
    if (searchActive) {
      limit = 50;
    } else {
      limit = Number.parseInt(req.query.limit, 10);
      if (!(limit > 0)) limit = 500;
      if (limit > 5000) limit = 5000;
    }

    // Shared filter CTE, reused by both the summary and the rows query. Window bounds are resolved off CURRENT_DATE in SQL (the anchor
    // the rest of the app trusts) so "today" means the DB's today. In product mode ($2=searchActive) the window bound is SKIPPED so the
    // match spans all time. All three windows end at CURRENT_DATE except 'yesterday', which is that single prior day.
    const filterCte = `
      WITH b AS (
        SELECT
          CASE $1
            WHEN 'today'     THEN CURRENT_DATE
            WHEN 'yesterday' THEN CURRENT_DATE - 1
            WHEN '3d'        THEN CURRENT_DATE - 2
          END AS from_date,
          CASE $1
            WHEN 'yesterday' THEN CURRENT_DATE - 1
            ELSE CURRENT_DATE
          END AS to_date
      ),
      f AS (
        SELECT s.*
        FROM sales s, b
        WHERE ($2::bool OR (s.solddate >= b.from_date AND s.solddate <= b.to_date))
          AND ($3::bool OR s.channel = $4)
          AND ($5::text IS NULL OR s.productname ILIKE $5 OR s.groupid ILIKE $5 OR s.code ILIKE $5)
      )`;

    const filterParams = [window, searchActive, channelAll, channelCode, searchLike];

    // SUMMARY — the honest headline over the whole matched set (returns netted in). Units split sold / returned / net; revenue and profit
    // net returns; margin = profit / revenue (NULL when revenue is 0). We return BOTH the window bounds and the actual data span (min/max
    // solddate) so the UI can label pulse mode with the window and product mode with the item's first->last sale. `products` = distinct
    // styles matched: in product mode, > 1 warns the operator the total spans multiple products (refine to isolate one).
    const summaryResult = await query(
      `${filterCte}
       SELECT
         (SELECT to_char(from_date, 'YYYY-MM-DD') FROM b) AS window_from,
         (SELECT to_char(to_date,   'YYYY-MM-DD') FROM b) AS window_to,
         to_char(MIN(solddate), 'YYYY-MM-DD')                          AS data_from,
         to_char(MAX(solddate), 'YYYY-MM-DD')                          AS data_to,
         COUNT(DISTINCT groupid)                                       AS products,
         COALESCE(SUM(qty) FILTER (WHERE qty > 0), 0)::int              AS units_sold,
         COALESCE(-SUM(qty) FILTER (WHERE qty < 0), 0)::int             AS units_returned,
         COALESCE(SUM(qty), 0)::int                                     AS units_net,
         COUNT(DISTINCT ordernum) FILTER (WHERE ordernum IS NOT NULL AND ordernum <> '') AS orders,
         COALESCE(SUM(soldprice * qty), 0)::numeric                     AS revenue,
         COALESCE(SUM(profit), 0)::numeric                             AS profit
       FROM f`,
      filterParams
    );

    // ROWS — newest first, capped. Fetch limit+1 to detect truncation without a COUNT.
    const rowsResult = await query(
      `${filterCte}
       SELECT solddate, ordertime, channel, code, RIGHT(code, 2) AS size, groupid, productname, ordernum,
              qty, soldprice, profit
       FROM f
       ORDER BY solddate DESC, ordertime DESC NULLS LAST, id DESC
       LIMIT $6::int`,
      [...filterParams, limit + 1]
    );

    const truncated = rowsResult.rows.length > limit;
    const rows = rowsResult.rows.slice(0, limit).map((r) => {
      const qty = Number(r.qty);
      const soldprice = num(r.soldprice);
      const profit = num(r.profit);
      // Per-line margin against that line's revenue (soldprice*qty). Null when revenue is 0 (can't divide) — UI shows "—".
      const revenue = soldprice === null ? null : soldprice * qty;
      const marginPct = revenue && revenue !== 0 && profit !== null ? Math.round((profit / revenue) * 1000) / 10 : null;
      return {
        solddate: toIsoDate(r.solddate),
        ordertime: r.ordertime || null,
        channel: r.channel,                 // 'SHP' | 'AMZ' | 'CM3'
        code: r.code || null,
        size: r.size || null,
        groupid: r.groupid || null,
        productname: r.productname || null,
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
      revenue: revenueTotal,
      profit: profitTotal,
      marginPct: revenueTotal !== 0 ? Math.round((profitTotal / revenueTotal) * 1000) / 10 : null,
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
      from,
      to,
      search: searchRaw || null,
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
