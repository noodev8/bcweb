/*
=======================================================================================================================================
API Route: pricing_match_toggle
=======================================================================================================================================
Method: POST
Purpose: Turn the Shopify "match Amazon price" autopilot ON or OFF for one style (skusummary.match_amazon_price). This is just the
         opt-in FLAG — it does NOT change the Shopify price itself. The actual matching is done by the self-contained cron job
         (C:\scripts\amz-match\amz_match_sync.py), which runs twice each afternoon and pins shopifyprice to Amazon's cheapest in-stock
         size. So flipping this ON here means "start auto-matching at the next sync"; the drill surfaces the pending target (Amazon
         lowest in stock) so the operator can see what it will become.

         Why the price isn't changed here-and-now: all price WRITES for matched styles live in that one cron job (deliberately
         self-contained so it retires cleanly with the legacy PowerBuilder app). Doing an instant push here would duplicate that write
         path in a second place and risk drift — the owner explicitly chose the standalone script over an API-driven reconcile.

         While a style is flagged: it is hidden from the WINNERS/LOSERS lists (pricing-triage / pricing-losers) and pricing-apply (W1)
         refuses a manual price (MATCH_LOCKED). Turning it OFF here restores manual control; it does NOT revert any price the cron set
         (the last matched price simply stays until the operator changes it).

Rules:
  - `enabled` is required and must be a real boolean (true/false) — no silent coercion of arbitrary values.
  - Only allow enabling a style that actually exists (NOT_FOUND otherwise). Enabling a style with no in-stock Amazon size is allowed
    (amazon_lowest comes back null) — the cron simply skips it until Amazon has stock; the UI shows the "nothing to match yet" hint.
  - No audit row / no price_change_log: this flips a setting, not a price. The cron writes the audit rows when it actually re-prices.
=======================================================================================================================================
Request Payload:
{ "groupid": "FLE030-IVES-NAVY-BLUE", "enabled": true }

Success Response:
{ "return_code": "SUCCESS", "groupid": "FLE030-IVES-NAVY-BLUE", "match_amazon": true, "amazon_lowest": 36.29 }
  // amazon_lowest = Amazon's cheapest IN-STOCK size right now (the match target), or null if none in stock. Echoed so the UI can show
  // "will match to £X at the next sync" without a second round-trip.
=======================================================================================================================================
Return Codes:
"SUCCESS" · "MISSING_FIELDS" · "NOT_FOUND" · "UNAUTHORIZED" · "SERVER_ERROR"
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

router.post('/', async (req, res) => {
  try {
    const { groupid } = req.body || {};
    const enabled = req.body ? req.body.enabled : undefined;

    if (!groupid || typeof enabled !== 'boolean') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'groupid and a boolean enabled are required' });
    }

    // Flip the flag. RETURNING confirms the style exists (0 rows -> NOT_FOUND) and echoes the stored value.
    const upd = await query(
      `UPDATE skusummary SET match_amazon_price = $2 WHERE groupid = $1 RETURNING match_amazon_price`,
      [groupid, enabled]
    );
    if (upd.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Style not found' });
    }

    // The current match target: Amazon's cheapest in-stock size (amzlive>0), read via safeNumeric (amzprice is a junk-prone VARCHAR).
    // Null when the style has no in-stock Amazon size — enabling is still allowed; the cron just skips it until Amazon has stock.
    const low = await query(
      `SELECT MIN(${safeNumeric('amzprice')}) AS amazon_lowest
         FROM amzfeed WHERE groupid = $1 AND COALESCE(amzlive,0) > 0`,
      [groupid]
    );

    return res.json({
      return_code: 'SUCCESS',
      groupid,
      match_amazon: upd.rows[0].match_amazon_price === true,
      amazon_lowest: num(low.rows[0] ? low.rows[0].amazon_lowest : null)
    });
  } catch (err) {
    logger.error('[pricing-match-toggle] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to update Amazon matching' });
  }
});

module.exports = router;
