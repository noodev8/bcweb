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

           3. SCORECARDS (the staff read) — "is the repricing time paying for itself?", one card per operator. This is deliberately a
              GROSS ACTIVITY measure, not a bottom-line profit one: it credits a raise with the units that sold at the raised price, which
              assumes those units would have sold anyway. A control-group study (unrepriced styles, same calendar days, matched on prior
              sales rate) says raises DO cost volume — so this number is "what their actions captured", never "profit they added". The UI
              says so on the panel; do not let it get quoted as contribution.

              Three rules make the numbers mean anything:

              a) BOUNDED ATTRIBUTION. Unlike `unitsSince` on the detail rows (deliberately the simple open-ended window), each change here
                 owns only the sales that happened WHILE ITS PRICE WAS LIVE — from the change date up to the next change on the same key.
                 Without this a style repriced three times has its sales counted three times and old changes accrue credit just for being
                 old; over 90 days that inflated the raise figure 3.6x (£8.6k -> £2.4k). LEAD() over the windowed set is sufficient: any
                 change that supersedes one inside the window is itself later, hence also inside the window (which runs to today). The
                 boundary days are settled by the price actually paid rather than by date alone — see `saleInRun`, which every attribution
                 LATERAL on this route shares.

              b) SETTLED ONLY, ON A FIXED PERIOD. A change made yesterday has not had a chance to earn and dilutes the average toward zero,
                 so only changes at least `settleDays` (14) old are scored. Crucially this layer ignores the `days` selector and always
                 looks back `scoreWindowDays` (90) — see SCORE_WINDOW_DAYS. Tying it to the selector meant a 30-day view scored 8 changes
                 out of 299 and put three different day counts (7/30/90, 21, "8 of 299") on one screen for the operator to reconcile.

              c) RAISES AND CUTS NEVER NET OFF. They are different jobs with different targets. A raise is scored in CASH captured; a cut is
                 scored in UNITS CLEARED (its whole purpose on the LOSERS list is shifting stock that would not move). Netting the discount
                 given away against the cash captured would make an operator look bad for doing the LOSERS job correctly, so the two are
                 returned as separate blocks and rendered as separate panels.

              The headline is a HIT RATE — how many raises / cuts EARNED MORE PER WEEK than the old price did (the VERDICT, season-adjusted;
              see the block above the handler) — expressed as a count and a percentage of the changes that could be judged, never as a
              per-change average of money. Until 2026-09-26 the rate was "sold at least one unit", which a raise that halved a style's
              profit/wk still passed.

              Why not money-per-change (this was tried and removed): "£7.46 extra per raise" was arithmetically correct and practically a
              lie. The distribution is savagely skewed — median £1.40 against that £7.46 mean, 94 of 277 raises sold nothing at all, and
              the TOP TEN raises produced 47% of the entire quarter's cash (core Arizona/Milano/Gizeh, styles that were going to sell
              whatever the price). An average implies a typical case; there is no typical case here. Two counts ("183 sold, 94 didn't")
              cannot be dragged by one lucky style, and a total ("£2,066 in") makes no claim about any individual change. Both survive the
              skew; the mean did not.

              Rates are PER CHANNEL for raises and must stay that way: Shopify sold on 51% of raises against Amazon's 76% over the same
              period, so a blended rate mostly measures someone's channel mix. Comparing a 60%-Amazon operator's blend against a
              100%-Shopify operator's blend is meaningless. Cut rates matched across channels (81% / 82%), so the front end sums those two
              blocks for display — but the data stays split so the day they diverge it is visible rather than silently blended away. The Amazon-match cron is EXCLUDED from this layer — it has no time to justify. It still appears in the
              summary's per-operator counts, which measure activity rather than judge it.

