/*
=======================================================================================================================================
API Route: users_list
=======================================================================================================================================
Method: GET
Purpose: Every active login, with whether it is an admin — the Admin -> Users screen (owner, 2026-11-20). An admin sees every screen;
         not admin sees only the five warehouse screens (bcweb-web/src/lib/userAccess.ts). Hidden on screen only — see routes/me.js.

Admins only (NOT_ADMIN otherwise): the web app hides the screen from a non-admin, and this keeps the list of logins off their screen
         even if the URL is typed. No password hashes are ever sent.

`is_you` marks the caller's own row: the screen does not let you change your own access (routes/user-set-admin.js), so no admin can
         lock themselves out.

READ ONLY.
=======================================================================================================================================
Success Response:
{
  "return_code": "SUCCESS",
  "users": [
    { "id": 2, "display_name": "Andreas", "username": "…", "is_admin": true, "is_you": true },
    { "id": 12, "display_name": "Dougie", "username": "…", "is_admin": false, "is_you": false }
  ]
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"NOT_ADMIN"
"UNAUTHORIZED"   (from verifyToken)
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { query } = require('../database');
const { verifyToken } = require('../middleware/verifyToken');
const logger = require('../utils/logger');

router.use(verifyToken);

router.get('/', async (req, res) => {
  if (!req.user.is_admin) {
    return res.json({ return_code: 'NOT_ADMIN', message: 'Only an admin can see the users' });
  }
  try {
    const r = await query(
      `SELECT id, display_name, username, is_admin
         FROM app_users
        WHERE active = true
        ORDER BY is_admin DESC, display_name`
    );
    const users = r.rows.map((u) => ({
      id: u.id,
      display_name: u.display_name,
      username: u.username,
      is_admin: u.is_admin === true,
      is_you: u.id === req.user.id,
    }));
    return res.json({ return_code: 'SUCCESS', users });
  } catch (err) {
    logger.error('[users-list] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to load the users' });
  }
});

module.exports = router;
