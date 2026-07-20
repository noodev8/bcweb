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
      "imagename": "birkenstock-....jpg",   // bare filename; the web builds https://images.brookfieldcomfort.com/<imagename>
      "local": 38,                          // SUM(localstock.qty), all states
      "localSizes": { "37": 4, "38": 5, "39": 6 },  // {size: localQty} for in-stock sizes; drives the client "Size XX" filter
      "onOrder": 0,                         // COUNT(orderstatus rows), arrived=0, ordertype 2|3
      "total": 38                           // local + amazon-held
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
        -- Local stock broken down BY SIZE, so the client can answer "who has a 41 on the shelf" without a round-trip (owner: search
        -- Size XX near the end of a hunt). Size = the code's last dash-segment (substring '[^-]+$'), which handles half sizes like
        -- "10.5" correctly where the module's usual RIGHT(code,2) would read ".5". Same row set as loc (deleted=0, qty>0), so the
        -- per-size counts sum back to the Local total. Emitted as a {size: qty} JSON map, only sizes actually in stock.
        SELECT groupid, jsonb_object_agg(sz, units) AS sizes
        FROM (
          SELECT groupid, substring(code from '[^-]+$') AS sz, SUM(qty) AS units
          FROM localstock
          WHERE COALESCE(deleted, 0) = 0 AND qty > 0
          GROUP BY groupid, substring(code from '[^-]+$')
        ) per_size
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
      )
      SELECT
        s.groupid,
        t.shopifytitle                                        AS title,
        s.segment,
        s.imagename,
        COALESCE(loc.units, 0)                                AS local_units,
        COALESCE(loc_by_size.sizes, '{}'::jsonb)              AS local_sizes,
        COALESCE(ord.units, 0)                                AS order_units,
        COALESCE(feed.units, 0)
          + COALESCE(transit.units, 0)                        AS amazon_units,
        COALESCE(birk.units, 0)                               AS birk_units
      FROM skusummary s
      LEFT JOIN title   t       ON t.groupid       = s.groupid
      LEFT JOIN loc             ON loc.groupid     = s.groupid
      LEFT JOIN loc_by_size     ON loc_by_size.groupid = s.groupid
      LEFT JOIN ord             ON ord.groupid     = s.groupid
      LEFT JOIN feed            ON feed.groupid    = s.groupid
      LEFT JOIN transit         ON transit.groupid = s.groupid
      LEFT JOIN birk            ON birk.groupid    = s.groupid
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
        imagename: r.imagename || null,
        local,
        // {size: localQty} for sizes currently in local stock — drives the client-side "Size XX" filter and the per-size count it
        // shows. jsonb already parses to an object with numeric values; default to {} so the client never guards for null.
        localSizes: r.local_sizes || {},
        onOrder: Number(r.order_units) || 0,
        // Total INCLUDES the Birkenstock pre-order book (owner) — a placed Birk order is stock they count on having, since it is the
        // only replenishment that exists for the brand. Local stays strictly "in the building".
        total: local + amazon + birk,
      };
    });

    return res.json({ return_code: 'SUCCESS', count: rows.length, rows });
  } catch (err) {
    logger.error('[inv-styles] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load inventory styles' });
  }
});

module.exports = router;
