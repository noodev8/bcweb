/*
=======================================================================================================================================
API Route: process_overview
=======================================================================================================================================
Method: GET
Purpose: The NEW SKUS and the prospects total, for the dashboard's Daily (New stuff = new SKUs sold, a %; Prospects) and Reports →
         New Additions (the list behind that %). Built 2026-10-25 for the Today screen (/process), removed 2026-10-26 — the route kept
         its name.
           - prospects: one plain total of lines on the Prospects list (the Archive left out).
           - rows: every SKU FIRST booked in on Goods In in the last 90 days, with its net sales per channel since that first arrival
             (AMZ, SHP, CM3, EBY), its stock and both channels' PRICE DUE. Rules: utils/processMap.js → NEW_SKUS_SQL — read its header.
           - newSkus: Daily's figure, counted HERE from those rows (sold = net units over every channel > 0), so the tile and the
             screen count the same list (owner, 2026-11-05).
         Every SKU comes back (a quarter's new SKUs is a couple of hundred), so the screens group and count without a second call.
         READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "newDays": 90,
  "prospects": 42,
  "newSkus": { "total": 171, "sold": 43 },              // Daily's New stuff: sold ÷ total
  "styles": 43,                                         // styles behind the SKUs
  "rows": [
    { "code": "GLB123-TAN-04", "groupid": "GLB123-TAN", "title": "…", "brand": "Lunar", "size": "04",
      "firstIn": "2026-09-11", "ageDays": 55, "daysLeft": 35,     // first Goods In arrival; 90 − age = days before it leaves the list
      "localStock": 0, "fbaStock": 1, "bought": 2, "onAmz": true,
      "amzPrice": 39.99, "amzReview": null, "amzDue": true, "amzSlider": false,                       // Amazon, per size
      "rrp": 49.95, "imagename": "glb123-tan.jpg",       // the style's RRP and picture (per style)
      "shpLive": true, "shpPrice": 44.95, "shpReview": "2026-11-08", "shpDue": false, "shpSlider": false,   // Shopify, per style
      "net": 1,                                         // net units over every channel — sold = net > 0
      "channels": { "AMZ": { "net": 1, "sold": 1 }, "SHP": { … }, "CM3": { … }, "EBY": { … } } }
  ],
  "others": [                                           // the same styles' OTHER sizes — size run only, never counted
    { "groupid": "CAPRI4-BLACK", "code": "CAPRI4-BLACK-37", "size": "37", "firstIn": "2026-07-24" }   // null = never booked in
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
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { NEW_DAYS, CHANNELS, NEW_SKUS_SQL, OTHER_SIZES_SQL } = require('../utils/processMap');

router.use(verifyToken);

const round2 = (v) => Math.round(Number(v) * 100) / 100;
const money = (v) => (v === null || v === undefined ? null : round2(v));

router.get('/', async (req, res) => {
  try {
    const [prospects, skus] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM prospect WHERE archived_at IS NULL`),
      query(NEW_SKUS_SQL, [NEW_DAYS]),
    ]);

    const styles = new Set();
    let sold = 0;
    const rows = skus.rows.map((r) => {
      styles.add(r.groupid);
      const channels = {};
      let net = 0;
      for (const ch of CHANNELS) {
        const s = r.sales[ch] || {};
        channels[ch] = { net: Number(s.net || 0), sold: Number(s.sold || 0) };
        net += channels[ch].net;
      }
      if (net > 0) sold += 1;   // the NEW_SKUS rule: netted a sale over every channel together
      const ageDays = Number(r.age_days);
      return {
        code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, size: r.size,
        firstIn: r.first_in, ageDays, daysLeft: NEW_DAYS - ageDays,
        localStock: Number(r.local_stock), fbaStock: Number(r.fba_stock), bought: Number(r.bought),
        onAmz: r.on_amz === true, amzPrice: money(r.amz_price), amzReview: r.amz_review || null,
        amzDue: r.amz_due === true, amzSlider: r.amz_slider === true,
        rrp: money(r.rrp), imagename: r.imagename || null,
        shpLive: r.shp_live === true, shpPrice: money(r.shp_price), shpReview: r.shp_review || null,
        shpDue: r.shp_due === true, shpSlider: r.shp_slider === true,
        net, channels,
      };
    });

    // The styles' other sizes, for the size run only (never counted) — needs the new codes, so it runs after.
    const others = rows.length
      ? (await query(OTHER_SIZES_SQL, [rows.map((r) => r.code)])).rows.map((o) => ({
        groupid: o.groupid, code: o.code, size: o.size, firstIn: o.first_in || null,
      }))
      : [];

    return res.json({
      return_code: 'SUCCESS',
      newDays: NEW_DAYS,
      prospects: prospects.rows[0].n,
      newSkus: { total: rows.length, sold },
      styles: styles.size,
      rows,
      others,
    });
  } catch (err) {
    logger.error('[process-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the new SKUs' });
  }
});

module.exports = router;
