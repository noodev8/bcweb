/*
=======================================================================================================================================
API Route: locations_add
=======================================================================================================================================
Method: POST
Purpose: Put a new rack in the `location` table, from the Location screen. The shelving goes up, the rack gets a name and a label,
         and from then on it is in the list, scannable, and somewhere stock can be put or transferred to.

THE OPERATOR TYPES THE NAME; THE SERVER CHOOSES EVERYTHING ELSE (owner, 2026-09-15).
  barcode    LC-(highest LC number + 1). `barcode` is the table's primary key and the thing the gun scans, so it is never typed: a typo
             would print a label for a rack that does not exist. The number is taken inside the transaction with the table locked
             against other writers, so two operators adding racks at once cannot be handed the same label. Gaps in the sequence (there
             are many — LC-59..66, LC-70..76) are NOT reused: a retired rack's label may still be stuck to something.
  pickorder  Copied from the racks the new name sits beside. The walking order is per AREA, not per rack — every C3 rack is 30, every
             C1 rack 40 — so "C3-Front-28" takes whatever the other "C3-Front-" racks carry, and "C3-Mezz" whatever the other "C3-"
             racks do. A name with no neighbours ('Brand New Bay', or a prefix nothing else has) gets 100, the value UKD-Tests was
             given, which sorts it after every established area rather than into one.

NAMES ARE UNIQUE CASE-INSENSITIVELY, though nothing in the table enforces it. Every screen joins racks to localstock with
lower(btrim(location)) (see locations-racks.js), so 'c3-front-28' beside 'C3-Front-28' would be one rack in the list with two labels
and a coin toss for which one a scan finds.

A NAME THAT ONLY LOCALSTOCK KNOWS IS ALLOWED. Stock parked under a name that is not in the table shows on the screen as a stray;
adding that name here is exactly how a stray becomes a real rack, and its units come with it without a single localstock write.

A NAME SHAPED LIKE A LABEL ('LC-12') IS REFUSED. The screen reads an LC- scan as a rack label before anything else, so a rack NAMED like
one would be unreachable by name and would shadow whichever rack really carries that label.

AUDIT: one bclog line, section 'Inventory', operator's login name in the workstation column — same as every other write on this screen.
=======================================================================================================================================
Request Payload:
{
  "location": "C3-Front-28"          // required — the rack's name, as it will be printed and spoken. Trimmed; 1-50 characters.
}

Success Response:
{
  "return_code": "SUCCESS",
  "rack": { "location": "C3-Front-28", "barcode": "LC-155", "pickorder": 30 }
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"    -- no name
"INVALID_NAME"      -- too long, or shaped like a rack label
"ALREADY_EXISTS"    -- a rack with that name (any casing) is already in the table; nothing was written
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

// The narrower of the two columns a rack name lives in (location.location is 100, localstock.location 50). A name that fits the table
// but not the stock rows would be a rack nothing could ever be put on.
const MAX_NAME = 50;

// Where a rack with no neighbours sorts — after every established area. See the header.
const DEFAULT_PICKORDER = 100;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    // Inner runs of whitespace collapsed as well as the ends trimmed: a double space is invisible on a label and would make a second
    // rack that looks identical to the first.
    const location = typeof body.location === 'string' ? body.location.trim().replace(/\s+/g, ' ') : '';

    if (!location) return res.json({ return_code: 'MISSING_FIELDS', message: 'A rack name is required' });
    if (location.length > MAX_NAME) {
      return res.json({ return_code: 'INVALID_NAME', message: `A rack name can be at most ${MAX_NAME} characters` });
    }
    if (/^LC-\d+$/i.test(location)) {
      return res.json({ return_code: 'INVALID_NAME', message: `${location} looks like a rack label, not a rack name` });
    }

    const changedBy = req.user.display_name;

    const result = await withTransaction(async (client) => {
      // Blocks other writers to `location` (not readers) until commit, so the duplicate check and the next label number below are
      // both still true when the INSERT lands.
      await client.query('LOCK TABLE location IN SHARE ROW EXCLUSIVE MODE');

      const dupe = await client.query(
        `SELECT location, barcode FROM location WHERE lower(btrim(location)) = lower($1) LIMIT 1`,
        [location]
      );
      if (dupe.rows.length > 0) return { fail: 'ALREADY_EXISTS', existing: dupe.rows[0] };

      const nextRes = await client.query(
        `SELECT COALESCE(MAX(substring(barcode FROM '^LC-([0-9]+)$')::int), 0) + 1 AS n
         FROM location
         WHERE barcode ~ '^LC-[0-9]+$'`
      );
      const barcode = `LC-${nextRes.rows[0].n}`;

      // The neighbours are the racks sharing everything up to the name's last '-': 'C3-Front-28' -> 'c3-front-'. A name with no '-'
      // has no prefix and so no neighbours. The most common pickorder among them, not the max, so one rack someone once re-ordered by
      // hand cannot drag every later addition along with it.
      const cut = location.lastIndexOf('-');
      let pickorder = DEFAULT_PICKORDER;
      if (cut > 0) {
        const prefix = location.slice(0, cut + 1).toLowerCase();
        const orderRes = await client.query(
          `SELECT pickorder
           FROM location
           WHERE left(lower(btrim(location)), $2) = $1 AND pickorder IS NOT NULL
           GROUP BY pickorder
           ORDER BY COUNT(*) DESC, pickorder ASC
           LIMIT 1`,
          [prefix, prefix.length]
        );
        if (orderRes.rows.length > 0) pickorder = Number(orderRes.rows[0].pickorder);
      }

      await client.query(
        `INSERT INTO location (location, barcode, pickorder, updated)
         VALUES ($1, $2, $3, to_char(now() AT TIME ZONE 'Europe/London','YYYYMMDD HH24:MI:SS'))`,
        [location, barcode, pickorder]
      );

      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Inventory', $2,
                 (now() AT TIME ZONE 'Europe/London')::date, to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [changedBy, `Location Add: ${location} (${barcode})`]
      );

      return { rack: { location, barcode, pickorder } };
    });

    if (result.fail === 'ALREADY_EXISTS') {
      return res.json({
        return_code: 'ALREADY_EXISTS',
        message: `${result.existing.location} is already a rack (${result.existing.barcode})`,
      });
    }
    return res.json({ return_code: 'SUCCESS', rack: result.rack });
  } catch (err) {
    logger.error('[locations-add] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to add that rack' });
  }
});

module.exports = router;
