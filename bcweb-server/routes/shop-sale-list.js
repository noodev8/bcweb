/*
=======================================================================================================================================
API Route: shop_sale_list
=======================================================================================================================================
Method: GET
Purpose: The catalogue for the Shop Sale screen (/shop-sale), in ONE call: every style (~300) with its picture, RRP and every size's
         free unit count. The client searches it itself (by name, brand, groupid or code) — small enough to ship once, as inv-styles does.

EVERY STYLE AND SIZE IS LISTED, IN STOCK OR NOT (owner, 2026-10-09: "got to be free to sell ... we can sell anything"). The shop can sell
a clearance pair kept back from the website, or something whose count is wrong. `free` never blocks a sale.

THE SHELVES ARE SHIPPED PER SIZE (`lines`) SO THE STOCK STAYS RIGHT (owner, 2026-10-09: "I want to make sure our stock is kept up to
date"). When a size is free on more than one shelf the screen asks which one the pair came off — nothing preselected, no shelf
favoured — so a later pick isn't sent to a shelf whose pair was already sold. One shelf: taken from there without asking. None: the
sale is booked with no stock move.

FREE = localstock where ordernum = '#FREE' AND deleted = 0 AND qty > 0 — the platform's one definition (CLAUDE.md).

PRICE. The shop charges RRP, not the website price (owner; docs/cm3-shop-plan.md §4.3), so `rrp` is the till default and `price`
(Shopify) is shipped only to be shown labelled as the website's. Both via safeNumeric — the legacy varchar columns can hold junk.
=======================================================================================================================================
Request Payload: none (GET)

Success Response:
{
  "return_code": "SUCCESS",
  "styles": [
    {
      "groupid": "D0772-16",
      "title": "Womens Remonte Fleece Lined Zip Boots Blue",   // title.shopifytitle; null if none
      "brand": "Remonte",
      "imagename": "womens-remonte-....jpg",                    // bare filename on images.brookfieldcomfort.com; null if none
      "rrp": 90.00,                                             // the shop price default; null if junk/blank
      "price": 81.00,                                           // the WEBSITE price, for reference only; null if junk/blank
      "codes": "D0772-16-37 D0772-16-38 …",                     // every size code, space-joined, so a typed code finds the style
      "sizes": [
        { "code": "D0772-16-37", "size": "37", "free": 0, "lines": [] },
        { "code": "D0772-16-40", "size": "40", "free": 2,
          "lines": [ { "location": "C1-04", "units": 1 }, { "location": "C3-Front-12", "units": 1 } ] }   // by location name
      ]
    }
  ]
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
const { safeNumeric } = require('../utils/sql');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Numeric sizes sort as numbers (37.5 between 37 and 38); anything else (UK '8', 'S', 'ONE') falls back to text after them.
function sizeKey(size) {
  return /^[0-9]+([.][0-9]+)?$/.test(size) ? [0, Number(size), ''] : [1, 0, size];
}
function bySize(a, b) {
  const ka = sizeKey(a.size), kb = sizeKey(b.size);
  return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2]);
}

router.get('/', async (req, res) => {
  try {
    // A style with no skumap rows has no size to sell, so it is left out (none on live data, 2026-10-09).
    const stylesRes = await query(`
      SELECT s.groupid, t.shopifytitle AS title, s.brand, s.imagename,
             ${safeNumeric('s.rrp')}          AS rrp,
             ${safeNumeric('s.shopifyprice')} AS price
      FROM skusummary s
      LEFT JOIN title t ON t.groupid = s.groupid
      WHERE EXISTS (SELECT 1 FROM skumap m WHERE m.groupid = s.groupid)
      ORDER BY t.shopifytitle NULLS LAST, s.groupid
    `);

    // EVERY size (skumap = the full range) with its free units by shelf. Size = the code's suffix after the last '-' (never
    // RIGHT(code,2) — CLAUDE.md).
    const sizesRes = await query(`
      WITH free AS (
        SELECT code, location, SUM(qty)::int AS units
        FROM localstock
        WHERE ordernum = '#FREE' AND COALESCE(deleted, 0) = 0 AND qty > 0
        GROUP BY code, location
      )
      SELECT m.groupid, m.code, SUBSTRING(m.code FROM '[^-]*$') AS size,
             COALESCE(json_agg(json_build_object('location', f.location, 'units', f.units) ORDER BY f.location)
                      FILTER (WHERE f.code IS NOT NULL), '[]') AS lines
      FROM skumap m
      LEFT JOIN free f ON f.code = m.code
      GROUP BY m.groupid, m.code
    `);

    const sizesByStyle = new Map();
    for (const r of sizesRes.rows) {
      if (!sizesByStyle.has(r.groupid)) sizesByStyle.set(r.groupid, []);
      const lines = (r.lines || []).map((l) => ({ location: l.location, units: Number(l.units) || 0 }));
      const free = lines.reduce((n, l) => n + l.units, 0);
      sizesByStyle.get(r.groupid).push({ code: r.code, size: r.size, free, lines });
    }

    const styles = stylesRes.rows.map((r) => {
      const sizes = (sizesByStyle.get(r.groupid) || []).sort(bySize);
      return {
        groupid: r.groupid,
        title: r.title || null,
        brand: r.brand || null,
        imagename: r.imagename || null,
        rrp: r.rrp === null ? null : Number(r.rrp),
        price: r.price === null ? null : Number(r.price),
        codes: sizes.map((s) => s.code).join(' '),
        sizes,
      };
    });

    return res.json({ return_code: 'SUCCESS', styles });
  } catch (err) {
    logger.error('[shop-sale-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the shop sale list' });
  }
});

module.exports = router;
