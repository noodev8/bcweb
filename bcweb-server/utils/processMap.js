/*
=======================================================================================================================================
Module: utils/processMap.js
=======================================================================================================================================
Purpose: The rules behind the Process page (owner, 2026-10-25) — a READ-ONLY map of blocks, one number per stage of the business
         ("Prospects > New list > Order > Price"), each opening a list of what to act on, with the acting done on the existing screens.
         The Monday-morning question it answers: is there something to do — find more prospects, sort out the performers, good or bad?
         First version = two blocks: the prospects total, and the NEW-SIZES GRID. Order / Price blocks come later, as additions.

THE NEW-SIZES GRID — every size of every style created in the last NEW_DAYS (90, "each quarter"), judged separately on each channel:
  AMZ  Amazon         SHP  Shopify (the website)         CM3  the shop counter
  The shop is its OWN channel, never credited to Shopify (owner: the shop sells at RRP, "unfair to give it to Shopify").
  EVERY new size appears on EVERY channel (owner's option B — "easiest to code and think about"), even one never sent there: a
  Birkenstock size will always read Not sold on Amazon. The owner's rule of thumb reads across the three: drop a size that is
  rubbish on ALL channels, keep one that is good on ONE.

  Five blocks per channel:
                thin (< line a unit)     good (>= line a unit)
    Sold 2+   │ price up               │ order more / feed     │     owner: 20 sales at 10p must not look like 2 at £10
    Sold once │ watch / nudge up       │ watch                 │
    Not sold  │ price down / Slider / drop                     │

  SOLD = units NET of returns (owner; the Winners / Simmer rule) — sold one and it came back = Not sold.
  £ A UNIT = profit on the positive rows / units on the positive rows. sales.profit already carries the returns haircut
  (utils/shopifyProfit.js, utils/amzProfit.js), so returns are NOT taken off the £ a second time — the same qty > 0 rule as Ad Daily.
  sales.profit is per UNIT (qty is occasionally 2 or 3), hence profit * qty.

  THE LINE: £3 a unit on Amazon and the shop. Shopify's booked profit is BEFORE Google, and ad spend is recorded per style so it can't
  be shared out to sizes — so Shopify's line is £3 PLUS the FIXED Google allowance (google_allowance, newest row): the average ad
  cost per Shopify unit over 90 days. Fixed, re-measured quarterly by button (see migrations/20261025_process_google_allowance.sql).

WHY "CREATED IN 90 DAYS" AND NOT THE NEW PORTFOLIO STATUS: utils/portfolioStatus.js uses the same 90 days (NEW_DAYS is imported, so
the two windows can't drift), but there WINNERS and STEADY are tested first — and STEADY is "sold a unit in 3 months", so every new
style that sells anything leaves NEW. Read through that status this grid could only ever show Not sold.
=======================================================================================================================================
*/

const { NEW_DAYS } = require('./portfolioStatus');
const { CLEARANCE_MONTHS } = require('./onShelf');
const { readSlowSizes } = require('./slowSizes');

const CHANNELS = ['AMZ', 'SHP', 'CM3'];
const BLOCKS = ['multi_thin', 'multi_good', 'once_thin', 'once_good', 'not_sold'];

// £ a unit kept that counts as good. Shopify adds the Google allowance on top (lineFor).
const BASE_LINE = 3;

// The allowance is measured over 90 days and falls DUE 90 days after it was accepted (owner: quarterly, by button).
const MEASURE_DAYS = 90;
const ALLOWANCE_DUE_DAYS = 90;

function lineFor(channel, allowance) {
  return channel === 'SHP' ? BASE_LINE + Number(allowance || 0) : BASE_LINE;
}

// Which block a size sits in on one channel. net = units net of returns; perUnit = £ a unit on the positive rows.
function blockFor(net, perUnit, line) {
  if (!(net > 0)) return 'not_sold';
  const good = perUnit !== null && perUnit >= line;
  if (net >= 2) return good ? 'multi_good' : 'multi_thin';
  return good ? 'once_good' : 'once_thin';
}

// Every size of every NEW style, with its sales per channel since the style was created and its stock. One query, no N+1.
//   created_on is the London date of skusummary.created_at, so a sale booked on the creation day counts.
//   Stock: local = sellable localstock (#FREE — CLAUDE.md, never stockvariants), the stock Shopify and the shop both sell from;
//   fba = amzfeed.amzlive, Amazon's sellable FBA units, PLUS the Amazon-bound local units (LOCAL_SQL / AMZ_BOUND_SQL above).
//   Size = suffix after the last '-' (CLAUDE.md — not RIGHT(code,2)), sorted numerically where it is a number.
//   NEVER-STOCKED SIZES ARE LEFT OUT (owner, 2026-10-25): a size with no stock now AND no sale since creation is one we listed in the
//   size run but never bought (the edge 36s/37s, UK 3s and 8s) — not unsold stock. Counting it swelled New and Unsold and pulled the
//   Winner % down. A sold-out size has sales, so it stays.
// AMAZON-BOUND local units count as FBA, not local (owner, 2026-10-26: "due for Pick and in location C3 Amazon") — the same split as
// Amazon Order (routes/amazon-order-list.js): flagged allocated='amz' (due for Pick) or picked and staged on the C3-Amazon shelf
// waiting for DPD. They sit in localstock until collected but are already on their way, so a size whose only stock is Amazon-bound
// is AT FBA, not Local only. Both predicates on localstock alias `l`.
const LOCAL_SQL = `l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
                   AND COALESCE(l.location, '') <> 'C3-Amazon' AND COALESCE(l.allocated, '') <> 'amz'`;
