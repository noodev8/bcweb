/*
=======================================================================================================================================
Module: utils/processMap.js
=======================================================================================================================================
Purpose: The NEW SIZES — every size of every style created in the last NEW_DAYS (90, "each quarter"), with its sales on each channel
         and its stock. Read by GET /process-overview for the dashboard's Daily (New stuff = new sizes not sold yet) and Reports →
         New Additions. Built 2026-10-25 for the Today screen (/process, "a map of the business in blocks"); that screen was removed
         2026-10-26 with its five-block grid (sold 2+ / once, thin / good), Unsold repricer lists and Clearance count — git history.

  Channels: AMZ Amazon · SHP Shopify (the website) · CM3 the shop counter — its OWN channel, never credited to Shopify (owner: the
  shop sells at RRP, "unfair to give it to Shopify").
  SOLD = units NET of returns (owner; the Winners / Simmer rule) — sold one and it came back = not sold.
  £ = profit on the positive rows. sales.profit already carries the returns haircut (utils/shopifyProfit.js, utils/amzProfit.js), so
  returns are NOT taken off the £ a second time. sales.profit is per UNIT (qty is occasionally 2 or 3), hence profit * qty.

WHY "CREATED IN 90 DAYS" AND NOT THE NEW PORTFOLIO STATUS: utils/portfolioStatus.js uses the same 90 days (NEW_DAYS is imported, so
the two windows can't drift), but there WINNERS and STEADY are tested first — and STEADY is "sold a unit in 3 months", so every new
style that sells anything leaves NEW. Read through that status the list could only ever show not sold.

REVIEW / DUE (owner, 2026-10-27: "add a review and due date to them as well ... these are products that need actions and easily
inspected"). Each new STYLE carries skusummary.next_new_review (set by POST /new-additions-review, the pricing screens' "Review in N
days"). A style never reviewed falls due FIRST_REVIEW_DAYS after it was created — 20, the owner's "that's when I'd expect something to
happen and act on it if not" (it was New Additions' "20+ days live" filter, which the Due switch replaced). So:
  due_on = COALESCE(next_new_review, created_on + FIRST_REVIEW_DAYS);  due = due_on <= today.
Clearing a review puts the style back on that default. Computed here (server date, London) so Daily and the screen agree.
ON AMAZON: a size is listed when it has an amzfeed row (every FBA listing, 0-stock ones too — the AMZ loaded rule, per size).
=======================================================================================================================================
*/

const { NEW_DAYS } = require('./portfolioStatus');

const CHANNELS = ['AMZ', 'SHP', 'CM3'];

// A never-reviewed new style is due this many days after it was created (see REVIEW / DUE above).
const FIRST_REVIEW_DAYS = 20;

// Every size of every NEW style, with its sales per channel since the style was created and its stock. One query, no N+1.
//   created_on is the London date of skusummary.created_at, so a sale booked on the creation day counts.
//   Stock: local = sellable localstock (#FREE — CLAUDE.md, never stockvariants), the stock Shopify and the shop both sell from;
//   fba = amzfeed.amzlive, Amazon's sellable FBA units, PLUS the Amazon-bound local units (LOCAL_SQL / AMZ_BOUND_SQL below).
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
    SELECT ss.groupid, ss.brand, (ss.created_at AT TIME ZONE 'Europe/London')::date AS created_on, ss.next_new_review
      FROM skusummary ss
     WHERE ss.created_at >= now() - make_interval(days => $1::int)
  ),
  sz AS (
    SELECT m.code, nw.groupid, nw.brand, nw.created_on, nw.next_new_review, SUBSTRING(m.code FROM '[^-]*$') AS size
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
         -- Dates as text, never a pg DATE (CLAUDE.md: BST day-shift).
         sz.next_new_review::text                                                         AS review_on,
         COALESCE(sz.next_new_review, sz.created_on + ${FIRST_REVIEW_DAYS})::text           AS due_on,
         COALESCE(sz.next_new_review, sz.created_on + ${FIRST_REVIEW_DAYS}) <= (now() AT TIME ZONE 'Europe/London')::date AS due,
         EXISTS (SELECT 1 FROM amzfeed a WHERE a.code = sz.code)                            AS on_amz,
         (now() AT TIME ZONE 'Europe/London')::date - sz.created_on                        AS age_days,
         COALESCE(loc.qty, 0) AS local_stock, COALESCE(fba.qty, 0) AS fba_stock,
         COALESCE(json_object_agg(sl.channel, json_build_object('net', sl.net_units, 'sold', sl.sold_units, 'profit', sl.profit))
                    FILTER (WHERE sl.channel IS NOT NULL), '{}') AS sales
    FROM sz
    LEFT JOIN sl    ON sl.code = sz.code
    LEFT JOIN loc   ON loc.code = sz.code
    LEFT JOIN fba   ON fba.code = sz.code
    LEFT JOIN title t ON t.groupid = sz.groupid
   GROUP BY sz.code, sz.groupid, sz.brand, sz.size, sz.created_on, sz.next_new_review, t.shopifytitle, loc.qty, fba.qty
  HAVING COALESCE(loc.qty, 0) > 0 OR COALESCE(fba.qty, 0) > 0 OR COUNT(sl.channel) > 0   -- never stocked = left out (see above)
   ORDER BY sz.created_on DESC, sz.groupid,
            CASE WHEN sz.size ~ '^[0-9]+([.][0-9]+)?$' THEN sz.size::numeric END NULLS LAST, sz.size
`;

module.exports = {
  NEW_DAYS,
  FIRST_REVIEW_DAYS,
  CHANNELS,
  NEW_SIZES_SQL,
};
