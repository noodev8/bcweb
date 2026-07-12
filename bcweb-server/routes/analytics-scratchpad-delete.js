/*
=======================================================================================================================================
API Route: analytics_scratchpad_delete
=======================================================================================================================================
Method: POST
Purpose: Analytics module — New Additions "Scratchpad" DELETE. Removes one note by id (the owner deletes a note once the product has
         been ordered / loaded, or when it's no longer relevant). The scratchpad is a shared team notepad, so any logged-in user may
         delete any note — there is no per-user ownership on it by design.

         POST (not HTTP DELETE) to stay inside the project's return_code envelope convention. Idempotent: deleting an already-gone id
         still returns SUCCESS with deleted:false, so a double-click never errors. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "id": 12   // required, integer
}

Success Response:
{
  "return_code": "SUCCESS",
  "deleted": true    // false if no row with that id existed (already gone)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"   // missing/invalid id
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

router.post('/', async (req, res) => {
  try {
    const id = Number(req.body?.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'A valid note id is required' });
    }
    const result = await query('DELETE FROM scratchpad_note WHERE id = $1', [id]);
    return res.json({ return_code: 'SUCCESS', deleted: (result.rowCount || 0) > 0 });
  } catch (err) {
    logger.error('[analytics-scratchpad-delete] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to delete note' });
  }
});

module.exports = router;
