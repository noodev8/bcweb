/*
=======================================================================================================================================
API Route: pricing_sitting_list
=======================================================================================================================================
Method: GET
Purpose: Repricing — the SITTING styles from Reports → Selling vs Sitting as a Shopify list, to clear them (owner, 2026-10-10: "Let's go
         with SHOPIFY only. My intention is to clear the crap. I will want to be able to price them"). The "Reprice these" link on the
         sitting list opens it, so the styles can be cut in bulk with the usual drill, bulk bar and live Shopify push — instead of one
         style at a time.

         SAME STYLES AS STOCK VS SALES. Membership and order come from utils/stockSitting.js — the very function the Sitting box and
         list read — so a list showing 52 styles there opens these 52 here (Due switch off; Due on hides the ones with a review date
         still ahead, as on every Repricing list — at build time 49 of 52 had one).

         SHOPIFY ONLY (owner's call — clearance is done on Shopify). Styles not live on Shopify (skusummary.shopify <> 1) are left off:
         a Shopify price can't clear them. At build time all 52 were live, so the list matched the box exactly; if that ever stops being
         true the two counts differ by exactly those styles.

         ONE UNSPLIT LIST, like a status list: no Selling / Stuck bars (every row has sold nothing in 60 days — the split would be
         empty on one side). NOT filtered by lead channel: sitting is all-channel, and the box counts every style.

         Stock column = the sitting list's units (local #FREE + amzfeed.amztotal), not local stock alone, so the list explains the box.
         Order: most pairs first — the sitting list's own order.

         NO ENTRY ON THE REPRICING SCREEN — same call as the excess version this replaces (owner, 2026-10-10: "in case we mess
         navigation"). The only way in is the link on Selling vs Sitting; there is no tab or tile for it on /segments.

Requires auth. READ-ONLY.
=======================================================================================================================================
Request: GET /pricing-sitting-list[?parked=include][&limit=N]
  limit    safety cap only (utils/listLimit.js, default 100 / max 500).

Success Response:
{
  "return_code": "SUCCESS",
  "total": 52,                 // styles listed (pre-cap; parked included only with ?parked=include)
  "truncated": false,
  "rows": [ { "rank": 1, "groupid": "…", "title": "…", "brand": "…", "price": 49.95, "rrp": 65, "stock": 24, "u30": 0,
              "last_sale": "2026-06-02" | null, "idle_days": 130 | null,
              "match_amazon": false, "next_review": "2026-12-01" | null, "parked": true }, ... ]
}
u30 = Shopify units in 30 days, as on the other Repricing lists (always 0 here — kept for the shared row shape).
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
const { safeNumeric } = require('../utils/sql');
const { parseListLimit } = require('../utils/listLimit');
const { loadStockSplit } = require('../utils/stockSitting');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const limit = parseListLimit(req.query.limit);
    const includeParked = req.query.parked === 'include';

    // Membership + order from the shared rule (see header), then the pricing fields for just those styles in one query.
    const { styles: members } = await loadStockSplit();
    if (members.length === 0) {
      return res.json({ return_code: 'SUCCESS', total: 0, truncated: false, rows: [] });
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
             ss.next_shopify_price_review::text AS next_review,                 -- text, never a pg DATE (CLAUDE.md: BST day-shift)
             COALESCE(ss.next_shopify_price_review > CURRENT_DATE, false) AS parked
      FROM skusummary ss
      LEFT JOIN win w ON w.groupid = ss.groupid
      WHERE ss.groupid = ANY($1::text[])
        AND ss.shopify = 1                                                      -- Shopify only (see header)
    `, [members.map((m) => m.groupid)]);
    const byId = new Map(r.rows.map((x) => [x.groupid, x]));

    // Keep the sitting order; drop styles not on Shopify, and parked ones unless asked for (the Due switch).
    const listed = members.filter((m) => {
      const p = byId.get(m.groupid);
      return p && (includeParked || !p.parked);
    });
    const rows = listed.slice(0, limit).map((m, i) => {
      const p = byId.get(m.groupid);
      return {
        rank: i + 1,
        groupid: m.groupid,
        title: m.title,
        brand: m.brand,
        price: p.price === null || p.price === undefined ? null : Number(p.price),   // null when the legacy VARCHAR held junk/blank
        rrp: p.rrp === null || p.rrp === undefined ? null : Number(p.rrp),
        stock: m.units,
        u30: Number(p.u30),
        last_sale: m.last_sale,
        idle_days: m.idle_days,
        match_amazon: p.match_amazon === true,
        next_review: p.next_review || null,
        parked: p.parked === true,
      };
    });

    return res.json({ return_code: 'SUCCESS', total: listed.length, truncated: rows.length < listed.length, rows });
  } catch (err) {
    logger.error('[pricing-sitting-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sitting list' });
  }
});

module.exports = router;
