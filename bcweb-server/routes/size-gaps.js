/*
=======================================================================================================================================
API Route: size_gaps
=======================================================================================================================================
Method: GET
Purpose: THE SIZE GAPS LIST (owner, 2026-11-08) — sizes missing from styles we already sell, as SKU-level prospects. Every rule lives
         in utils/sizeGaps.js (read its header): the brand range (size_gap_range: Lunar UK 3–9; Rieker / Remonte / Strive Womens EU 36–42 — a size = the number at the end
         of the code), what a gap is (not on our system, or
         empty with nothing on order and no net sale in 90 days), Can't get left out, the best-size order, and the per-size
         marks (Park 3 / 6 months, Not made, Ordered).
         ONE route for the screen (/prospects/size-gaps) AND the "Size gaps · n" link on Prospects — the link reads counts.open_styles,
         so the count and the list can never disagree. Cheap (~0.2s for Lunar), and Prospects loads it as its own request so its own
         list never waits on it. THE ORDER = each style's BEST SIZE by 12-month profit a pair (owner, 2026-11-09), returned as best
         + each size's per_pair so the screen can show why a style is where it is.
         READ-ONLY. Requires auth.
=======================================================================================================================================
Request Payload: none

Success Response:
{
  "return_code": "SUCCESS",
  "today": "2026-11-08",
  "ranges": [ { "brand": "Lunar", "who": "Womens", "uk_from": 3, "uk_to": 9, "sizing": "UK" } ],   // uk_* = THE size (UK or EU)
  "styles": [ { "groupid": "FLE030-IVES-BLACKSOLE", "title": "...", "brand": "Lunar", "imagename": "x.jpg" | null,
                "asin": "B0..." | null, "sizing": "UK" | "EU", "best": { "per_pair": 12.73, "size": "8 UK" } | null,
                "sizes": [ { "uk": 9, "code": null, "state": "gap", "is_new": true, "units": 0, "on_order": 0, "last_sale": null, "per_pair": null,
                             "mark": null | { "mark": "park"|"notmade"|"ordered", "until": "2027-02-08"|null,
                                              "marked_on": "2026-11-08", "marked_by": "Andreas" } } ] } ],
  "counts": { "open_styles": 33, "open_sizes": 88, "park": 0, "ordered": 0, "notmade": 0 }
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
const { readSizeGaps } = require('../utils/sizeGaps');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const out = await readSizeGaps();
    return res.json({ return_code: 'SUCCESS', ...out });
  } catch (err) {
    logger.error('[size-gaps] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the size gaps' });
  }
});

module.exports = router;
