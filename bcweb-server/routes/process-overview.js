/*
=======================================================================================================================================
API Route: process_overview
=======================================================================================================================================
Method: GET
Purpose: Everything the Process page shows (owner, 2026-10-25 — a read-only map of blocks, each acted on in the existing screens):
           - prospects: one plain total of lines on the Prospects list (owner: no rating split, no "new this month").
           - the Google allowance in force, and whether its quarterly re-measure is due.
           - the NEW-SIZES GRID: every size of every style created in the last 90 days, put in one of five blocks on EACH channel
             (Amazon, Shopify, shop counter), with the block totals. The rules live in utils/processMap.js — read its header.
         Every size comes back (a quarter's new styles is a few hundred sizes), so the page groups and lists them without a second
         call. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "newDays": 90,
  "prospects": 42,
  "allowance": { "perUnit": 8.00, "spend": null, "units": null, "windowFrom": "2026-07-28", "windowTo": "2026-10-25",
                 "acceptedBy": "Andreas", "acceptedOn": "2026-10-25", "dueOn": "2027-01-23", "due": false } | null,
  "lines": { "AMZ": 3, "SHP": 11, "CM3": 3 },          // £ a unit that counts as good
  "styles": 30,                                         // new styles behind the sizes
  "summary": {
    "AMZ": { "multi_thin": { "sizes": 1, "units": 3, "profit": 4.20 }, "multi_good": {...}, "once_thin": {...},
             "once_good": {...}, "not_sold": {...} },
    "SHP": {...}, "CM3": {...}
  },
  "rows": [
    { "code": "0051793-38", "groupid": "0051793", "title": "Arizona Black", "brand": "Birkenstock", "size": "38",
      "created": "2026-10-02", "localStock": 2, "fbaStock": 0,
      "channels": {
        "AMZ": { "net": 0, "sold": 0, "profit": 0, "perUnit": null, "block": "not_sold" },
        "SHP": { "net": 1, "sold": 1, "profit": 12.40, "perUnit": 12.40, "block": "once_good" },
        "CM3": { ... } } }
  ]
}
  - units in summary are NET of returns; profit is £ earned on the positive rows (sales.profit already allows for returns).
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
const { NEW_DAYS, CHANNELS, BLOCKS, NEW_SIZES_SQL, lineFor, blockFor, readAllowance } = require('../utils/processMap');

router.use(verifyToken);

const round2 = (v) => Math.round(Number(v) * 100) / 100;

router.get('/', async (req, res) => {
  try {
    const [prospects, allowance, sizes] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM prospect`),
      readAllowance(query),
      query(NEW_SIZES_SQL, [NEW_DAYS]),
    ]);

    // With no allowance row Shopify falls back to the bare £3 — the page says so rather than hiding the grid.
    const lines = Object.fromEntries(CHANNELS.map((ch) => [ch, lineFor(ch, allowance ? allowance.perUnit : 0)]));

    const summary = Object.fromEntries(CHANNELS.map((ch) => [
      ch, Object.fromEntries(BLOCKS.map((b) => [b, { sizes: 0, units: 0, profit: 0 }])),
    ]));
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
        const block = blockFor(net, perUnit, lines[ch]);
        channels[ch] = { net, sold, profit, perUnit, block };

        const tot = summary[ch][block];
        tot.sizes += 1;
        tot.units += Math.max(net, 0);
        // Not sold carries no £: a size sold and returned nets to 0 units but keeps its positive-row profit, which isn't earnings.
        if (block !== 'not_sold') tot.profit = round2(tot.profit + profit);
      }
      return {
        code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, size: r.size, created: r.created_on,
        localStock: Number(r.local_stock), fbaStock: Number(r.fba_stock), channels,
      };
    });

    return res.json({
      return_code: 'SUCCESS',
      newDays: NEW_DAYS,
      prospects: prospects.rows[0].n,
      allowance,
      lines,
      styles: styles.size,
      summary,
      rows,
    });
  } catch (err) {
    logger.error('[process-overview] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the Process page' });
  }
});

module.exports = router;