const AMZ_BOUND_SQL = `COALESCE(l.deleted, 0) = 0 AND l.qty > 0
                       AND (l.allocated = 'amz' OR (l.ordernum = '#FREE' AND l.location = 'C3-Amazon'))`;

const NEW_SIZES_SQL = `
  WITH nw AS (
    SELECT ss.groupid, ss.brand, (ss.created_at AT TIME ZONE 'Europe/London')::date AS created_on
      FROM skusummary ss
     WHERE ss.created_at >= now() - make_interval(days => $1::int)
  ),
  sz AS (
    SELECT m.code, nw.groupid, nw.brand, nw.created_on, SUBSTRING(m.code FROM '[^-]*$') AS size
      FROM nw JOIN skumap m ON m.groupid = nw.groupid
  ),
  sl AS (
    SELECT x.code, x.channel,
           SUM(x.qty)                                   AS net_units,
           SUM(x.qty)            FILTER (WHERE x.qty > 0) AS sold_units,
           SUM(x.profit * x.qty) FILTER (WHERE x.qty > 0) AS profit
      FROM sz JOIN sales x ON x.code = sz.code AND x.solddate >= sz.created_on
     WHERE x.channel IN ('AMZ', 'SHP', 'CM3')
     GROUP BY x.code, x.channel
  ),
  loc AS (
    SELECT l.code, SUM(l.qty) AS qty
      FROM localstock l JOIN sz ON sz.code = l.code
     WHERE ${LOCAL_SQL}
     GROUP BY l.code
  ),
  fba AS (
    SELECT x.code, SUM(x.qty) AS qty FROM (
      SELECT f.code, f.amzlive AS qty FROM amzfeed f JOIN sz ON sz.code = f.code
      UNION ALL
      SELECT l.code, l.qty FROM localstock l JOIN sz ON sz.code = l.code WHERE ${AMZ_BOUND_SQL}
    ) x
     GROUP BY x.code
  )
  SELECT sz.code, sz.groupid, sz.brand, sz.size, sz.created_on::text AS created_on,
         t.shopifytitle AS title,
         COALESCE(loc.qty, 0) AS local_stock, COALESCE(fba.qty, 0) AS fba_stock,
         COALESCE(json_object_agg(sl.channel, json_build_object('net', sl.net_units, 'sold', sl.sold_units, 'profit', sl.profit))
                    FILTER (WHERE sl.channel IS NOT NULL), '{}') AS sales
    FROM sz
    LEFT JOIN sl    ON sl.code = sz.code
    LEFT JOIN loc   ON loc.code = sz.code
    LEFT JOIN fba   ON fba.code = sz.code
    LEFT JOIN title t ON t.groupid = sz.groupid
   GROUP BY sz.code, sz.groupid, sz.brand, sz.size, sz.created_on, t.shopifytitle, loc.qty, fba.qty
  HAVING COALESCE(loc.qty, 0) > 0 OR COALESCE(fba.qty, 0) > 0 OR COUNT(sl.channel) > 0   -- never stocked = left out (see above)
   ORDER BY sz.created_on DESC, sz.groupid,
            CASE WHEN sz.size ~ '^[0-9]+([.][0-9]+)?$' THEN sz.size::numeric END NULLS LAST, sz.size
`;

// The Process screen's UNSOLD sizes with their stock — the same rules as the page: a NEW size ($1 = NEW_DAYS, plain created_at) that
// has netted no sale on ANY channel since its style was created. fba = amzfeed.amzlive + Amazon-bound local units, local = the rest of sellable #FREE localstock (LOCAL_SQL / AMZ_BOUND_SQL).
const UNSOLD_SIZES_SQL = `
  SELECT m.code, m.groupid,
         (SELECT COALESCE(SUM(f.amzlive), 0) FROM amzfeed f WHERE f.code = m.code)
           + (SELECT COALESCE(SUM(l.qty), 0) FROM localstock l WHERE l.code = m.code AND ${AMZ_BOUND_SQL}) AS fba,
         (SELECT COALESCE(SUM(l.qty), 0) FROM localstock l WHERE l.code = m.code AND ${LOCAL_SQL}) AS local
    FROM skusummary ss
    JOIN skumap m ON m.groupid = ss.groupid
   WHERE ss.created_at >= now() - make_interval(days => $1::int)
     AND NOT EXISTS (
       SELECT 1 FROM sales x
        WHERE x.code = m.code AND x.channel IN ('AMZ', 'SHP', 'CM3')
          AND x.solddate >= (ss.created_at AT TIME ZONE 'Europe/London')::date
        GROUP BY x.channel HAVING SUM(x.qty) > 0
     )
`;
// UNSOLD · AT FBA as a code list, for the Amazon repricer (routes/amz-process-list.js): FBA stock > 0 (stock in both places counts
// here — it is already on Amazon).
const UNSOLD_FBA_CODES_SQL = `SELECT us.code FROM (${UNSOLD_SIZES_SQL}) us WHERE us.fba > 0`;
// UNSOLD · LOCAL ONLY as a STYLE list, for the Shopify repricer (routes/pricing-process-list.js): every style with at least one unsold
// size held locally and not at FBA. Shopify prices per style, so the style is the row.
const UNSOLD_LOCAL_STYLES_SQL = `SELECT DISTINCT us.groupid FROM (${UNSOLD_SIZES_SQL}) us WHERE us.fba <= 0 AND us.local > 0`;

