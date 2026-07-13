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

         PENDING-ONLY: a row that has been confirmed uploaded to Seller Central (uploaded_at IS NOT NULL — set by POST /amz-mark-uploaded)
         drops out of the basket for good. This is what answers "did a colleague / last-night-me already upload these?": once confirmed,
         the list empties and stays empty (regardless of the window), and the lastUpload summary below says who did it and when.

         A ROLLING WINDOW still bounds the PENDING set: changes from the last WINDOW_HOURS (72h). It's now only a backstop — the upload
         confirmation, not the clock, is what normally clears a row — so it's generous: a genuinely-pending change should linger until
         someone uploads it, not vanish overnight. No calendar/midnight logic; a rolling span survives a session across midnight.

         This needs a real timestamp per change: amz_price_log stored only a bare DATE (log_date), so a `changed_at timestamptz` was added
         (migration 20260713_amz_price_log_changed_at.sql). Older rows predate it (NULL) and are simply never "recent" — correct, they're
         history, not this sitting's basket.

         LATEST price per SKU: a SKU changed twice in the window should upload its final price once. DISTINCT ON (code) ORDER BY id DESC
         keeps the newest PENDING price per code (id is the ascending surrogate, so highest id = most recent). Each row also carries its
         log `id` so the client can tell POST /amz-mark-uploaded exactly which rows the downloaded file covered.

         lastUpload: the most recent confirmed upload (rows share one uploaded_at instant per mark call, so MAX(uploaded_at) identifies the
         last batch). Returned as { at, by, count } so the UI can reassure "last uploaded HH:MM by X · N SKUs" even when the basket is
         empty — the single most useful signal for "is there anything left to do?". null when nothing has ever been marked uploaded.

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
    { "id": 4821, "code": "FLE030-IVES-WHITE-38", "amz_sku": "AD-0XF8D-48L", "size": "38", "title": "...", "segment": "IVES-WHITE",
      "old_price": 39.29, "new_price": 39.79, "rrp": 45.00 },
    ... // one row per PENDING SKU changed by anyone in the last 72h, latest price; ordered by code
  ],
  "lastUpload": { "at": "2026-07-13T19:14:07.221Z", "by": "Andreas", "count": 27 }   // or null if nothing ever marked uploaded
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

// The rolling window bounding the PENDING set. Now only a backstop (upload confirmation, not the clock, normally clears a row), so it's
// generous — a genuinely-pending change should linger until someone uploads it, not vanish overnight. Widen if a change should survive
// longer than this while un-uploaded.
const WINDOW_HOURS = 72;

router.get('/', async (req, res) => {
  try {
    // Latest log row per SKU changed by ANYONE in the last WINDOW_HOURS (team-wide — no changed_by filter). Absolute time, no timezone/
    // calendar logic. Joined to the Amazon SKU (for the file) + rrp/segment/title (for the file + basket display). DISTINCT ON (code) +
    // id DESC = newest price per code regardless of who set it. The outer ORDER BY presents them by code. Old rows (NULL changed_at) are
    // never within the window — correctly excluded.
    const result = await query(`
      SELECT DISTINCT ON (l.code)
             l.id,
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
      WHERE l.uploaded_at IS NULL
        AND l.changed_at >= now() - make_interval(hours => $1::int)
      ORDER BY l.code, l.id DESC
    `, [WINDOW_HOURS]);

    const items = result.rows.map((r) => ({
      id: r.id,
      code: r.code,
      amz_sku: r.amz_sku || null,
      size: r.size,
      title: r.title || null,
      segment: r.segment || null,
      old_price: num(r.old_price),
      new_price: num(r.new_price),
      rrp: num(r.rrp),
    }));

    // The most recent confirmed upload (one mark call stamps its whole batch with the same uploaded_at instant, so MAX(uploaded_at)
    // isolates the last batch; count its distinct SKUs). Drives the "last uploaded HH:MM by X · N SKUs" reassurance line. NULL if the
    // table has never been marked (fresh feature / no uploads yet).
    const lastRes = await query(`
      WITH last AS (SELECT MAX(uploaded_at) AS at FROM amz_price_log WHERE uploaded_at IS NOT NULL)
      SELECT last.at,
             (SELECT uploaded_by FROM amz_price_log WHERE uploaded_at = last.at LIMIT 1)         AS by,
             (SELECT COUNT(DISTINCT code) FROM amz_price_log WHERE uploaded_at = last.at)::int    AS count
      FROM last
      WHERE last.at IS NOT NULL
    `);
    const lastUpload = lastRes.rows[0]
      ? { at: lastRes.rows[0].at, by: lastRes.rows[0].by || null, count: lastRes.rows[0].count }
      : null;

    return res.json({ return_code: 'SUCCESS', items, lastUpload });
  } catch (err) {
    logger.error('[amz-basket] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the upload basket' });
  }
});

module.exports = router;
