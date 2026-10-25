/*
=======================================================================================================================================
API Route: process_allowance_accept
=======================================================================================================================================
Method: POST
Purpose: The second half of Re-measure: make the figure the owner was SHOWN the Google allowance in force (a new google_allowance row;
         rows are never edited, so the history stays). Nothing else changes — no price, no product row. The Process page's Shopify
         thin/good line moves on its next load.

         THE SHOWN FIGURE, NOT A FRESH ONE: the page sends the per-unit figure and the window end it displayed. The server re-measures
         that SAME window and saves only if it still comes to the same figure; if late sales or a re-import moved it, nothing is saved
         and the new figure comes back (MEASURE_CHANGED) for the page to show again. So what is accepted is always what was seen.
=======================================================================================================================================
Request Payload:
{
  "perUnit": 7.75,              // number, required — the figure the page showed
  "windowTo": "2026-10-23"      // string YYYY-MM-DD, required — the window end the page showed
}

Success Response:
{
  "return_code": "SUCCESS",
  "allowance": { "perUnit": 7.75, ... }            // the row now in force, as process-overview returns it
}
MEASURE_CHANGED Response:
{
  "return_code": "MEASURE_CHANGED",
  "message": "...",
  "measure": { "windowFrom": "...", "windowTo": "...", "spend": 6201.10, "units": 800, "perUnit": 7.75 }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_WINDOW"
"NOTHING_TO_MEASURE"
"MEASURE_CHANGED"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');
const { measureAllowance, readAllowance } = require('../utils/processMap');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const perUnit = Number(req.body?.perUnit);
    const windowTo = String(req.body?.windowTo || '');
    if (req.body?.perUnit === undefined || req.body?.perUnit === null || !windowTo) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'perUnit and windowTo are required' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(windowTo) || !Number.isFinite(perUnit)) {
      return res.json({ return_code: 'INVALID_WINDOW', message: 'windowTo must be YYYY-MM-DD and perUnit a number' });
    }

    const out = await withTransaction(async (client) => {
      const q = (text, params) => client.query(text, params);
      const measure = await measureAllowance(q, windowTo);
      if (measure.perUnit === null) {
        return { error: 'NOTHING_TO_MEASURE', message: 'Nothing sold on Shopify in that window — there is no figure to accept' };
      }
      if (measure.perUnit !== Math.round(perUnit * 100) / 100) {
        return { error: 'MEASURE_CHANGED', message: `The figure has moved to £${measure.perUnit.toFixed(2)} since it was shown`, measure };
      }
      await client.query(`
        INSERT INTO google_allowance (per_unit, spend, units, window_from, window_to, accepted_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [measure.perUnit, measure.spend, measure.units, measure.windowFrom, measure.windowTo, req.user.display_name]);
      return { ok: true };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message, measure: out.measure });
    return res.json({ return_code: 'SUCCESS', allowance: await readAllowance(query) });
  } catch (err) {
    logger.error('[process-allowance-accept] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not save the Google allowance' });
  }
});

module.exports = router;
