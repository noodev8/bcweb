/*
=======================================================================================================================================
API Route: qz_cert
=======================================================================================================================================
Method: GET
Purpose: The public certificate QZ Tray asks for before it will take a print job (docs/qz-tray-plan.md). Each packing PC trusts this
         same certificate through its `override.crt` (a copy is docs/qz-override.crt), so jobs signed by /qz-sign print with no
         Allow/Block popup. Self-signed, made 2026-10-29, expires 2036-10-26. READ ONLY. Requires auth.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "certificate": "-----BEGIN CERTIFICATE-----\n..."
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"NOT_CONFIGURED"   QZ_CERTIFICATE missing from .env — the browser falls back to its print dialog
"UNAUTHORIZED"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', (req, res) => {
  try {
    // Kept on one line in .env with \n escapes; dotenv expands them in a double-quoted value, the replace covers a single-quoted one.
    const certificate = (process.env.QZ_CERTIFICATE || '').replace(/\\n/g, '\n').trim();
    if (!certificate) return res.json({ return_code: 'NOT_CONFIGURED', message: 'QZ Tray certificate is not set up on the server' });
    return res.json({ return_code: 'SUCCESS', certificate });
  } catch (err) {
    logger.error('[qz-cert] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Could not load the QZ Tray certificate' });
  }
});

module.exports = router;
