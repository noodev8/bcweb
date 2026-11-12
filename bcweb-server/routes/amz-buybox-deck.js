/*
=======================================================================================================================================
API Route: amz_buybox_deck
=======================================================================================================================================
Method: GET
Purpose: The Buy Box "Go through" screen (/amz/buybox/deck, 2026-11-12) — the sizes in the two Buy Box groups with a job (Room to go
         up, Can match), one suggested move each, money at stake first. THE rules: utils/amzBuyBoxDeck.js (read its header). READ ONLY,
         never asks Amazon — the stored reading, like the Buy Box screen. The price itself is set with the normal W-A1, POST /amz-apply.

Success Response:
{
  "return_code": "SUCCESS",
  "counts": { "room": 39, "can_match": 8 },                                    // cards in each deck
  "left_out": { "room": { "not_selling": 89, "waiting": 0, "not_eligible": 0 }, "can_match": { ... } },
  "last_all": { ...the last whole-list read, as /amz-buybox }, "running": null,
  "cards": [ { "deck": "room", "code": "FLE030-IVES-WHITE-05", "title": "...", "imagename": "...", "our_price": 39.49,
               "suggest": 41.46, "suggest_note": "Capped at +5% — ...", "profit_now": 6.10, "profit_suggest": 7.42,
               "profit_line": { "per_pound": 0.5806, "at_zero": -16.83 }, "gain_week": 1.23, "stake": 1.23,
               "holder": "US", "bb_price": null, "our_share": 100, "next_up": 42.99, "walk": 35.62, "rrp": 45.00,
               "live": 20, "total": 31, "sold30": 4, "weeks_left": 33.2, "offers": [...], "featured": [...], ... } ]
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
const { pool } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { readDeck } = require('../utils/amzBuyBoxDeck');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  const client = await pool.connect();
  try {
    const d = await readDeck(client);
    return res.json({ return_code: 'SUCCESS', ...d });
  } catch (err) {
    logger.error('[amz-buybox-deck] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Buy Box deck' });
  } finally {
    client.release();
  }
});

module.exports = router;
