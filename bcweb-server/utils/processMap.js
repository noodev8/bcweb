/*
=======================================================================================================================================
Module: utils/processMap.js
=======================================================================================================================================
Purpose: THE NEW SKUS — prospect performance (owner, 2026-11-05: "I want to see if we are shifting new products coming in, meaning our
         prospects are performing"). Read by GET /process-overview for the dashboard's Daily (New stuff = sold ÷ new SKUs, a %) and
         Reports → New Additions (the list behind that figure — owner, same day: the screen and the tile must count the same thing;
         "our intention here is to get the 25% as high as possible"). ONE query, so the tile and the list can't drift.

  IN: every SKU whose EARLIEST-EVER Goods In arrival (incoming_stock, read across ALL of it) is in the last NEW_DAYS (90) days. The
      style's created date plays no part — a new size of an old style counts from its own first arrival. A REBUY of a SKU first booked
      in before the window is OUT, however long ago ("anything that has arrived over 90 days is a different problem" — Slow /
      Clearance). Goods In starts 2024-12-31 and may be pruned to ~3 years; a SKU with no arrival on record that is bought again then
      counts as new (owner: "treat them as new when they are rebought"). A SKU never booked in (a test listing on placeholder stock)
      is not on the list until it is.
  SOLD: netted a sale on ANY channel — AMZ, SHP, CM3 (the shop counter), EBY (eBay, owner) — ON OR AFTER that first arrival, net of
      returns (sold one and it came back = not sold). Once sold it is ticked off for good: "a SKU arrives and is sold, it is notched
      off. We buy more, sell more is irrelevant." New stock landing pulls the % DOWN on purpose — the owner's signal to slow buying
      until it is healthy; don't "fix" that with a maturity window (rejected).
  DAYS LEFT: NEW_DAYS − days since first arrival. An unsold SKU that reaches 90 days leaves the list (and the % — it drops out of
      both sides, so the % can rise without a sale); the screen sorts on it so a size is priced BEFORE it drops out.

PRICE DUE (owner, 2026-11-05, option A — New Additions' own "Look again" review, skusummary.next_new_review, was retired the same day:
"one review date, one habit"). The pricing screens' own Due, read here:
  - Shopify (per STYLE): live on Shopify (shopify = 1) with sellable local stock, next_shopify_price_review passed or none — the
    Shopify Pricing home's predicate (routes/pricing-all-list.js).
  - Amazon (per SIZE): an amzfeed listing with stock live or on its way (amztotal > 0), DUE BY THE ONE AMAZON RULE (utils/amzDue.js,
    docs/amz-buybox/PLAN.md decision 26, 2026-11-13 — was "next_amz_price_review passed or none"): a size the Buy Box answers in
    Chilled (selling at FBA, or New — most unsold new sizes) is never due (decision 27 — its cards are Daily's Buy Box moves); every
    other size when its review date has come round. routes/amz-all-list.js's rule, less its 0-stock status rows (a size with nothing at Amazon can't be sold there by a price).
    `amz_bb` says the Buy Box decides the size — the Review column leaves it out (no date decides it). NEW_SKUS_SQL takes $2 =
    utils/amzDue.js → sideParams(side).bb.
  A style is due on New Additions when it still has an UNSOLD new size and (Shopify is due OR an unsold size is due on Amazon) — sold
  sizes are ticked off, so they never make a style due. Worked out on the screen from these flags (bcweb-web/src/lib/process.ts).

  Channels on a row: AMZ Amazon · SHP Shopify (the website) · CM3 the shop counter — its OWN channel, never credited to Shopify (owner:
  the shop sells at RRP, "unfair to give it to Shopify") · EBY eBay.
  Stock: local = sellable localstock (#FREE — CLAUDE.md, never stockvariants), the stock Shopify and the shop both sell from;
  fba = amzfeed.amzlive, Amazon's sellable FBA units, PLUS the Amazon-bound local units (LOCAL_SQL / AMZ_BOUND_SQL below).
  Bought = pairs booked in on Goods In, SUM(GREATEST(quantity_added, 1)) — every arrival of the SKU, the first included.
  Size = suffix after the last '-' (CLAUDE.md — not RIGHT(code,2)), sorted numerically where it is a number.

HISTORY: until 2026-11-05 the screen listed every size of every STYLE CREATED in 90 days with a pairs Sold % and its own review
(next_new_review, left in the DB unused — migrations/20261027c_new_review.sql); Daily had moved to this SKU rule that morning and the
two disagreed (owner: the tile said 25%, the screen another number on a different list). Git history has the style-based query.
=======================================================================================================================================
*/

