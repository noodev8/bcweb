/*
=======================================================================================================================================
API Route: segment-rename
=======================================================================================================================================
Method: POST
Purpose: Step 5 write W-seg-2 (docs/segments-spec.md §2.2, §5, §6-C) — rename a segment as a FIRST-CLASS operation. A rename already
         has to rewrite every product's segment tag, so the tool owns it: because the registry row keeps its `id`, the segment's
         cadence, review clocks and work-log all carry across automatically. (Renaming outside this route — a raw SQL / sheet edit —
         would orphan that history, which is exactly what this endpoint exists to prevent.)

Two UPDATEs, one transaction (either both land or neither):
  1. UPDATE skusummary SET segment = newName WHERE segment = oldName   -- the membership rewrite (touches REAL product rows)
  2. UPDATE segment    SET name    = newName WHERE name    = oldName   -- the registry rename (id unchanged -> clocks/log follow)

Guards:
  - newName is trimmed; it must be non-blank, differ from oldName, and fit skusummary.segment which is VARCHAR(20) (schema landmine —
    a longer name would throw mid-transaction), so we reject > 20 chars up front with NAME_TOO_LONG.
  - oldName must exist in the registry (else NOT_FOUND).
  - newName must NOT already exist in the registry (merging two segments is out of scope for v1, and segment.name is UNIQUE anyway) ->
    NAME_EXISTS.

WARNING: this is the one Segments write that changes live product data (skusummary.segment). Test via BEGIN..ROLLBACK, never commit a
rename to a real segment unless the owner OKs it (CLAUDE.md).
=======================================================================================================================================
Request Payload:
{ "oldName": "IVES-WHITE", "newName": "IVES-WHITE-SS26" }   // both strings, required

Success Response:
{ "return_code": "SUCCESS", "oldName": "IVES-WHITE", "newName": "IVES-WHITE-SS26", "productsMoved": 14 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_NAME"    // newName blank or identical to oldName
"NAME_TOO_LONG"   // newName > 20 chars (skusummary.segment is VARCHAR(20))
"NOT_FOUND"       // oldName not in the registry
"NAME_EXISTS"     // newName already a registry segment (merge not supported)
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

// skusummary.segment is VARCHAR(20) (legacy schema landmine) — the registry name mirrors it, so a rename can't exceed this.
const MAX_SEGMENT_LEN = 20;

router.post('/', async (req, res) => {
  try {
    const body = req.body || {};
    const oldName = body.oldName;
    const newName = typeof body.newName === 'string' ? body.newName.trim() : body.newName;

    // 1) Presence.
    if (!oldName || !newName) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'oldName and newName are required' });
    }
    // 2) newName must be a real change and fit the VARCHAR(20) column (reject up front, not as a mid-transaction DB error).
    if (newName === oldName) {
      return res.json({ return_code: 'INVALID_NAME', message: 'newName must differ from oldName' });
    }
    if (newName.length > MAX_SEGMENT_LEN) {
      return res.json({ return_code: 'NAME_TOO_LONG', message: `newName must be ${MAX_SEGMENT_LEN} characters or fewer` });
    }

    // 3) oldName must exist; newName must be free (no merge). segment.name is UNIQUE, so this also pre-empts a constraint violation.
    const old = await query('SELECT id FROM segment WHERE name = $1', [oldName]);
    if (old.rows.length === 0) {
      return res.json({ return_code: 'NOT_FOUND', message: 'Segment not found' });
    }
    const taken = await query('SELECT 1 FROM segment WHERE name = $1', [newName]);
    if (taken.rows.length > 0) {
      return res.json({ return_code: 'NAME_EXISTS', message: 'A segment with that name already exists (merging is not supported)' });
    }

    // 4) Atomic rename — rewrite product membership AND the registry name together. The registry id is untouched, so the segment's
    //    clocks (segment_area_state) and work-log (segment_worklog) stay attached with no data movement.
    const productsMoved = await withTransaction(async (client) => {
      const upd = await client.query('UPDATE skusummary SET segment = $2 WHERE segment = $1', [oldName, newName]);
      await client.query('UPDATE segment SET name = $2 WHERE name = $1', [oldName, newName]);
      return upd.rowCount;
    });

    return res.json({ return_code: 'SUCCESS', oldName, newName, productsMoved });
  } catch (err) {
    logger.error('[segment-rename] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to rename segment' });
  }
});

module.exports = router;
