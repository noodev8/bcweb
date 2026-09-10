/*
=======================================================================================================================================
API Route: locations_transfer
=======================================================================================================================================
Method: POST
Purpose: Move stock from one rack to another. The shoe comes off one shelf and goes onto another; nothing else about it changes.

THIS IS A MOVE, NOT A REMOVE PLUS AN ADD, and that is the whole reason the route exists rather than the screen calling inv-adjust
twice. A localstock row records who the unit is PROMISED to — `ordernum` when it is picked for a customer order, `allocated = 'amz'`
when it is Amazon's — and inv-adjust's add path mints a fresh '#FREE' / 'unallocated' row from the catalogue. Removing and re-adding
would therefore hand back a free pair and silently un-pick the order still waiting for it, with nothing anywhere recording that it
happened. Carrying a shoe to another shelf changes WHERE it is, not WHO it is for. So:

  - the whole row moves whenever the whole row is going: UPDATE its location, and every other column stays exactly as it was;
  - a partial take SPLITS the row: decrement the source and insert a clone at the destination carrying ordernum / allocated / assigned
    / pickorder / supplier / brand across. That split is the same one amz-pick-allocate.js does when it peels units off a cluster.

A CLUSTER, NOT A ROW, for the reason inv-adjust spells out: two pairs on a shelf can be one row of qty 2 or two rows of qty 1, so the
client hands over every id behind the line it is looking at and the route walks them smallest-first, moving whole rows where it can and
splitting only the last one. Smallest-first means a stray qty=1 row goes before a big row is broken up, which keeps the table tidier
than the alternative.

THE DESTINATION MUST BE A REAL RACK — checked against the `location` table, exactly as goods-in-book.js checks it, and for the same
reason: the screen's rack list also carries places that are not shelves (the 'Ordered' marker turns up in localstock.location and means
the units are still with the supplier). Stock can be moved OFF one of those, which is a genuine tidy-up, but never ONTO one.
C3-Amazon IS allowed as a destination here, unlike Goods In. It is a real bay and moving stock into it is a real job; per
amz-pick-allocate.js a row is on the Amazon gather list because it is NOT at the bay yet, so this quietly does what the Pick screen's
to_amazon does. The client says so before it calls — it is a warning, not a prohibition.

AUDIT USES THE LEGACY PHRASING, because the PowerBuilder Transfer screen has been writing these lines since May and a stock hunt should
not have to know which app moved the shoe: `Transfer <code> from <SRC> >> to <DEST>`, section 'Transfer', with the operator's login
name where PowerBuilder puts the workstation. One line per unit moved, matching how the legacy screen logs a run of them.

Everything is one withTransaction: the shoe leaves one shelf and lands on the other, or neither happens.
=======================================================================================================================================
Request Payload:
{
  "code": "1027720-ARIZONA-47",      // required — the size being moved
  "from": "C3-Front-05",             // required — the rack it is on now
  "to": "C1-04",                     // required — the rack it is going to; must be a real rack in `location`
  "ids": ["WS7-...", "WEB-..."],     // required — every localstock id behind the line (the panel already holds them)
  "units": 1                         // optional, default 1 — how many to move (the screen moves one shoe at a time)
}

Success Response:
{
  "return_code": "SUCCESS",
  "moved": 1,
  "code": "1027720-ARIZONA-47",
  "from": "C3-Front-05",
  "to": "C1-04",
  "fromUnits": 2,                    // that code's units left on the source rack
  "toUnits": 1,                      // and now on the destination
  "movedIds": ["WEB-…"]              // the rows that landed there BECAUSE of this call — hand these straight back to undo it
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    -- code / from / to / ids missing, same rack both ends, or units out of range
"BAD_SHELF"         -- the destination is not a rack in `location`
"NOT_FOUND"         -- none of those ids are still on the source rack (someone else moved or picked them first)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Same ceiling as inv-adjust's MAX_DELTA. The screen moves one shoe at a time; this is here so a typo cannot become a warehouse.
const MAX_UNITS = 50;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const from = typeof body.from === 'string' ? body.from.trim() : '';
    const to = typeof body.to === 'string' ? body.to.trim() : '';
    const units = body.units === undefined ? 1 : Number(body.units);
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((i) => typeof i === 'string' && i.trim() !== '').map((i) => i.trim())))
      : [];

    if (!code || !from || !to || ids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code, from, to and ids are required' });
    }
    if (from.toLowerCase() === to.toLowerCase()) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'That is the rack it is already on' });
    }
    if (!Number.isInteger(units) || units < 1 || units > MAX_UNITS) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `units must be a whole number between 1 and ${MAX_UNITS}` });
    }

    // The logged-in operator, resolved server-side by verifyToken and never trusted from the client (CLAUDE.md).
    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      const stampRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp`);
      const stamp = stampRes.rows[0].stamp;

      // IS THE DESTINATION A SHELF. Read from the racks table rather than trusted from the client, and the table's own spelling is
      // what gets written — so a scan of 'c1-04' can never fork the rack into a second casing nothing else references.
      const shelfRes = await client.query(
        `SELECT location FROM location WHERE lower(btrim(location)) = lower($1) LIMIT 1`, [to]
      );
      if (shelfRes.rows.length === 0) return { fail: 'BAD_SHELF' };
      const destination = shelfRes.rows[0].location.trim();

      // The live cluster: the ids the panel handed over, still on the source rack, still this code, still stock. Locked so a pick or an
      // adjust cannot spend the same unit while we are moving it. Smallest first, so a stray qty=1 row goes before a bigger row is
      // split — the same order inv-adjust peels in.
      const clusterRes = await client.query(
        `SELECT id, qty, ordernum, allocated, groupid, supplier, brand, pickorder, assigned
         FROM localstock
         WHERE id = ANY($1::text[]) AND code = $2 AND lower(btrim(location)) = lower($3)
           AND COALESCE(deleted, 0) = 0 AND qty > 0
         ORDER BY qty ASC, id
         FOR UPDATE`,
        [ids, code, from]
      );
      const cluster = clusterRes.rows;
      if (cluster.length === 0) return { fail: 'NOT_FOUND' };

      // Move whole rows while they fit inside what is left to move; split the one that doesn't. A split clone inherits everything
      // that says who the unit is for — that inheritance IS the difference between a transfer and a remove-plus-add.
      let remaining = units;
      // The rows that ended up at the destination BECAUSE of this call — the ones updated, plus any clone minted by a split. Returned
      // so the screen's undo can send exactly them straight back, rather than guessing at whatever is now sitting there under the same
      // code: a rack can already hold that size under a different promise, and an undo must not move somebody else's pick.
      const movedIds = [];
      for (const r of cluster) {
        if (remaining <= 0) break;
        const qty = Number(r.qty) || 0;
        if (qty <= remaining) {
          await client.query(`UPDATE localstock SET location = $1, updated = $2 WHERE id = $3`, [destination, stamp, r.id]);
          movedIds.push(r.id);
          remaining -= qty;
        } else {
          const cloneId = `WEB-${crypto.randomUUID()}`;
          await client.query(`UPDATE localstock SET qty = qty - $1, updated = $2 WHERE id = $3`, [remaining, stamp, r.id]);
          await client.query(
            `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, deleted, assigned, pickorder, allocated)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12)`,
            [cloneId, stamp, r.ordernum, destination, r.groupid, code, r.supplier, remaining, r.brand,
              r.assigned, r.pickorder, r.allocated]
          );
          movedIds.push(cloneId);
          remaining = 0;
        }
      }
      const moved = units - remaining;   // capped at what the cluster actually held, exactly as inv-adjust caps a remove

      // Legacy phrasing, one line per unit — the PowerBuilder screen's own shape, so a stock hunt reads both apps the same way.
      for (let i = 0; i < moved; i++) {
        await client.query(
          `INSERT INTO bclog (workstation, section, log, date, time, created_at)
           VALUES ($1, 'Transfer', $2,
                   (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
          [changedBy, `Transfer ${code} from ${from} >> to ${destination}`]
        );
      }

      // Fresh counts for both ends, so the screen states what is true rather than what it assumed.
      const countAt = async (loc) => {
        const r = await client.query(
          `SELECT COALESCE(SUM(qty), 0) AS units FROM localstock
           WHERE code = $1 AND lower(btrim(location)) = lower($2) AND COALESCE(deleted, 0) = 0 AND qty > 0`,
          [code, loc]
        );
        return Number(r.rows[0].units) || 0;
      };

      return { moved, to: destination, movedIds, fromUnits: await countAt(from), toUnits: await countAt(destination) };
    });

    if (result.fail === 'BAD_SHELF') {
      return res.json({ return_code: 'BAD_SHELF', message: `${to} is not a rack — stock can come off it, but not go onto it` });
    }
    if (result.fail === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'That line is no longer on this rack — refresh and try again' });
    }
    return res.json({ return_code: 'SUCCESS', code, from, ...result });
  } catch (err) {
    logger.error('[locations-transfer] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to move that stock' });
  }
});

module.exports = router;
