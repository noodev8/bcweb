/*
=======================================================================================================================================
API Route: prospect_save
=======================================================================================================================================
Method: POST
Purpose: Add a line to Prospects, or edit one (name, Amazon link/ASIN, rating). The owner is whoever added it (req.user) and doesn't
         change on an edit. The ASIN is pulled out of whatever was pasted — a bare ASIN or any Amazon product URL (utils/prospect.js).
         Refuses an ASIN that is already on another line, naming it and who added it, so two people don't research the same listing.
         A NEW line can carry its first check (what you see on Amazon right now) — saved in the same transaction, so a refused check
         never leaves a half-added line. WRITES prospect (+ prospect_check on add). Requires auth.
=======================================================================================================================================
Request Payload:
{ "id": 4,                                   // omit to add a new line
  "name": "Rieker Y3453 ankle boot black",   // required, up to 200 chars
  "amazon": "https://www.amazon.co.uk/dp/B0C1234567/...",   // optional — ASIN or URL; "" clears it
  "rating": "diamond",                       // optional — 'diamond' | 'good' | 'sketchy' | null
  "check": { "rank": "2,140", "price": "64.99", "sellers": "3", "size": "" } }   // optional, add only — as prospect-check-add

Success Response:
{ "return_code": "SUCCESS", "id": 4, "asin": "B0C1234567" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"BAD_ASIN"          // something was pasted but no ASIN could be found in it
"ALREADY_LISTED"    // that ASIN is on another line
"NOT_FOUND"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { RATINGS, BAD_ASIN_MESSAGE, parseAsin, parseCheck } = require('../utils/prospect');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const id = body.id === undefined || body.id === null ? null : Number(body.id);
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : '';
    const rating = body.rating === undefined || body.rating === null || body.rating === '' ? null : body.rating;
    if (!name || (id !== null && (!Number.isInteger(id) || id < 1)) || (rating !== null && !RATINGS.includes(rating))) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'A name is required' });
    }
    const amazon = typeof body.amazon === 'string' ? body.amazon.trim() : '';
    const asin = amazon ? parseAsin(amazon) : null;
    if (amazon && !asin) {
      return res.json({ return_code: 'BAD_ASIN', message: BAD_ASIN_MESSAGE });
    }
    // The first check, add only. An all-blank check object counts as none (the form always sends one).
    const rawCheck = id === null && body.check && typeof body.check === 'object' ? body.check : null;
    const hasCheck = rawCheck && ['rank', 'price', 'sellers'].some((k) => rawCheck[k] !== undefined && rawCheck[k] !== null && rawCheck[k] !== '');
    const check = hasCheck ? parseCheck(rawCheck) : null;
    if (check && check.error) return res.json({ return_code: check.error, message: check.message });

    const out = await withTransaction(async (client) => {
      if (asin) {
        const dup = await client.query(
          `SELECT name, owner FROM prospect WHERE asin = $1 AND ($2::int IS NULL OR id <> $2) LIMIT 1`, [asin, id]
        );
        if (dup.rows.length) {
          const d = dup.rows[0];
          return { error: 'ALREADY_LISTED', message: `Already on the list: "${d.name}" (added by ${d.owner})` };
        }
      }
      if (id === null) {
        const ins = await client.query(
          `INSERT INTO prospect (name, asin, rating, owner) VALUES ($1, $2, $3, $4) RETURNING id`,
          [name, asin, rating, req.user.display_name]
        );
        const newId = ins.rows[0].id;
        if (check) {
          await client.query(`
            INSERT INTO prospect_check (prospect_id, size, asin, rank, price, sellers, checked_by)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [newId, check.size, check.asin, check.rank, check.price, check.sellers, req.user.display_name]);
        }
        return { id: newId };
      }
      const upd = await client.query(
        `UPDATE prospect SET name = $2, asin = $3, rating = $4, updated_at = now() WHERE id = $1`, [id, name, asin, rating]
      );
      if (upd.rowCount === 0) return { error: 'NOT_FOUND', message: 'That line has been deleted' };
      return { id };
    });

    if (out.error) return res.json({ return_code: out.error, message: out.message });
    return res.json({ return_code: 'SUCCESS', id: out.id, asin });
  } catch (err) {
    logger.error('[prospect-save] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to save' });
  }
});

module.exports = router;
