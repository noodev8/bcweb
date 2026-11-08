/*
=======================================================================================================================================
API Route: analytics_slow_sizes
=======================================================================================================================================
Method: GET
Purpose: Slow -> Sizes. Every SIZE (code) we hold, longest without a sale first. Owner, 2026-10-15: "My interest is in individual SKUs
         that just haven't shifted the longest. I get the top 50 of those and work on them ... I will then decide how to deal with
         them." Slow itself works per STYLE (utils/stockSitting.js), so a style that sells in its middle sizes never shows there even
         when one big size has sat for a year (the owner's example: Milano). This is the same question at code grain.

         A LIST, NOT A RULE. No window, no bar: every held size is returned, ranked. There is no "slow" cut-off here on purpose — the
         owner works the top of the list and decides; don't add a threshold or a flag without the owner. Nothing is written.

IDLE DAYS = how long the stock held NOW has sat without a sale: days since the LATER of its last NET sale (any channel; a sale that
         came back doesn't count — 2026-10-26, utils/onShelf.js → lastNetSales) and its oldest held pair's arrival (utils/onShelf.js → idleSince; owner, 2026-10-15: "this screen is
         about clearing losers"). A size restocked last week that last sold a year ago is a week idle — it was sold out, not stuck.
         That reverses the 2026-10-10 "deliveries ignored" rule here only (Slow itself still ignores them). idle_from says which
         date started the clock ('sale' | 'arrival'); last_sale is still the real last sale, for the month.

ON SHELF = days since the OLDEST pair still held arrived (utils/onShelf.js — oldest sells first; a pair from before Goods In logged
         arrivals is dated 31 Dec 2024, so every size has a number). A separate fact from idle days (owner, 2026-10-15): a size that
         last sold 300 days ago but was restocked last month is a re-order, not an old pair.

NEVER SOLD: idle days = on shelf days (it has been waiting since its oldest pair arrived). Since 2026-10-15 these roll in with the rest
         (owner: "everything rolls as standard instead of putting text in") — no "before 2025" text, no separate top rank.

NEVER SOLD, RESTOCKED ANYWAY (owner, 2026-11-06, Slow movers): a restock restarts a size's clock (the 2026-10-15 rule — a size that
         SOLD has done its job, so its restock is the reorder process's business, not this screen's). A size that NEVER sold never did
         its job: "I bought more before it even sell". So HERE ONLY its clock runs from its FIRST EVER Goods In arrival, not the restock
         — idle_days / idle_from / clearance are recomputed from first_in (e.g. Rieker L7500-35, first in Aug 2025, restocked Sep
         2026, never sold → No sale 9 months+), with no special mention on screen. Done in this route, NOT utils/onShelf.js, so the
         size screen and eBay's clearance price (which read the util) are untouched until the owner asks. (The code is
         utils/slowSizes.js → datedFromFirstArrival since 2026-11-06, so the Clearance decisions see the same list; readSlowSizes
         itself still doesn't apply it.)

STOCK = the utils/financeStock.js definition at code grain (local #FREE not deleted + amzfeed.amztotal), LIVE — one number, no Amazon
         split, the same as Slow and Sell-through.

CLEARANCE (2026-10-26) = idle since on or before today minus 9 calendar months (rows built in
         utils/slowSizes.js → readSlowSizes).

STYLE SOLD (12M) = net units of the whole STYLE in the last 12 months (was 90 days until 2026-10-15 — owner: "shall we say a
         year ... its basically saying the style has sold this many in this time"), so a dead size in a selling style (the Milano case) can be told apart from a
         dead style (which Slow already lists).

SLOW MOVERS AS STYLE ROWS (owner, 2026-11-06 — the handover from New stuff, New Additions' layout): the screen draws one row per
         STYLE with every size as a tile, so three extra facts ride along — none changes who is on the list:
           styles[]  = each listed style's picture (skusummary.imagename).
           sold_12m  = THIS size's net units in the last 12 months (returns subtract), beside its stock ("8 in stock, 1 sold").
           uk        = THIS size's UK size from skumap.uksize ("5.5" from "5.5 UK"; null for a child size or none) — the front
                       screen's By size grid counts sizes per UK size, so EU and UK brands share one axis (Birkenstock EU 38 = UK 5).
           others[]  = the style's sizes we DON'T hold that have ever arrived on Goods In or ever sold — the grey tiles, so a dud size
                       can be read against the run. (Never-stocked placeholders left out, as New Additions' OTHER_SIZES_SQL.)

         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-10-15",
  "cutoff": "2026-01-15",                       // idle since on or before this = clearance
  "sizes": [
    { "code": "1017722-BEND-46", "groupid": "1017722-BEND", "size": "46", "title": "…", "brand": "Birkenstock",
      "units": 2,
      "last_sale": "2025-08-02" | null,         // last NET sale; null = never sold (or every sale came back)
      "idle_days": 439,                         // since the later of last sale / oldest held arrival
      "idle_from": "sale" | "arrival",
      "on_shelf": "2025-03-11",                 // oldest held pair's arrival ('2024-12-31' = before the log)
      "on_shelf_days": 218,
      "style_sold_12m": 41,
      "sold_12m": 3,                            // this size, net, last 12 months
      "uk": "5.5" | null,                       // UK size (skumap.uksize); null = child size or none recorded
      "clearance": true }                       // unsold 9 months (see CLEARANCE)
  ],                                            // longest idle first; then most pairs
  "styles": [ { "groupid": "1017722-BEND", "imagename": "1017722.jpg" | null } ],
  "others": [ { "groupid": "1017722-BEND", "code": "1017722-BEND-40", "size": "40" } ]   // not held, ever arrived / sold
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
const { verifyToken } = require('../middleware/verifyToken');
const { query } = require('../database');
const { readSlowSizes, datedFromFirstArrival } = require('../utils/slowSizes');
const logger = require('../utils/logger');
const { ACTIVE_SQL } = require('../utils/sizePrice');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { today, cutoff, sizes } = await readSlowSizes();

    // NEVER SOLD, RESTOCKED ANYWAY (see the header): run a never-sold size's clock from its FIRST arrival when a restock moved it later.
    // The rule lives in utils/slowSizes.js → datedFromFirstArrival, shared with the Clearance decisions (utils/listDecision.js).
    await datedFromFirstArrival(sizes, today, cutoff);

    // Longest idle first, then longest on the shelf, then most pairs.
    sizes.sort((a, b) => b.idle_days - a.idle_days || b.on_shelf_days - a.on_shelf_days || b.units - a.units
      || a.code.localeCompare(b.code));

    // The extras for the style rows (see SLOW MOVERS AS STYLE ROWS) — three set queries, no N+1.
    const codes = sizes.map((x) => x.code);
    const groupids = [...new Set(sizes.map((x) => x.groupid))];
    const [imgQ, soldQ, othersQ, ukQ, ownQ] = await Promise.all([
      query(`SELECT groupid, NULLIF(TRIM(imagename), '') AS imagename FROM skusummary WHERE groupid = ANY($1::text[])`, [groupids]),
      query(`SELECT code, SUM(qty)::int AS q FROM sales
              WHERE code = ANY($1::text[]) AND solddate > (now() AT TIME ZONE 'Europe/London')::date - 365
              GROUP BY code`, [codes]),
      query(`SELECT DISTINCT m.groupid, m.code, SUBSTRING(m.code FROM '[^-]*$') AS size
               FROM skumap m
              WHERE m.groupid = ANY($1::text[]) AND m.code IS NOT NULL AND NOT (m.code = ANY($2::text[]))
                AND (EXISTS (SELECT 1 FROM incoming_stock i WHERE i.code = m.code)
                     OR EXISTS (SELECT 1 FROM sales s WHERE s.code = m.code))`, [groupids, codes]),
      query(`SELECT DISTINCT ON (code) code, TRIM(uksize) AS uk FROM skumap WHERE code = ANY($1::text[]) ORDER BY code`, [codes]),
      // A size's own Shopify price in force (utils/sizePrice.js, 2026-11-08) — shown on its tile so it reads as already dealt with.
      query(`SELECT code, price FROM (${ACTIVE_SQL}) a WHERE a.code = ANY($1::text[])`, [codes]),
    ]);
    const own = new Map(ownQ.rows.map((r) => [r.code, Number(r.price)]));
    const sold = new Map(soldQ.rows.map((r) => [r.code, Math.max(Number(r.q) || 0, 0)]));
    // "5.5 UK" -> "5.5"; a child size ("8 UK Child") or anything else -> null (the grid's Other column).
    const uk = new Map(ukQ.rows.map((r) => [r.code, (/^([0-9]+([.]5)?) UK$/.exec(r.uk || '') || [])[1] || null]));
    for (const x of sizes) {
      x.sold_12m = sold.get(x.code) || 0;
      x.uk = uk.get(x.code) || null;
      x.size_price = own.has(x.code) ? own.get(x.code) : null;
    }

    return res.json({ return_code: 'SUCCESS', today, cutoff, sizes,
      styles: imgQ.rows.map((r) => ({ groupid: r.groupid, imagename: r.imagename || null })),
      others: othersQ.rows.map((r) => ({ groupid: r.groupid, code: r.code, size: r.size })) });
  } catch (err) {
    logger.error('[analytics-slow-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load slow sizes' });
  }
});

module.exports = router;
