/*
=======================================================================================================================================
API Route: inv_locations
=======================================================================================================================================
Method: GET
Purpose: The list of real shelf locations, for the phase-2 "add to a location" picker (docs/inventory-spec.md). When the operator drops
         a size on a shelf it isn't on yet, they pick from the racks that actually exist rather than typing a free-form string — a typo
         would create a phantom location nothing else references. ~50 distinct values, so we ship the lot once and the client filters.

         Derived from live localstock (the racks currently holding stock), not a fixed config table — there is none. Grouped by AREA
         (C1 / C3-Front / C3-Back / C3-Shop / …) so the picker can offer them by zone, mirroring how the legacy screen's C1/C3 buttons
         carve the warehouse up. The area is just the location string's prefix; 'OTHER' catches anything that doesn't match (e.g. the
         stray 'Ordered' row) so nothing is silently dropped.

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
const logger = require('../utils/logger');

router.use(verifyToken);

// Bucket a location string into a warehouse zone by its prefix. Kept in one place so the picker's grouping can't drift from the areas
// the operator knows. Case-insensitive because nothing constrains the column (a stray 'C3-SHOP' exists alongside 'C3-Shop').
function areaOf(location) {
  const l = location.toLowerCase();
  if (l.startsWith('c1-')) return 'C1';
  if (l.startsWith('c3-front-')) return 'C3-Front';
  if (l.startsWith('c3-back-')) return 'C3-Back';
  if (l.startsWith('c3-amazon')) return 'C3-Amazon';
  if (l.startsWith('c3-shop')) return 'C3-Shop';
  return 'OTHER';
}

// The order areas appear in the picker — the busy shelving first, the Amazon bay and stray bucket last.
const AREA_ORDER = ['C3-Front', 'C3-Back', 'C1', 'C3-Shop', 'C3-Amazon', 'OTHER'];

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
