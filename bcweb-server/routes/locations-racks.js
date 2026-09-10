/*
=======================================================================================================================================
API Route: locations_racks
=======================================================================================================================================
Method: GET
Purpose: Every rack in the building, with how many units are sitting on it. The left-hand list of the Locations module. READ ONLY.

TWO SOURCES, FULL-JOINED, AND THAT IS THE POINT OF THE ROUTE. utils/locations.js sets out why they answer different questions:
  `location`   — the racks that EXIST. Authoritative, ~71 rows, each with its own printed label ('LC-58') and a pickorder.
  `localstock` — the racks that currently HOLD something, known only as a side effect of holding it.
Neither alone is the list this screen needs. Take only `location` and stock parked somewhere off-list becomes INVISIBLE — on a screen
whose whole job is "what is on the shelves", stock you cannot see is the one unacceptable outcome. Take only `localstock` and every
empty rack disappears, which is the failure inv-locations.js documents against itself (C1 has 22 racks; 5 held stock the day that note
was written). So: FULL OUTER JOIN, and nothing is dropped from either side.

`known` IS HOW THE TWO SIDES ARE TOLD APART. false means "stock is here but this is not a rack in the table" — most often `Ordered`,
which is not a place at all but a marker meaning the units are on their way from the supplier. The client shows those apart rather
than hiding them: a stray is exactly the sort of thing this screen should surface, and silently swallowing one is how a phantom
location survives for a year.

NOTHING IS EXCLUDED, unlike goods-in-shelves.js, which drops C3-Amazon/C3-Office/C3-Socks. That route answers "where can a delivery be
put", so a bay you never unpack onto is noise. This one answers "what is where", and the Amazon staging bay holds real stock that the
operator is entitled to look at.

JOINED CASE-INSENSITIVELY because nothing constrains the column: a stray 'C3-SHOP' exists alongside 'C3-Shop', and joining on the raw
string would split one rack into two half-populated rows. The name shown is the `location` table's spelling when there is one.

ORDERED BY pickorder, the racks' own walking sequence, so scrolling the list is walking the aisle. NULLs (a hand-added rack, or a
stray that only localstock knows) sort last rather than jumping the queue.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "racks": [
    { "location": "C3-Back-Stage", "barcode": "LC-98", "pickorder": 10, "units": 34, "known": true },
    ...
  ],
  "total": 71                                  // racks listed, not units
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

router.get('/', async (req, res) => {
  try {
    // SELLABLE STOCK ONLY, per the CLAUDE.md landmine: soft-deleted rows and qty<=0 rows are not stock in a place. `ordernum` is NOT
    // filtered here, and that is deliberate — a unit picked for a customer order is still physically on the shelf until it is packed,
    // so leaving it out would under-count every rack the picker has been down. Which units those are is the contents route's job.
    const result = await query(`
      WITH held AS (
        SELECT lower(btrim(location)) AS key,
               MIN(btrim(location))   AS shown,
               SUM(qty)::int          AS units
        FROM localstock
        WHERE COALESCE(deleted, 0) = 0 AND qty > 0
          AND location IS NOT NULL AND btrim(location) <> ''
        GROUP BY 1
      ),
      racks AS (
        SELECT lower(btrim(location)) AS key,
               btrim(location)        AS location,
               barcode,
               pickorder
        FROM location
        WHERE location IS NOT NULL AND btrim(location) <> ''
      )
      SELECT COALESCE(r.location, h.shown)   AS location,
             r.barcode,
             r.pickorder,
             COALESCE(h.units, 0)            AS units,
             (r.key IS NOT NULL)             AS known
      FROM racks r
      FULL OUTER JOIN held h ON h.key = r.key
      ORDER BY r.pickorder ASC NULLS LAST, 1 ASC
    `);

    const racks = result.rows.map((r) => ({
      location: r.location,
      barcode: r.barcode ? String(r.barcode).trim() : null,
      pickorder: r.pickorder === null ? null : Number(r.pickorder),
      units: Number(r.units) || 0,
      known: r.known === true,
    }));

    return res.json({ return_code: 'SUCCESS', racks, total: racks.length });
  } catch (err) {
    logger.error('[locations-racks] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load racks' });
  }
});

module.exports = router;
