/*
=======================================================================================================================================
API Route: inv_stock
=======================================================================================================================================
Method: GET
Purpose: Slice 2 of the Inventory Management module (docs/inventory-spec.md §3a). One style's stock position at SIZE grain — the
         compact three-number grid the operator actually reads with a customer waiting: Order / Total / Local per size, plus the
         product image for visual confirmation.

         The image is not decoration. A normal result set is a dozen near-identical black Arizonas, and the picture is how the operator
         confirms they are looking at the right one (owner). Returned as the bare `imagename`; the web builds the URL, exactly as
         product-get / Add-Modify already do.

SIZES COME FROM skumap, NOT localstock (CLAUDE.md landmine): localstock holds in-stock rows only, so a sold-out size has NO row. Taking
the size range from skumap and LEFT JOINing each stock source means a sold-out size still appears, reading 0 — which is the answer the
operator needs ("we have none in a 39"), not a missing row they might read as "not stocked".

THE TWO AGGREGATION RULES (same as inv-styles; the easiest bug to ship here — spec §3 data facts):
  - localstock  -> SUM(qty).   qty is NOT always 1 (106 of 2250 live rows exceed it, max 9).
  - orderstatus -> COUNT(*).   qty IS always 1 there (one row per SKU).
Verified end-to-end against the legacy PowerBuilder screen for 1005292-ARIZONA: sizes 35-41 return 3/10/5/5/3/7/5, matching it exactly.
Size 36 is the one that proves the rule — 9 rows, one carrying qty=2, so COUNT(*) would render 9 and be wrong.

DEFINITIONS (owner, 2026-07-19):
  - Local = what is in localstock, whatever its state. INCLUDES stock already picked for an order (still physically on the shelf).
  - Order = orderstatus rows not yet arrived, local (type 2) or Amazon (type 3). Taken at face value, no staleness logic (owner).
  - Total = everything we have of that size wherever it sits = Local + live at Amazon + inbound + boxed + in transit.
=======================================================================================================================================
Request Payload (query string):
  groupid  (string, required)  - the style key

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "1005292-ARIZONA",
  "title": "Birkenstock Arizona Two-Strap Patent Sandals Black Narrow Fit",
  "imagename": "womens-....jpg",              // bare filename; web builds https://images.brookfieldcomfort.com/<imagename>. null if none
  "totals": { "local": 42, "onOrder": 0, "total": 42 },   // column totals, so the operator does not add up 8 rows in their head
  "sizes": [
    {
      "code": "1005292-ARIZONA-36", "eu": "36", "uksize": "3.5 UK",
      "local": 10, "onOrder": 0, "total": 10,      // compact view — DERIVED from buckets below, never computed separately
      "buckets": {                                  // Show Detail view (spec §3b)
        "free": 10, "picked": 0, "amzReserved": 0, "amzBay": 0,          // HERE
        "onOrderLocal": 0, "onOrderAmz": 0, "arrivedLocal": 0, "arrivedAmz": 0,  // INCOMING
        "amzLive": 0, "amzInbound": 0, "boxed": 0, "transit": 0          // AT AMAZON
      },
      "amazonTotal": 0,                             // PDF p7 re-order figure (incl. amz-earmarked stock still in our building)
      "demand": 0                                   // ordertype 1 — a CLAIM on stock, never added into a stock figure
    },
    ...
  ],
  "locations": [                            // every physical localstock row — "which rack is it on"
    {
      "id": "WS1-1626-6ZDZH",               // stable key; phase 2 edits these rows in place
      "code": "1005292-ARIZONA-36",
      "eu": "36",
      "uksize": "3.5 UK",
      "location": "C3-Front-15",
      "qty": 2,
      "ordernum": null,                     // the order it is committed to, or null when free
      "state": "FREE"                       // FREE | PICKED | AMZ_RESERVED | AMZ_BAY
    },
    ...
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"     // no groupid
"NOT_FOUND"          // no such style in skusummary
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

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').toString().trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // Header first — also our existence check, so a bad groupid gets NOT_FOUND rather than an empty grid that looks like "no stock".
    const head = await query(
      `SELECT s.groupid, t.shopifytitle AS title, s.imagename
       FROM skusummary s
       LEFT JOIN title t ON t.groupid = s.groupid
       WHERE s.groupid = $1`,
      [groupid]
    );
    if (head.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    // One query for the whole grid. Each source pre-aggregated to code grain in its own CTE, LEFT JOINed onto the skumap size list.
    // The CTEs are scoped to this style's codes (the `sz` join) rather than aggregating the whole table and filtering after.
    // The query returns the TWELVE buckets of spec §3b per size. The compact Local / Order / Total figures are then DERIVED from
    // those buckets in JS below, rather than computed separately — so the collapsed grid and the Show Detail breakdown are
    // arithmetically incapable of disagreeing. (Two independent sums that "should" match is how a screen ends up quietly lying.)
    const grid = await query(
      `WITH sz AS (
         SELECT m.code, RIGHT(m.code, 2) AS eu, m.uksize
         FROM skumap m
         WHERE m.groupid = $1
       ),
       loc AS (
         -- Buckets 1-4, split by state. Soft-deleted rows excluded.
         -- COALESCE on allocated is deliberate: a bare "allocated <> 'amz'" is NULL (not true) for a NULL allocated, which would drop
         -- that unit from ALL FOUR buckets and quietly break "buckets sum to Local". Live data only holds 'unallocated'/'amz', but
         -- nothing constrains the column.
         SELECT
           l.code,
           SUM(l.qty) FILTER (WHERE l.ordernum =  '#FREE' AND COALESCE(l.allocated, '') <> 'amz')                                   AS free_u,
           SUM(l.qty) FILTER (WHERE l.ordernum <> '#FREE')                                                                          AS picked_u,
           SUM(l.qty) FILTER (WHERE l.ordernum =  '#FREE' AND l.allocated = 'amz' AND UPPER(l.location) <> 'C3-AMAZON')             AS amz_reserved_u,
           SUM(l.qty) FILTER (WHERE l.ordernum =  '#FREE' AND l.allocated = 'amz' AND UPPER(l.location) =  'C3-AMAZON')             AS amz_bay_u
         FROM localstock l
         JOIN sz ON sz.code = l.code
         WHERE COALESCE(l.deleted, 0) = 0 AND l.qty > 0
         GROUP BY l.code
       ),
       ord AS (
         -- Buckets 5-8 + customer demand. orderstatus.shopifysku = skumap.code (verified 100% on live data).
         -- COUNT(*) not SUM(qty): qty is always 1 here, one row per SKU. Opposite rule to localstock above — see the header block.
         SELECT
           o.shopifysku AS code,
           COUNT(*) FILTER (WHERE o.ordertype = 2 AND o.arrived = 0) AS on_order_local_u,
           COUNT(*) FILTER (WHERE o.ordertype = 3 AND o.arrived = 0) AS on_order_amz_u,
           COUNT(*) FILTER (WHERE o.ordertype = 2 AND o.arrived = 1) AS arrived_local_u,
           COUNT(*) FILTER (WHERE o.ordertype = 3 AND o.arrived = 1) AS arrived_amz_u,
           COUNT(*) FILTER (WHERE o.ordertype = 1)                   AS demand_u
         FROM orderstatus o
         JOIN sz ON sz.code = o.shopifysku
         GROUP BY o.shopifysku
       ),
       feed AS (
         -- Buckets 9-10. amztotal INCLUDES amzlive (verified amztotal >= amzlive on all 474 live rows), so inbound is the difference.
         -- GREATEST(...,0) guards against a feed row that ever breaks that invariant, so inbound can never render negative.
         SELECT
           f.code,
           SUM(COALESCE(f.amzlive, 0))                                              AS amz_live_u,
           SUM(GREATEST(COALESCE(f.amztotal, 0) - COALESCE(f.amzlive, 0), 0))       AS amz_inbound_u
         FROM amzfeed f
         JOIN sz ON sz.code = f.code
         GROUP BY f.code
       ),
       boxed AS (
         -- Bucket 11: in an Amazon box, waiting for DPD.
         SELECT s.code, SUM(s.qty) AS units
         FROM amzshipment s
         JOIN sz ON sz.code = s.code
         GROUP BY s.code
       ),
       transit AS (
         -- Bucket 12: handed to DPD within the last 2 days — still counted as ours (PDF p7).
         SELECT a.code, SUM(a.qty) AS units
         FROM amzshipment_archive a
         JOIN sz ON sz.code = a.code
         WHERE a.created_at >= now() - interval '2 days'
         GROUP BY a.code
       ),
       birk AS (
         -- Birkenstock pre-order book: the ~6-months-ahead seasonal POs. This is a SEPARATE notion of "incoming" from orderstatus —
         -- orderstatus holds warehouse order lines and knows nothing about these, so without this the screen cannot see what is
         -- coming from Birkenstock at all.
         --
         -- requested MINUS arrived (owner): an arrived unit has already been booked into localstock, so counting the full requested
         -- figure would double-count it against Local. GREATEST(...,0) guards the case where more arrived than was requested.
         --
         -- INNER JOIN on skumap is deliberate: birktracker.code is BIRKENSTOCK's naming (e.g. '0044701-Ramses Birko-Flor Unisex-35'),
         -- and only ~77% of lines match a code we carry. The rest are new-season styles not set up in skumap yet — they have no
         -- Inventory presence to show this against, so dropping them is correct, not a gap (owner).
         SELECT b.code, SUM(GREATEST(COALESCE(b.requested, 0) - COALESCE(b.arrived, 0), 0)) AS units
         FROM birktracker b
         JOIN sz ON sz.code = b.code
         GROUP BY b.code
       )
       SELECT
         sz.code,
         sz.eu,
         sz.uksize,
         COALESCE(loc.free_u, 0)           AS free_u,
         COALESCE(loc.picked_u, 0)         AS picked_u,
         COALESCE(loc.amz_reserved_u, 0)   AS amz_reserved_u,
         COALESCE(loc.amz_bay_u, 0)        AS amz_bay_u,
         COALESCE(ord.on_order_local_u, 0) AS on_order_local_u,
         COALESCE(ord.on_order_amz_u, 0)   AS on_order_amz_u,
         COALESCE(ord.arrived_local_u, 0)  AS arrived_local_u,
         COALESCE(ord.arrived_amz_u, 0)    AS arrived_amz_u,
         COALESCE(ord.demand_u, 0)         AS demand_u,
         COALESCE(feed.amz_live_u, 0)      AS amz_live_u,
         COALESCE(feed.amz_inbound_u, 0)   AS amz_inbound_u,
         COALESCE(boxed.units, 0)          AS boxed_u,
         COALESCE(transit.units, 0)        AS transit_u,
         COALESCE(birk.units, 0)           AS birk_u
       FROM sz
       LEFT JOIN loc     ON loc.code     = sz.code
       LEFT JOIN ord     ON ord.code     = sz.code
       LEFT JOIN feed    ON feed.code    = sz.code
       LEFT JOIN boxed   ON boxed.code   = sz.code
       LEFT JOIN transit ON transit.code = sz.code
       LEFT JOIN birk    ON birk.code    = sz.code
       -- Numeric size order (35, 36, ... 42), not text order. Sizes are EU by design and normally 2 digits, but the regex guard keeps
       -- a non-numeric code (accessories, one-size items) from throwing on the ::int cast — those sort last.
       ORDER BY (CASE WHEN sz.eu ~ '^[0-9]+$' THEN sz.eu::int ELSE 999 END), sz.code`,
      [groupid]
    );

    // pg returns SUM()/COUNT() as strings (numeric/bigint) — coerce once here.
    const n = (v) => Number(v) || 0;

    const sizes = grid.rows.map((r) => {
      // The twelve buckets, spec §3b, in the order the UI displays them.
      const b = {
        free: n(r.free_u),
        picked: n(r.picked_u),
        amzReserved: n(r.amz_reserved_u),
        amzBay: n(r.amz_bay_u),
        onOrderLocal: n(r.on_order_local_u),
        onOrderAmz: n(r.on_order_amz_u),
        arrivedLocal: n(r.arrived_local_u),
        arrivedAmz: n(r.arrived_amz_u),
        amzLive: n(r.amz_live_u),
        amzInbound: n(r.amz_inbound_u),
        boxed: n(r.boxed_u),
        transit: n(r.transit_u),
      };

      // Compact figures DERIVED from the buckets, never computed independently — so Show Detail always reconciles.
      const local = b.free + b.picked + b.amzReserved + b.amzBay;
      const atAmazon = b.amzLive + b.amzInbound + b.boxed + b.transit;
      // Birkenstock pre-order book, INCLUDED IN TOTAL (owner): the operator already counts a placed Birk order as stock they have —
      // "I know it's coming" — because these are ordered ~6 months ahead and are the only replenishment that exists for Birkenstock.
      // requested MINUS arrived, so units already booked into localstock are not counted twice against Local.
      const birkOnOrder = n(r.birk_u);

      return {
        code: r.code,
        eu: r.eu,
        uksize: r.uksize || null,
        local,
        onOrder: b.onOrderLocal + b.onOrderAmz,
        total: local + atAmazon + birkOnOrder,
        buckets: b,
        // Derived rows from PDF p7 / spec §3. amazonTotal is the figure that drives Amazon re-ordering: everything at or heading to
        // Amazon, INCLUDING the units still sitting in our building earmarked for it (amzReserved + amzBay + onOrderAmz).
        amazonTotal: b.amzLive + b.amzInbound + b.boxed + b.transit + b.onOrderAmz + b.amzReserved + b.amzBay,
        // Customer demand is a CLAIM on stock, not stock. Kept separate so it is never added into a stock figure.
        demand: n(r.demand_u),
        // Also surfaced as its own Show Detail column, so the operator can see how much of Total is a pre-order rather than stock
        // on a shelf. It is NOT part of Local — Local stays strictly "what is in the building".
        birkOnOrder,
      };
    });

    // ---- Locations (slice 3) ------------------------------------------------------------------------------------------------
    // Every physical localstock row for the style: WHERE is it, and what state is it in. This is the half of the screen that answers
    // "go and fetch it" — the grid says we have a 38, this says which rack.
    //
    // LEFT JOIN to skumap (not an inner join) deliberately: if a localstock row's code has no skumap variant, the row still appears
    // with a blank UK size. A stock row the operator cannot see is far worse than one with a missing size label.
    //
    // State is derived with the SAME rules as spec §3 buckets 1-4, so this panel and the grid can never disagree:
    //   PICKED       - committed to a customer order (ordernum <> '#FREE'), still on the shelf until packed
    //   AMZ_BAY      - allocated to Amazon AND already moved to the C3-Amazon staging bay. NOTE: per the lifecycle doc (p5) this is
    //                  still pickable for a Shopify customer, so it is NOT "gone" — the UI must not grey it out as unavailable.
    //   AMZ_RESERVED - allocated to Amazon but still in its normal rack location
    //   FREE         - unallocated and unpicked
    // location is compared case-insensitively: nothing constrains that column (a stray 'C3-SHOP' has been seen in live data).
    const locs = await query(
      `SELECT
         l.id,
         l.code,
         RIGHT(l.code, 2) AS eu,
         m.uksize,
         l.location,
         l.qty,
         l.ordernum,
         CASE
           WHEN l.ordernum <> '#FREE'                                        THEN 'PICKED'
           WHEN l.allocated = 'amz' AND UPPER(l.location) = 'C3-AMAZON'      THEN 'AMZ_BAY'
           WHEN l.allocated = 'amz'                                          THEN 'AMZ_RESERVED'
           ELSE 'FREE'
         END AS state
       FROM localstock l
       LEFT JOIN skumap m ON m.code = l.code
       WHERE l.groupid = $1 AND COALESCE(l.deleted, 0) = 0 AND l.qty > 0
       ORDER BY (CASE WHEN RIGHT(l.code, 2) ~ '^[0-9]+$' THEN RIGHT(l.code, 2)::int ELSE 999 END), l.location`,
      [groupid]
    );

    // id is carried through because phase 2 edits these rows in place and needs a stable key (spec §4).
    const locations = locs.rows.map((r) => ({
      id: r.id,
      code: r.code,
      eu: r.eu,
      uksize: r.uksize || null,
      location: r.location || null,
      qty: Number(r.qty) || 0,
      ordernum: r.ordernum === '#FREE' ? null : r.ordernum,
      state: r.state,
    }));

    // Column totals, computed here rather than in the browser so the grid and its footer can never disagree. Buckets are totalled
    // too, so the Show Detail view gets an all-sizes column without the client re-summing twelve series.
    const BUCKET_KEYS = [
      'free', 'picked', 'amzReserved', 'amzBay',
      'onOrderLocal', 'onOrderAmz', 'arrivedLocal', 'arrivedAmz',
      'amzLive', 'amzInbound', 'boxed', 'transit',
    ];
    const totals = sizes.reduce(
      (acc, s) => {
        acc.local += s.local;
        acc.onOrder += s.onOrder;
        acc.total += s.total;
        acc.amazonTotal += s.amazonTotal;
        acc.demand += s.demand;
        acc.birkOnOrder += s.birkOnOrder;
        for (const k of BUCKET_KEYS) acc.buckets[k] += s.buckets[k];
        return acc;
      },
      {
        local: 0, onOrder: 0, total: 0, amazonTotal: 0, demand: 0, birkOnOrder: 0,
        buckets: Object.fromEntries(BUCKET_KEYS.map((k) => [k, 0])),
      }
    );

    return res.json({
      return_code: 'SUCCESS',
      groupid: head.rows[0].groupid,
      title: head.rows[0].title || null,
      imagename: head.rows[0].imagename || null,
      totals,
      sizes,
      locations,
    });
  } catch (err) {
    logger.error('[inv-stock] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load stock position' });
  }
});

module.exports = router;
