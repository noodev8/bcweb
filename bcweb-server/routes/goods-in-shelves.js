/*
=======================================================================================================================================
API Route: goods_in_shelves
=======================================================================================================================================
Method: GET
Purpose: Every rack a delivery can be put on. READ ONLY.

READS THE `location` TABLE, NOT `localstock`, and that is the whole point of the route existing. localstock only knows the racks that
currently HOLD something, so an empty rack is invisible to it — and an empty rack is exactly where a delivery goes. C1 has 22 racks;
on the day this was written 5 of them held stock, so a localstock-derived picker offered 5 and hid 17 real shelves. See the header of
utils/locations.js for the two sources and which question each answers.

ORDERED BY `pickorder`, the racks' own walking sequence (Stage 10 -> C3 30 -> C1 40 -> Shop 60), then by name. Not alphabetically, and
not by the Inventory picker's AREA_ORDER: the operator is standing in the building, and the order the racks are walked is the order
they are thought about. Areas are still grouped so the picker can offer them by zone, but the ZONES come out in pickorder order too
rather than in a list someone typed.

THREE RACKS ARE EXCLUDED and they are listed, with reasons, at NOT_A_DESTINATION below — the FBA staging bay plus two bays a delivery
is never unpacked onto. Everything else in `location` is offered. Note what is NOT in that table at all: 'Ordered', which turns up in
localstock.location and is a marker meaning "on order" rather than somewhere you can put a shoe. Reading the authoritative table is
what keeps strays like it out, which is why the exclusion list is three deliberate entries and not a growing list of typos.

`barcode` is the rack's OWN scannable label ('LC-58'), and it is load-bearing: the Goods In screen matches a scan against it so the
operator can point the gun at the rack to set the destination instead of reaching for the dropdown. That match happens client-side
against this response, so a rack scan costs no round-trip — which is the only reason it is fast enough to be worth doing.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "areas": [
    { "area": "C3-Back", "locations": [ { "location": "C3-Back-Stage", "barcode": "LC-98", "pickorder": 10 }, ... ] },
    ...
  ],
  "all": ["C3-Back-Stage", "C3-Back-01", ...]    // flat, in the same pickorder sequence
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
const { areaOf } = require('../utils/locations');
const logger = require('../utils/logger');

router.use(verifyToken);

// Racks that exist in `location` but are never somewhere a DELIVERY is put, so they are not offered as a destination:
//   C3-Amazon   the FBA staging bay. A unit reaches it by being claimed against an Amazon order line and Goods In routes it there on
//               its own; offering it manually would let local stock be dropped into the outbound bay by accident, and nothing
//               downstream would question it. (Matches AMAZON_SHELF in utils/pick.js.)
//   C3-Office   } not shelving a box gets unpacked onto (owner). Both hold stock that got there some other way, and both being in the
//   C3-Socks    } picker only made the list longer to walk past.
// Named individually rather than by zone: everything else in this table is a real rack, including UKD-Tests, and a prefix rule would
// eventually take out something the owner does want. Compared lower-cased — nothing constrains the column's casing.
const NOT_A_DESTINATION = ['C3-Amazon', 'C3-Office', 'C3-Socks'];

router.get('/', async (req, res) => {
  try {
    // pickorder can be NULL on a hand-added row; those sort last rather than first, so a rack with no walking position never jumps
    // to the top of the picker.
    const result = await query(`
      SELECT location, barcode, pickorder
      FROM location
      WHERE location IS NOT NULL AND btrim(location) <> ''
        AND NOT (lower(btrim(location)) = ANY($1))
      ORDER BY pickorder ASC NULLS LAST, location ASC
    `, [NOT_A_DESTINATION.map((l) => l.toLowerCase())]);

    const rows = result.rows.map((r) => ({
      location: r.location.trim(),
      barcode: r.barcode || null,
      pickorder: r.pickorder === null ? null : Number(r.pickorder),
    }));

    // Group into zones, preserving the pickorder sequence within each. A Map keeps insertion order, so the zones come out ordered by
    // the pickorder of their first rack — no second sort, and no hand-written zone order to drift.
    const byArea = new Map();
    for (const r of rows) {
      const a = areaOf(r.location);
      if (!byArea.has(a)) byArea.set(a, []);
      byArea.get(a).push(r);
    }
    // ...with one hand-placed exception: OTHER is the catch-all, so it goes last whatever its racks' pickorder says. Today it holds
    // only UKD-Tests, which sorts last anyway; the rule is here so the next odd rack can't land the group mid-shelving.
    const areas = [...byArea.entries()]
      .map(([area, locations]) => ({ area, locations }))
      .sort((a, b) => Number(a.area === 'OTHER') - Number(b.area === 'OTHER'));

    return res.json({ return_code: 'SUCCESS', areas, all: rows.map((r) => r.location) });
  } catch (err) {
    logger.error('[goods-in-shelves] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load shelves' });
  }
});

module.exports = router;
