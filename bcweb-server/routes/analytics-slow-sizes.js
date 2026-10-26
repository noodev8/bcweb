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

STOCK = the utils/financeStock.js definition at code grain (local #FREE not deleted + amzfeed.amztotal), LIVE — one number, no Amazon
         split, the same as Slow and Sell-through.

CLEARANCE (2026-10-26) = idle since on or before today minus 9 calendar months (rows built in
         utils/slowSizes.js → readSlowSizes).

STYLE SOLD (12M) = net units of the whole STYLE in the last 12 months (was 90 days until 2026-10-15 — owner: "shall we say a
         year ... its basically saying the style has sold this many in this time"), so a dead size in a selling style (the Milano case) can be told apart from a
         dead style (which Slow already lists).

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
      "clearance": true }                       // unsold 9 months (see CLEARANCE)
  ]                                             // longest idle first; then most pairs
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
const { readSlowSizes } = require('../utils/slowSizes');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const { today, cutoff, sizes } = await readSlowSizes();

    // Longest idle first, then longest on the shelf, then most pairs.
    sizes.sort((a, b) => b.idle_days - a.idle_days || b.on_shelf_days - a.on_shelf_days || b.units - a.units
      || a.code.localeCompare(b.code));

    return res.json({ return_code: 'SUCCESS', today, cutoff, sizes });
  } catch (err) {
    logger.error('[analytics-slow-sizes] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load slow sizes' });
  }
});

module.exports = router;
