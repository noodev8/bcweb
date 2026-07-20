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
  "price": 46.95,                             // live Shopify price; null if the legacy varchar column holds junk or is blank
  "rrp": 55.00,                               // recommended retail; null on the same terms (rrp = the text 'RRP' on 37 real rows)
  "totals": { "local": 42, "onOrder": 0, "total": 42 },   // column totals, so the operator does not add up 8 rows in their head
  "sizes": [
    {
      "code": "1005292-ARIZONA-36", "eu": "36", "uksize": "3.5 UK",
      "local": 10, "onOrder": 0, "total": 10,      // compact view — DERIVED from buckets below, never computed separately
      "buckets": {                                  // Show Detail view (spec §3b)
        "free": 10, "picked": 0, "amzAlloc": 0,                          // HERE
        "onOrderLocal": 0, "onOrderAmz": 0, "arrivedLocal": 0, "arrivedAmz": 0,  // INCOMING
        "amzLive": 0, "amzInbound": 0, "boxed": 0, "transit": 0          // AT AMAZON
      },
      "amazonTotal": 0,                             // the re-order figure (incl. amz-earmarked stock still in our building)
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
      "state": "FREE"                       // FREE | PICKED | AMZ
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
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').toString().trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }

    // Header first — also our existence check, so a bad groupid gets NOT_FOUND rather than an empty grid that looks like "no stock".
    // Price and RRP ride along on the header so the operator can answer "how much is it?" mid-conversation without leaving the
    // screen (owner, 2026-07-20). Read via safeNumeric, NEVER a bare ::numeric — these are legacy character-varying columns that
    // hold junk on real rows (rrp = the literal text 'RRP' in 37 of them), and a plain cast throws and 500s the whole request.
    // A bad value degrades to null and the UI simply omits it.
    const head = await query(
      `SELECT s.groupid, t.shopifytitle AS title, s.imagename,
              ${safeNumeric('s.shopifyprice')} AS price,
              ${safeNumeric('s.rrp')}          AS rrp
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
         -- sizedisplay is the HUMAN-ENTERED label (owner, 2026-07-20): the same string the customer sees on the public site, typed
         -- on the Add/Modify sizes screen. Prefer it over deriving a label from code + uksize — the operator already decided how
         -- this size should read, and a brand that is not EU-sized simply says "5 UK" rather than a bogus "05 EU / 5 UK".
         -- It lives in optionsize behind an "<seq>--" ordering prefix (e.g. '101--35 EU / 2.5 UK'), which is stripped here; same
         -- transformation as product-get.js. 100% populated across all 2046 variants, but it is free text, so the client keeps a
         -- fallback for a blank one. eu/uksize are still selected: eu drives the numeric size ordering below.
         SELECT m.code, RIGHT(m.code, 2) AS eu, m.uksize,
                NULLIF(btrim(regexp_replace(m.optionsize, '^[0-9]+--', '')), '') AS sizedisplay
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
           -- ONE amz bucket, not the old reserved/bay split (owner, 2026-07-20). Both were just "allocated 'amz'" with a different
           -- location, and the locations table below already prints the location per row — so the split cost a column and told the
           -- operator nothing the row underneath did not. On live data the "normal rack" side was 0 units anyway: goods-in writes
           -- Amazon arrivals straight to C3-Amazon, so every one of the 76 allocated pairs sits in the bay.
           SUM(l.qty) FILTER (WHERE l.ordernum =  '#FREE' AND l.allocated = 'amz')                                                  AS amz_alloc_u
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
         -- Bucket 12: handed to DPD within the last 2 days — still counted as ours (lifecycle doc p7).
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
         sz.sizedisplay,
         COALESCE(loc.free_u, 0)           AS free_u,
         COALESCE(loc.picked_u, 0)         AS picked_u,
         COALESCE(loc.amz_alloc_u, 0)      AS amz_alloc_u,
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
        amzAlloc: n(r.amz_alloc_u),
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
      const local = b.free + b.picked + b.amzAlloc;
      // NO `boxed` HERE (owner, 2026-07-20). A boxed pair has not left the building — its localstock row is still there, allocated
      // 'amz' at C3-Amazon — so it is already inside `local` above. Adding it again inflated Total for exactly the styles being
      // shipped. `transit` DOES belong: once DPD collects, the localstock rows are gone and the units exist in no other source until
      // Amazon books them in. Bucket 11 is still computed and returned; it is simply not part of any total.
      const atAmazon = b.amzLive + b.amzInbound + b.transit;
      // Birkenstock pre-order book, INCLUDED IN TOTAL (owner): the operator already counts a placed Birk order as stock they have —
      // "I know it's coming" — because these are ordered ~6 months ahead and are the only replenishment that exists for Birkenstock.
      // requested MINUS arrived, so units already booked into localstock are not counted twice against Local.
      const birkOnOrder = n(r.birk_u);

      return {
        code: r.code,
        eu: r.eu,
        uksize: r.uksize || null,
        sizeDisplay: r.sizedisplay || null,
        local,
        onOrder: b.onOrderLocal + b.onOrderAmz,
        total: local + atAmazon + birkOnOrder,
        buckets: b,
        // THE re-order figure: everything at, heading to, or set aside for Amazon. amzLive + amzInbound is exactly amzfeed.amztotal
        // (Amazon's own count, split for display), and the rest is what we hold that Amazon cannot see yet.
        //
        // `boxed` IS DELIBERATELY EXCLUDED (owner, 2026-07-20; the lifecycle doc p7 was corrected to match — an earlier revision
        // added amzshipment here). Building a box does NOT remove the units from localstock: the lifecycle is amz-reserved -> moved
        // to the C3-Amazon bay -> boxed, and the localstock row stays put (still ordernum '#FREE', allocated 'amz') through all
        // three. So adding `boxed` counts the same pairs twice, once as amzAlloc and once as boxed, inflating the figure we re-order
        // against. Verified on live data: of the 12 largest amzshipment codes, 11 have an exactly matching allocated-'amz'
        // localstock quantity at C3-Amazon. Goods In is where they get there — a type-3 order marked arrived is written straight to
        // localstock at location 'C3-Amazon', allocated 'amz', one row per pair.
        //
        // `transit` STAYS, and its 2-day overlap is intentional (owner): once a box is collected the localstock rows are gone, so for
        // the day or two before Amazon books the shipment into amztotal those units exist nowhere else. If Amazon reports them faster
        // than that we briefly double-count — accepted, because the cost is deferring a re-order, not buying stock we already own.
        amazonTotal: b.amzLive + b.amzInbound + b.transit + b.onOrderAmz + b.amzAlloc,
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
    // State is derived with the SAME rules as the grid's buckets, so this panel and the grid can never disagree:
    //   PICKED - committed to a customer order (ordernum <> '#FREE'), still on the shelf until packed
    //   AMZ    - allocated to Amazon. NOT split into reserved-vs-bay any more (owner, 2026-07-20): the difference between the two was
    //            only ever the location, and the location is printed in the very next column. Per the lifecycle doc (p5) an amz unit
    //            is still pickable for a Shopify customer, so it is NOT "gone" — the UI must not grey it out as unavailable.
    //   FREE   - unallocated and unpicked
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
           WHEN l.ordernum <> '#FREE'   THEN 'PICKED'
           WHEN l.allocated = 'amz'     THEN 'AMZ'
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
      'free', 'picked', 'amzAlloc',
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
      // Numbers, not strings: safeNumeric already rejected junk, so the client formats and never parses.
      price: head.rows[0].price === null ? null : Number(head.rows[0].price),
      rrp: head.rows[0].rrp === null ? null : Number(head.rows[0].rrp),
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
