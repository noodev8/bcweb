/*
=======================================================================================================================================
Module: utils/portfolioStatus.js
=======================================================================================================================================
Purpose: THE PORTFOLIO STATUS of every style — WINNERS | STEADY | NEW | HARVEST | LOSERS — defined once, written to
         skusummary.portfolio_status by "Update now" on Repricing's Status tab, and READ everywhere else.

         "Instead of determining the WINNERS all the time, lets tag it in the database. By Groupid." — owner, 2026-09-24.

         The tag is a STAMP, not a live reading: it says what the style was at the last Update. That is the point. The repricer is
         the next consumer — it will pick which list to show from the selected status — and it must read the SAME value the
         Winners screen counted, not re-derive its own. So the rules live here, the write lives here, and callers read the column.

THE RULES, TESTED IN THIS ORDER — FIRST MATCH WINS (owner, 2026-09-24):

  1. WINNERS  revenue NET OF RETURNS > WINNER_BAR (£1,500) in the rolling 12 months, all channels — AND IN SEASON. SUM(soldprice *
              qty) over every sales row in the window, returns (qty < 0) included, strictly greater, WINNER_BAR from utils/portfolio.js.
     ...NET, NOT GROSS (owner, 2026-09-26 — "if we sold 100 of a product and had 90 returned, I would be treating it as a winner,
              but its a mess"). Until then returns were excluded, which made four Shopify winners on the day — UPPSALA £1,712 gross /
              £1,262 net, a ZERMATT, an ARIZONA and a MAYARI that missed by £1 — winners on sales they had to refund. "Even if by £1,
              we have to draw the line somewhere." A return counts in the window it was BOOKED (refund date), not the sale's.
              The stamped portfolio_revenue_12m / _units_12m are net too, so the tier dial (£2,500 / £5,000 / £10,000) reads the
              same figure the tag was decided on.
     ...an OUT-OF-SEASON earner over the bar goes straight to HARVEST, skipping STEADY (owner, 2026-09-25). Why: the 12-month
              window kept every summer winner a WINNER all winter — 56 of 73 winners were summer styles on the day — so pricing
              the winners never shrank the list. They come back as WINNERS together on 1 April, which is when they want pricing.
              Straight to HARVEST because every one of them sold in the last 3 months and would otherwise all land in STEADY.
              ONE calendar rule on both channels, knowingly: on the day 15 of 16 Amazon summer winners were still selling in 30d
              and move to HARVEST anyway (option "keep it a winner while it still sells" was offered and declined). The owner's
              next step is to review those HARVEST earners by data — some may really be season 'Any'.
  2. STEADY   sold at least one unit in the last STEADY_MONTHS (3) months.
  3. NEW      skusummary.created_at under NEW_DAYS (90) days ago.
  4. HARVEST  the style's season is OUT of season today — Summer is April-August, Winter September-March.
  5. LOSERS   everything else.

  ⚠ NEW IS TESTED BEFORE HARVEST — the owner's call when asked (2026-09-24). His first description had HARVEST first, which
    made a summer style added in September a HARVEST on its first day, before it had had any chance to sell. A product gets its
    90 days as NEW whatever the calendar says; after that, out-of-season beats loser.

  ⚠ SEASON 'Any' IS NEVER OUT OF SEASON, so it never HARVESTs and an 'Any' earner is a WINNER all year (owner, 2026-09-24).
    Only 'Summer' and 'Winter' can. (The six summer IVES were re-seasoned 'Any' on 2026-09-25: they sold at 24-53% of their summer
    rate through the winter.) The test is case- and space-insensitive because this is a legacy free-text column, but today it holds exactly Summer/Winter/Any.

  THE UNIVERSE IS skusummary — the catalogue as it stands. A deleted style cannot carry a tag, which is why the WINNERS card can
  read a couple lower than the portfolio hero count (that one also counts styles that traded this year and were then deleted —
  "a product can come in for a month, do its job and leave"). Both are right; they answer different questions.

  NOT A WINNER WHILE OUT OF STOCK? No stock test anywhere, same as the portfolio: a status is about what the style EARNS, and the
  repricer applies its own in-stock filter when it builds a list.

WHY created_at FOR NEW, when utils/portfolio.js warns against it for AGE: that warning is about how long a style has been ON SALE
(anchored on first sale). NEW here is literally "a record created in the last 90 days" — the owner's definition — and a style
with no sales at all has no first sale to anchor on. skusummary.created_at is the authoritative record date (backfilled
2026-07-28).

Writes: applyPortfolioStatus() only, and only inside a caller's transaction. It touches portfolio_status/_at and NOTHING ELSE on
skusummary — no legacy `updated` stamp, no shopifychange: re-tagging is not a product edit.
=======================================================================================================================================
*/

