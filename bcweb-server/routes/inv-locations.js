/*
=======================================================================================================================================
API Route: inv_locations
=======================================================================================================================================
Method: GET
Purpose: The list of real shelf locations, for the phase-2 "add to a location" picker (docs/inventory-spec.md). When the operator drops
         a size on a shelf it isn't on yet, they pick from the racks that actually exist rather than typing a free-form string — a typo
         would create a phantom location nothing else references. ~50 distinct values, so we ship the lot once and the client filters.

         Derived from live localstock — the racks currently HOLDING stock. Grouped by AREA (C1 / C3-Front / C3-Back / C3-Shop / …) so
         the picker can offer them by zone, mirroring how the legacy screen's C1/C3 buttons carve the warehouse up. The area is just
         the location string's prefix; 'OTHER' catches anything that doesn't match (e.g. the stray 'Ordered' row, which is a marker
         meaning "on order", not a place) so nothing is silently dropped.

         KNOWN GAP, and this header used to state the opposite: there IS a config table, `location` — ~71 racks with their own
         barcodes and pickorder. Deriving from localstock instead means an EMPTY rack cannot be offered, because nothing is on it to
         reveal it: C1 has 22 racks and on the day this note was written 5 held stock. For "add to a location" that is a real if quiet
         limitation. GET /goods-in-shelves reads the authoritative table and is the shape to copy when this one is fixed; the grouping
         helpers both use now live in utils/locations.js, so the fix is a change of source, not a rewrite.

         Excludes soft-deleted rows and blank/NULL locations. Read-only; requires auth.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "areas": [
    { "area": "C3-Front", "locations": ["C3-Front-01", "C3-Front-02", ...] },
    { "area": "C3-Back",  "locations": [...] },
    ...
  ],
  "all": ["C1-Rack-05", "C3-Amazon", "C3-Back-01", ...]   // flat, sorted — for a plain typeahead
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
const { areaOf, AREA_ORDER } = require('../utils/locations');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const result = await query(
      `SELECT DISTINCT location
       FROM localstock
       WHERE COALESCE(deleted, 0) = 0 AND location IS NOT NULL AND btrim(location) <> ''
       ORDER BY location`
    );
    const all = result.rows.map((r) => r.location);

    // Group into areas, preserving the sorted order within each.
    const byArea = new Map();
    for (const loc of all) {
      const a = areaOf(loc);
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a).push(loc);
    }
    const areas = AREA_ORDER
      .filter((a) => byArea.has(a))
      .map((a) => ({ area: a, locations: byArea.get(a) }));

    return res.json({ return_code: 'SUCCESS', areas, all });
  } catch (err) {
    logger.error('[inv-locations] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load locations' });
  }
});

module.exports = router;
