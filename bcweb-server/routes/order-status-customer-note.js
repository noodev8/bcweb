/*
=======================================================================================================================================
API Route: order_status_customer_note
=======================================================================================================================================
Method: POST
Purpose: Save the free-text working note against a customer order — the blank bar across the top of the legacy PowerBuilder Status
         grid (Downloads/legacy-status.png), which filled in when a row was clicked and wrote back to `orderstatus.notes`.

WHAT IT'S FOR: it is a handover note between operators about a specific order, not structured data. Real examples from the archive:
"Wait for UKD to arrive to pack together", "sent an email asking if they sure they want 3", "came back as a return to sender".
17 of 3,177 archived customer rows carry one — rare, but load-bearing when present, which is why the feature survived the cull.

GRAIN — PER ORDER, WRITTEN TO EVERY LINE (owner's call). `orderstatus.notes` is physically a per-unit column, but the note is about
the order ("chase this customer"), and a 3-pair order would otherwise need the same sentence typed three times. So one write fans out
across every line sharing the ordernum, and the list route surfaces the first non-empty note in a group. Consequence worth knowing:
if PowerBuilder wrote DIFFERENT notes to individual lines of one order (it could — its bar wrote only the clicked row), saving here
flattens them to a single note. Given the volume above, that trade was judged fine.

An empty string CLEARS the note. That's deliberate and is the only way to remove one — there is no separate delete.

Scoped to ordertype = 1 in the WHERE clause, not just by the caller passing a customer ordernum, so this route can never touch a
supplier order even if handed one.
=======================================================================================================================================
Request Payload:
{ "ordernum": "BC18665", "note": "chased customer, waiting on reply" }   // note: string, '' clears, max 500 chars

Success Response:
{ "return_code": "SUCCESS", "updated": 2 }    // lines written
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
// LEGACY_STAMP is the shared 'YYYYMMDD HH24:MI:SS' text-stamp format, not one of that module's ordertype-specific predicates —
// safe to share across both stages (see the warning at the top of utils/customerOrders.js about what must NOT be shared).
const { LEGACY_STAMP } = require('../utils/orderStatus');
const { CUSTOMER_ORDERTYPE } = require('../utils/customerOrders');
const logger = require('../utils/logger');

router.use(verifyToken);

// `notes` is character varying with no length constraint in the schema, but a note is a sentence, not a document. Truncating at a
// generous ceiling keeps a fat-fingered paste out of the row rather than rejecting the operator's work outright.
const MAX_NOTE = 500;

router.post('/', async (req, res) => {
  try {
    const { ordernum, note } = req.body || {};

    if (typeof ordernum !== 'string' || ordernum.trim() === '') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ordernum is required' });
    }
    if (typeof note !== 'string') {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'note is required (send "" to clear it)' });
    }

    const clean = note.trim().slice(0, MAX_NOTE);

    const updated = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE orderstatus
            SET notes = $1, updated = ${LEGACY_STAMP}
          WHERE ordernum = $2 AND ordertype = $3`,
        [clean, ordernum.trim(), CUSTOMER_ORDERTYPE]
      );
      return r.rowCount || 0;
    });

    if (updated === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'No customer order lines found for that order' });
    }

    return res.json({ return_code: 'SUCCESS', updated });
  } catch (err) {
    logger.error('[order-status-customer-note] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the note' });
  }
});

module.exports = router;
