/*
=======================================================================================================================================
API Route: size_gap_release
=======================================================================================================================================
Method: POST
Purpose: RELEASE marked sizes on Size gaps (owner, 2026-11-08) — the way a Not made size ever comes back (it never ends by itself),
         and the early way back for a Park or Ordered. Deletes the size_gap_mark rows; the size shows on the list again if it is
         still a gap. Rules: utils/sizeGaps.js.
         WRITES size_gap_mark (delete) only, plus one bclog row (section 'Size gaps'), in ONE transaction. Requires auth.
=======================================================================================================================================
Request Payload:
{ "sizes": [ { "groupid": "JLH950-BLAZE-BLACK", "uk": 9 }, ... ] }     // 1–500

Success Response:
{ "return_code": "SUCCESS", "released": 1 }
=======================================================================================================================================
Return Codes:
"SUCCESS"
"NO_SIZES"
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { withTransaction } = require('../utils/transaction');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const sizes = (Array.isArray(req.body?.sizes) ? req.body.sizes : [])
    .filter((s) => s && typeof s.groupid === 'string' && s.groupid.trim() && Number.isInteger(s.uk))
    .map((s) => ({ groupid: s.groupid.trim(), uk: s.uk }));
  if (!sizes.length || sizes.length > 500) return res.json({ return_code: 'NO_SIZES', message: 'Pick 1–500 sizes' });

  try {
    const who = req.user.display_name;
    let released = [];
    await withTransaction(async (client) => {
      const r = await client.query(
        `DELETE FROM size_gap_mark k USING unnest($1::text[], $2::int[]) AS t(g, u)
          WHERE k.groupid = t.g AND k.uk = t.u
          RETURNING k.groupid, k.uk, k.mark`,
        [sizes.map((s) => s.groupid), sizes.map((s) => s.uk)]);
      released = r.rows;
      if (released.length) {
        await writeBcLog(client, {
          who,
          section: 'Size gaps',
          log: `Released: ${released.map((x) => `${x.groupid} ${x.uk} (${x.mark})`).join(', ')}`,
        });
      }
    });
    return res.json({ return_code: 'SUCCESS', released: released.length });
  } catch (err) {
    logger.error('[size-gap-release] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to release' });
  }
});

module.exports = router;