const { dueSql } = require('./amzDue');
const { NEW_DAYS } = require('./portfolioStatus');
const { AMZ_NOW_CTES } = require('./amzNow');
const { safeNumeric } = require('./sql');

const CHANNELS = ['AMZ', 'SHP', 'CM3', 'EBY'];

// AMAZON-BOUND local units count as FBA, not local (owner, 2026-10-26: "due for Pick and in location C3 Amazon") — the same split as
// Amazon Order (routes/amazon-order-list.js): flagged allocated='amz' (due for Pick) or picked and staged on the C3-Amazon shelf
// waiting for DPD. Both predicates on localstock alias `l`.
const LOCAL_SQL = `l.ordernum = '#FREE' AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
                   AND COALESCE(l.location, '') <> 'C3-Amazon' AND COALESCE(l.allocated, '') <> 'amz'`;
const AMZ_BOUND_SQL = `COALESCE(l.deleted, 0) = 0 AND l.qty > 0
                       AND (l.allocated = 'amz' OR (l.ordernum = '#FREE' AND l.location = 'C3-Amazon'))`;

// Every NEW SKU with its sales per channel since its first arrival, its stock and both channels' price due. No N+1.
const NEW_SKUS_SQL = `
  WITH ${AMZ_NOW_CTES},
  today AS (SELECT (now() AT TIME ZONE 'Europe/London')::date AS d),
  f AS (
    SELECT i.code, MIN(i.arrival_date)::date AS first_in, SUM(GREATEST(i.quantity_added, 1)) AS bought
      FROM incoming_stock i
     GROUP BY i.code
    HAVING MIN(i.arrival_date) >= (SELECT d FROM today) - $1::int
  ),
  sz AS (
    SELECT f.code, f.first_in, f.bought, COALESCE(m.groupid, f.code) AS groupid, m.next_amz_price_review,
           SUBSTRING(f.code FROM '[^-]*$') AS size
      FROM f LEFT JOIN skumap m ON m.code = f.code
  ),
  sl AS (
    SELECT x.code, x.channel,
           SUM(x.qty)                                     AS net_units,
           SUM(x.qty) FILTER (WHERE x.qty > 0)            AS sold_units
      FROM sz JOIN sales x ON x.code = sz.code AND x.solddate >= sz.first_in
     WHERE x.channel IN ('AMZ', 'SHP', 'CM3', 'EBY')
     GROUP BY x.code, x.channel
  ),
  loc AS (
    SELECT l.code, SUM(l.qty) AS qty FROM localstock l JOIN sz ON sz.code = l.code WHERE ${LOCAL_SQL} GROUP BY l.code
  ),
  -- The style's sellable local stock, ALL its sizes (new or not) — what Shopify sells, so what makes a Shopify price worth setting.
  sloc AS (
    SELECT l.groupid, SUM(l.qty) AS qty FROM localstock l
     WHERE l.groupid IN (SELECT groupid FROM sz) AND ${LOCAL_SQL}
     GROUP BY l.groupid
  ),
  fba AS (
    SELECT x.code, SUM(x.qty) AS qty FROM (
      SELECT a.code, a.amzlive AS qty FROM amzfeed a JOIN sz ON sz.code = a.code
      UNION ALL
      SELECT l.code, l.qty FROM localstock l JOIN sz ON sz.code = l.code WHERE ${AMZ_BOUND_SQL}
    ) x
     GROUP BY x.code
  )
  SELECT sz.code, sz.groupid, NULLIF(TRIM(ss.brand), '') AS brand, sz.size, t.shopifytitle AS title,
         sz.first_in::text AS first_in,                                     -- text, never a pg DATE (CLAUDE.md: BST day-shift)
         (SELECT d FROM today) - sz.first_in AS age_days,
         COALESCE(loc.qty, 0) AS local_stock, COALESCE(fba.qty, 0) AS fba_stock, sz.bought,
         -- Amazon (per size)
         (a.code IS NOT NULL) AS on_amz,
         -- The CURRENT Amazon price: a change logged since the last import (uploaded, or still pending in the basket) beats the feed —
         -- utils/amzNow.js → AMZ_NOW_CTES. New Additions' bulk % works off this, so two moves before an upload don't both start from
         -- the stale feed price.
         COALESCE(an.price, ${safeNumeric('a.amzprice')}) AS amz_price,
         ${safeNumeric('a.fbafee')} AS amz_fbafee,                         -- with cost: the Amazon break-even the bulk preview flags
         sz.next_amz_price_review::text AS amz_review,
         (a.code IS NOT NULL AND COALESCE(a.amztotal, 0) > 0
           AND ${dueSql('sz.code', 'sz.next_amz_price_review', '$2', '(SELECT d FROM today)')}) AS amz_due,   -- THE one Amazon rule
         (sz.code = ANY($2::text[])) AS amz_bb,                                   -- the Buy Box decides this size (header)
         -- Shopify (per style — the same on each of its sizes)
         (COALESCE(ss.shopify, 0) = 1) AS shp_live,
         ${safeNumeric('ss.shopifyprice')} AS shp_price,
         ss.imagename,                                                     -- the style's picture (New Additions' thumbnail)
         ${safeNumeric('ss.rrp')} AS rrp,                                   -- the style's RRP (New Additions' RRP column)
         ${safeNumeric('ss.cost')} AS cost,                                 -- the style's cost (the bulk preview's below-cost flags)
         ss.next_shopify_price_review::text AS shp_review,
         (COALESCE(ss.shopify, 0) = 1 AND COALESCE(sloc.qty, 0) > 0
           AND (ss.next_shopify_price_review IS NULL OR ss.next_shopify_price_review <= (SELECT d FROM today))) AS shp_due,
         COALESCE((SELECT json_object_agg(sl.channel, json_build_object('net', sl.net_units, 'sold', sl.sold_units))
                     FROM sl WHERE sl.code = sz.code), '{}') AS sales
    FROM sz
    LEFT JOIN skusummary ss ON ss.groupid = sz.groupid
    LEFT JOIN title t       ON t.groupid  = sz.groupid
    LEFT JOIN amzfeed a     ON a.code     = sz.code
    LEFT JOIN amz_now an    ON an.code    = sz.code
    LEFT JOIN loc           ON loc.code   = sz.code
    LEFT JOIN fba           ON fba.code   = sz.code
    LEFT JOIN sloc          ON sloc.groupid = sz.groupid
   ORDER BY sz.groupid, CASE WHEN sz.size ~ '^[0-9]+([.][0-9]+)?$' THEN sz.size::numeric END NULLS LAST, sz.size
`;

