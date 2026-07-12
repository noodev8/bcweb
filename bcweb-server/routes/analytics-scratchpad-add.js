/*
=======================================================================================================================================
API Route: analytics_scratchpad_add
=======================================================================================================================================
Method: POST
Purpose: Analytics module — New Additions "Scratchpad" ADD. Inserts one free-form note. The only field is the note text (`body`); the
         author is resolved server-side from the JWT (never trusted from the client) and the timestamp is the DB default. Returns the
         new row so the client can prepend it without a re-fetch.

         `body` is trimmed; a blank note is rejected (MISSING_FIELDS). A generous length cap (4000 chars) guards against accidental
         paste-bombs while leaving plenty of room for a paragraph of research notes. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "body": "Arizona Taupe suede — check EU stock, ~£55 landed?"   // required, non-blank
}

Success Response:
{
  "return_code": "SUCCESS",
  "note": { "id": 12, "body": "...", "created_by": "Andreas", "created_at": "2026-07-12T09:14:00.000Z" }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // blank/missing body, or body too long
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

const MAX_LEN = 4000;

router.post('/', async (req, res) => {
  try {
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'A note is required' });
    }
    if (body.length > MAX_LEN) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `Note is too long (max ${MAX_LEN} characters)` });
    }

    const createdBy = req.user.display_name; // resolved server-side, never from the client
    const result = await query(
      `INSERT INTO scratchpad_note (body, created_by)
       VALUES ($1, $2)
       RETURNING id, body, created_by, created_at`,
      [body, createdBy]
    );
    const r = result.rows[0];
    const note = {
      id: Number(r.id),
      body: r.body,
      created_by: r.created_by || null,
      created_at: r.created_at ? new Date(r.created_at).toISOString() : null,
    };
    return res.json({ return_code: 'SUCCESS', note });
  } catch (err) {
    logger.error('[analytics-scratchpad-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save note' });
  }
});

module.exports = router;