const { query } = require('../database');
const { WINNER_BAR } = require('./portfolio');

// The statuses in RULE ORDER, which is also the order the screen draws the cards. Exported so the repricer and the web client
// have one list to agree with. Must match the CHECK constraint in migrations/20260924_portfolio_status.sql.
const STATUSES = ['WINNERS', 'STEADY', 'NEW', 'HARVEST', 'LOSERS'];

// "Sold at least 1 item in 3 months."
const STEADY_MONTHS = 3;

// "Less than 90 days old from created date."
const NEW_DAYS = 90;

// Summer = April..August (5 months); every other month is Winter (September..March, 7 months). Month numbers, 1-based.
const SUMMER_FIRST_MONTH = 4;
const SUMMER_LAST_MONTH = 8;

// The season the business is in today, as a SQL expression yielding 'summer' | 'winter' (lower case). London wall-clock month — see
// "THE SEASON IS READ ON LONDON WALL-CLOCK" above CLASSIFY_SQL. ONE definition: the status classifier below and Shopify Order's
// in-season filter (routes/shopify-order-list.js) both read this, so a WINNER and "in season" on the order screen can never disagree
// about what month it is.
function seasonNowSql() {
  return `CASE WHEN EXTRACT(MONTH FROM now() AT TIME ZONE 'Europe/London')
                    BETWEEN ${Number(SUMMER_FIRST_MONTH)} AND ${Number(SUMMER_LAST_MONTH)}
               THEN 'summer' ELSE 'winter' END`;
}

// Today's date in LONDON, as SQL. CURRENT_DATE is the pg session's (Etc/UTC) date, which is still yesterday for the first hour of a
// BST day — fine for a 12-month window, wrong for a date someone reads back as "the day I did it".
const LONDON_TODAY_SQL = `(now() AT TIME ZONE 'Europe/London')::date`;

// The first day of the NEXT season, as a SQL date: 1 September while it is summer, 1 April while it is winter (next year's, from
// September to December). The boundaries are the season rule's own constants, so "until next season" on Shopify Order's no-supply
// flag lapses on exactly the day seasonNowSql() flips.
function nextSeasonStartSql() {
  const m = `EXTRACT(MONTH FROM ${LONDON_TODAY_SQL})::int`;
  const y = `EXTRACT(YEAR FROM ${LONDON_TODAY_SQL})::int`;
  return `CASE WHEN ${m} BETWEEN ${Number(SUMMER_FIRST_MONTH)} AND ${Number(SUMMER_LAST_MONTH)}
               THEN make_date(${y}, ${Number(SUMMER_LAST_MONTH) + 1}, 1)
               WHEN ${m} > ${Number(SUMMER_LAST_MONTH)}
               THEN make_date(${y} + 1, ${Number(SUMMER_FIRST_MONTH)}, 1)
               ELSE make_date(${y}, ${Number(SUMMER_FIRST_MONTH)}, 1) END`;
}

