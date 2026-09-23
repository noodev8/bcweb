/*
=======================================================================================================================================
API Route: segment-work
=======================================================================================================================================
Method: POST
Purpose: Step 5 write W-seg-1 (docs/segments-spec.md §5, §6-B) — set one area of one segment's review clock and/or its "off" (not
         applicable) flag. This is the segment-level analogue of the per-product review (pricing-apply's reviewDays).

NO LONGER LOGS (owner, 2026-09-23). This route used to INSERT a segment_worklog row ("who worked it / when / note") on every call.
The detail page stopped showing that history and the owner saw no use for it, so the INSERT is gone. The table and its old rows are
left in place: GET /segments and GET /segment still read the latest row for lastWorkedBy/lastWorkedAt, which now simply stops
advancing. `note` is still accepted for old clients but is ignored.

Rules:
  - `reviewDays` is OPTIONAL (mirrors pricing-apply / the Add-Modify "None" chip). If supplied it must be an integer >= 1 and sets
    next_review_date = CURRENT_DATE + reviewDays; if omitted/blank/null we leave the clock UNTOUCHED and only log the event.
    EXCEPTION — the SHOPIFY area is now a DERIVED clock (spec §9): it has no segment-level date, so reviewDays is ignored for it
    (the UI hides the pills; this is a defensive server-side guard). A note and the `off` flag still apply to Shopify.
  - `off` is OPTIONAL (true/false). Flags this area as not applicable to this segment (e.g. EVA-SEG isn't sold on Amazon) — an
    operator decision, not derived from the date, so it lives as its own column and short-circuits due-state classification
    (utils/segmentDue.js) regardless of next_review_date. Omitted = leave the flag UNTOUCHED. Turning off does NOT touch
    next_review_date (the clock is preserved underneath so it resumes where it left off if switched back on).
  - The clock row is only touched (upserted, ON CONFLICT) when reviewDays and/or off was actually supplied — a call with neither
    never creates a phantom segment_area_state row, it just reads the current state back.

Only writes the module's own table (segment_area_state) — never product rows.
=======================================================================================================================================
Request Payload:
{
  "name":       "IVES-WHITE",  // string, required — the segment name
  "area":       "Shopify",     // string, required — the area name (Shopify / Amazon / Housekeeping …)
  "reviewDays": 7,             // integer >= 1, OPTIONAL; omit/blank/null = "None" (leave the clock untouched)
  "off":        false          // boolean, OPTIONAL; omit/null = leave the flag untouched
}

Success Response:
{
  "return_code": "SUCCESS",
  "name": "IVES-WHITE",
  "area": "Shopify",
  "nextReview": "2026-07-16",  // the clock's date after this call (unchanged when reviewDays was None); null if never set
  "off": false                 // the flag's state after this call (unchanged when off was omitted)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_REVIEW_DAYS"
"INVALID_OFF"        // off supplied but not a boolean
"NOT_FOUND"          // unknown segment name or unknown/inactive area
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { isoDate } = require('../utils/segmentDue');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const { name, area } = body;

    // 1) Presence — name + area required. reviewDays/note optional.
    if (!name || !area) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'name and area are required' });
    }

    // 2) Optional review period. Absent/blank/null -> leave the clock untouched. If supplied, must be an integer >= 1.
    let reviewDays = null;
    const reviewRaw = body.reviewDays;
    if (reviewRaw !== undefined && reviewRaw !== null && String(reviewRaw).trim() !== '') {
      const n = Number(reviewRaw);
      if (!Number.isInteger(n) || n < 1) {
        return res.json({ return_code: 'INVALID_REVIEW_DAYS', message: 'reviewDays must be an integer >= 1' });
      }
      reviewDays = n;
    }

    // 2b) Optional off flag. Absent/null -> leave untouched. If supplied, must be a real boolean.
    let off = null;
    if (body.off !== undefined && body.off !== null) {
      if (typeof body.off !== 'boolean') {
        return res.json({ return_code: 'INVALID_OFF', message: 'off must be true or false' });
      }
      off = body.off;
    }

    // 3) Resolve the segment + area to their ids (the FK targets). Unknown either -> NOT_FOUND (no silent create of a segment/area).
    const seg = await query('SELECT id FROM segment WHERE name = $1', [name]);
    if (seg.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Segment not found' });
    }
    const ar = await query('SELECT id, default_cadence_days FROM area WHERE name = $1 AND active = true', [area]);
    if (ar.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Area not found' });
    }
    const segmentId = seg.rows[0].id;
    const areaId = ar.rows[0].id;
    const areaCadence = ar.rows[0].default_cadence_days;

    // Shopify is now a DERIVED clock (spec §9): its due state comes from the products' own review dates, so there is no segment-level
    // date to set. Defensively ignore any reviewDays a stale client still sends for Shopify (the UI already hides the pills); a note
    // and the `off` flag remain meaningful and are left untouched.
    if (area.toLowerCase() === 'shopify') reviewDays = null;

    // 4) Write: if a period and/or the off flag was given, upsert the clock row.
    const result = await withTransaction(async (client) => {
      let nextReview;
      let offState;
      if (reviewDays !== null || off !== null) {
        // Something to change — upsert (create the clock row if it doesn't exist yet, cadence seeded from the area default).
        // COALESCE means an untouched field (NULL param) keeps its existing value rather than being blanked.
        const clk = await client.query(`
          INSERT INTO segment_area_state (segment_id, area_id, cadence_days, next_review_date, off)
          VALUES ($1, $2, $3, CURRENT_DATE + $4::int, COALESCE($5, false))
          ON CONFLICT (segment_id, area_id) DO UPDATE SET
            next_review_date = COALESCE(CURRENT_DATE + $4::int, segment_area_state.next_review_date),
            off = COALESCE($5, segment_area_state.off)
          RETURNING next_review_date, off
        `, [segmentId, areaId, areaCadence, reviewDays, off]);
        nextReview = clk.rows[0].next_review_date;
        offState = clk.rows[0].off;
      } else {
        // Neither reviewDays nor off supplied — leave the clock untouched; read its current state back for the response.
        const clk = await client.query(
          'SELECT next_review_date, off FROM segment_area_state WHERE segment_id = $1 AND area_id = $2',
          [segmentId, areaId]
        );
        nextReview = clk.rows.length ? clk.rows[0].next_review_date : null;
        offState = clk.rows.length ? clk.rows[0].off : false;
      }

      return { nextReview, offState };
    });

    return res.json({
      return_code: 'SUCCESS',
      name,
      area,
      nextReview: isoDate(result.nextReview),
      off: !!result.offState,
    });
  } catch (err) {
    logger.error('[segment-work] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record segment work' });
  }
});

module.exports = router;
