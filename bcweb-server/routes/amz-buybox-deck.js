/*
=======================================================================================================================================
API Route: amz_buybox_deck
=======================================================================================================================================
Method: GET
Purpose: The Buy Box "Go through" screen (/amz/buybox/deck) and the Buy Box screen's answer bar (2026-11-12, PLAN.md decisions 13–20).
         Every size IN STOCK AT AMAZON gets ONE answer for the chosen MOOD — New · Raise · Cut · Leave · Not for this screen — and the
         New / Raise / Cut sizes that are ready make cards, one suggested move each. THE rules: utils/amzBuyBoxDeck.js (read its header).
         READ ONLY, never asks Amazon — the stored reading, like the Buy Box screen. A Set is the normal W-A1 (POST /amz-apply with its
         `buybox` fields); a Leave is POST /amz-buybox-leave.

Query: ?mood=fierce|chilled|climb  (anything else = chilled — every screen load starts on Chilled, nothing stored)

Success Response:
{
  "return_code": "SUCCESS", "mood": "chilled", "in_stock": 293,
  "counts": { "new": 6, "raise": 22, "cut": 7 },                               // cards on each tab
  "answers": { "raise": { "total": 29, "ready": 22, "reasons": { "ready": 22, "raised": 5, "changed": 2 } }, "cut": {...},
               "new": {...}, "leave": { "total": 47, "ready": 0, "reasons": { "top": 20, "tie": 8, ... } },
               "off": { "total": 208, "ready": 0, "reasons": { "recent": 74, "older": 134 } } },
  "answer_of": { "FLE030-IVES-WHITE-05": ["raise", "ready"], ... },         // every in-stock size: [answer, reason]
  "last_all": { ...the last whole-list read, as /amz-buybox }, "running": null,
  "cards": [ { "deck": "raise", "group": "room", "code": "FLE030-IVES-WHITE-05", "our_price": 39.49, "suggest": 41.46,
               "suggest_note": "Capped at +5% — ...", "floor": 35.62, "walk": 35.62, "breakeven": 32.10, "landed_ago": null, ... } ]
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
    const d = await readDeck(client, { mood: typeof req.query.mood === 'string' ? req.query.mood : undefined });
    return res.json({ return_code: 'SUCCESS', ...d });
  } catch (err) {
    logger.error('[amz-buybox-deck] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the Buy Box deck' });
  } finally {
    client.release();
  }
});

module.exports = router;
