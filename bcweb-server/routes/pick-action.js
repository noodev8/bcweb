/*
=======================================================================================================================================
API Route: pick_action
=======================================================================================================================================
Method: POST
Purpose: The Pick module's one write — action a selection of shelf rows. Ported from legacy PowerBuilder of_pickunpick, which took an
         integer parm and wrote it into `localstock.qty`. utils/pick.js holds the vocabulary (the qty magic numbers, the two mode
         filters, and why the Amazon actions differ from the legacy's); read that header before changing anything here.

  shopify mode   pick 0 | unpick 1 | not_found -1 | restock -2      ->  UPDATE localstock SET qty = ...
  amazon  mode   to_amazon                                          ->  UPDATE localstock SET location = 'C3-Amazon'
                 unallocate                                         ->  UPDATE localstock SET allocated = 'unallocated'

MODE IS RE-CHECKED SERVER-SIDE, NOT TRUSTED. Every id is filtered through utils/pick.js -> modeFilter() in the UPDATE's own WHERE, so
an action can only ever touch rows the same mode's LIST would have shown. It is not a formality: writing qty on an Amazon row would
set a '#FREE' row to 0, and orderSync phase F deletes exactly that (`DELETE FROM localstock WHERE qty = 0 AND ordernum = '#FREE'`) —
the unit would vanish from stock entirely on the next sync, with the shelf still holding the shoe. A stale second tab is enough to
try it, so the guard is in the SQL rather than in a check above it.

The response reports `updated` against `requested`, and the two differing is NORMAL, not an error: the mobile app picks the same rows
and orderSync deletes them when the order ships, so a row can legitimately be gone between the list load and the button press. The
client re-fetches the list either way; a partial hit is reported, not rolled back.

WRITES THE LEGACY `updated` STAMP. localstock.updated is TEXT in the 'YYYYMMDD HH24:MI:SS' Europe/London shape PowerBuilder renders
(CLAUDE.md: keep writing the legacy text stamps). There is no timestamptz column on this table to write alongside it.

AUDITED TO `bclog`, inside the same transaction. Picking moves physical stock and the legacy screen recorded nothing, so "who
un-picked that?" was unanswerable. `changed_by` is resolved from the token server-side and never sent by the client (CLAUDE.md).
=======================================================================================================================================
Request Payload:
{
  "mode": "shopify",                              // required — 'shopify' | 'amazon'
  "action": "pick",                               // required — shopify: pick|unpick|not_found|restock; amazon: to_amazon|unallocate
  "ids": ["WS7-4433-LX9YE", "WS7-4350-IDBCK"]     // required — localstock.id values, non-empty
}
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "mode": "shopify", "action": "pick", "requested": 2, "updated": 2, "ids": ["WS7-4433-LX9YE", ...] }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_MODE"
"INVALID_ACTION"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const { PICK_MODES, SHOPIFY_ACTIONS, AMAZON_ACTIONS, AMAZON_SHELF, modeFilter } = require('../utils/pick');
const logger = require('../utils/logger');

router.use(verifyToken);

// Cap one call so a malformed payload can't rewrite the whole table. The real lists run to single or low double figures; 500 is far
// above any honest selection and far below "everything".
const MAX_IDS = 500;

// The legacy text stamp, as a SQL fragment — same shape PowerBuilder writes, Europe/London (CLAUDE.md).
const LEGACY_STAMP = `to_char(now() AT TIME ZONE 'Europe/London', 'YYYYMMDD HH24:MI:SS')`;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const mode = String(body.mode || '').toLowerCase();
    const action = String(body.action || '').toLowerCase();
    const { ids } = body;

    if (!PICK_MODES.includes(mode)) {
      return res.json({ return_code: 'INVALID_MODE', message: `mode must be one of: ${PICK_MODES.join(', ')}` });
    }

    const allowed = mode === 'amazon' ? AMAZON_ACTIONS : Object.keys(SHOPIFY_ACTIONS);
    if (!allowed.includes(action)) {
      return res.json({ return_code: 'INVALID_ACTION', message: `action must be one of: ${allowed.join(', ')} in ${mode} mode` });
    }

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ids must be a non-empty array' });
    }
    const cleanIds = Array.from(new Set(
      ids.filter((i) => typeof i === 'string' && i.trim() !== '').map((i) => i.trim())
    ));
    if (cleanIds.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ids must contain at least one valid localstock id' });
    }
    if (cleanIds.length > MAX_IDS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `at most ${MAX_IDS} rows can be actioned in one call` });
    }

    // The SET clause per action. Only ever built from the validated `action`; no request value reaches the SQL except through $params.
    let setClause;
    let params;
    if (mode === 'amazon') {
      setClause = action === 'to_amazon' ? `location = $2` : `allocated = 'unallocated'`;
      params = action === 'to_amazon' ? [cleanIds, AMAZON_SHELF] : [cleanIds];
    } else {
      setClause = `qty = $2`;
      params = [cleanIds, SHOPIFY_ACTIONS[action]];
    }

    const who = req.user.display_name;

    const updated = await withTransaction(async (client) => {
      const result = await client.query(
        `UPDATE localstock ls
            SET ${setClause}, updated = ${LEGACY_STAMP}
          WHERE ls.id = ANY($1::text[])
            AND ${modeFilter(mode, 'ls')}
        RETURNING ls.id`,
        params
      );

      const hit = result.rows.map((r) => r.id);
      if (hit.length > 0) {
        await writeBcLog(client, {
          who,
          section: 'Pick',
          log: `${mode} ${action}: ${hit.length} row(s) — ${hit.slice(0, 8).join(', ')}${hit.length > 8 ? ' …' : ''}`,
        });
      }
      return hit;
    });

    return res.json({
      return_code: 'SUCCESS',
      mode,
      action,
      requested: cleanIds.length,
      updated: updated.length,
      ids: updated,
    });
  } catch (err) {
    logger.error('[pick-action] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to action the selected rows' });
  }
});

module.exports = router;
