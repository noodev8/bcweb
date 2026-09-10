/*
=======================================================================================================================================
API Route: locations_stock
=======================================================================================================================================
Method: POST
Purpose: What is on ONE rack. The right-hand panel of the Locations module. READ ONLY.

COLLAPSED SERVER-SIDE, by code AND state. localstock stores the same fact two ways depending on how it was scanned in — two pairs on
one shelf can be one row of qty 2 or two rows of qty 1 — so the raw rows would print 'Arizona 38' twice and make the operator add up.
InvLocations collapses this in the browser; done here instead because this screen shows a whole rack rather than one size, so it is
the difference between a 12-line panel and a 40-line one.
GROUPED BY STATE AS WELL AS CODE, never by code alone. A shelf holding one free pair and one picked pair must show two lines: merged,
it would read as 2 available when only 1 is takeable, and that is the one error a "go and fetch it" screen cannot afford.
Every underlying localstock id is carried on the line, so the write that follows can adjust those exact rows rather than re-finding
them by description.

STATE uses the same three rules as inv-stock.js, deliberately identical so the two screens can never disagree about a unit:
  PICKED  committed to a customer order (ordernum <> '#FREE'), still physically on the shelf until it is packed
  AMZ     allocated to Amazon. Present-but-flagged, NOT unavailable — an amz unit can still be picked for a Shopify customer, so the
          client must not grey it out
  FREE    unallocated and unpicked, the normal case

MATCHED CASE-INSENSITIVELY, same reason as locations-racks.js: nothing constrains the column's casing, and a rack the list shows as
one entry must not come back half-empty because the stock on it was written 'C3-SHOP'.

LEFT JOINs to skumap and title, never inner: a localstock row whose code has no variant or no title still appears, with the name
blank. A unit the operator cannot see is far worse than one with a missing label — the same call inv-stock.js makes.
=======================================================================================================================================
Request Payload:
{
  "location": "C3-Front-05"                    // string, required — the rack to read
}

Success Response:
{
  "return_code": "SUCCESS",
  "location": "C3-Front-05",                   // as matched, so the client can trust what it is showing
  "lines": [
    { "key": "1005292-ARIZONA-38|FREE", "code": "1005292-ARIZONA-38", "groupid": "1005292-ARIZONA",
      "title": "Arizona Birko-Flor Black", "size": "38", "uksize": "5", "qty": 2, "state": "FREE",
      "ids": ["WEB-1a2b…", "WEB-3c4d…"] },
    ...
  ],
  "units": 14                                  // total on the rack, so the header cannot disagree with the list
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"       -- no location given
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

router.post('/', async (req, res) => {
  try {
    const location = typeof req.body?.location === 'string' ? req.body.location.trim() : '';
    if (!location) return res.json({ return_code: 'MISSING_FIELDS', message: 'location is required' });

    // Ordered by size within a style so a rack reads like the shelf itself. Numeric-aware: RIGHT(code,2) is text, so a plain sort
    // would put '40' before '5' — the same cast inv-stock.js uses, with non-numeric sizes pushed to the end rather than dropped.
    const result = await query(`
      SELECT l.id,
             l.code,
             l.groupid,
             RIGHT(l.code, 2)  AS size,
             m.uksize,
             t.shopifytitle    AS title,
             l.qty,
             CASE
               WHEN l.ordernum <> '#FREE' THEN 'PICKED'
               WHEN l.allocated = 'amz'   THEN 'AMZ'
               ELSE 'FREE'
             END AS state
      FROM localstock l
      LEFT JOIN skumap m ON m.code = l.code
      LEFT JOIN title  t ON t.groupid = l.groupid
      WHERE lower(btrim(l.location)) = lower($1)
        AND COALESCE(l.deleted, 0) = 0
        AND l.qty > 0
      ORDER BY COALESCE(t.shopifytitle, l.groupid, l.code) ASC,
               (CASE WHEN RIGHT(l.code, 2) ~ '^[0-9]+$' THEN RIGHT(l.code, 2)::int ELSE 999 END) ASC,
               l.id ASC
    `, [location]);

    // Collapse in the order the query returned, so the lines keep the shelf's own sequence. A Map preserves insertion order.
    const byKey = new Map();
    for (const r of result.rows) {
      const key = `${r.code}|${r.state}`;
      const hit = byKey.get(key);
      const qty = Number(r.qty) || 0;
      if (hit) {
        hit.qty += qty;
        hit.ids.push(r.id);
      } else {
        byKey.set(key, {
          key,
          code: r.code,
          groupid: r.groupid || null,
          title: r.title || null,
          size: r.size || '',
          uksize: r.uksize || null,
          qty,
          state: r.state,
          ids: [r.id],
        });
      }
    }
    const lines = [...byKey.values()];

    return res.json({
      return_code: 'SUCCESS',
      location,
      lines,
      units: lines.reduce((n, l) => n + l.qty, 0),
    });
  } catch (err) {
    logger.error('[locations-stock] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load what is on that rack' });
  }
});

module.exports = router;
