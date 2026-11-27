/*
=======================================================================================================================================
API Route: prospect_check_amazon
=======================================================================================================================================
Method: POST
Purpose: "Check on Amazon" on an open Prospects line (owner, 2026-11-27: "On the current prospects list we check rank and type it
         manually. May as well help us do that with a button now?"). Reads the line's listing from Amazon's API and SAVES it as a check
         — exactly what the team used to type: the overall Fashion rank, the Buy Box price (else the lowest offer) and the sellers,
         with the size Amazon gives for that ASIN, checked_by = whoever pressed it. Reading: utils/amzProspectRead.js (THE copy,
         shared with Search Amazon). Typing a check by hand still works.
         Which listing: the line's own ASIN, else the ASIN on its newest check that has one. None → NO_ASIN.
         An archived line is read-only (the screen hides the button) → ARCHIVED.
         If Amazon gives no rank AND no price, nothing is saved (EMPTY) — a blank check would only push the real one off the row.
         WRITES prospect_check (and touches prospect.updated_at), like prospect-check-add. Requires auth.
=======================================================================================================================================
Request Payload:
{ "prospect_id": 4 }

Success Response:
{ "return_code": "SUCCESS", "id": 31, "check": { "asin": "B0DH4V8QCV", "size": "6 UK", "rank": "865,412", "price": "68.99",
                                                 "sellers": "0 FBA · 1 FBM" } }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"
"ARCHIVED"
"NO_ASIN"         // the line has no Amazon ASIN to check
"AMAZON_ERROR"    // Amazon refused the listing (message says why)
"EMPTY"           // Amazon gave neither a rank nor a price — nothing saved
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { readOne, sellersText, rankText } = require('../utils/amzProspectRead');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const prospectId = Number((req.body || {}).prospect_id);
    if (!Number.isInteger(prospectId) || prospectId < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'prospect_id is required' });
    }

    // The line and the ASIN to read — its own, else its newest check's.
    const { rows } = await query(`
      SELECT p.archived_at IS NOT NULL AS archived,
             COALESCE(p.asin, (SELECT c.asin FROM prospect_check c WHERE c.prospect_id = p.id AND c.asin IS NOT NULL
                                ORDER BY c.checked_at DESC, c.id DESC LIMIT 1)) AS asin
        FROM prospect p WHERE p.id = $1`, [prospectId]);
    if (!rows.length) return res.json({ return_code: 'NOT_FOUND', message: 'That line has been deleted' });
    if (rows[0].archived) return res.json({ return_code: 'ARCHIVED', message: 'Reopen the line to check it' });
    const asin = rows[0].asin;
    if (!asin) return res.json({ return_code: 'NO_ASIN', message: 'Add the Amazon link to this line first (Edit)' });

    // Amazon first, outside the transaction — no DB lock is held while waiting on Amazon.
    let read;
    try {
      read = await readOne(asin);
    } catch (err) {
      return res.json({ return_code: 'AMAZON_ERROR', message: err.message });
    }
    const { item, offers } = read;
    const price = offers.buybox ?? offers.lowest;
    const check = {
      asin,
      size: item.size ? String(item.size).slice(0, 10) : null,
      rank: item.group_rank ? rankText(item.group_rank.rank) : null,
      price: price !== null ? price.toFixed(2) : null,
      sellers: sellersText(offers) || null,
    };
    if (check.rank === null && check.price === null) {
      return res.json({ return_code: 'EMPTY', message: 'Amazon shows no rank or price for this listing just now — nothing saved' });
    }

    const out = await withTransaction(async (client) => {
      const p = await client.query(`UPDATE prospect SET updated_at = now() WHERE id = $1 AND archived_at IS NULL`, [prospectId]);
      if (p.rowCount === 0) return { error: 'NOT_FOUND', message: 'That line has been deleted or archived' };
      const ins = await client.query(`
        INSERT INTO prospect_check (prospect_id, size, asin, rank, price, sellers, checked_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [prospectId, check.size, check.asin, check.rank, check.price, check.sellers, req.user.display_name]);
      return { id: ins.rows[0].id };
    });
    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id: out.id, check });
  } catch (err) {
    logger.error('[prospect-check-amazon] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to check on Amazon' });
  }
});

module.exports = router;
