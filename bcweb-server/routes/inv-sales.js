/*
=======================================================================================================================================
API Route: inv_sales
=======================================================================================================================================
Method: GET
Purpose: Recent sales of one style for the Inventory screen — "is this thing actually moving, what did it go for, and did we make
         anything on it" — answerable while the operator is still looking at the stock position, without changing screens (owner).

WHY THIS IS NOT pricing-sales. That route is deliberately Shopify-only (`channel='SHP'`) because it is evidence for setting a Shopify
price. Inventory is not a pricing screen: the question here is whether the product is selling AT ALL, so this returns EVERY channel in
one merged feed with the channel on each row. There are THREE live channels, not two — AMZ (9627 sales), SHP (7704) and CM3 (133, last
sale 2026-07-13). A two-way Shopify/Amazon toggle would have hidden CM3 entirely, which is why there is no channel filter at all
(owner, 2026-07-20). Whoever wants channel-filtered evidence has the pricing drills.

RETURNS ARE INCLUDED, not filtered out (owner). pricing-sales excludes them (`qty > 0 AND soldprice > 0`) because a return is not
evidence about a price. Here they are exactly the thing worth seeing: three returns in the last ten sales is a fact about the product
that a "sales" list hiding them would misrepresent. A return is flagged with `isReturn` so the UI can mark it rather than silently mix
it in — its `profit` is normally negative (83 of the 90 return rows on live data), which is the reversal of the original margin.

BOUNDING: most-recent-N, not a date window — same reasoning as pricing-sales. Sales are dense on a hot style, so a fixed cap gives a
predictable payload and always shows the latest activity. Fetch limit+1 to detect truncation without a second COUNT.

Schema notes (CLAUDE.md): `solddate` is a DATE, `ordertime` a 'HH:MM' VARCHAR, so newest-first is (solddate, ordertime, id) DESC.
`soldprice` and `profit` are NUMERIC and need no safeNumeric guard (unlike the skusummary varchar price columns). `profit` is computed
downstream by the owner's P&L pipeline and is 100% populated — surfaced as-is, never re-derived here. Size is shown using skumap's
DISPLAY SIZE (optionsize, minus its '<seq>--' ordering prefix), matching the size grid above it, so a UK-sized brand reads "5 UK"
rather than a bogus "05 EU". Requires auth.
=======================================================================================================================================
Request Query Params:
  groupid (string, required)
  limit   (int, optional)   - max rows to return; default 20, clamped to [1, 100]

Success Response:
{
  "return_code": "SUCCESS",
  "groupid": "1005292-ARIZONA",
  "rows": [
    {
      "solddate": "2026-07-18", "ordertime": "18:11", "channel": "SHP",
      "sizeDisplay": "39 EU / 6 UK", "qty": 1, "soldprice": 57.00, "profit": 3.01, "isReturn": false
    },
    ... // newest first
  ],
  "limit": 20,
  "truncated": true         // more than `limit` rows exist; UI says "showing last N"
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
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

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

function toIsoDate(d) {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

router.get('/', async (req, res) => {
  try {
    const groupid = (req.query.groupid || '').toString().trim();
    if (!groupid) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid is required' });
    }
    // Default 20 — this is a glance-at-it panel, not a history report. Clamped so a client cannot dump a busy style's whole life.
    let limit = Number.parseInt(req.query.limit, 10);
    if (!(limit > 0)) limit = 20;
    if (limit > 100) limit = 100;

    // Existence check first, so a bad groupid returns NOT_FOUND rather than an empty list that reads as "never sold".
    const exists = await query('SELECT 1 FROM skusummary WHERE groupid = $1', [groupid]);
    if (exists.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    // LEFT JOIN skumap (not inner): a sale whose code has since been removed from skumap must still appear — losing a real sale to
    // keep a tidy size label would be the wrong trade. Such a row falls back to the code's tail in the client.
    const result = await query(`
      SELECT s.solddate, s.ordertime, s.channel, s.code, s.qty, s.soldprice, s.profit, s.returnsaleid,
             NULLIF(btrim(regexp_replace(m.optionsize, '^[0-9]+--', '')), '') AS sizedisplay
      FROM sales s
      LEFT JOIN skumap m ON m.code = s.code
      WHERE s.groupid = $1
      ORDER BY s.solddate DESC, s.ordertime DESC NULLS LAST, s.id DESC
      LIMIT $2::int
    `, [groupid, limit + 1]);

    const truncated = result.rows.length > limit;
    const rows = result.rows.slice(0, limit).map((r) => ({
      solddate: toIsoDate(r.solddate),
      ordertime: r.ordertime || null,
      channel: r.channel || null,
      // Fall back to the code tail when a sale's variant is no longer in skumap.
      sizeDisplay: r.sizedisplay || (r.code ? String(r.code).split('-').pop() : null),
      qty: Number(r.qty),
      soldprice: num(r.soldprice),
      profit: num(r.profit),
      isReturn: r.returnsaleid !== null && r.returnsaleid !== '',
    }));

    return res.json({ return_code: 'SUCCESS', groupid, rows, limit, truncated });
  } catch (err) {
    logger.error('[inv-sales] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load sales' });
  }
});

module.exports = router;