// THE LEAD CHANNEL (owner, 2026-09-25) — stamped beside the status, so each channel's pricing lists show only the styles that channel
// earns from. The status stays ONE all-channel tag and ONE count; the channel only decides which list a style appears on:
//   SHP / AMZ  >= LEAD_SHARE of the style's 12m gross revenue came from that channel
//   BOTH       mixed, OR no 12m sales but listed on Amazon (amzfeed) — it needs pricing on both
//   SHP        no 12m sales and not on Amazon
// NULL (created since the last Update) is read as BOTH everywhere, so a new product is never hidden from a list.
// Why 80%: on the day, every winner was >= 80% one channel (50 Shopify / 23 Amazon / 0 mixed); STEADY had 10 mixed, LOSERS 3.
const LEAD_SHARE = 0.8;
const CHANNELS = ['SHP', 'AMZ'];

// "Is this style on <channel>'s lists?" as SQL over a skusummary alias — THE one predicate every status list, count and filter uses,
// so no two places can disagree about which list a style belongs on. Channel comes from the fixed CHANNELS list, never a request.
function channelFilterSql(alias, channel) {
  if (!CHANNELS.includes(channel)) throw new Error(`channelFilterSql: unknown channel ${channel}`);
  return `COALESCE(${alias}.portfolio_channel, 'BOTH') IN ('${channel}', 'BOTH')`;
}

// "Is this style out of season today?" — used by BOTH the winner test and the HARVEST rule, and (negated) by Shopify Order's
// in-season filter. Only 'Summer'/'Winter' can be out of season; 'Any' and blanks never are. `alias` is the skusummary alias; `now`
// is the current season ('summer' | 'winter') as SQL — the classifier passes its season_now CTE column, a one-off query can take the
// default and inline seasonNowSql().
function outOfSeasonSql(alias, now = `(${seasonNowSql()})`) {
  return `(LOWER(TRIM(${alias}.season)) IN ('summer', 'winter') AND LOWER(TRIM(${alias}.season)) <> ${now})`;
}
const OUT_OF_SEASON = outOfSeasonSql('ss', 'sn.s');

// The classification, as one SELECT returning (groupid, status) for every row in skusummary. ONE pass over sales with FILTER for
// both windows, so the table is scanned once — then a CASE in rule order.
//
// THE SEASON IS READ ON LONDON WALL-CLOCK. The pg session runs Etc/UTC; on the night of 31 August the UTC month is still August for
// an hour after London has moved to September. now() AT TIME ZONE 'Europe/London' gives the month the business is actually in.
//
// The constants are interpolated as Number()s — never anything from a request.
const CLASSIFY_SQL = `
  WITH sold AS (
    -- Returns are rows with qty < 0 at a positive soldprice (both channels), so SUM(soldprice * qty) over ALL rows is revenue NET of
    -- returns. revenue_12m / units_12m — the WINNERS test and what is stamped beside it — are net (owner, 2026-09-26, see rule 1).
    -- Everything else stays on SALES ONLY (qty > 0), unchanged: a refund is not "sold in 3 months" for STEADY, and the lead channel
    -- is a share of where the style sells, not where it gets returned.
    SELECT groupid,
           COALESCE(SUM(soldprice * qty), 0)                                                                AS revenue_12m,
           COALESCE(SUM(qty), 0)::int                                                                       AS units_12m,
           COALESCE(SUM(soldprice * qty) FILTER (WHERE channel = 'SHP' AND qty > 0), 0)                   AS shp_rev,
           COALESCE(SUM(soldprice * qty) FILTER (WHERE channel = 'AMZ' AND qty > 0), 0)                   AS amz_rev,
           COUNT(*) FILTER (WHERE qty > 0
                              AND solddate >= CURRENT_DATE - INTERVAL '${Number(STEADY_MONTHS)} months')  AS lines_recent
    FROM sales
    WHERE groupid IS NOT NULL AND groupid <> ''
      AND solddate >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY groupid
  ),
  on_amz AS (SELECT DISTINCT groupid FROM amzfeed),
  season_now AS (
    SELECT ${seasonNowSql()} AS s
  )
  SELECT ss.groupid,
         CASE
           -- an out-of-season earner is HARVEST, not WINNERS and not STEADY (see rule 1 in the header)
           WHEN COALESCE(so.revenue_12m, 0) > ${Number(WINNER_BAR)} AND ${OUT_OF_SEASON} THEN 'HARVEST'
           WHEN COALESCE(so.revenue_12m, 0) > ${Number(WINNER_BAR)}                THEN 'WINNERS'
           WHEN COALESCE(so.lines_recent, 0) > 0                                    THEN 'STEADY'
           WHEN ss.created_at >= now() - INTERVAL '${Number(NEW_DAYS)} days'       THEN 'NEW'
           WHEN ${OUT_OF_SEASON}                                                    THEN 'HARVEST'
           ELSE 'LOSERS'
         END AS status,
         -- Stamped beside the tag so the screen's bar dial and the winners list read the figures the tag was decided on,
         -- never a live figure that has moved since (migrations/20260924b).
         ROUND(COALESCE(so.revenue_12m, 0), 2) AS revenue_12m,
         COALESCE(so.units_12m, 0)             AS units_12m,
         -- The lead channel (see LEAD_SHARE above). The share is taken of the two channels that have pricing lists.
         CASE
           WHEN COALESCE(so.shp_rev, 0) + COALESCE(so.amz_rev, 0) > 0 THEN
             CASE WHEN so.shp_rev >= ${Number(LEAD_SHARE)} * (so.shp_rev + so.amz_rev) THEN 'SHP'
                  WHEN so.amz_rev >= ${Number(LEAD_SHARE)} * (so.shp_rev + so.amz_rev) THEN 'AMZ'
                  ELSE 'BOTH' END
           WHEN oa.groupid IS NOT NULL THEN 'BOTH'
           ELSE 'SHP'
         END AS channel
  FROM skusummary ss
  CROSS JOIN season_now sn
  LEFT JOIN sold so   ON so.groupid = ss.groupid
  LEFT JOIN on_amz oa ON oa.groupid = ss.groupid
`;

