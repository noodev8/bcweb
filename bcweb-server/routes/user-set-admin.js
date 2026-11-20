/*
=======================================================================================================================================
API Route: user_set_admin
=======================================================================================================================================
Method: POST
Purpose: Switch one login between admin and not admin — the switch on the Admin -> Users screen (owner, 2026-11-20). An admin sees
         every screen; not admin sees only the five warehouse screens (bcweb-web/src/lib/userAccess.ts). Hidden on screen only — no
         other route is refused on it (see routes/me.js); this one is, because without the check anyone signed in could make
         themselves admin.

GUARDS
  - Admins only (NOT_ADMIN).
  - Not your own row (SELF): no admin can switch themselves off and lock themselves out; another admin does it. This also means the
    last admin can never be switched off (LAST_ADMIN is the belt-and-braces check inside the transaction).

WRITES app_users.is_admin, and one bclog row (section 'Users', who = the admin) so the Log screen shows who changed whose access.
       The change applies on the user's next page load (the web app reads /me).
=======================================================================================================================================
Request Payload:
{
  "user_id": 12,        // number, required
  "is_admin": false     // boolean, required
}

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
"MISSING_FIELDS"
"NOT_ADMIN"
"SELF"
"NOT_FOUND"
"LAST_ADMIN"
"UNAUTHORIZED"   (from verifyToken)
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const { withTransaction } = require('../utils/transaction');
const { verifyToken } = require('../middleware/verifyToken');
const { writeBcLog } = require('../utils/bclog');
const logger = require('../utils/logger');

router.use(verifyToken);

router.post('/', async (req, res) => {
  const { user_id, is_admin } = req.body || {};
  const id = Number(user_id);

  if (!Number.isInteger(id) || id <= 0 || typeof is_admin !== 'boolean') {
    return res.json({ return_code: 'MISSING_FIELDS', message: 'user_id and is_admin (true / false) are required' });
  }
  if (!req.user.is_admin) {
    return res.json({ return_code: 'NOT_ADMIN', message: 'Only an admin can change who is an admin' });
  }
  if (id === req.user.id) {
    return res.json({ return_code: 'SELF', message: 'You can’t change your own access — ask another admin' });
  }

  try {
    const out = await withTransaction(async (client) => {
      const r = await client.query(
        `UPDATE app_users SET is_admin = $1 WHERE id = $2 AND active = true RETURNING id, display_name, is_admin`,
        [is_admin, id]
      );
      if (r.rowCount === 0) return { code: 'NOT_FOUND' };

      // Never leave nobody able to reach this screen. Checked after the update, inside the transaction, so it rolls back.
      const admins = await client.query('SELECT COUNT(*)::int AS n FROM app_users WHERE active = true AND is_admin = true');
      if (admins.rows[0].n === 0) throw Object.assign(new Error('last admin'), { code: 'LAST_ADMIN' });

      const u = r.rows[0];
      await writeBcLog(client, {
        who: req.user.display_name,
        section: 'Users',
        log: `${u.display_name} set to ${u.is_admin ? 'admin (every screen)' : 'not admin (warehouse screens only)'}`,
      });
      return { code: 'SUCCESS', user: u };
    });

    if (out.code === 'NOT_FOUND') {
      return res.json({ return_code: 'NOT_FOUND', message: 'No active user with that id' });
    }
    return res.json({ return_code: 'SUCCESS', id: out.user.id, display_name: out.user.display_name, is_admin: out.user.is_admin === true });
  } catch (err) {
    if (err.code === 'LAST_ADMIN') {
      return res.json({ return_code: 'LAST_ADMIN', message: 'There must always be at least one admin' });
    }
    logger.error('[user-set-admin] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Failed to change the user' });
  }
});

module.exports = router;
