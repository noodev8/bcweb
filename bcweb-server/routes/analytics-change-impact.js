/*
=======================================================================================================================================
API Route: analytics_change_impact   (Analytics module — "Price Changes")
=======================================================================================================================================
Method: GET
Purpose: Analytics module — Price Changes. A "did our repricing take effect?" ledger: the most recent price changes across BOTH channels,
         each showing the BEFORE -> AFTER price, who changed it, when, and how many units have sold SINCE the change. The owner loads it
         to eyeball whether recent moves are moving stock.

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
         Amazon changes (not whatever share of a combined 50 happened to be Amazon).

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
  limit   (int, optional)     - max rows to return (per selected channel); default 50, clamped to [1, 200].

Success Response:
{
  "return_code": "SUCCESS",
  "channel": "all",
  "user": null,
  "limit": 50,
  "count": 50,
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

    // Limit: default 50, clamp so a client can't request an unbounded dump. Applied AFTER the channel filter (per-channel limit).
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 50;
    if (limit > 200) limit = 200;

    // Include-flags let one parameterised query serve all three channel modes without string-building the WHERE.
    const wantShp = channel === 'all' || channel === 'shp';
    const wantAmz = channel === 'all' || channel === 'amz';

    // Unified change list -> filter (channel + optional user) -> newest-first -> limit -> attach title + units-since.
    //   sort_ts    = exact change instant (changed_at) or the bare change date at midnight for legacy rows.
    //   change_date is kept separately (a real DATE) purely to compute days_since and bound the sales-since sum by day.
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
      ),
      picked AS (
        SELECT *
        FROM changes
        WHERE ($3::text IS NULL OR changed_by = $3)
        ORDER BY sort_ts DESC, id DESC
        LIMIT $4::int
      )
      SELECT pk.channel,
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
      [wantShp, wantAmz, user, limit]
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

    return res.json({
      return_code: 'SUCCESS',
      channel,
      user,
      limit,
      count: rows.length,
      users: usersResult.rows.map((u) => u.changed_by),
      rows,
    });
  } catch (err) {
    logger.error('[analytics-change-impact] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Price Changes' });
  }
});

module.exports = router;