/**
 * Re-tag every style. Call INSIDE a transaction with that transaction's client.
 *
 * Every row is written, not only the ones that changed, so portfolio_status_at on every row is the time of this run — that is
 * what makes MAX(portfolio_status_at) mean "last updated" and a NULL mean "created since the last update".
 *
 * @returns {Promise<{counts: Record<string, number>, total: number, channelCounts: Record<'SHP'|'AMZ', Record<string, number>>}>}
 *          channelCounts = per channel, the styles ON that channel's lists (its own + BOTH).
 */
async function applyPortfolioStatus(client) {
  const r = await client.query(`
    UPDATE skusummary ss
       SET portfolio_status = c.status,
           portfolio_status_at = now(),
           portfolio_revenue_12m = c.revenue_12m,
           portfolio_units_12m = c.units_12m,
           portfolio_channel = c.channel
      FROM (${CLASSIFY_SQL}) c
     WHERE c.groupid = ss.groupid
    RETURNING ss.portfolio_status AS status, ss.portfolio_channel AS channel
  `);
  const zero = () => Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const counts = zero();
  const channelCounts = { SHP: zero(), AMZ: zero() };
  for (const row of r.rows) {
    counts[row.status] += 1;
    for (const ch of CHANNELS) if (row.channel === ch || row.channel === 'BOTH') channelCounts[ch][row.status] += 1;
  }
  return { counts, total: r.rows.length, channelCounts };
}

/**
 * The STORED tags, counted — what the screen's cards draw. Reads the column only; never re-classifies.
 *
 * @returns {Promise<{total:number, updated_at:string|null, added_since:number, untagged:number,
 *                    statuses: {status:string, count:number, pct:number|null}[]}>}
 */
