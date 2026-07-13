/*
=======================================================================================================================================
API Route: amz_basket
=======================================================================================================================================
Method: GET
Purpose: Rebuild the Amazon upload basket — ALL operators' recent price changes — straight from the audit log (amz_price_log), so it
         survives a browser close / machine restart / re-login. Amazon has no live push: an Apply only logs the price (POST /amz-apply);
         the price reaches Amazon when someone downloads ONE Seller Central file and uploads it. The basket used to live only in browser
         memory, so switching the machine off before downloading lost the file. This endpoint makes it regenerate-able at any time from the
         durable DB copy — the client rebuilds the same file from these rows.

         TEAM-WIDE (not per-operator, owner decision): the basket is everyone's recent changes, so whoever is at the desk can upload a
         colleague's pending change after they've left (and vice-versa) — one shared file for the whole team's sitting.

         A simple ROLLING WINDOW: changes from the last WINDOW_HOURS (12h). No calendar/midnight logic — a rolling span both survives a
         session that crosses midnight AND self-clears afterwards, so it's never the "lost it at midnight" trap and never drags in stale
         work. 12h comfortably covers a working day/evening; widen the one constant if that's ever tight.

         This needs a real timestamp per change: amz_price_log stored only a bare DATE (log_date), so a `changed_at timestamptz` was added
         (migration 20260713_amz_price_log_changed_at.sql). Older rows predate it (NULL) and are simply never "recent" — correct, they're
         history, not this sitting's basket.

         LATEST price per SKU: a SKU changed twice in the window should upload its final price once. DISTINCT ON (code) ORDER BY id DESC
         keeps the newest price per code (id is the ascending surrogate, so highest id = most recent).

         Because the Seller Central upload is IDEMPOTENT (the file just SETS prices), including a change the operator already uploaded is
         harmless (Amazon re-sets a price to the value it already has). That is what lets this stay simple — no per-row "uploaded yet?"
         tracking. The basket is a view, not a queue.

Read-only. Never writes; amzfeed is untouched (FBA-only, refreshed nightly). Each row carries everything the client file builder needs
(amz_sku + new_price + rrp) plus display fields (size, title, segment, old_price), mirroring the in-memory basket item shape.

Schema landmines respected: sk.rrp is a junk-prone VARCHAR -> safeNumeric (NULL on non-numeric). amz_price_log.old_price/new_price are
NUMERIC (no cast). amz_sku = amzfeed.sku (LEFT JOIN — a SKU that vanished from amzfeed since the change keeps its log row but yields a
null amz_sku; the client drops null-sku rows from the file). Size = RIGHT(code,2). Requires auth.
=======================================================================================================================================
Request Query Params: (none — the operator is resolved from the token)

Success Response:
{
  "return_code": "SUCCESS",
  "items": [
    { "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "size": "38", "title": "...", "segment": "IVES-WHITE",
      "old_price": 39.29, "new_price": 39.79, "rrp": 45.00 },
    ... // one row per SKU changed by anyone in the last 12h, latest price; ordered by code
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { safeNumeric } = require('../utils/sql');
const logger = require('../utils/logger');

router.use(verifyToken);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// The rolling window: how far back a change stays in the basket. Long enough to cover a working day/evening (and to carry a late session
// across midnight), short enough to self-clear. One knob — widen if a sitting ever runs longer than this.
const WINDOW_HOURS = 12;

router.get('/', async (req, res) => {
  try {
    // Latest log row per SKU changed by ANYONE in the last WINDOW_HOURS (team-wide — no changed_by filter). Absolute time, no timezone/
    // calendar logic. Joined to the Amazon SKU (for the file) + rrp/segment/title (for the file + basket display). DISTINCT ON (code) +
    // id DESC = newest price per code regardless of who set it. The outer ORDER BY presents them by code. Old rows (NULL changed_at) are
    // never within the window — correctly excluded.
    const result = await query(`
      SELECT DISTINCT ON (l.code)
             l.code,
             a.sku                        AS amz_sku,
             RIGHT(l.code, 2)             AS size,
             t.shopifytitle               AS title,
             sk.segment                   AS segment,
             l.old_price                  AS old_price,
             l.new_price                  AS new_price,
             ${safeNumeric('sk.rrp')}     AS rrp
      FROM amz_price_log l
      LEFT JOIN amzfeed a    ON a.code = l.code
      LEFT JOIN skusummary sk ON sk.groupid = a.groupid
      LEFT JOIN title t       ON t.groupid = a.groupid
      WHERE l.changed_at >= now() - make_interval(hours => $1::int)
      ORDER BY l.code, l.id DESC
    `, [WINDOW_HOURS]);

    const items = result.rows.map((r) => ({
      code: r.code,
      amz_sku: r.amz_sku || null,
      size: r.size,
      title: r.title || null,
      segment: r.segment || null,
      old_price: num(r.old_price),
      new_price: num(r.new_price),
      rrp: num(r.rrp),
    }));

    return res.json({ return_code: 'SUCCESS', items });
  } catch (err) {
    logger.error('[amz-basket] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the upload basket' });
  }
});

module.exports = router;
