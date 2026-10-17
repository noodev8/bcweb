/*
=======================================================================================================================================
API Route: slider_marks
=======================================================================================================================================
Method: GET
Purpose: Which products are in a Pricing Slider right now — the one lookup behind the slider badge on the pricing screens (phase 4,
         owner 2026-10-17: "show an indication on the Amazon and Shopify pricing pages when a product is in a slider"). Every LIVE member
         (sliding / found / at floor — utils/slider.js → LIVE_STATES) of every group, both channels, in one small list: the screens fetch
         it once (SWR, shared across them) and look products up client-side, rather than every list route growing a slider join.

         Why the badge matters: the slider doesn't touch review dates, so without it a product in a slider looks like any other on the
         pricing lists — and pricing it by hand there quietly takes it out of the slider (it reads as 'repriced' at the next Move).
         Shopify members are keyed by style (groupid), Amazon members by SKU (code) and carry their style so a style row can say
         "2 sizes in a slider". Read-only. Requires auth.
=======================================================================================================================================
Request Query Params: none

Success Response:
{
  "return_code": "SUCCESS",
  "marks": [
    { "channel": "SHP", "key": "22152-42-019", "groupid": "22152-42-019", "state": "sliding",   // sliding | found | floor
      "group_id": 3, "name": "Caprice NEW", "group_state": "active" }                           // active | paused
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
const { LIVE_STATES } = require('../utils/slider');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    // Live members only — an ended group's members have all left (state 'ended'), so they drop out on their own.
    const r = await query(`
      SELECT m.channel, m.item_key AS key, m.groupid, m.state, g.id AS group_id, g.name, g.state AS group_state
      FROM slider_member m
      JOIN slider_group g ON g.id = m.group_id
      WHERE m.state = ANY($1::text[])
      ORDER BY m.channel, m.item_key
    `, [LIVE_STATES]);
    return res.json({ return_code: 'SUCCESS', marks: r.rows });
  } catch (err) {
    logger.error('[slider-marks] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the slider marks' });
  }
});

module.exports = router;
