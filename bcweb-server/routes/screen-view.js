/*
=======================================================================================================================================
API Route: screen_view
=======================================================================================================================================
Method: POST
Purpose: Record that the signed-in operator opened a screen. One row in `screen_view`, append-only, never read back by this route.

WHY THE TABLE EXISTS (owner, 2026-09-22): "I will one day wonder which screens are being used and which are ignored, and perhaps by
         who." That cannot be answered retrospectively — nothing in the DB records a page being opened — so collection started before
         the question was asked, deliberately with no report built on it yet. The notes below lived in the migration file; migrations
         are deleted once applied in this repo, so they are kept here instead, where the code that writes the rows is.

WHY ITS OWN TABLE AND NOT bclog, which is the obvious home. bclog audits things that CHANGED, is shared with PowerBuilder, is read by
         a human searching it, and its value rests on every row being a real event. Screen opens are the opposite kind of data:
         ambient, an order of magnitude higher in volume (a working day is a few hundred navigations against a couple of dozen
         actions), and interesting only in aggregate. They would drown the ledger, in a table another application also reads.

PER-PERSON IS IN SCOPE, AND WHAT IT IS FOR (owner, 2026-09-22): "because of training. If one person is using a single screen and we
         feel there is a better screen, then we know what discussion to have." Hold to that, because the same numbers support a very
         different use. The question this answers is WHICH SCREEN SOMEONE IS DOING A JOB ON — somebody working from Inventory all day
         when the product hub would answer it in one hop is a training prompt, and per person is the only way to see it. It is NOT an
         activity measure: a report ranking people by row count would measure how chatty their navigation is, not their output.
         So: break down by person. Rank screens within a person. DO NOT RANK PEOPLE.

WHAT THIS DATA CANNOT TELL YOU, recorded here because it will outlive the conversation. A LOW count does not mean a screen is
         ignored — Finance is once a month BY DESIGN and Birkenstock a few times a year, and both sit bottom of any ranking while
         working exactly as intended. The honest read is "nothing has opened this in 90 days" as a prompt to go and ask why, never a
         league table and never on its own a reason to remove a screen. A HIGH count does not mean a screen is good either:
         re-opening the same screen twenty times can equally mean it does not hold the answer, and for the training question above
         that is often the more interesting reading.

THE TABLE: screen_view (id serial, username varchar NOT NULL, path varchar NOT NULL, viewed_at timestamptz DEFAULT now()), indexed
         (path, viewed_at DESC) and (username, viewed_at DESC) — the two reads it exists for. No foreign key to the users table, so a
         row outlives the account; username rather than a user id for the same reason (and the same reasoning as bclog.workstation).
         viewed_at is UTC — format to Europe/London at READ time. No session or journey column: "how did they get here" is a much
         bigger question, and guessing at it now is how you end up with columns nothing ever reads.
         Volume is a few hundred rows a day, ~70k a year — small enough to leave raw. If it ever needs trimming, roll up into daily
         counts per (username, path) and delete the raw rows behind it rather than dropping history outright.

         The client sends only the browser pathname. The operator is resolved server-side from the JWT (house rule: `changed_by` and
         anything like it is never sent by the client), and the path is normalised and whitelisted by utils/screenPath.js before it
         is stored — an unrecognised route is DROPPED, not saved, so the table's vocabulary stays closed.

WHY THIS ROUTE ALWAYS REPORTS SUCCESS, even when it stored nothing.
         The caller is a fire-and-forget effect on every page in the app. There is nothing it could usefully do with a failure, and
         nothing the operator could act on: a missing usage row is a bookkeeping gap, and it must never surface as an error on a page
         that loaded perfectly well. So an unknown path returns SUCCESS with recorded:false, and even a DB failure is logged
         server-side and returned as SUCCESS. `recorded` exists so this is visible when someone goes looking, rather than silent.
         THE DELIBERATE CONSEQUENCE: this route cannot tell you the collection is broken. If the table ever looks emptier than it
         should, check the server log for [screen-view] rather than the network tab.

No transaction: one insert, nothing to keep consistent with, and it must never hold a connection that a real write is waiting on.
=======================================================================================================================================
Request:
{ "path": "/analytics/winners" }
=======================================================================================================================================
Success Response:
{ "return_code": "SUCCESS", "recorded": true }
{ "return_code": "SUCCESS", "recorded": false }     // unrecognised path, or the insert failed — both deliberately non-fatal
=======================================================================================================================================
Return Codes:
"SUCCESS" · "UNAUTHORIZED"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const { normaliseScreenPath } = require('../utils/screenPath');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const path = normaliseScreenPath(req.body?.path);

  // Unrecognised route. Almost always means a screen shipped without being added to utils/screenPath.js, so it is worth a log line —
  // this is the only way that omission ever becomes visible.
  if (!path) {
    logger.info(`[screen-view] ignored unrecognised path: ${String(req.body?.path).slice(0, 120)}`);
    return res.json({ return_code: 'SUCCESS', recorded: false });
  }

  try {
    await query('INSERT INTO screen_view (username, path) VALUES ($1, $2)', [req.user.display_name || 'unknown', path]);
    return res.json({ return_code: 'SUCCESS', recorded: true });
  } catch (err) {
    // Swallowed on purpose — see the header. Usage telemetry must never be able to make a working page look broken.
    logger.error('[screen-view] insert failed:', err.message);
    return res.json({ return_code: 'SUCCESS', recorded: false });
  }
});

module.exports = router;
