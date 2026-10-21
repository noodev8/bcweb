/*
=======================================================================================================================================
API Route: prospect_check_add
=======================================================================================================================================
Method: POST
Purpose: Record one look at a Prospects line — rank, price and number of sellers as seen on Amazon, typed by hand (owner, 2026-10-21:
         no scraping, no API). Size is optional because rank differs by size on the same listing; an ASIN can be pasted too, since a
         size is usually its own child ASIN (it also feeds "do we already have it?"). At least one of rank / price / sellers is needed —
         parsing is utils/prospect.js → parseCheck. WRITES prospect_check (and touches prospect.updated_at). Requires auth.
=======================================================================================================================================
Request Payload:
{ "prospect_id": 4, "size": "38", "amazon": "B0C1234567", "rank": "58k", "price": "64.99", "sellers": "3" }   // all free text, all but prospect_id optional

Success Response:
{ "return_code": "SUCCESS", "id": 9 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"BAD_ASIN"
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { parseCheck } = require('../utils/prospect');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const prospectId = Number(body.prospect_id);
    if (!Number.isInteger(prospectId) || prospectId < 1) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'prospect_id is required' });
    }
    const c = parseCheck(body);
    if (c.error) return res.json({ return_code: c.error, message: c.message });

    const out = await withTransaction(async (client) => {
      const p = await client.query(`UPDATE prospect SET updated_at = now() WHERE id = $1`, [prospectId]);
      if (p.rowCount === 0) return { error: 'NOT_FOUND', message: 'That line has been deleted' };
      const ins = await client.query(`
        INSERT INTO prospect_check (prospect_id, size, asin, rank, price, sellers, checked_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [prospectId, c.size, c.asin, c.rank, c.price, c.sellers, req.user.display_name]);
      return { id: ins.rows[0].id };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id: out.id });
  } catch (err) {
    logger.error('[prospect-check-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save the check' });
  }
});

module.exports = router;