async function readPortfolioStatus() {
  const r = await query(`
    SELECT portfolio_status AS status,
           COUNT(*)::int AS n,
           -- on each channel's lists (its own + BOTH; NULL reads as BOTH) — the split chips on the Winners screen
           COUNT(*) FILTER (WHERE ${channelFilterSql('skusummary', 'SHP')})::int AS n_shp,
           COUNT(*) FILTER (WHERE ${channelFilterSql('skusummary', 'AMZ')})::int AS n_amz,
           -- created since the last Update: tagged NEW by the column default / product-create, never assessed yet
           COUNT(*) FILTER (WHERE portfolio_status_at IS NULL)::int AS unassessed,
           -- London wall-clock, as text — never hand a timestamptz to the client to re-zone
           to_char(MAX(portfolio_status_at) AT TIME ZONE 'Europe/London', 'YYYY-MM-DD HH24:MI') AS last_at
    FROM skusummary
    GROUP BY portfolio_status
  `);

  let total = 0;
  let untagged = 0;       // NULL status: rows that existed before the column did and have never been through an Update
  let addedSince = 0;
  let updatedAt = null;
  const byStatus = new Map();
  const channelTotals = { SHP: 0, AMZ: 0 };
  for (const row of r.rows) {
    total += row.n;
    channelTotals.SHP += row.n_shp;
    channelTotals.AMZ += row.n_amz;
    if (row.status === null) { untagged += row.n; continue; }
    byStatus.set(row.status, row);
    addedSince += row.unassessed;
    if (row.last_at && (updatedAt === null || row.last_at > updatedAt)) updatedAt = row.last_at;
  }

  // Share of ALL styles in the catalogue, so the five cards (plus any untagged) sum to the total shown beside them. One decimal
  // place: the small statuses sit around 5-7%, where a whole percent would round two different-sized cards to the same figure.
  //
  // `channels` = how many of this status are on each channel's lists. They can sum to MORE than `count`: a BOTH style (mixed
  // seller, or unsold but listed on Amazon) is on both lists, and that is the truth about where it needs pricing.
  // `channel_totals` is the per-channel denominator for a channel view's percentages.
  const statuses = STATUSES.map((status) => {
    const row = byStatus.get(status);
    const count = row ? row.n : 0;
    return {
      status,
      count,
      pct: total > 0 ? Math.round((count / total) * 1000) / 10 : null,
      channels: { SHP: row ? row.n_shp : 0, AMZ: row ? row.n_amz : 0 },
    };
  });

  return { total, updated_at: updatedAt, added_since: addedSince, untagged, statuses, channel_totals: channelTotals };
}

/**
 * The tagged WINNERS, with the revenue/units stamped at the last Update — biggest first. What the screen's bar dial filters and
 * its brand breakdown groups; also the rows a winners list or a "reprice these" jump will need. Reads stored values only.
 *
 * Brand: skusummary's own. A tagged row always has a skusummary row (that is where the tag lives), so no sales-snapshot
 * fallback is needed here.
 */
async function readTaggedWinners() {
  const r = await query(`
    SELECT ss.groupid,
           t.shopifytitle                       AS title,
           NULLIF(TRIM(ss.brand), '')           AS brand,
           COALESCE(ss.portfolio_revenue_12m, 0) AS revenue_12m,
           COALESCE(ss.portfolio_units_12m, 0)   AS units_12m,
           COALESCE(ss.portfolio_channel, 'BOTH') AS channel
    FROM skusummary ss
    LEFT JOIN title t ON t.groupid = ss.groupid
    WHERE ss.portfolio_status = 'WINNERS'
    ORDER BY ss.portfolio_revenue_12m DESC NULLS LAST, ss.groupid
  `);
  return r.rows.map((w) => ({
    groupid: w.groupid,
    title: w.title || null,
    brand: w.brand || null,
    revenue_12m: Number(w.revenue_12m) || 0,     // pg NUMERIC arrives as a string
    units_12m: Number(w.units_12m) || 0,
    channel: w.channel,                          // SHP | AMZ | BOTH — which channel's list it sits on (both, for BOTH)
  }));
}

module.exports = {
  STATUSES,
  CHANNELS,
  LEAD_SHARE,
  channelFilterSql,
  STEADY_MONTHS,
  NEW_DAYS,
  SUMMER_FIRST_MONTH,
  SUMMER_LAST_MONTH,
  seasonNowSql,
  outOfSeasonSql,
  LONDON_TODAY_SQL,
  nextSeasonStartSql,
  CLASSIFY_SQL,
  applyPortfolioStatus,
  readPortfolioStatus,
  readTaggedWinners,
};
