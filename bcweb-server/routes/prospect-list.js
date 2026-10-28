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
         sorting, filtering and "rank was X, now Y" in the browser. ARCHIVED lines come back too (archived_at set; 2026-10-26) — the
         screen's Active | Archive switch splits them; the archive holds 6 months at most, so the list stays small. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "rows": [
    { "id": 4, "name": "Rieker Y3453 ankle boot black", "asin": "B0C1234567", "rating": "diamond", "rrp": "89.95" | null,
      "cost": "55" | null,                                            // typed by hand, free text (2026-10-27)
      "return_on_cost": { "price": 98, "cost": 55, "profit": 5.60, "on_cost_pct": 10.2 } | null,
          // RETURN ON COST (owner, 2026-10-27): a pair's keep on Amazon at the LATEST check's price (the newest check with a price
          // that reads as a number), over the cost — utils/prospect.js → returnOnCost, THE Amazon formula. null without both.
      "owner": "Andreas",
      "archived_at": null | "...", "archived_by": null | "Summer", "outcome": null | "ordered" | "dropped",
      "created_at": "2026-10-21T09:12:00Z", "updated_at": null, "updated_by": null,
      "have": { "groupid": "RIE-Y3453-BLACK" } | null,
      "checks": [ { "id": 9, "size": "38", "asin": null, "rank": "58k", "price": "64.99", "sellers": "3", "checked_by": "Summer",
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
const { moneyNum, returnOnCost } = require('../utils/prospect');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  try {
    const [lines, checks, notes] = await Promise.all([
      // have: the first of our Amazon listings matching any ASIN on the line. amzfeed.asin is stored as-is, so compare upper-cased.
      query(`
        SELECT p.id, p.name, p.asin, p.rating, p.rrp, p.cost, p.owner, p.created_at, p.updated_at, p.updated_by, p.archived_at, p.archived_by, p.outcome,
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
        id: p.id, name: p.name, asin: p.asin, rating: p.rating, rrp: p.rrp, cost: p.cost, owner: p.owner,
        return_on_cost: null,
        created_at: p.created_at, updated_at: p.updated_at, updated_by: p.updated_by,
        archived_at: p.archived_at, archived_by: p.archived_by, outcome: p.outcome,
        have: p.have_groupid ? { groupid: p.have_groupid } : null,
        checks: [], notes: [],
      };
      byId.set(p.id, row);
      return row;
    });
    for (const c of checks.rows) {
      byId.get(c.prospect_id)?.checks.push({
        id: c.id, size: c.size, asin: c.asin, rank: c.rank,
        price: c.price, sellers: c.sellers,   // free text, as typed
        checked_by: c.checked_by, checked_at: c.checked_at,
      });
    }
    // Return on cost from the newest check whose price reads as a number (checks are oldest first).
    for (const row of rows) {
      if (moneyNum(row.cost) === null) continue;
      const priced = [...row.checks].reverse().find((c) => moneyNum(c.price) !== null);
      if (priced) row.return_on_cost = returnOnCost(priced.price, row.cost);
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
