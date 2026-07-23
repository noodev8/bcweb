/*
=======================================================================================================================================
API Route: inv_adjust
=======================================================================================================================================
Method: POST
Purpose: Phase 2, slice 1 of the Inventory module — the FIRST writes. Adjust the local stock held at ONE location for ONE size, with a
         +/- delta, exactly like the Order Status +/- (owner, 2026-07-23). This is how the operator fixes a count that is wrong in the
         real world: press - when a pair isn't actually on the shelf, press + when there's more than recorded. Removing the last unit
         clears the size from that location.

WHY A CLUSTER, NOT A ROW. localstock stores the same stock inconsistently: two pairs on a shelf can be one row of qty=2 OR two rows of
qty=1, and a single (code, location, state) can be SIX rows of qty=1 (verified on live data). So a "location line" in the panel is a
CLUSTER of rows, and the client hands us every id in it (it already has them from the grouped locations view). We add/remove against
the cluster, never assuming a single row.

ADD (delta > 0): the mixed-qty store means we don't have to touch existing rows — we just INSERT one new row of qty=delta, cloned from
a cluster row so it inherits that line's location/ordernum/allocated/supplier/brand/code and joins the same cluster (owner: "if easier
to add a row instead of increasing qty, you can"). id is minted as WEB-<uuid> (localstock.id is a varchar PK; the legacy WS-style id is
a workstation tag we no longer need — the login name is the audit trail now).

REMOVE (delta < 0): CAREFUL, because the cluster can be a qty=1 row next to a qty=3 row. We walk the cluster smallest-first and peel
|delta| units off: decrement a row when it has more than we still need, else soft-delete it (deleted=1) and carry on. Capped at what
the cluster actually holds, so a fat-fingered -9 on a 2-pair line removes 2 and stops.

NO LOCKS. Every location and state is editable, INCLUDING C3-Amazon and picked stock (owner: "the operator is in control ... from
anywhere"). The panel still shows the state tag so they can see what they're touching.

AUDIT. Each adjustment writes one bclog row (section 'Inventory'), matching the legacy PowerBuilder phrasing ("Inv Add: <code> to
<loc>" / "Inv Remove: <code> from <loc>") so web and PowerBuilder edits read identically in the log — but with the LOGIN NAME where
workstation used to go, because the point of the log is "which operator did what, when I'm hunting for stock" (owner). bclog.id is a
GENERATED ALWAYS identity, so we never write it — the DB fills it.

Everything is one withTransaction: the stock change AND its audit row either both land or neither.
=======================================================================================================================================
Request Payload:
{
  "code": "1005292-ARIZONA-40",     // required — the size code
  "location": "C3-Front-22",        // required — the shelf line being adjusted
  "delta": -1,                      // required — non-zero integer. + adds units at this location, - removes them.
  "ids": ["WS7-...", "WS1-..."]     // required — every localstock id in this (code, location, state) cluster (from the panel)
}

Success Response:
{ "return_code": "SUCCESS", "added": 0, "removed": 1, "units": 5, "local": 41 }
  // units = the line's new unit total at this code+location; local = the size's new local total across all locations (drives the chip)
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"        // none of the given ids are live any more (raced with another operator), or nothing to remove
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

// Cap one adjustment so a typo (an extra zero) can't insert or delete a large number of units in a single call.
const MAX_DELTA = 50;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const delta = Number(body.delta);
    const ids = Array.isArray(body.ids)
      ? Array.from(new Set(body.ids.filter((i) => typeof i === 'string' && i.trim() !== '').map((i) => i.trim())))
      : [];

    if (!code || !location) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'code and location are required' });
    }
    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > MAX_DELTA) {
      return res.json({ return_code: 'MISSING_FIELDS', message: `delta must be a non-zero integer, at most ${MAX_DELTA} in magnitude` });
    }
    // Slice 1 adjusts EXISTING lines only, so we always have the cluster's ids. Adding to a brand-new location (no ids) is slice 2.
    if (ids.length === 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'ids must list the localstock rows on this line' });
    }

    // The logged-in operator's display name — resolved server-side by verifyToken, never trusted from the client (CLAUDE.md).
    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      // One legacy-format timestamp for every row we touch this call ('YYYYMMDD HH24:MI:SS', Europe/London), so a web-written row is
      // indistinguishable from a PowerBuilder one.
      const stampRes = await client.query(`SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS') AS stamp`);
      const stamp = stampRes.rows[0].stamp;

      // The live cluster: only the given ids that are still this code+location and not deleted. Smallest qty first, so a -1 clears a
      // stray qty=1 row before nibbling a big one. Row-locked so a concurrent adjust on the same line can't double-spend units.
      const clusterRes = await client.query(
        `SELECT id, qty, ordernum, allocated, groupid, supplier, brand, pickorder, assigned
         FROM localstock
         WHERE id = ANY($1::text[]) AND code = $2 AND location = $3 AND COALESCE(deleted, 0) = 0
         ORDER BY qty ASC, id
         FOR UPDATE`,
        [ids, code, location]
      );
      const cluster = clusterRes.rows;
      if (cluster.length === 0) {
        // Every id we were given is gone (another operator cleared the line first). Nothing to add-onto or remove-from.
        return null;
      }

      let added = 0;
      let removed = 0;

      if (delta > 0) {
        // Clone a cluster row so the new units inherit this line's exact state (location/ordernum/allocated/supplier/brand/pickorder),
        // then override only what makes it a fresh "just added" row: a minted id, qty=delta, the new stamp, not-deleted.
        const t = cluster[0];
        const newId = `WEB-${crypto.randomUUID()}`;
        await client.query(
          `INSERT INTO localstock (id, updated, ordernum, location, groupid, code, supplier, qty, brand, deleted, assigned, pickorder, allocated)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 0, $10, $11, $12)`,
          [newId, stamp, t.ordernum, location, t.groupid, code, t.supplier, delta, t.brand, t.assigned, t.pickorder, t.allocated]
        );
        added = delta;
      } else {
        // Peel |delta| units off the cluster, smallest row first. Decrement a row that has more than we still need; otherwise
        // soft-delete it and carry the remainder onto the next row. Capped at what the cluster holds.
        let remaining = Math.abs(delta);
        for (const r of cluster) {
          if (remaining <= 0) break;
          if (r.qty > remaining) {
            await client.query(`UPDATE localstock SET qty = qty - $1, updated = $2 WHERE id = $3`, [remaining, stamp, r.id]);
            remaining = 0;
          } else {
            await client.query(`UPDATE localstock SET deleted = 1, updated = $1 WHERE id = $2`, [stamp, r.id]);
            remaining -= r.qty;
          }
        }
        removed = Math.abs(delta) - remaining;
      }

      // Audit row — legacy phrasing, login name in place of workstation. x<n> suffix only when more than one unit moved, so a normal
      // single +/- reads exactly like a PowerBuilder line.
      const n = Math.abs(delta);
      const suffix = n > 1 ? ` x${n}` : '';
      const logLine = delta > 0 ? `Inv Add: ${code} to ${location}${suffix}` : `Inv Remove: ${code} from ${location}${suffix}`;
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Inventory', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [changedBy, logLine]
      );

      // Fresh totals for the UI: this line's units at code+location, and the size's whole local across every location (the chip count).
      const lineRes = await client.query(
        `SELECT COALESCE(SUM(qty), 0) AS units FROM localstock WHERE code = $1 AND location = $2 AND COALESCE(deleted, 0) = 0`,
        [code, location]
      );
      const sizeRes = await client.query(
        `SELECT COALESCE(SUM(qty), 0) AS local FROM localstock WHERE code = $1 AND COALESCE(deleted, 0) = 0`,
        [code]
      );
      return { added, removed, units: Number(lineRes.rows[0].units) || 0, local: Number(sizeRes.rows[0].local) || 0 };
    });

    if (result === null) {
      return res.json({ return_code: 'NOT_FOUND', message: 'This stock line no longer exists — refresh and try again' });
    }
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[inv-adjust] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to adjust stock' });
  }
});

module.exports = router;
