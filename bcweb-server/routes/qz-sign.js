/*
=======================================================================================================================================
API Route: qz_sign
=======================================================================================================================================
Method: POST
Purpose: Signs one QZ Tray request so it prints silently (docs/qz-tray-plan.md). QZ Tray hands the browser a string to sign; the
         browser sends it here and passes the signature back. SHA-512 with RSA, matching qz.security.setSignatureAlgorithm('SHA512') in
         bcweb-web/src/lib/labelPrinter.ts. The private key lives only in .env (QZ_PRIVATE_KEY) — it never reaches the browser, and this
         route is behind auth so only a logged-in user can get a job past QZ Tray's popup. WRITES NOTHING. Requires auth.
=======================================================================================================================================
Request Payload:
{
  "request": "string"    the exact text QZ Tray asked to have signed
}

Success Response:
{
  "return_code": "SUCCESS",
  "signature": "base64..."
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"VALIDATION_ERROR"
"NOT_CONFIGURED"   QZ_PRIVATE_KEY missing from .env
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', (req, res) => {
  try {
    const request = req.body?.request;
    if (typeof request !== 'string' || !request) {
      return res.json({ return_code: 'VALIDATION_ERROR', message: 'Nothing to sign' });
    }
    // One line in .env with \n escapes — see qz-cert.js.
    const key = (process.env.QZ_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!key) return res.json({ return_code: 'NOT_CONFIGURED', message: 'QZ Tray signing key is not set up on the server' });
    const signature = crypto.createSign('RSA-SHA512').update(request).sign(key, 'base64');
    return res.json({ return_code: 'SUCCESS', signature });
  } catch (err) {
    logger.error('[qz-sign] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not sign the print request' });
  }
});

module.exports = router;
