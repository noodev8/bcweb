/*
=======================================================================================================================================
API Route: analytics_change_impact   (Analytics module — "Price Changes")
=======================================================================================================================================
Method: GET
Purpose: Analytics module — Price Changes. A "did our repricing take effect?" ledger over a TIME WINDOW (default 30 days), in two layers:

           1. SUMMARY (the report) — how much repricing happened in the window, split up/down and BY OPERATOR. This is the staff-progress
              read: over 30 days the two operators together log ~1,500 changes (bulk moves loop one log row per style), so the raw list is
              a dump, not a monitor. The summary answers "how did the month go" in one glance; the filters drill into it.
           2. ROWS (the detail) — the newest `limit` changes (default 50) matching the current filters, each showing the BEFORE -> AFTER
              price, who changed it, when, and how many units have sold SINCE the change.

         Why a window rather than "latest N": a change needs time to show sales. Bounding by DAYS (not by row count) means the older moves
         in the window — the ones that have actually had a chance to sell — stay visible instead of being pushed off by today's activity.

         Two source logs, one unified list:
           - Shopify changes live in `price_change_log` (STYLE grain — one row per groupid, channel 'SHP').
           - Amazon changes live in `amz_price_log`  (SKU grain — one row per size `code`; the style is resolved via amzfeed.groupid).
         They are normalised into a single shape via UNION ALL, ordered newest-first by the change instant, then bounded to `limit`.

         "Units sold since the change" = SUM(sales.qty) for the same channel + key where solddate >= the change date (positive lines only,
         qty>0 & soldprice>0 — matching the rest of the pricing module). This is the SIMPLE window (owner decision): every sale from the
         change date to today, so if an item was repriced again later those newer sales still count here. It is NOT bounded by the next
         change on the same item. Caveat baked into the UI: `sales.solddate` is a bare DATE, so a sale made earlier on the change DAY can't
         be excluded — a 0-day-old change's count is same-day/indicative.

         Per-channel limit (owner decision): `limit` applies AFTER the channel filter, so switching to Amazon shows the latest `limit`
         Amazon changes (not whatever share of a combined 50 happened to be Amazon). `total` reports how many changes MATCH the filters in
         the window (pre-limit) so the UI can say "showing 50 of 1,327"; `truncated` is total > limit.

         The SUMMARY deliberately ignores the `user` filter (it honours window + channel only) so the per-operator breakdown stays whole
         while you drill into one operator's rows — the breakdown IS the filter control on the front end. It carries no units-sold figure:
         a per-row sales sum over a whole window would double-count items repriced more than once, so impact stays a per-row column.

         The response also carries `users` — the distinct set of operators who have made ANY logged change (across both logs, ignoring the
         current channel/user filter) — so the front end can populate a stable "filter by user" dropdown without a second request. This is
         the hook for future per-user monitoring: `changed_by` is already the server-resolved display_name on both logs.

Schema notes (CLAUDE.md): old_price/new_price are NUMERIC on both logs (no safeNumeric needed). `changed_at` (timestamptz) carries the exact
instant for newer rows; older rows fall back to the bare DATE (`change_date` / `log_date`) cast to midnight — COALESCE handles the mix.
`days_since` is computed in SQL as (CURRENT_DATE - change_date) so we never round-trip a DATE through JS date parsing. Amazon size =
RIGHT(code,2). Human name from title.shopifytitle (via the resolved groupid). Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, optional)  - 'all' (default) | 'shp' | 'amz'. Case-insensitive.
  user    (string, optional)  - exact changed_by (display_name) to filter to; omitted/blank = all users.
  days    (int, optional)     - window length in days, counted back from today; default 30, clamped to [1, 365].
  limit   (int, optional)     - max DETAIL rows to return (per selected channel); default 50, clamped to [1, 200].

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "all",
  "user": null,
  "days": 30,
  "limit": 50,
  "count": 50,                            // rows actually returned (<= limit)
  "total": 1327,                          // changes matching window + channel + user BEFORE the limit
  "truncated": true,                      // total > limit -> the table is a sample of the window
  "summary": {                            // window + channel only (ignores the user filter)
    "total": 1484, "up": 900, "down": 560, "flat": 24, "shp": 1327, "amz": 157,
    "byUser": [ { "user": "Andreas", "total": 1032, "up": 700, "down": 320, "shp": 980, "amz": 52 }, ... ]
  },
  "users": ["Andreas", "Sam", ...],       // distinct operators across both logs, for the filter dropdown
  "rows": [
    { "channel": "AMZ", "groupid": "FLE030-IVES-RED", "amzCode": "FLE030-IVES-RED-04", "size": "04",
      "title": "Womens ...", "oldPrice": 36.49, "newPrice": 35.49, "changedBy": "Andreas",
      "changedAt": "2026-07-13T00:55:00.000Z", "note": "creep 0.30 — 4u/7d", "daysSince": 1, "unitsSince": 0 },
    ... // newest change first
  ]
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

router.get('/', async (req, res) => {
  try {
    // Channel: normalise to 'all' | 'shp' | 'amz'. Anything unexpected falls back to 'all'.
    const rawChannel = String(req.query.channel || 'all').toLowerCase();
    const channel = rawChannel === 'shp' || rawChannel === 'amz' ? rawChannel : 'all';

    // User: exact changed_by match; blank/whitespace = no filter.
    const userRaw = typeof req.query.user === 'string' ? req.query.user.trim() : '';
    const user = userRaw.length ? userRaw : null;

    // Window: how far back to count, in days. This is the primary bound now — the summary covers the WHOLE window; the row list is the
    // newest slice of it. Clamped to a year so a stray value can't scan the entire log history.
    let days = Number.parseInt(req.query.days, 10);
    if (!(days > 0)) days = 30;
    if (days > 365) days = 365;

    // Limit: bounds the DETAIL rows only (default 50), so the table stays readable when the window holds four figures' worth of changes.
    // Applied AFTER the channel filter (per-channel limit).
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 50;
    if (limit > 200) limit = 200;

    // Include-flags let one parameterised query serve all three channel modes without string-building the WHERE.
    const wantShp = channel === 'all' || channel === 'shp';
    const wantAmz = channel === 'all' || channel === 'amz';

    // Unified change list -> window + channel filter -> optional user filter -> newest-first -> limit -> attach title + units-since.
    //   sort_ts    = exact change instant (changed_at) or the bare change date at midnight for legacy rows.
    //   change_date is kept separately (a real DATE) purely to compute days_since and bound the sales-since sum by day.
    //   The window predicate sits INSIDE each UNION branch so it can use each log's own date index rather than filtering after the merge.
    //   total      = COUNT(*) OVER () evaluated in `picked` BEFORE the LIMIT -> how many changes the filters really match ("50 of 1,327").
    //   units-since LATERAL: same channel + key, positive lines, solddate on/after the change day. Runs on the <=limit picked rows only.
    const result = await query(
      `
      WITH changes AS (
        SELECT 'SHP'::text        AS channel,
               p.groupid          AS groupid,
               NULL::varchar      AS amz_code,
               p.old_price        AS old_price,
               p.new_price        AS new_price,
               p.reason_notes     AS note,
               p.changed_by       AS changed_by,
               COALESCE(p.changed_at, p.change_date::timestamptz) AS sort_ts,
               p.change_date      AS change_date,
               p.id               AS id
        FROM price_change_log p
        WHERE p.channel = 'SHP' AND $1::bool
          AND COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz
        UNION ALL
        SELECT 'AMZ'::text,
               f.groupid,
               a.code,
               a.old_price,
               a.new_price,
               a.notes,
               a.changed_by,
               COALESCE(a.changed_at, a.log_date::timestamptz),
               a.log_date,
               a.id
        FROM amz_price_log a
        LEFT JOIN amzfeed f ON f.code = a.code
        WHERE $2::bool
          AND COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz
      ),
      picked AS (
        SELECT *, COUNT(*) OVER ()::int AS total
        FROM changes
        WHERE ($4::text IS NULL OR changed_by = $4)
        ORDER BY sort_ts DESC, id DESC
        LIMIT $5::int
      )
      SELECT pk.total,
             pk.channel,
             pk.groupid,
             pk.amz_code,
             CASE WHEN pk.amz_code IS NOT NULL THEN RIGHT(pk.amz_code, 2) END AS size,
             t.shopifytitle          AS title,
             pk.old_price,
             pk.new_price,
             pk.note,
             pk.changed_by,
             pk.sort_ts,
             (CURRENT_DATE - pk.change_date) AS days_since,
             su.units                AS units_since
      FROM picked pk
      LEFT JOIN title t ON t.groupid = pk.groupid
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.qty), 0)::int AS units
        FROM sales s
        WHERE s.channel = pk.channel
          AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= pk.change_date
          AND ( (pk.channel = 'SHP' AND s.groupid = pk.groupid)
             OR (pk.channel = 'AMZ' AND s.code = pk.amz_code) )
      ) su ON true
      ORDER BY pk.sort_ts DESC, pk.id DESC
      `,
      [wantShp, wantAmz, days, user, limit]
    );

    // SUMMARY — the report layer: every change in the window (channel filter honoured, user filter deliberately NOT), grouped by operator.
    // Aggregated in SQL over the whole window rather than derived from `rows`, which only ever holds the newest `limit` of it. Direction is
    // classified once here: 'up'/'down' need both prices; equal-or-unknown prices fall into neither and show up as flat (total - up - down).
    // changed_by is COALESCEd to '' so legacy/unattributed rows collapse into one bucket the front end can label, instead of vanishing.
    const summaryResult = await query(
      `
      WITH changes AS (
        SELECT 'SHP'::text AS channel, p.old_price, p.new_price, COALESCE(p.changed_by, '') AS changed_by
        FROM price_change_log p
        WHERE p.channel = 'SHP' AND $1::bool
          AND COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz
        UNION ALL
        SELECT 'AMZ'::text, a.old_price, a.new_price, COALESCE(a.changed_by, '')
        FROM amz_price_log a
        WHERE $2::bool
          AND COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz
      )
      SELECT changed_by,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE old_price IS NOT NULL AND new_price IS NOT NULL AND new_price > old_price)::int AS up,
             COUNT(*) FILTER (WHERE old_price IS NOT NULL AND new_price IS NOT NULL AND new_price < old_price)::int AS down,
             COUNT(*) FILTER (WHERE channel = 'SHP')::int AS shp,
             COUNT(*) FILTER (WHERE channel = 'AMZ')::int AS amz
      FROM changes
      GROUP BY changed_by
      ORDER BY total DESC, changed_by
      `,
      [wantShp, wantAmz, days]
    );

    // Roll the per-operator rows up into the window totals — one pass, no second round trip.
    const byUser = summaryResult.rows.map((r) => ({
      user: r.changed_by || null,               // null = unattributed (legacy rows with no changed_by)
      total: Number(r.total) || 0,
      up: Number(r.up) || 0,
      down: Number(r.down) || 0,
      shp: Number(r.shp) || 0,
      amz: Number(r.amz) || 0,
    }));
    const summary = byUser.reduce(
      (acc, u) => ({
        total: acc.total + u.total,
        up: acc.up + u.up,
        down: acc.down + u.down,
        flat: acc.flat + (u.total - u.up - u.down),
        shp: acc.shp + u.shp,
        amz: acc.amz + u.amz,
        byUser: acc.byUser,
      }),
      { total: 0, up: 0, down: 0, flat: 0, shp: 0, amz: 0, byUser }
    );

    // Distinct operators across BOTH logs, ignoring the current channel/user filter -> a stable dropdown. NULLs (legacy rows written
    // before changed_by existed) are dropped. Sorted alphabetically for a predictable list.
    const usersResult = await query(
      `
      SELECT DISTINCT changed_by FROM (
        SELECT changed_by FROM price_change_log WHERE channel = 'SHP'
        UNION ALL
        SELECT changed_by FROM amz_price_log
      ) u
      WHERE changed_by IS NOT NULL AND changed_by <> ''
      ORDER BY changed_by
      `
    );

    const rows = result.rows.map((r) => ({
      channel: r.channel,                       // 'SHP' | 'AMZ'
      groupid: r.groupid || null,               // resolved style key (from amzfeed for Amazon rows); null if an AMZ code no longer maps
      amzCode: r.amz_code || null,              // the exact SKU code on Amazon rows -> lets the row-click deep-link to that size's drill
      size: r.size || null,                     // EU size (Amazon rows only)
      title: r.title || null,
      oldPrice: num(r.old_price),
      newPrice: num(r.new_price),
      note: r.note || '',
      changedBy: r.changed_by || null,
      changedAt: r.sort_ts ? new Date(r.sort_ts).toISOString() : null,
      daysSince: r.days_since === null ? null : Number(r.days_since),
      unitsSince: Number(r.units_since) || 0,
    }));

    // `total` comes off any picked row (it's a window function, identical on all of them); no rows = nothing matched.
    const total = result.rows.length ? Number(result.rows[0].total) || 0 : 0;

    return res.json({
      return_code: 'SUCCESS',
      channel,
      user,
      days,
      limit,
      count: rows.length,
      total,
      truncated: total > rows.length,
      summary,
      users: usersResult.rows.map((u) => u.changed_by),
      rows,
    });
  } catch (err) {
    logger.error('[analytics-change-impact] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Price Changes' });
  }
});

module.exports = router;
