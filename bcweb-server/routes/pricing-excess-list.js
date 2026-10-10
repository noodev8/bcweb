/*
=======================================================================================================================================
API Route: pricing_excess_list
=======================================================================================================================================
Method: GET
Purpose: Repricing — the Shopify list behind one STOCK DEPTH tile on Reports → Stock vs Sales (owner, 2026-10-10: "get the list up in
         the repricer"). Over a year is the clearance pile; a tile's "Reprice" link opens this list so the styles can be cut in bulk
         with the usual drill, bulk bar and live Shopify push — instead of one style at a time from the row menu.

         SAME STYLES AS THE TILE. Membership comes from utils/stockDepth.js — the very function the depth card reads — so a tile
         showing 51 styles opens a list of those 51 (Due switch off; Due on hides the ones with a review date still ahead, as on every
         Repricing list). Only styles WITH excess are listed, matching the tiles.

         ONE UNSPLIT LIST, like a status list: no Selling / Stuck bars. NOT filtered by lead channel (unlike the status lists): excess
         is all-channel stock, and the tile counts every style.

         Stock column = the depth card's units (local #FREE + amzfeed.amztotal), not local stock alone, so the list explains the tile.
         Order: deepest first — no sales at the top, then by months of stock, then biggest pile — the depth card's own order.

         NO ENTRY ON THE REPRICING SCREEN (owner, 2026-10-10: "in case we mess navigation"). The only way in is the link on Stock vs
         Sales; there is no tab or tile for it on /segments.

Requires auth. READ-ONLY.
=======================================================================================================================================
Request: GET /pricing-excess-list?band=over12[&parked=include][&limit=N]
  band     required — under6 | 6to12 | over12 | total (total = every style with excess). Anything else -> MISSING_FIELDS.
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "band": "over12",
  "total": 51,                 // styles listed (pre-cap; parked included only with ?parked=include)
  "truncated": false,
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "brand": "…", "price": 49.95, "rrp": 65, "stock": 15, "u30": 0,
              "months": null, "excess": 15, "match_amazon": false, "next_review": null, "parked": false }, ... ]
}
"months" is null for a style with no sales. u30 = Shopify units in 30 days, as on the other Repricing lists.
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const { parseListLimit } = require('../utils/listLimit');
const { loadStockDepth } = require('../utils/stockDepth');
const logger = require('../utils/logger');

router.use(verifyToken);

const BANDS = ['under6', '6to12', 'over12', 'total'];

router.get('/', async (req, res) => {
  try {
    const band = typeof req.query.band === 'string' ? req.query.band.trim() : '';
    if (!BANDS.includes(band)) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'band must be one of ' + BANDS.join(', ') });
    }
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // Membership + order from the shared rule (see header), then the pricing fields for just those styles in one query.
    const depth = await loadStockDepth();
    const members = depth.rows
      .filter((r) => r.excess > 0 && (band === 'total' || r.band === band))
      .sort((a, b) => (b.months ?? Infinity) - (a.months ?? Infinity) || b.units - a.units || a.groupid.localeCompare(b.groupid));
    if (members.length === 0) {
      return res.json({ return_code: 'SUCCESS', band, total: 0, truncated: false, rows: [] });
    }

    const r = await query(`
      WITH win AS (   -- Shopify units in the last 30 days — the same measure and filters the other Repricing lists use
        SELECT groupid, SUM(qty) AS u30 FROM sales
        WHERE channel='SHP' AND qty>0 AND soldprice>0 AND solddate >= CURRENT_DATE - 30 AND groupid = ANY($1::text[])
        GROUP BY groupid
      )
      SELECT ss.groupid,
             ${safeNumeric('ss.shopifyprice')} AS price,
             ${safeNumeric('ss.rrp')} AS rrp,              -- for the bulk bar's "Reset to RRP"
             COALESCE(w.u30, 0) AS u30,
             ss.match_amazon_price AS match_amazon,
             NULLIF(TRIM(ss.brand), '') AS brand,
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked
      FROM skusummary ss
      LEFT JOIN win w ON w.groupid = ss.groupid
      WHERE ss.groupid = ANY($1::text[])
    `, [members.map((m) => m.groupid)]);
    const byId = new Map(r.rows.map((x) => [x.groupid, x]));

    // Keep the depth order; drop parked styles unless asked for (the Due switch), and any style with no skusummary row.
    const listed = members.filter((m) => {
      const p = byId.get(m.groupid);
      return p && (includeParked || !p.parked);
    });
    const rows = listed.slice(0, limit).map((m, i) => {
      const p = byId.get(m.groupid);
      return {
        rank: i + 1,
        groupid: m.groupid,
        title: m.title || null,
        brand: p.brand || m.brand || null,
        price: p.price === null || p.price === undefined ? null : Number(p.price),   // null when the legacy VARCHAR held junk/blank
        rrp: p.rrp === null || p.rrp === undefined ? null : Number(p.rrp),
        stock: m.units,
        u30: Number(p.u30),
        months: m.months,
        excess: m.excess,
        match_amazon: p.match_amazon === true,
        next_review: p.next_review || null,
        parked: p.parked === true,
      };
    });

    return res.json({ return_code: 'SUCCESS', band, total: listed.length, truncated: rows.length < listed.length, rows });
  } catch (err) {
    logger.error('[pricing-excess-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load excess list' });
  }
});

module.exports = router;