// CLEARANCE (owner, 2026-10-26: "Something that hasnt been sold for 9 months is a proper loser"). The count of Slow Sizes' Clearance
// box — the SAME rows (utils/slowSizes.js; owner: "lets use the same numbers"): a held SIZE, any style age, whose idle clock (the later
// of its last NET sale on any channel and its oldest held pair's arrival) started 9+ calendar months ago. Sold anywhere = good.
// READ ONLY; counts only — the card opens Slow Sizes.
async function clearanceCount() {
  const { sizes } = await readSlowSizes();
  const c = sizes.filter((x) => x.clearance);
  return {
    months: CLEARANCE_MONTHS,
    sizes: c.length,
    units: c.reduce((t, x) => t + x.units, 0),
    styles: new Set(c.map((x) => x.groupid)).size,
  };
}

// The allowance in force: the newest accepted row. null if the table is empty (never, after the migration's seed).
async function readAllowance(q) {
  const r = await q(`
    SELECT per_unit, spend, units, window_from::text AS window_from, window_to::text AS window_to, accepted_by,
           (accepted_at AT TIME ZONE 'Europe/London')::date::text AS accepted_on,
           ((accepted_at AT TIME ZONE 'Europe/London')::date + $1::int)::text AS due_on,
           (accepted_at AT TIME ZONE 'Europe/London')::date + $1::int <= (now() AT TIME ZONE 'Europe/London')::date AS due
      FROM google_allowance ORDER BY accepted_at DESC, id DESC LIMIT 1
  `, [ALLOWANCE_DUE_DAYS]);
  if (!r.rows.length) return null;
  const a = r.rows[0];
  return {
    perUnit: Number(a.per_unit), spend: a.spend === null ? null : Number(a.spend), units: a.units === null ? null : Number(a.units),
    windowFrom: a.window_from, windowTo: a.window_to, acceptedBy: a.accepted_by, acceptedOn: a.accepted_on,
    dueOn: a.due_on, due: a.due,
  };
}

// Measure the allowance: Google spend / Shopify units sold, over MEASURE_DAYS ending `windowTo` — by default the newest COMPLETE day
// of ad data (a day we hold a row for that was captured on a LATER day; the newest import is normally a part day — the anchor
// routes/google-ads-styles.js uses, for the same reason). Units are positive rows (qty > 0), the Ad Efficiency / Ad Daily basis.
// READ ONLY. Returns perUnit null when nothing sold in the window.
async function measureAllowance(q, windowTo = null) {
  const r = await q(`
    WITH anchor AS (
      SELECT COALESCE($2::date, LEAST(CURRENT_DATE, (
               SELECT MAX(snapshot_date) FROM google_product_daily
                WHERE (imported_at AT TIME ZONE 'Europe/London')::date > snapshot_date
             ))) AS d
    )
    SELECT (a.d - ($1::int - 1))::text AS window_from, a.d::text AS window_to,
           (SELECT COALESCE(SUM(cost), 0) FROM google_product_daily WHERE snapshot_date BETWEEN a.d - ($1::int - 1) AND a.d) AS spend,
           (SELECT COALESCE(SUM(qty), 0) FROM sales
             WHERE channel = 'SHP' AND qty > 0 AND solddate BETWEEN a.d - ($1::int - 1) AND a.d)                     AS units
      FROM anchor a
  `, [MEASURE_DAYS, windowTo]);
  const m = r.rows[0];
  const spend = Math.round(Number(m.spend) * 100) / 100;
  const units = Number(m.units);
  return {
    windowFrom: m.window_from, windowTo: m.window_to, spend, units,
    perUnit: units > 0 ? Math.round((spend / units) * 100) / 100 : null,
  };
}

module.exports = {
  NEW_DAYS,
  CHANNELS,
  BLOCKS,
  BASE_LINE,
  MEASURE_DAYS,
  ALLOWANCE_DUE_DAYS,
  NEW_SIZES_SQL,
  UNSOLD_FBA_CODES_SQL,
  UNSOLD_LOCAL_STYLES_SQL,
  lineFor,
  blockFor,
  CLEARANCE_MONTHS,
  clearanceCount,
  readAllowance,
  measureAllowance,
};
