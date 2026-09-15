/*
=======================================================================================================================================
API Route: locations_add_undo
=======================================================================================================================================
Method: POST
Purpose: UNDO a rack just added from the Location screen — a typo in the name, or the wrong bay. Removes that one row from `location`.

THIS IS NOT "DELETE A RACK", and the guards are what keep it from becoming one:
  - it is addressed by BARCODE, the label locations-add.js just handed back, and the name must match too
  - the rack must have been added in the last UNDO_HOURS (its legacy `updated` stamp) — an established rack is never removable here
  - nothing may be sitting on it. Once stock has gone onto the rack it is a real place, and taking the row away would turn that stock
    into a stray; take the stock off first (or undo that too), then the rack
A real retire-a-rack flow would want to think about printed labels and walking order; this only takes back a mistake made a moment ago.

THE LABEL NUMBER GOES BACK IN THE POOL. locations-add.js hands out highest + 1, so the next rack added gets the same LC number. That is
what makes an immediate undo tidy (no gap), and the reason the window is short: a label is not printed for a rack nobody kept.

AUDIT: one bclog line, section 'Inventory', mirroring the add ("Location Add: ..." / "Location Remove: ... (undo)").
=======================================================================================================================================
Request Payload:
{
  "location": "C3-Front-28",       // required — the name the add returned
  "barcode": "LC-155"              // required — the label the add returned
}

Success Response:
{ "return_code": "SUCCESS", "location": "C3-Front-28", "barcode": "LC-155" }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"NOT_FOUND"         -- no such rack, or it was not added recently enough to undo
"NOT_EMPTY"         -- stock is on it now; nothing was written
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// Same ceiling as locations-restore.js.
const UNDO_HOURS = 12;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const location = typeof body.location === 'string' ? body.location.trim() : '';
    const barcode = typeof body.barcode === 'string' ? body.barcode.trim() : '';
    if (!location || !barcode) return res.json({ return_code: 'MISSING_FIELDS', message: 'location and barcode are required' });

    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      // Same lock locations-add takes, so an add cannot be handed this label while it is being given back.
      await client.query('LOCK TABLE location IN SHARE ROW EXCLUSIVE MODE');

      const rackRes = await client.query(
        `SELECT location, barcode
         FROM location
         WHERE barcode = $1
           AND lower(btrim(location)) = lower($2)
           AND updated >= to_char((now() - make_interval(hours => $3)) AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS')`,
        [barcode, location, UNDO_HOURS]
      );
      if (rackRes.rows.length === 0) return { fail: 'NOT_FOUND' };
      const rack = rackRes.rows[0];

      const heldRes = await client.query(
        `SELECT COALESCE(SUM(qty), 0)::int AS units
         FROM localstock
         WHERE lower(btrim(location)) = lower($1) AND COALESCE(deleted, 0) = 0 AND qty > 0`,
        [location]
      );
      const units = Number(heldRes.rows[0].units) || 0;
      if (units > 0) return { fail: 'NOT_EMPTY', units };

      await client.query(`DELETE FROM location WHERE barcode = $1`, [barcode]);
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Inventory', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [changedBy, `Location Remove: ${rack.location} (${rack.barcode}) (undo)`]
      );
      return { location: rack.location, barcode: rack.barcode };
    });

    if (result.fail === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'That rack was not just added — it cannot be undone from here' });
    }
    if (result.fail === 'NOT_EMPTY') {
      return res.json({ return_code: 'NOT_EMPTY', message: `${location} has ${result.units} ${result.units === 1 ? 'unit' : 'units'} on it now — take them off first` });
    }
    return res.json({ return_code: 'SUCCESS', ...result });
  } catch (err) {
    logger.error('[locations-add-undo] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to undo that rack' });
  }
});

module.exports = router;
