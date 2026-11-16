/*
=======================================================================================================================================
API Route: clearance_amz_lookup
=======================================================================================================================================
Method: POST (a read — POST only to carry the list of codes)
Purpose: The Clearance screen's "Look up on Amazon" button (owner, 2026-11-15): for sizes not selling on Amazon, find each one in
         Amazon's catalogue by its BARCODE and return the ASIN and sales rank — whether or not we have ever listed it. Pressed by the
         owner, never on page load. Rules: utils/amzBarcodeLookup.js (THE copy). STORES NOTHING; writes nothing.
         Also the Amazon Order screen's "Get rank" on a No AMZ size's detail row — one code per tap (owner, 2026-11-15), and the AMZ
         loaded screen's "Check ranks on Amazon" — every barcoded size on that list, in turns of 300 (owner, 2026-11-15).

         Requires auth.
=======================================================================================================================================
Request Payload:
{ "codes": ["M620A-05", "M620A-07"] }     // up to 300 skumap codes

Success Response:
{
  "return_code": "SUCCESS",
  "results": [
    { "code": "M620A-05", "ean": "5050703186001", "found": true, "asin": "B0…", "title": "…", "rank": 45210 },   // rank 0 = no rank
    { "code": "M620A-07", "ean": "5050703186025", "found": false, "asin": null, "title": null, "rank": null }  // not on Amazon at all
  ],                                                                                                         // found null = couldn't ask
  "failed": 0                                // batches Amazon refused (those sizes come back found: null)
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"BAD_REQUEST"      // no codes, or more than 300
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const { lookupCodes } = require('../utils/amzBarcodeLookup');
const logger = require('../utils/logger');

const MAX_CODES = 300;

router.use(verifyToken);

router.post('/', async (req, res) => {
  const codes = Array.isArray(req.body && req.body.codes)
    ? [...new Set(req.body.codes.map((c) => String(c || '').trim()).filter(Boolean))] : [];
  if (codes.length === 0) return res.json({ return_code: 'BAD_REQUEST', message: 'No sizes given' });
  if (codes.length > MAX_CODES) return res.json({ return_code: 'BAD_REQUEST', message: `At most ${MAX_CODES} sizes at a time` });
  try {
    const { results, failed } = await lookupCodes(codes);
    return res.json({ return_code: 'SUCCESS', results, failed });
  } catch (err) {
    logger.error('[clearance-amz-lookup] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not look the sizes up on Amazon' });
  }
});

module.exports = router;