Schema notes (CLAUDE.md): old_price/new_price are NUMERIC on both logs (no safeNumeric needed). `changed_at` (timestamptz) carries the exact
instant for newer rows; older rows fall back to the bare DATE (`change_date` / `log_date`) cast to midnight — COALESCE handles the mix.
`days_since` is computed in SQL as (CURRENT_DATE - change_date) so we never round-trip a DATE through JS date parsing. The change DAY is
derived from the instant in Europe/London, never read from the stored change_date/log_date column — the DB session is UTC, so those columns
hold the UTC day and an after-11pm apply is stamped a day early (see the comment on the detail query). Amazon size =
the code's suffix after the last '-'. Human name from title.shopifytitle (via the resolved groupid). Requires auth.
=======================================================================================================================================
Request Query Params:
  channel (string, optional)  - 'all' (default) | 'shp' | 'amz'. Case-insensitive.
  user    (string, optional)  - exact changed_by (display_name) to filter to; omitted/blank = all users.
  days    (int, optional)     - window length in days, counted back from today; default 30, clamped to [1, 365].
  impact  (string, optional)  - DETAIL list filter: 'all' (default) | 'settled' (>= settleDays old) | 'moved' (settled AND sold something).
                                Applied before the limit, so it filters the whole window rather than the newest 50 rows.
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
  "settleDays": 14,                       // a change must be this old to be scored (see SCORECARDS rule b)
  "scoreWindowDays": 90,                  // the scorecards' OWN look-back — fixed; this layer ignores days, channel AND user
  "scorecards": [                         // one entry per operator, most-scored first; automated writers excluded
    { "user": "Andreas", "settled": 518, "pending": 256,   // pending = in-window but < settleDays old, so scored nowhere on this panel
      "shp": { "raises": 112, "raiseVerdicts": { "more": 30, "less": 25, "same": 6, "unclear": 51 }, "raiseUnits": 690,
               "raiseCash": 1707.40,
               "cuts": 74, "cutVerdicts": { "more": 20, "less": 3, "same": 1, "unclear": 50 }, "cutUnits": 520, "cutDiscount": 1900.00 },
      "amz": { ...same shape... },
      "excluded": { "level": 5, "newPrice": 1 } },   // logged but not a reprice; kept so counts reconcile with the summary
    ...
  ],
  "users": ["Andreas", "Sam", ...],       // distinct operators across both logs, for the filter dropdown
  "rows": [
    { "channel": "AMZ", "groupid": "FLE030-IVES-RED", "amzCode": "FLE030-IVES-RED-04", "size": "04",
      "title": "Womens ...", "oldPrice": 36.49, "newPrice": 35.49, "changedBy": "Andreas",
      "changedAt": "2026-07-13T00:55:00.000Z", "note": "creep 0.30 — 4u/7d", "daysSince": 1, "unitsSince": 0,
      "settled": false, "unitsLive": 0, "cashImpact": 0.00,     // unitsLive/cashImpact = bounded to this price's own run
      "lastProfit": 5.60, "lastSold": "2026-07-24",            // profit on the latest sale AT THIS PRICE (null = none since the change)
      "verdict": "MORE", "daysBefore": 21, "daysAfter": 17,     // VERDICT block below; all null when the row isn't scored
      "unitsBefore": 2, "unitsAfter": 3, "pwBefore": 1.77, "pwAfter": 4.99, "season": 0.777 },
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

// pg date/timestamp -> 'YYYY-MM-DD' from local components (no UTC day-shift — a pg DATE handed to toISOString() parses as local midnight
// and BST drags it back a day). null-safe.
function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// A change must be this many days old before it is scored on the staff cards: a raise made yesterday hasn't had a chance to earn, and
// including it only drags the average toward zero. 14 days ~ two sales weeks, matched to the WINNERS bar's own cadence (>=2 units/30d,
// i.e. roughly one sale every two weeks for a borderline-fine item) so a settled change has had a fair chance to show a sale either way.
// Owner call (2026-07-30): review-period clearance (the old 21d rationale) was dropped as the deciding factor — the panel answers "is it
// working", not "is it out of review", so scoring a change still inside its own review window is fine.
const SETTLE_DAYS = 14;

// The scorecards run on a FIXED 90-day look-back, deliberately ignoring the `days` window selector. That selector is an ACTIVITY control
// ("how much repricing happened this month"); impact needs a MATURITY basis, and the two fight each other: on a 30-day window only the
// 21-30-day-old slice qualifies, which was 8 changes out of 299 — a number that looks like a bug and reads like a verdict. Fixing the
// basis means the panel always answers the same question ("of the changes old enough to judge, how did they do?") and can state its own
// period once, instead of the operator having to reconcile three different day counts on one screen. 90 days ~ one season, which suits a
// catalogue whose demand swings hard between winter and summer; longer would blend clearance and harvest into one meaningless average.
// The CHANNEL filter still applies (a per-channel cut doesn't harm the sample); the user filter still doesn't (the cards ARE that split).
const SCORE_WINDOW_DAYS = 90;

// The one non-human writer on the logs — the Amazon auto-match cron (C:\scripts\amz-match\amz_match_sync.py writes this exact display
// name). Matched by string because that script, not this app, owns the value. EXCLUDED from the scorecards entirely (owner's call): the
// panel answers "was this person's time well spent", and a cron has no time to justify — scoring it just adds a card nobody reads. It
// still appears in the summary's BY USER counts, which are activity, not a staff judgement.
const AUTOMATED_WRITER = 'Amazon match (auto)';

// ------------------------------------------------------------------------------------------------------------------------------------
// "Did this sale happen at THIS change's price?" — the attribution predicate, in one place because three different LATERALs need to agree
// (units_live on the detail rows, the latest-sale profit beside it, and the scorecards). Two of them sit side by side in the same table
// row, so any drift between them shows up on screen as a row that contradicts itself.
//
// The whole difficulty is the BOUNDARY DAY. `sales.solddate` is a bare DATE and legacy log rows carry no `changed_at` at all, so on the day
// a price changed there is no timestamp that can say which side of the switch a sale fell on. A plain `solddate >= change_date` credited
// this change with everything that sold that day INCLUDING the sales made hours earlier at the old price — a 6 Jul raise 63.99 -> 70.43
// read as 5 units when the drill's price timeline (which groups by the price actually paid) said 4.
//
// So the day is used for the coarse window and the PRICE PAID settles the two boundary days:
//   - on the change day, a sale at the OLD price was transacted before the switch -> not ours;
//   - on the day the NEXT change landed, a sale at OUR price was transacted before that switch -> still ours (the old rule dropped these
//     silently, which is why some runs were also under-counting their tail).
// The two halves are exact complements — the next change's own lower bound excludes precisely what our upper bound claims — so every sale
// has exactly one owner and nothing is double counted.
//
// `c` is the change row's alias; `col` maps the four columns it needs, because the scorecards query names them differently (d/o/nw). All
// of it is fixed source text — no request input reaches this string.
// ------------------------------------------------------------------------------------------------------------------------------------
const saleInRun = (c, col = {}) => {
  const day = col.day || 'change_date';
  const next = col.next || 'next_d';
  const oldP = col.oldPrice || 'old_price';
  const newP = col.newPrice || 'new_price';
  return `
            s.solddate >= ${c}.${day}
            AND (${c}.${next} IS NULL OR s.solddate <= ${c}.${next})
            AND NOT (s.solddate = ${c}.${day} AND ${c}.${oldP} IS NOT NULL AND s.soldprice = ${c}.${oldP})
            AND (${c}.${next} IS NULL OR s.solddate < ${c}.${next} OR (${c}.${newP} IS NOT NULL AND s.soldprice = ${c}.${newP}))`;
};

// ------------------------------------------------------------------------------------------------------------------------------------
// VERDICT — "did this change leave the item EARNING more or less per week?" (owner, 2026-09-26). The old hit rates ("sold at least one")
// only proved a change hadn't killed the item: a raise that took a style from 6/wk at £72 to 1/wk at £80 scored as a success. The verdict
// compares PROFIT PER WEEK at the old price against profit per week at the new one, so a raise that loses volume but earns more per week
// is a win, and one that sells but earns less is not. A cut off the Stuck list starts from ~£0/wk (it sold nothing in 30 days by
// definition), so any profitable sale after it reads as "earned more" — correct: shifting that stock was the job.
//
//   before = the old price's last stretch: from the previous change on the same key (or BEFORE_DAYS back, whichever is later) up to this
//            change. Boundary days are settled by price paid, the same way `saleInRun` does it.
//   after  = this price's run (`saleInRun`), capped at AFTER_DAYS and stopping before today (today is a part day).
//   £/wk   = SUM(sales.profit) * 7 / window days. Calendar days the price was LIVE, not first-to-last sale like the drill's timeline — a
//            week at a price with nothing sold is evidence here, not a gap.
//   SEASON = the whole channel's profit per day over the same two windows. If Shopify as a whole earned 30% less in the after window,
//            the before figure is scaled down 30% before comparing — otherwise every August raise on a sandal looks bad because
//            September arrived, not because of the price. One ratio per change; no per-style modelling. Skipped (factor 1) when either
//            window has no channel profit.
//   verdict = MORE / LESS when the after £/wk beats / misses the season-adjusted before by more than VERDICT_BAND, SAME inside the band,
//            UNCLEAR when either window was under 7 days (price wasn't live long enough to rate) or fewer than VERDICT_MIN_UNITS sold
//            across both windows (noise). Amazon is scored per SIZE, so expect a lot of UNCLEAR there — that is honest, not a bug.
//
// Profit is `sales.profit` on positive lines, matching every other attribution here. The known AMZ ~20% understatement (see memory/docs)
// sits on BOTH sides of the comparison, so it cancels.
// ------------------------------------------------------------------------------------------------------------------------------------
const BEFORE_DAYS = 28;
const AFTER_DAYS = 28;
const VERDICT_BAND = 0.1;        // ±10% of the season-adjusted before figure counts as "no real change"
const VERDICT_MIN_UNITS = 3;     // fewer units than this across both windows = can't tell
const VERDICT_MIN_DAYS = 7;      // a price live under a week on either side can't be rated per week

// Daily channel profit, the season baseline. `lookback` is SQL text for how many days back the scored changes can reach (window + BEFORE).
const chanDailyCte = (lookback) => `
      chan_daily AS (
        SELECT s.channel, s.solddate AS d, SUM(s.profit) AS profit
        FROM sales s
        WHERE s.channel IN ('SHP', 'AMZ') AND s.qty > 0 AND s.soldprice > 0
          AND s.solddate >= CURRENT_DATE - (${lookback})
        GROUP BY s.channel, s.solddate
      )`;

// The chain of LATERALs that produces `ev_v.verdict` plus the evidence behind it for change row `c`. `keyMatch` ties a sales row `s` to the
// change's item; `gate` is the "should this row be scored at all" test — every LATERAL returns nothing when it fails, so unscored rows
// (pending, holds, first prices) come back with NULL evidence and a NULL verdict rather than a fake one. Fixed source text only.
const verdictJoins = (c, col, keyMatch, gate) => {
  const day = col.day || 'change_date';
  const next = col.next || 'next_d';
  const prev = col.prev || 'prev_d';
  const oldP = col.oldPrice || 'old_price';
  const chan = col.chan || 'channel';
  return `
      LEFT JOIN LATERAL (
        SELECT GREATEST(${c}.${prev}, ${c}.${day} - ${BEFORE_DAYS}) AS from_d,
               LEAST(${c}.${next}, CURRENT_DATE, ${c}.${day} + ${AFTER_DAYS}) AS to_d,
               ${c}.${day} - GREATEST(${c}.${prev}, ${c}.${day} - ${BEFORE_DAYS}) AS days_before,
               LEAST(${c}.${next}, CURRENT_DATE, ${c}.${day} + ${AFTER_DAYS}) - ${c}.${day} AS days_after
        WHERE ${gate}
      ) ev_w ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.qty), 0)::int AS units, COALESCE(SUM(s.profit), 0) AS profit
        FROM sales s
        WHERE ev_w.from_d IS NOT NULL
          AND s.channel = ${c}.${chan} AND s.qty > 0 AND s.soldprice > 0 AND ${keyMatch}
          AND s.solddate >= ev_w.from_d AND s.solddate <= ${c}.${day}
          AND (s.solddate < ${c}.${day} OR s.soldprice = ${c}.${oldP})
          AND (${c}.${prev} IS NULL OR s.solddate > ${c}.${prev} OR s.soldprice = ${c}.${oldP})
      ) ev_b ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.qty), 0)::int AS units, COALESCE(SUM(s.profit), 0) AS profit
        FROM sales s
        WHERE ev_w.from_d IS NOT NULL
          AND s.channel = ${c}.${chan} AND s.qty > 0 AND s.soldprice > 0 AND ${keyMatch}
          AND ${saleInRun(c, col)}
          AND s.solddate < ${c}.${day} + ${AFTER_DAYS}
          AND s.solddate < CURRENT_DATE
      ) ev_a ON true
      LEFT JOIN LATERAL (
        SELECT SUM(cd.profit) FILTER (WHERE cd.d <  ${c}.${day}) AS before,
               SUM(cd.profit) FILTER (WHERE cd.d >= ${c}.${day}) AS after
        FROM chan_daily cd
        WHERE ev_w.from_d IS NOT NULL
          AND cd.channel = ${c}.${chan} AND cd.d >= ev_w.from_d AND cd.d < ev_w.to_d
      ) ev_c ON true
      LEFT JOIN LATERAL (
        SELECT ev_b.profit * 7.0 / GREATEST(ev_w.days_before, 7) AS pw_before,
               ev_a.profit * 7.0 / GREATEST(ev_w.days_after, 7)  AS pw_after,
               CASE WHEN ev_c.before > 0 AND ev_c.after > 0 AND ev_w.days_before > 0 AND ev_w.days_after > 0
                    THEN (ev_c.after / ev_w.days_after) / (ev_c.before / ev_w.days_before)
                    ELSE 1 END AS season
        WHERE ev_w.from_d IS NOT NULL
      ) ev_r ON true
      LEFT JOIN LATERAL (
        SELECT CASE
                 WHEN ev_w.days_before < ${VERDICT_MIN_DAYS} OR ev_w.days_after < ${VERDICT_MIN_DAYS} THEN 'UNCLEAR'
                 WHEN ev_b.units + ev_a.units < ${VERDICT_MIN_UNITS} THEN 'UNCLEAR'
                 WHEN ev_r.pw_after > ev_r.pw_before * ev_r.season + ${VERDICT_BAND} * ABS(ev_r.pw_before * ev_r.season) THEN 'MORE'
                 WHEN ev_r.pw_after < ev_r.pw_before * ev_r.season - ${VERDICT_BAND} * ABS(ev_r.pw_before * ev_r.season) THEN 'LESS'
                 ELSE 'SAME'
               END AS verdict
        WHERE ev_w.from_d IS NOT NULL
      ) ev_v ON true`;
};

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

    // Impact filter on the DETAIL list — "which of my changes have actually done something?".
    //   'all'     - every change in the window (the raw activity log).
    //   'settled' - only changes old enough to judge (>= SETTLE_DAYS). Same bar the scorecards use.
    //   'moved'   - settled AND something sold at that price. The "it worked" list.
    // Applied server-side, before the limit, so it filters the whole window rather than just the newest 50 rows.
    const rawImpact = String(req.query.impact || 'all').toLowerCase();
    const impact = rawImpact === 'settled' || rawImpact === 'moved' ? rawImpact : 'all';

    // Include-flags let one parameterised query serve all three channel modes without string-building the WHERE.
    const wantShp = channel === 'all' || channel === 'shp';
    const wantAmz = channel === 'all' || channel === 'amz';

    // Unified change list -> window + channel filter -> optional user filter -> newest-first -> limit -> attach title + units-since.
    //   sort_ts    = exact change instant (changed_at) or the bare change date at midnight for legacy rows.
    //   change_date is the LONDON calendar day of that instant, derived here rather than read from the stored change_date/log_date column.
    //     The DB session runs in UTC, so the stored column (written as CURRENT_DATE by the apply routes) is the UTC day: a change applied
    //     at 00:14 BST is stamped with YESTERDAY. Every consumer of change_date compares it against sales.solddate, which is a LOCAL trading
    //     day — so an evening apply used to credit itself with the whole of the previous day's sales, all made at the OLD price, and the row
    //     read "changed 26 Jul, sold 25 Jul". Deriving the day from the instant in Europe/London puts both sides on the same calendar.
    //     Legacy rows (changed_at NULL) are unaffected: their date goes to UTC midnight and converts back to the same day.
    //   The window predicate sits INSIDE each UNION branch so it can use each log's own date index rather than filtering after the merge.
    //   total      = COUNT(*) OVER () evaluated in `picked` BEFORE the LIMIT -> how many changes the filters really match ("50 of 1,327").
    //   units-since LATERAL: same channel + key, positive lines, solddate on/after the change day.
    //
    // Each row also carries the BOUNDED figure the scorecards are built on: `units_live` counts only what sold while THIS price was live
    // (change date -> the next change on the same key), so a style repriced twice doesn't credit both moves with the same sales. That's
    // what makes "show me the changes that actually did something" answerable per row. `is_settled` marks changes old enough to judge.
    // The bounded LATERAL therefore has to run across the WHOLE window, not just the picked rows, because the `impact` filter and `total`
    // both depend on it — a few hundred rows, so the extra work is cheap and the count stays truthful.
    // Note LEAD() partitions on the row's own key (groupid for Shopify, code for Amazon) and must see every change in the window,
    // including ones the user filter would drop: someone else's later change still ends this price's run.
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
               (COALESCE(p.changed_at, p.change_date::timestamptz) AT TIME ZONE 'Europe/London')::date AS change_date,
               p.id               AS id,
               COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz AS in_window
        FROM price_change_log p
        WHERE p.channel = 'SHP' AND $1::bool
          AND COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - ($3::int + ${BEFORE_DAYS}))::timestamptz
        UNION ALL
        SELECT 'AMZ'::text,
               f.groupid,
               a.code,
               a.old_price,
               a.new_price,
               a.notes,
               a.changed_by,
               COALESCE(a.changed_at, a.log_date::timestamptz),
               (COALESCE(a.changed_at, a.log_date::timestamptz) AT TIME ZONE 'Europe/London')::date,
               a.id,
               COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - $3::int)::timestamptz
        FROM amz_price_log a
        LEFT JOIN amzfeed f ON f.code = a.code
        WHERE $2::bool
          AND COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - ($3::int + ${BEFORE_DAYS}))::timestamptz
      ),
      -- The source reaches BEFORE_DAYS further back than the window so LAG() can see the change that started the old price's run (the
      -- verdict's "before" window). Those extra rows are dropped straight after (in_window) and never reach a count, a row or the limit.
      bounded AS (
        SELECT c.*,
               LEAD(c.change_date) OVER (
                 PARTITION BY c.channel, COALESCE(c.amz_code, c.groupid)
                 ORDER BY c.sort_ts, c.id
               ) AS next_d,
               LAG(c.change_date) OVER (
                 PARTITION BY c.channel, COALESCE(c.amz_code, c.groupid)
                 ORDER BY c.sort_ts, c.id
               ) AS prev_d
        FROM changes c
      ),
      ${chanDailyCte(`$3::int + ${BEFORE_DAYS}`)},
      scored AS (
        SELECT b.*,
               ((CURRENT_DATE - b.change_date) >= $6::int) AS is_settled,
               lu.units AS units_live
        FROM bounded b
        LEFT JOIN LATERAL (
          SELECT COALESCE(SUM(s.qty), 0)::int AS units
          FROM sales s
          WHERE s.channel = b.channel
            AND s.qty > 0 AND s.soldprice > 0
            AND ${saleInRun('b')}
            AND ( (b.channel = 'SHP' AND s.groupid = b.groupid)
               OR (b.channel = 'AMZ' AND s.code = b.amz_code) )
        ) lu ON true
        WHERE b.in_window
      ),
      picked AS (
        SELECT *, COUNT(*) OVER ()::int AS total
        FROM scored
        WHERE ($4::text IS NULL OR changed_by = $4)
          AND ( $7::text = 'all'
             OR ($7::text = 'settled' AND is_settled)
             OR ($7::text = 'moved'   AND is_settled AND units_live > 0) )
        ORDER BY sort_ts DESC, id DESC
        LIMIT $5::int
      )
      SELECT pk.total,
             pk.channel,
             pk.groupid,
             pk.amz_code,
             CASE WHEN pk.amz_code IS NOT NULL THEN SUBSTRING(pk.amz_code FROM '[^-]*$') END AS size,
             t.shopifytitle          AS title,
             pk.old_price,
             pk.new_price,
             pk.note,
             pk.changed_by,
             pk.sort_ts,
             (CURRENT_DATE - pk.change_date) AS days_since,
             pk.is_settled,
             pk.units_live,
             su.units                AS units_since,
             ls.last_profit,
             ls.last_solddate,
             ev_v.verdict,
             ev_w.days_before,
             ev_w.days_after,
             ev_b.units              AS units_before,
             ev_a.units              AS units_after,
             ev_r.pw_before,
             ev_r.pw_after,
             ev_r.season
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
      -- Profit on the most recent sale MADE AT THIS PRICE — bounded to exactly the same run as units_live (change date -> the next change
      -- on the same key), so it answers "what is the NEW price earning?" and not "what has this style ever earned". An unbounded latest-sale
      -- profit (the New Additions technique) reads as history here: on a row repriced last week it would happily show a sale from March at
      -- the old price, which is the opposite of the question this screen asks. NULL when nothing has sold since the change — the column then
      -- shows a dash, which lines up with the 0 in the Sold column beside it. Positive lines only so a return can't become the "latest"; tie-break
      -- (solddate, then ordertime blank-last, then id) matches the Sales screen so "latest" means the same thing everywhere.
      -- Runs over the picked rows only (<= limit), so it's a top-1 lookup per displayed row, not per window row.
      LEFT JOIN LATERAL (
        SELECT s.profit AS last_profit, s.solddate AS last_solddate
        FROM sales s
        WHERE s.channel = pk.channel
          AND s.qty > 0 AND s.soldprice > 0
          AND ${saleInRun('pk')}
          AND ( (pk.channel = 'SHP' AND s.groupid = pk.groupid)
             OR (pk.channel = 'AMZ' AND s.code = pk.amz_code) )
        ORDER BY s.solddate DESC, NULLIF(s.ordertime, '') DESC NULLS LAST, s.id DESC
        LIMIT 1
      ) ls ON true
      -- The verdict (see VERDICT above) — picked rows only, and only real reprices old enough to judge.
      ${verdictJoins(
        'pk',
        {},
        `((pk.channel = 'SHP' AND s.groupid = pk.groupid) OR (pk.channel = 'AMZ' AND s.code = pk.amz_code))`,
        'pk.is_settled AND pk.old_price > 0 AND pk.new_price > 0 AND pk.old_price <> pk.new_price'
      )}
      ORDER BY pk.sort_ts DESC, pk.id DESC
      `,
      [wantShp, wantAmz, days, user, limit, SETTLE_DAYS, impact]
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

    // SCORECARDS — see computeScorecards() below the handler. Served from a once-a-day cache (see getScorecards).
    const scorecards = await getScorecards();

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
      // The bounded pair — what this specific move can be credited with. `cashImpact` is signed by direction: positive = extra cash taken
      // on a raise, negative = discount handed over on a cut. Null when a price is missing, so the UI shows "—" rather than a fake 0.
      settled: !!r.is_settled,
      unitsLive: Number(r.units_live) || 0,
      // Profit on the latest sale made AT THIS PRICE — same bounded run as unitsLive. null = nothing has sold since the change.
      lastProfit: num(r.last_profit),
      lastSold: toIsoDate(r.last_solddate),
      // The verdict (see VERDICT above) and the evidence behind it. All null when the row isn't scored (pending, hold, first price).
      // pwBefore is the RAW old-price figure; `season` is the channel factor it was scaled by before comparing (1 = no adjustment).
      verdict: r.verdict || null,               // 'MORE' | 'LESS' | 'SAME' | 'UNCLEAR' | null
      daysBefore: r.days_before === null ? null : Number(r.days_before),
      daysAfter: r.days_after === null ? null : Number(r.days_after),
      unitsBefore: r.units_before === null ? null : Number(r.units_before),
      unitsAfter: r.units_after === null ? null : Number(r.units_after),
      pwBefore: r.pw_before === null ? null : Number(Number(r.pw_before).toFixed(2)),
      pwAfter: r.pw_after === null ? null : Number(Number(r.pw_after).toFixed(2)),
      season: r.season === null ? null : Number(Number(r.season).toFixed(3)),
      cashImpact:
        num(r.old_price) === null || num(r.new_price) === null
          ? null
          : Number((((Number(r.units_live) || 0) * (Number(r.new_price) - Number(r.old_price)))).toFixed(2)),
    }));

    // `total` comes off any picked row (it's a window function, identical on all of them); no rows = nothing matched.
    const total = result.rows.length ? Number(result.rows[0].total) || 0 : 0;

    return res.json({
      return_code: 'SUCCESS',
      channel,
      user,
      days,
      impact,
      limit,
      count: rows.length,
      total,
      truncated: total > rows.length,
      summary,
      settleDays: SETTLE_DAYS,
      scoreWindowDays: SCORE_WINDOW_DAYS,   // scorecards' own fixed period — NOT `days`
      scorecards,
      users: usersResult.rows.map((u) => u.changed_by),
      rows,
    });
  } catch (err) {
    logger.error('[analytics-change-impact] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load Price Changes' });
  }
});

// ------------------------------------------------------------------------------------------------------------------------------------
// SCORECARDS CACHE — the Impact grid is computed at most once a day. It ignores every request filter, so one result serves every request,
// and it scores only changes at least SETTLE_DAYS old, so it barely moves within a day. The verdict made it the slow part of this route
// (~1s of the ~1.5s: ~1,350 settled changes x three sales lookups each), and it ran on every filter click. Owner's call (2026-09-26): a grid
// up to a day stale is fine for this screen.
//
// Keyed on the DB's day (UTC — the pg session is Etc/UTC and CURRENT_DATE drives the settled test), so the grid rolls over when the SQL's
// notion of "today" does. What can lag within a day: sales synced later in the day for already-settled changes, a new change that ends a
// settled change's run, and the "N scored of M" / hold counts, which include today's activity. The detail list and summary are never cached.
// The PROMISE is stored, not the result, so requests that arrive while the first load is running share it rather than each starting the query.
// A failed load is dropped so the next request retries instead of serving an error all day. In-process: PM2 runs one fork, and a restart
// (every deploy) simply starts cold.
// ------------------------------------------------------------------------------------------------------------------------------------
let scorecardCache = { day: null, promise: null };

function getScorecards() {
  const day = new Date().toISOString().slice(0, 10);
  if (scorecardCache.day !== day || !scorecardCache.promise) {
    const promise = computeScorecards().catch((err) => {
      if (scorecardCache.promise === promise) scorecardCache = { day: null, promise: null };
      throw err;
    });
    scorecardCache = { day, promise };
  }
  return scorecardCache.promise;
}

async function computeScorecards() {
  // SCORECARDS — the staff read. Ignores EVERY filter above (window, channel, user) and runs on its own fixed basis: the last
  // SCORE_WINDOW_DAYS, both channels, everyone. One rule is easier to hold than three exceptions, and the grid needs both channels side
  // by side regardless of what the channel switch says.
  //
  //   ch      = both logs normalised, with `kind` classifying each row ONCE (see below). Nothing downstream re-tests prices.
  //   bounded = LEAD() gives the date the NEXT change on the same key landed -> the end of this change's attribution window.
  //             Ordered by the exact instant then id so same-day changes chain in the order they were actually made.
  //   scored  = attaches units sold inside that window, and flags settled-ness. is_settled must be evaluated AFTER the LEAD: a settled
  //             change is often superseded by a RECENT one, and filtering those out first would leave next_d NULL and let the old change
  //             claim every sale up to today. A same-day supersede yields an empty window and 0 units, which is correct.
  //
  // `kind` is the single source of truth for what a log row IS, replacing the `old_price > 0 AND new_price > 0` tests that used to be
  // repeated in every aggregate:
  //   RAISE / CUT  - a real reprice with a usable before and after.
  //   LEVEL        - logged but the price didn't move: a HOLD. Not a mistake and not a no-op — `pricing-park` (W2) sets a review date
  //                  but writes no log row and stores no note, so pressing Apply with the price unchanged is the only way to record WHY
  //                  a style was left alone ("Hold at £45... Review ~2026-06-10; if still 0 units, drop to £40"). It is the third
  //                  pricing verb after raise and cut, and it evidences that someone looked, so it is counted and shown, never scored:
  //                  a hold isn't trying to move anything, so "did it sell?" says nothing about it.
  //   NEW          - old_price is 0/NULL: the FIRST price on a new product, written by Add/Modify. There is no "before", so it can be
  //                  neither a raise nor a cut. These used to be dropped silently by the >0 filter, which quietly deleted 14 of Summer's
  //                  82 Shopify rows from her denominator. Now they're classified, excluded from the rates, and counted in `excluded` so
  //                  the numbers reconcile against the activity summary above.
  // Rates are per CHANNEL because they are structurally different: Shopify raises sold on 51% of tries against Amazon's 76% in the same
  // period, so a blended percentage is a channel-mix artefact and cannot be compared between two operators with different mixes.
  const scoreResult = await query(
    `
    WITH ch AS (
      SELECT COALESCE(p.changed_by, '') AS who, p.groupid AS k, 'SHP'::text AS chan,
             p.old_price AS o, p.new_price AS nw,
             CASE WHEN p.old_price IS NULL OR p.old_price <= 0 OR p.new_price IS NULL OR p.new_price <= 0 THEN 'NEW'
                  WHEN p.new_price > p.old_price THEN 'RAISE'
                  WHEN p.new_price < p.old_price THEN 'CUT'
                  ELSE 'LEVEL' END AS kind,
             COALESCE(p.changed_at, p.change_date::timestamptz)      AS ts,
             (COALESCE(p.changed_at, p.change_date::timestamptz) AT TIME ZONE 'Europe/London')::date AS d,
             p.id AS id,
             COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - $1::int)::timestamptz AS in_window
      FROM price_change_log p
      WHERE p.channel = 'SHP'
        AND COALESCE(p.changed_at, p.change_date::timestamptz) >= (CURRENT_DATE - ($1::int + ${BEFORE_DAYS}))::timestamptz
      UNION ALL
      SELECT COALESCE(a.changed_by, ''), a.code, 'AMZ',
             a.old_price, a.new_price,
             CASE WHEN a.old_price IS NULL OR a.old_price <= 0 OR a.new_price IS NULL OR a.new_price <= 0 THEN 'NEW'
                  WHEN a.new_price > a.old_price THEN 'RAISE'
                  WHEN a.new_price < a.old_price THEN 'CUT'
                  ELSE 'LEVEL' END,
             COALESCE(a.changed_at, a.log_date::timestamptz),
             (COALESCE(a.changed_at, a.log_date::timestamptz) AT TIME ZONE 'Europe/London')::date,
             a.id,
             COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - $1::int)::timestamptz
      FROM amz_price_log a
      WHERE COALESCE(a.changed_at, a.log_date::timestamptz) >= (CURRENT_DATE - ($1::int + ${BEFORE_DAYS}))::timestamptz
    ),
    bounded AS (
      SELECT ch.*,
             LEAD(ch.d) OVER (PARTITION BY ch.chan, ch.k ORDER BY ch.ts, ch.id) AS next_d,
             LAG(ch.d)  OVER (PARTITION BY ch.chan, ch.k ORDER BY ch.ts, ch.id) AS prev_d   -- the verdict's "before" start
      FROM ch
    ),
    scored AS (
      SELECT b.*, ((CURRENT_DATE - b.d) >= $2::int) AS is_settled, su.units
      FROM bounded b
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(s.qty), 0)::int AS units
        FROM sales s
        WHERE s.channel = b.chan
          AND s.qty > 0 AND s.soldprice > 0
          AND ${saleInRun('b', { day: 'd', oldPrice: 'o', newPrice: 'nw' })}
          AND ( (b.chan = 'SHP' AND s.groupid = b.k) OR (b.chan = 'AMZ' AND s.code = b.k) )
      ) su ON true
      WHERE b.in_window        -- the extra BEFORE_DAYS of source rows exist only to feed LAG(); they are not this panel's changes
    ),
    ${chanDailyCte(`$1::int + ${BEFORE_DAYS}`)},
    -- The verdict per settled raise/cut (see VERDICT above). Holds, first prices and pending changes get NULL and are counted nowhere.
    judged AS (
      SELECT b.*, ev_v.verdict
      FROM scored b
      ${verdictJoins(
        'b',
        { day: 'd', oldPrice: 'o', newPrice: 'nw', chan: 'chan' },
        `((b.chan = 'SHP' AND s.groupid = b.k) OR (b.chan = 'AMZ' AND s.code = b.k))`,
        `b.is_settled AND b.kind IN ('RAISE', 'CUT')`
      )}
    )
    -- One row per operator per channel; the front end sums the two where a blended figure is safe (cuts) and keeps them apart where it
    -- is not (raises). Every aggregate is settled-only, so the settled count is the denominator the rates below can be trusted against.
    SELECT who, chan,
           COUNT(*) FILTER (WHERE is_settled)::int                                       AS settled,
           -- The counterweight to "settled": changes made INSIDE the window but still under SETTLE_DAYS old, so scored nowhere on this
           -- panel. Surfaced (rather than left as an invisible gap) because it is the single most misread thing here — someone repricing
           -- hard all month sees a scorecard built on the three-week-old work only, and reads it as the panel being stale or broken.
           -- Reporting it turns "why isn't my week in this?" into "my week is in the queue", and settled + pending reconciles to the
           -- window total, so no row can silently vanish between the two.
           COUNT(*) FILTER (WHERE NOT is_settled)::int                                    AS pending,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'RAISE')::int                     AS raises,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'RAISE' AND verdict = 'MORE')::int    AS raises_more,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'RAISE' AND verdict = 'LESS')::int    AS raises_less,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'RAISE' AND verdict = 'SAME')::int    AS raises_same,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'RAISE' AND verdict = 'UNCLEAR')::int AS raises_unclear,
           COALESCE(SUM(units) FILTER (WHERE is_settled AND kind = 'RAISE'), 0)::int      AS raise_units,
           COALESCE(SUM(units * (nw - o)) FILTER (WHERE is_settled AND kind = 'RAISE'), 0) AS raise_cash,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'CUT')::int                       AS cuts,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'CUT' AND verdict = 'MORE')::int      AS cuts_more,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'CUT' AND verdict = 'LESS')::int      AS cuts_less,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'CUT' AND verdict = 'SAME')::int      AS cuts_same,
           COUNT(*) FILTER (WHERE is_settled AND kind = 'CUT' AND verdict = 'UNCLEAR')::int   AS cuts_unclear,
           COALESCE(SUM(units) FILTER (WHERE is_settled AND kind = 'CUT'), 0)::int        AS cut_units,
           COALESCE(SUM(units * (o - nw)) FILTER (WHERE is_settled AND kind = 'CUT'), 0)  AS cut_discount,
           -- NOT settled-gated, unlike everything above. Settling exists to give a change time to SELL; a hold isn't waiting on an
           -- outcome and a first-time price has no "before" to beat, so gating these would just hide the last three weeks of work.
           COUNT(*) FILTER (WHERE kind = 'LEVEL')::int                                    AS level_changes,
           COUNT(*) FILTER (WHERE kind = 'NEW')::int                                      AS new_prices
    FROM judged
    GROUP BY who, chan
    `,
    [SCORE_WINDOW_DAYS, SETTLE_DAYS]
  );

  // Fold the per-(operator, channel) rows into one entry per operator holding both channel blocks. Built by accumulation rather than by
  // two passes so an operator who has only ever touched one channel still gets a fully-shaped (zeroed) block for the other — the grid
  // renders a dash there, which is itself informative (Summer has never repriced on Amazon).
  const emptyVerdicts = () => ({ more: 0, less: 0, same: 0, unclear: 0 });
  const emptyBlock = () => ({
    raises: 0, raiseVerdicts: emptyVerdicts(), raiseUnits: 0, raiseCash: 0,
    cuts: 0, cutVerdicts: emptyVerdicts(), cutUnits: 0, cutDiscount: 0,
  });
  const byOperator = new Map();

  for (const r of scoreResult.rows) {
    if (r.who === AUTOMATED_WRITER) continue;      // cron, not staff — see AUTOMATED_WRITER
    const key = r.who || '';
    if (!byOperator.has(key)) {
      byOperator.set(key, {
        user: r.who || null,                        // null = unattributed legacy rows
        settled: 0,
        pending: 0,                                 // in-window but too new to score — see the `pending` column above
        shp: emptyBlock(),
        amz: emptyBlock(),
        excluded: { level: 0, newPrice: 0 },        // logged but not a reprice — surfaced so the counts reconcile
      });
    }
    const entry = byOperator.get(key);
    const block = r.chan === 'AMZ' ? entry.amz : entry.shp;

    entry.settled += Number(r.settled) || 0;
    entry.pending += Number(r.pending) || 0;
    entry.excluded.level += Number(r.level_changes) || 0;
    entry.excluded.newPrice += Number(r.new_prices) || 0;

    block.raises = Number(r.raises) || 0;
    block.raiseVerdicts = {
      more: Number(r.raises_more) || 0, less: Number(r.raises_less) || 0,
      same: Number(r.raises_same) || 0, unclear: Number(r.raises_unclear) || 0,
    };
    block.raiseUnits = Number(r.raise_units) || 0;
    block.raiseCash = Number(Number(r.raise_cash || 0).toFixed(2));
    block.cuts = Number(r.cuts) || 0;
    block.cutVerdicts = {
      more: Number(r.cuts_more) || 0, less: Number(r.cuts_less) || 0,
      same: Number(r.cuts_same) || 0, unclear: Number(r.cuts_unclear) || 0,
    };
    block.cutUnits = Number(r.cut_units) || 0;
    block.cutDiscount = Number(Number(r.cut_discount || 0).toFixed(2));
  }

  // MOST DATA FIRST. Never rank on a rate: a 91%-of-11 would outrank a 51%-of-112 and the grid would lead with its least reliable row.
  // Sorting by sample size keeps the trustworthy row on top and barely moves month to month; ties by name so reloads don't reshuffle.
  return [...byOperator.values()].sort((a, b) => {
    if (b.settled !== a.settled) return b.settled - a.settled;
    return (a.user || '').localeCompare(b.user || '');
  });
}

module.exports = router;
