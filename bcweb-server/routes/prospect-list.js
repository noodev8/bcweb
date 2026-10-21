/*
=======================================================================================================================================
API Route: prospect_list
=======================================================================================================================================
Method: GET
Purpose: Every line on the Prospects screen (the shared notepad of possible NEW products found on Amazon, 2026-10-21) with all of its
         checks and notes, plus "do we already have it?" — any ASIN on the line (the line's own or one typed on a check) that is in
         amzfeed, i.e. one of our Amazon listings. That is the only link to our own stock, and it is a yes/no on purpose (owner: "Just
         if we already have it. Managing our existing stock is for another process").
         The list is small (lines get deleted), so it all comes back in one go — three queries, no N+1 — and the screen does the
         sorting, filtering and "rank was X, now Y" in the browser. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "rows": [
    { "id": 4, "name": "Rieker Y3453 ankle boot black", "asin": "B0C1234567", "rating": "diamond", "owner": "Andreas",
      "created_at": "2026-10-21T09:12:00Z", "updated_at": null,
      "have": { "groupid": "RIE-Y3453-BLACK" } | null,
      "checks": [ { "id": 9, "size": "38", "asin": null, "rank": 2140, "price": 64.99, "sellers": 3, "checked_by": "Summer",
                    "checked_at": "..." } ],                      // oldest first
      "notes":  [ { "id": 2, "body": "38 is the one selling", "created_by": "Summer", "created_at": "..." } ] }   // oldest first
  ]
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
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const [lines, checks, notes] = await Promise.all([
      // have: the first of our Amazon listings matching any ASIN on the line. amzfeed.asin is stored as-is, so compare upper-cased.
      query(`
        SELECT p.id, p.name, p.asin, p.rating, p.owner, p.created_at, p.updated_at,
               (SELECT f.groupid FROM amzfeed f
                 WHERE UPPER(TRIM(f.asin)) IN (SELECT p.asin UNION SELECT c.asin FROM prospect_check c WHERE c.prospect_id = p.id)
                 ORDER BY f.groupid LIMIT 1) AS have_groupid
          FROM prospect p
         ORDER BY p.created_at DESC
      `),
      query(`
        SELECT id, prospect_id, size, asin, rank, price, sellers, checked_by, checked_at
          FROM prospect_check ORDER BY checked_at, id
      `),
      query(`SELECT id, prospect_id, body, created_by, created_at FROM prospect_note ORDER BY created_at, id`),
    ]);

    const byId = new Map();
    const rows = lines.rows.map((p) => {
      const row = {
        id: p.id, name: p.name, asin: p.asin, rating: p.rating, owner: p.owner,
        created_at: p.created_at, updated_at: p.updated_at,
        have: p.have_groupid ? { groupid: p.have_groupid } : null,
        checks: [], notes: [],
      };
      byId.set(p.id, row);
      return row;
    });
    for (const c of checks.rows) {
      byId.get(c.prospect_id)?.checks.push({
        id: c.id, size: c.size, asin: c.asin, rank: c.rank,
        price: c.price === null ? null : Number(c.price), sellers: c.sellers,
        checked_by: c.checked_by, checked_at: c.checked_at,
      });
    }
    for (const n of notes.rows) {
      byId.get(n.prospect_id)?.notes.push({ id: n.id, body: n.body, created_by: n.created_by, created_at: n.created_at });
    }

    return res.json({ return_code: 'SUCCESS', rows });
  } catch (err) {
    logger.error('[prospect-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load prospects' });
  }
});

module.exports = router;
