/*
=======================================================================================================================================
API Route: process_overview
=======================================================================================================================================
Method: GET
Purpose: The new sizes and the prospects total, for the dashboard's Daily (New stuff = new sizes not sold yet; Prospects) and
         Reports → New Additions (the list). Built 2026-10-25 for the Today screen (/process), which was removed 2026-10-26 — the
         route kept its name; its blocks, allowance, summary and clearance went with the screen.
           - prospects: one plain total of lines on the Prospects list (the Archive left out).
           - NEW SIZES: every size of every style created in the last 90 days, with its sales on EACH channel (Amazon, Shopify, shop
             counter) and its stock. The rules live in utils/processMap.js — read its header.
           - Each size carries its STYLE's review (2026-10-27): reviewOn (the date set, or null), dueOn (that, or created + 20 days)
             and due; and onAmz — the size has an amzfeed listing.
         Every size comes back (a quarter's new styles is a few hundred sizes), so the screens group and count them without a second
         call. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "newDays": 90,
  "prospects": 42,
  "styles": 30,                                         // new styles behind the sizes
  "rows": [
    { "code": "0051793-38", "groupid": "0051793", "title": "Arizona Black", "brand": "Birkenstock", "size": "38",
      "created": "2026-10-02", "localStock": 2, "fbaStock": 0, "onAmz": false,
      "reviewOn": null, "dueOn": "2026-10-22", "due": true, "ageDays": 25,        // days since created (London)
      "channels": {
        "AMZ": { "net": 0, "sold": 0, "profit": 0, "perUnit": null },
        "SHP": { "net": 1, "sold": 1, "profit": 12.40, "perUnit": 12.40 },
        "CM3": { ... } } }
  ]
}
  - net is units NET of returns; profit is £ earned on the positive rows (sales.profit already allows for returns).
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
const { NEW_DAYS, CHANNELS, NEW_SIZES_SQL } = require('../utils/processMap');

router.use(verifyToken);

const round2 = (v) => Math.round(Number(v) * 100) / 100;

router.get('/', async (req, res) => {
  try {
    const [prospects, sizes] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM prospect WHERE archived_at IS NULL`),
      query(NEW_SIZES_SQL, [NEW_DAYS]),
    ]);

    const styles = new Set();

    const rows = sizes.rows.map((r) => {
      styles.add(r.groupid);
      const channels = {};
      for (const ch of CHANNELS) {
        const s = r.sales[ch] || {};
        const net = Number(s.net || 0);
        const sold = Number(s.sold || 0);
        const profit = round2(s.profit || 0);
        const perUnit = sold > 0 ? round2(profit / sold) : null;
        channels[ch] = { net, sold, profit, perUnit };
      }
      return {
        code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, size: r.size, created: r.created_on,
        localStock: Number(r.local_stock), fbaStock: Number(r.fba_stock), onAmz: r.on_amz === true,
        reviewOn: r.review_on || null, dueOn: r.due_on, due: r.due === true, ageDays: Number(r.age_days), channels,
      };
    });

    return res.json({
      return_code: 'SUCCESS',
      newDays: NEW_DAYS,
      prospects: prospects.rows[0].n,
      styles: styles.size,
      rows,
    });
  } catch (err) {
    logger.error('[process-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the new sizes' });
  }
});

module.exports = router;
