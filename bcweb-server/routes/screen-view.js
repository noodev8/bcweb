/*
=======================================================================================================================================
API Route: screen_view
=======================================================================================================================================
Method: POST
Purpose: Record that the signed-in operator opened a screen. One row in `screen_view`, append-only, never read back by this route.

         This is TELEMETRY, not an audit trail — see the migration header (20260922e_screen_view.sql) for why it is deliberately not
         written to bclog, and for what the data can and cannot be used to conclude. The per-person breakdown is IN SCOPE and is for
         training ("which screen is this person doing the job on, and is there a better one") — not for measuring anybody's output.

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