// THE STYLE'S OTHER SIZES — for the size run only, never counted (owner, 2026-11-05, on Capri 4 Black showing one lone tile: "Show all
// sizes and enable the sizes that still havnt sold"). Every size of a style on the list that is NOT a new SKU: first booked in before the
// window (it has aged out, sold or not — Slow / Clearance's problem now) or never booked in but holding stock. A size never booked in
// and holding nothing is one we never bought (the edge 36s / UK 8s) and stays hidden, as before. $1 = the new SKU codes.
const OTHER_SIZES_SQL = `
  SELECT m.groupid, m.code, SUBSTRING(m.code FROM '[^-]*$') AS size,
         (SELECT MIN(i.arrival_date)::text FROM incoming_stock i WHERE i.code = m.code) AS first_in
    FROM skumap m
   WHERE m.groupid IN (SELECT groupid FROM skumap WHERE code = ANY($1::text[]))
     AND NOT (m.code = ANY($1::text[]))
     AND (EXISTS (SELECT 1 FROM incoming_stock i WHERE i.code = m.code)
          OR EXISTS (SELECT 1 FROM localstock l WHERE l.code = m.code AND ${LOCAL_SQL})
          OR EXISTS (SELECT 1 FROM amzfeed a WHERE a.code = m.code AND COALESCE(a.amztotal, 0) > 0))
`;

module.exports = { NEW_DAYS, CHANNELS, NEW_SKUS_SQL, OTHER_SIZES_SQL };
