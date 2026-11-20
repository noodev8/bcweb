/*
=======================================================================================================================================
API Route: me
=======================================================================================================================================
Method: GET
Purpose: Who is signed in — the display name and whether they are an admin. The web app (contexts/AuthContext.tsx) reads this on
         each page load, so switching someone on the Users screen takes effect on their next page load without a new login (the
         login response also carries is_admin, but only once).

ADMIN vs NOT ADMIN (owner, 2026-11-20): an admin sees every screen; not admin sees only the five warehouse screens (Customer Orders,
         Goods In, AMZ Shipment, Pick, Location — the list is bcweb-web/src/lib/userAccess.ts). HIDDEN ON SCREEN ONLY: no API route is
         refused on it (owner: "don't need to worry about server") apart from the Users screen's own write, /user-set-admin.

READ ONLY. The values come from verifyToken, which reads app_users fresh on every request.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "id": 12,
  "display_name": "Dougie",
  "is_admin": false
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"UNAUTHORIZED"   (from verifyToken)
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { verifyToken } = require('../middleware/verifyToken');

router.use(verifyToken);

router.get('/', (req, res) => {
  return res.json({
    return_code: 'SUCCESS',
    id: req.user.id,
    display_name: req.user.display_name,
    is_admin: req.user.is_admin === true,
  });
});

module.exports = router;
