/*
=======================================================================================================================================
API Route: amz_buybox_leave
=======================================================================================================================================
Method: POST
Purpose: LEAVE on Buy Box "Go through" (/amz/buybox/deck, PLAN.md decisions 16–17, 2026-11-12). Nothing goes to Amazon. In ONE
         transaction:
           - the size's Amazon Due date moves 4 weeks out, KEEPING a later one (skumap.next_amz_price_review =
             GREATEST(existing, today + 28)) — the shared W-A2 write, utils/amzReviewWrite.js → writeAmzReview({ keepLater: true }),
             which also logs a HOLD row (note "Buy Box Leave") so the decision shows on Price Changes like any other hold. Why: a size
             looked at on Go through shouldn't then be moved blind from the Due list (owner: "one door per answer").
           - one amz_buybox_press row (action 'leave', the mood, the tab, the suggested price) — utils/amzBuyBoxDeck.js → recordPress,
             behind a SAVEPOINT (the record never stops the Due date). The card comes back when the price it would suggest differs
             from this one (to the penny) or after 7 days, whichever first.
         Leave asks nothing (owner: a reason "will slow us down").

Request Payload:
{ "code": "FLE030-IVES-WHITE-05", "mood": "chilled", "tab": "raise", "our_price": 39.49, "suggested": 41.46 }

Success Response:
{ "return_code": "SUCCESS", "code": "FLE030-IVES-WHITE-05", "next_review": "2026-12-10", "recorded": true }
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" · "UNAUTHORIZED" · "SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeAmzReview } = require('../utils/amzReviewWrite');
const { REVIEW_DAYS, recordPress, pressFields } = require('../utils/amzBuyBoxDeck');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    if (!code) return res.json({ return_code: 'MISSING_FIELDS', message: 'code is required' });
    const f = pressFields(body);
    if (f.error) return res.json({ return_code: 'MISSING_FIELDS', message: f.error });

    const by = req.user.display_name;
    const out = await withTransaction(async (client) => {
      const w = await writeAmzReview(client, { codes: [code], reviewDays: REVIEW_DAYS, note: 'Buy Box Leave', changedBy: by, keepLater: true });
      if (!w.rowCount) return { notFound: true };
      const recorded = await recordPress(client, { code, by, mood: f.mood, tab: f.tab, action: 'leave', our_price: f.our_price, suggested: f.suggested, price: null });
      return { next_review: w.rows[0].next_review, recorded };
    });
    if (out.notFound) return res.json({ return_code: 'NOT_FOUND', message: `${code} is not a known size` });
    return res.json({ return_code: 'SUCCESS', code, next_review: out.next_review, recorded: out.recorded });
  } catch (err) {
    logger.error('[amz-buybox-leave] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to leave the size' });
  }
});

module.exports = router;
