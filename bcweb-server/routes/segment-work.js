/*
=======================================================================================================================================
API Route: segment-work
=======================================================================================================================================
Method: POST
Purpose: Step 5 write W-seg-1 (docs/segments-spec.md §5, §6-B) — record a WORK EVENT against one area of one segment, and OPTIONALLY
         set that area's review clock and/or its "off" (not applicable) flag. This is the segment-level analogue of the per-product
         review (pricing-apply's reviewDays), and it is what advances a clock from red/grey back to green and writes the
         "who worked it / when / note" history.

Rules:
  - `reviewDays` is OPTIONAL (mirrors pricing-apply / the Add-Modify "None" chip). If supplied it must be an integer >= 1 and sets
    next_review_date = CURRENT_DATE + reviewDays; if omitted/blank/null we leave the clock UNTOUCHED and only log the event.
  - `off` is OPTIONAL (true/false). Flags this area as not applicable to this segment (e.g. EVA-SEG isn't sold on Amazon) — an
    operator decision, not derived from the date, so it lives as its own column and short-circuits due-state classification
    (utils/segmentDue.js) regardless of next_review_date. Omitted = leave the flag UNTOUCHED. Turning off does NOT touch
    next_review_date (the clock is preserved underneath so it resumes where it left off if switched back on).
  - `note` is optional free text (trimmed, length-capped), stored on the worklog row.
  - `worked_by` = req.user.display_name, resolved server-side by verifyToken from the token's id — NEVER sent by the client.
  - The worklog INSERT always happens; the clock row is only touched (upserted, ON CONFLICT) when reviewDays and/or off was
    actually supplied — a bare "log a note" call never creates a phantom segment_area_state row.
  - Everything runs inside one withTransaction so a review/off change can't land without its log row.

Only writes the module's own tables (segment_worklog, segment_area_state) — never product rows.
=======================================================================================================================================
Request Payload:
{
  "name":       "IVES-WHITE",  // string, required — the segment name
  "area":       "Shopify",     // string, required — the area name (Shopify / Amazon / Remove …)
  "reviewDays": 7,             // integer >= 1, OPTIONAL; omit/blank/null = "None" (leave the clock untouched)
  "off":        false,         // boolean, OPTIONAL; omit/null = leave the flag untouched
  "note":       "harvested — pace held"  // string, OPTIONAL
}

Success Response:
{
  "return_code": "SUCCESS",
  "name": "IVES-WHITE",
  "area": "Shopify",
  "workedBy": "Andreas",
  "workedAt": "2026-07-09T10:11:12.000Z",
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

    const note = (body.note === undefined || body.note === null ? '' : String(body.note)).trim().slice(0, 500);

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

    const workedBy = req.user.display_name; // server-resolved from the token — never from the client body

    // 4) Atomic write: always log the event; if a period was given, upsert the clock's next_review_date in the same transaction.
    const result = await withTransaction(async (client) => {
      const logged = await client.query(`
        INSERT INTO segment_worklog (segment_id, area_id, worked_by, note)
        VALUES ($1, $2, $3, $4)
        RETURNING worked_at
      `, [segmentId, areaId, workedBy, note]);

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

      return { workedAt: logged.rows[0].worked_at, nextReview, offState };
    });

    return res.json({
      return_code: 'SUCCESS',
      name,
      area,
      workedBy,
      workedAt: result.workedAt ? result.workedAt.toISOString() : null,
      nextReview: isoDate(result.nextReview),
      off: !!result.offState,
    });
  } catch (err) {
    logger.error('[segment-work] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to record segment work' });
  }
});

module.exports = router;
