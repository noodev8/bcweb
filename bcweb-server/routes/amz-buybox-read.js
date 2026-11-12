/*
=======================================================================================================================================
API Route: amz_buybox_read
=======================================================================================================================================
Method: POST
Purpose: Start a Buy Box read from the screen (owner, 2026-11-12): the whole list ("Read all now" — ~360 sizes, 4–5 minutes, paced to
         Amazon's rate limits) or ONE style ("Read this style", after a price change — a few seconds). Rules in utils/amzBuyBox.js.
         Normally the cron does the whole-list read (scripts/amz-buybox-read.js); these buttons are for "now".

         The read runs IN THE BACKGROUND on the server: this route claims the read (one at a time — a press while another read, or the
         cron, is running answers BUSY with that read's progress), answers at once, and the screen follows the progress through GET
         /amz-buybox (`running`). Nothing is written but the Buy Box tables (amz_buybox_now / _history / _run) — no price changes.

Request Body: { "groupid": "FLE030-IVES-WHITE" }   // omit for the whole list
Success Response: { "return_code": "SUCCESS", "run": { "id": 5, "scope": "all", "total": 358 } }
Busy Response:    { "return_code": "BUSY", "message": "...", "running": { "id": 4, "scope": "all", "by_name": "cron", "total": 358, "done": 120 } }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BUSY"            another read is running
"NOTHING_TO_READ" no Amazon sizes for that choice
"NOT_CONFIGURED"  SP-API keys / AMZ_SP_SELLER_ID missing in .env
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { startRun, executeRun } = require('../utils/amzBuyBox');
const sp = require('../utils/amzSpApi');
const { query } = require('../database');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const groupid = req.body && typeof req.body.groupid === 'string' && req.body.groupid.trim() ? req.body.groupid.trim() : null;
    try { sp.marketplaceId(); sp.sellerId(); } catch (e) {
      return res.json({ return_code: 'NOT_CONFIGURED', message: e.message });
    }
    const r = await startRun({ by: req.user.display_name, groupid });
    if (r.busy) {
      return res.json({ return_code: 'BUSY', message: 'A Buy Box read is already running', running: r.busy });
    }
    if (!r.run.sizes.length) {
      await query(`UPDATE amz_buybox_run SET status = 'ok', finished_at = now(), changed = 0 WHERE id = $1`, [r.run.id]);
      return res.json({ return_code: 'NOTHING_TO_READ', message: groupid ? `No Amazon sizes for ${groupid}` : 'No Amazon sizes in stock' });
    }
    // Not awaited — the read carries on after the answer (see the header). executeRun never throws.
    executeRun(r.run);
    return res.json({ return_code: 'SUCCESS', run: { id: r.run.id, scope: r.run.scope, total: r.run.sizes.length } });
  } catch (err) {
    logger.error('[amz-buybox-read] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to start the Buy Box read' });
  }
});

module.exports = router;
