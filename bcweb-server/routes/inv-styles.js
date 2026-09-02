/*
=======================================================================================================================================
API Route: inv_styles
=======================================================================================================================================
Method: GET
Purpose: Slice 1 of the Inventory Management module (docs/inventory-spec.md). Returns EVERY style once, with the three headline stock
         numbers rolled up across all its sizes, so the web /inventory screen can render the full list and then filter it CLIENT-SIDE
         (the operator's Contains / Does-not-contain drill-down). There is deliberately no `term` parameter: the candidate set is ~280
         styles, so we ship the lot once and let successive FINDs narrow it in the browser with no round-trip. Requires auth.

         Why all three numbers here and not just on the drill: the list is the triage view ("have we got any of these at all?"), so a
         style with zero everywhere should be visibly zero before you click it.

THE TWO AGGREGATION RULES (the easiest bug to ship in this module — see spec §3 data facts):
  - localstock  -> SUM(qty).   qty is NOT always 1: 106 of 2250 live rows exceed it (max 9). COUNT(*) under-reports by ~7%.
  - orderstatus -> COUNT(*).   qty IS always 1 there (one row per SKU, verified across all live rows). SUM(qty) would be a no-op but
                               COUNT(*) states the intent, and guards us if a stray qty ever lands.
They are opposite rules on two similar-looking tables. Do not "tidy" them into one.

DEFINITIONS (owner, 2026-07-19 — reconciled against the legacy PowerBuilder screen):
  - Local = what is in localstock, whatever its state. INCLUDES stock already picked for an order: a picked unit is still physically
            on the shelf until it is packed, and "is it in the building" is the question this screen answers. Verified against
            PowerBuilder for 1005292-ARIZONA (size 37 = 4 free + 1 picked = 5; size 38 = 3 free + 2 picked = 5).
  - Order = units on the way to us: orderstatus rows not yet arrived, local (type 2) or Amazon (type 3). Taken at face value — no
            staleness logic here. clean_sales.sql prunes stale rows weekly; cleanup is a human job on another screen (owner).
  - Total = everything we have or have coming = Local + Amazon-held (live + inbound + in transit) + the Birkenstock pre-order
            book (birktracker: requested - arrived). Birk POs are INCLUDED because the operator already counts a placed Birk order as
            stock they have ("I know it's coming") — it is ordered ~6 months ahead and is the brand's only replenishment.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "count": 280,
  "rows": [
    {
      "groupid": "1005292-ARIZONA",
      "title": "Birkenstock Arizona Two-Strap Patent Sandals Black Narrow Fit",  // title.shopifytitle; null if none
      "segment": "ARIZONA-GENERAL",
      "season": "Summer",                   // skusummary.season — 'Summer' | 'Winter' | 'Any' (100% populated on live data); '' if ever blank
      "imagename": "birkenstock-....jpg",   // bare filename; the web builds https://images.brookfieldcomfort.com/<imagename>
      "price": 57.00,                       // safeNumeric(shopifyprice); null if the legacy varchar holds junk. For the card face.
      "rrp": 80.00,                         // safeNumeric(rrp); null likewise. Shown struck-through only when above price.
      "local": 38,                          // SUM(localstock.qty), all states
      "amazon": 11,                         // held AT Amazon (live + inbound + transit). Its own field so the client can show/filter "local + Amazon"
      "localSizes": { "35": 0, "36": 10, "37": 4 },  // {size: localQty} for EVERY size in skumap (0 = sold out); the pickable figure
      "totalSizes": { "35": 0, "36": 12, "37": 4 },  // {size: local + Amazon-held + Birk PO} over the same keys; drives the size chips
      "onOrder": 0,                         // COUNT(orderstatus rows), arrived=0, ordertype 2|3
      "sold30": 7,                          // units sold in the last 30 days, all channels (positive sales only); for the SALES filter
      "total": 38,                          // local + amazon + birk pre-order book (NOT the same as local+amazon — birk is future stock)
      "amazonSkus": "17659-23-42-2607 17659-23-43-2607", // space-joined skumap.sku for every variant; null if none. Lets the client's
                                             // Contains search find a style by a pasted Amazon SKU
      "created": "20260724 11:07:30"          // skusummary.created_at as 'YYYYMMDD HH24:MI:SS' (Europe/London); null if unstamped.
                                             // Sortable as plain text — the browse opens newest-first on it
    },
    ...
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
const { safeNumeric } = require('../utils/sql');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

// Every inventory route requires a valid session (CLAUDE.md).
router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // One query, no N+1. Each stock source is pre-aggregated to style grain in its own CTE and LEFT JOINed onto the style list, so a
    // style with no rows in a given source simply reads 0 rather than dropping out of the list.
    //
    // Amazon sources are joined to a style via skumap (amzshipment/archive are code-grain); amzfeed already carries groupid, so it
    // needs no join. amzfeed.amztotal already includes amzlive (verified: amztotal >= amzlive on all 474 live rows, so
    // "inbound" = amztotal - amzlive is non-negative and amztotal is the correct single figure for live + inbound).
    const result = await query(`
      WITH loc AS (
        -- Local: SUM(qty), ALL states (free, picked, amz-allocated). Excludes soft-deleted rows only.
        SELECT groupid, SUM(qty) AS units
        FROM localstock
        WHERE COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY groupid
      ),
      loc_by_size AS (
        -- EVERY size the style carries in skumap, each with its LOCAL count (0 for sold-out). The browse card draws a chip per size
        -- and greys the empty ones, so a sold-out MIDDLE size stays visible in its place instead of vanishing and letting a bigger
        -- size close the gap (which reads as a different size — owner, 2026-07-23). skumap is the full size range (one row per variant,
        -- size = last dash-segment '[^-]+$', which handles half sizes like "10.5" where RIGHT(code,2) would read ".5"); LEFT JOIN the
        -- same in-stock, non-deleted localstock rows loc uses, so the per-size counts still sum back to the Local total. Emitted as a
        -- {size: localQty} JSON map. Still drives the "Size XX" filter (membership = qty > 0), which a 0 entry correctly fails.
        SELECT m.groupid, jsonb_object_agg(m.sz, COALESCE(ls.units, 0)) AS sizes
        FROM (
          SELECT groupid, substring(code from '[^-]+$') AS sz
          FROM skumap
          GROUP BY groupid, substring(code from '[^-]+$')
        ) m
        LEFT JOIN (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(qty) AS units
          FROM localstock
          WHERE COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) ls ON ls.groupid = m.groupid AND ls.sz = m.sz
        GROUP BY m.groupid
      ),
      elsewhere_by_size AS (
        -- PER-SIZE stock we hold but CANNOT PICK: at Amazon (amzfeed.amztotal = live + inbound), in transit to Amazon, and on the
        -- Birkenstock pre-order book. Added 2026-09-02 because the browse chips were localstock-only: a size sitting 0 here but 1 at
        -- FBA drew as a dead greyed chip, reading "we have none of this anywhere" when we had one — you had to open the drill to find
        -- out (owner, from 14450-16 size 44). The chip now prints the TOTAL, so the card face and the drill's TOTAL column agree.
        --
        -- MUST STAY IN STEP WITH routes/inv-stock.js's per-size total (local + atAmazon + birkOnOrder). Same three sources, same
        -- rules: amztotal already includes amzlive so it is the single Amazon figure; transit is the 2-day DPD window; birk is
        -- requested - arrived, floored at 0, INNER JOINed through skumap. If you change one file's definition, change both, or the
        -- browse chip and the drill row for the same size will print different numbers on the same screen.
        --
        -- Size key is substring(code from '[^-]+$') — IDENTICAL to loc_by_size above, so the two maps share keys and the client can
        -- add them size-for-size. (RIGHT(code,2) would read '.5' on a half size; see loc_by_size.)
        SELECT groupid, jsonb_object_agg(sz, units) AS sizes
        FROM (
          SELECT groupid, sz, SUM(units) AS units
          FROM (
            SELECT f.groupid, substring(f.code from '[^-]+$') AS sz, COALESCE(f.amztotal, 0) AS units
            FROM amzfeed f
            UNION ALL
            SELECT m.groupid, substring(a.code from '[^-]+$') AS sz, a.qty AS units
            FROM amzshipment_archive a
            JOIN skumap m ON m.code = a.code
            WHERE a.created_at >= now() - interval '2 days'
            UNION ALL
            SELECT m.groupid, substring(b.code from '[^-]+$') AS sz,
                   GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0) AS units
            FROM birktracker b
            JOIN skumap m ON m.code = b.code
          ) src
          GROUP BY groupid, sz
        ) agg
        GROUP BY groupid
      ),
      ord AS (
        -- On order: COUNT of not-yet-arrived local (2) / Amazon (3) order lines. orderstatus.shopifysku = skumap.code (verified 100%).
        SELECT m.groupid, COUNT(*) AS units
        FROM orderstatus o
        JOIN skumap m ON m.code = o.shopifysku
        WHERE o.arrived = 0 AND o.ordertype IN (2, 3)
        GROUP BY m.groupid
      ),
      feed AS (
        -- At Amazon: live + inbound, straight from the nightly FBA feed. READ ONLY (CLAUDE.md) — never written by this app.
        SELECT groupid, SUM(COALESCE(amztotal, 0)) AS units
        FROM amzfeed
        GROUP BY groupid
      ),
      amz_skus AS (
        -- Full Amazon Seller SKUs (skumap.sku = internal code + supplier suffix, e.g. 17659-23-42-2607) held under each style, so a
        -- pasted Amazon SKU can be found by the Contains box even though it isn't the internal code (owner request 2026-07-25). skumap
        -- is one row per variant and always carries sku, unlike amzfeed (live FBA rows only) — this way a style search still works even
        -- when the size isn't currently live on Amazon. Space-joined so the client's plain-substring haystack search works unchanged.
        SELECT groupid, string_agg(sku, ' ') AS skus
        FROM skumap
        WHERE sku IS NOT NULL
        GROUP BY groupid
      ),
      -- NO boxed CTE. amzshipment units are still in localstock (allocated 'amz' at C3-Amazon) until DPD collects, so they are
      -- already inside loc below — counting them here too inflated Total for any style mid-shipment (owner, 2026-07-20).
      -- NB: no backticks anywhere in this string; it is a JS template literal, and one would end it mid-query.
      transit AS (
        -- Handed to DPD within the last 2 days — still counted as ours (lifecycle doc p7 rule).
        SELECT m.groupid, SUM(a.qty) AS units
        FROM amzshipment_archive a
        JOIN skumap m ON m.code = a.code
        WHERE a.created_at >= now() - interval '2 days'
        GROUP BY m.groupid
      ),
      birk AS (
        -- Birkenstock pre-order book (birktracker): the ~6-months-ahead seasonal POs, which orderstatus knows nothing about.
        -- requested MINUS arrived — an arrived unit is already in localstock, so the raw requested would double-count it.
        -- INNER JOIN on skumap: birktracker.code is Birkenstock's own naming and ~23% of lines are new-season styles we have not set
        -- up yet; those have no Inventory presence to show against. Must stay in step with routes/inv-stock.js — the list Total and
        -- the drill Total have to agree.
        SELECT m.groupid, SUM(GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0)) AS units
        FROM birktracker b
        JOIN skumap m ON m.code = b.code
        GROUP BY m.groupid
      ),
      sold AS (
        -- Units SOLD in the last 30 days, ALL channels (AMZ + SHP + CM3) — the simple "is this moving" number the operator weighs
        -- against stock to decide a drop. Deliberately shallow: a fixed 30-day gross unit count, no per-channel or velocity nuance (the
        -- pricing drills own that). qty > 0 drops returns so a refund doesn't read as a negative sale (mirrors the "positive sales only"
        -- rule the winners list uses). sales.groupid is already style-grain, so no join. LEFT JOINed below → a style with none reads 0.
        SELECT groupid, SUM(qty) AS units
        FROM sales
        WHERE solddate >= CURRENT_DATE - INTERVAL '30 days' AND qty > 0
        GROUP BY groupid
      )
      SELECT
        s.groupid,
        t.shopifytitle                                        AS title,
        s.segment,
        -- SEASON, for the browse's WINTER / SUMMER commands (owner, 2026-09-02). A plain column on skusummary — no join, no aggregation.
        -- Shipped rather than inferred from the segment name: only three segments encode season (RIEKER-WIN/-SUM, REMONTE-WIN, 32 styles
        -- between them), so segment-name matching silently missed the other 263 and made the operator trust a naming convention instead
        -- of the data. Values on live data are exactly 'Summer' (204), 'Any' (62), 'Winter' (29) — no blanks, and Add/Modify
        -- (routes/product-create.js) keeps new styles tagged. COALESCE anyway: a blank must fall out of both seasons, not crash a match.
        COALESCE(s.season, '')                                AS season,
        s.imagename,
        -- Price + RRP for the card face (owner: "£57" on the card). Legacy character-varying columns that can hold junk, so read via
        -- safeNumeric (NULL on non-numeric), NEVER a bare ::numeric — same rule as inv-stock.js. rrp only earns its place struck-through
        -- when it is ABOVE price; the client decides that, we just ship both.
        ${safeNumeric('s.shopifyprice')}                      AS price,
        ${safeNumeric('s.rrp')}                               AS rrp,
        COALESCE(loc.units, 0)                                AS local_units,
        COALESCE(loc_by_size.sizes, '{}'::jsonb)              AS local_sizes,
        COALESCE(elsewhere_by_size.sizes, '{}'::jsonb)        AS elsewhere_sizes,
        COALESCE(ord.units, 0)                                AS order_units,
        COALESCE(feed.units, 0)
          + COALESCE(transit.units, 0)                        AS amazon_units,
        COALESCE(birk.units, 0)                               AS birk_units,
        COALESCE(sold.units, 0)                               AS sold_units,
        amz_skus.skus                                         AS amz_skus,
        -- WHEN THE STYLE WAS ADDED — the Inventory browse opens on newest-first, so this is its default sort key (owner, 2026-07-28).
        -- Read from created_at, the proper timestamptz column: it is the one being built on, and the legacy created varchar is only a
        -- text stamp kept for the older systems. (No backticks in this comment — the whole query is a JS template literal.) migrations/20260728_skusummary_created_at_backfill.sql filled created_at for the
        -- styles that predate it, so there are no NULLs to work around; a style somehow lacking one still can't fall out of the list,
        -- it just sorts to the bottom (see the COALESCE).
        --
        -- Rendered to 'YYYYMMDD HH24:MI:SS' in EUROPE/LONDON here, not shipped as a Date: that shape sorts correctly as plain text, so
        -- the client compares strings and never parses. Handing a pg timestamp to the client to run through toISOString() is the BST
        -- day-shift landmine in CLAUDE.md — doing the conversion in SQL, in the business timezone, is the whole point.
        COALESCE(to_char(s.created_at AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS'), '')  AS created_sort
      FROM skusummary s
      LEFT JOIN title   t       ON t.groupid       = s.groupid
      LEFT JOIN loc             ON loc.groupid     = s.groupid
      LEFT JOIN loc_by_size     ON loc_by_size.groupid = s.groupid
      LEFT JOIN elsewhere_by_size ON elsewhere_by_size.groupid = s.groupid
      LEFT JOIN ord             ON ord.groupid     = s.groupid
      LEFT JOIN feed            ON feed.groupid    = s.groupid
      LEFT JOIN transit         ON transit.groupid = s.groupid
      LEFT JOIN birk            ON birk.groupid    = s.groupid
      LEFT JOIN sold            ON sold.groupid    = s.groupid
      LEFT JOIN amz_skus        ON amz_skus.groupid = s.groupid
      ORDER BY t.shopifytitle NULLS LAST, s.groupid
    `);

    // pg returns SUM()/COUNT() as strings (numeric/bigint) — coerce so the JSON carries real numbers and the client can sort/compare
    // without parsing. Total is composed here rather than in SQL so the definition sits next to the comment that explains it.
    const rows = result.rows.map((r) => {
      const local = Number(r.local_units) || 0;
      const amazon = Number(r.amazon_units) || 0;
      const birk = Number(r.birk_units) || 0;
      return {
        groupid: r.groupid,
        title: r.title || null,
        segment: r.segment || null,
        // 'Summer' | 'Winter' | 'Any' | '' — the client folds 'Any' into BOTH seasons (a year-round style is sellable in either), so
        // this is shipped raw and the meaning is applied there, next to the filter that depends on it.
        season: r.season || null,
        imagename: r.imagename || null,
        // safeNumeric already rejected junk to NULL, so ship numbers the client formats without parsing.
        price: r.price === null ? null : Number(r.price),
        rrp: r.rrp === null ? null : Number(r.rrp),
        local,
        // Stock held AT Amazon (live + inbound + in-transit). Sent as its own field so the client can show a "local + Amazon" combined
        // indicator and filter on it (STOCK LESS / STOCK MORE) — the "what have we actually got right now?" number used to decide what
        // to drop. Deliberately SEPARATE from `total` below, which also folds in the Birk pre-order book (future stock, not in hand).
        amazon,
        // {size: localQty} for EVERY size in skumap (0 for sold-out) — drives the browse card's size chips (greyed at 0) and the
        // client-side "Size XX" filter. jsonb already parses to an object with numeric values; default to {} so the client never
        // guards for null.
        localSizes: r.local_sizes || {},
        // PER-SIZE TOTAL = local + Amazon-held + Birk pre-order, the same three parts as `total` above and the same definition as the
        // drill's TOTAL column (routes/inv-stock.js). This is what the browse chips print, so a size we hold ONLY at Amazon shows its
        // count instead of greying out as if we had none anywhere (owner, 2026-09-02). localSizes is still sent alongside — the client
        // needs the split for the chip's hover and for the +/- adjust, which only ever moves LOCAL.
        //
        // Keys are the UNION of the two maps. loc_by_size covers every size in skumap and is normally a superset, but an amzfeed or
        // birktracker row whose size isn't set up in skumap would otherwise have nowhere to land and vanish silently — the exact class
        // of bug this change exists to kill. A size present in only one map reads 0 from the other.
        totalSizes: (() => {
          const loc = r.local_sizes || {};
          const els = r.elsewhere_sizes || {};
          const out = {};
          for (const k of new Set([...Object.keys(loc), ...Object.keys(els)])) {
            out[k] = (Number(loc[k]) || 0) + (Number(els[k]) || 0);
          }
          return out;
        })(),
        onOrder: Number(r.order_units) || 0,
        // Space-joined full Amazon Seller SKUs held under this style (e.g. "JLH455-CHARL-BLACK-04-2606 …"), so the Contains box can
        // find a style by a pasted Amazon SKU that doesn't share the internal code. Null when the style has no Amazon presence.
        amazonSkus: r.amz_skus || null,
        // Units sold in the last 30 days, all channels (positive sales only). The "is it moving" figure the client shows and
        // SALES LESS / SALES MORE filters on — weighed against stock to decide a drop.
        sold30: Number(r.sold_units) || 0,
        // Total INCLUDES the Birkenstock pre-order book (owner) — a placed Birk order is stock they count on having, since it is the
        // only replenishment that exists for the brand. Local stays strictly "in the building".
        total: local + amazon + birk,
        // skusummary.created_at as 'YYYYMMDD HH24:MI:SS' (Europe/London). Null only if the style has no created_at at all, which the
        // 2026-07-28 backfill removed — and which would simply sort last on "newest first" rather than break anything.
        created: r.created_sort || null,
      };
    });

    return res.json({ return_code: 'SUCCESS', count: rows.length, rows });
  } catch (err) {
    logger.error('[inv-styles] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load inventory styles' });
  }
});

module.exports = router;
