/*
=======================================================================================================================================
API Route: login_user
=======================================================================================================================================
Method: POST
Purpose: Authenticates an application user (username + password) against app_users. On success, signs a JWT carrying ONLY the user's
         id (API-RULES / CLAUDE.md) and returns it together with the display_name (so the web UI can greet the user; display_name is
         also what becomes changed_by on price writes, but that is resolved server-side from the token — never trusted from a client).
=======================================================================================================================================
Request Payload:
{
  "username": "andreas",           // string, required
  "password": "securepassword123"  // string, required
}

Success Response:
{
  "return_code": "SUCCESS",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",  // string, JWT (payload = { id })
  "display_name": "Andreas"                            // string, shown in the UI
}
=======================================================================================================================================
Return Codes:
"SUCCESS"
"MISSING_FIELDS"
"INVALID_CREDENTIALS"
"SERVER_ERROR"
=======================================================================================================================================
*/

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { query } = require('../database');
const config = require('../config/config');
const logger = require('../utils/logger');

router.post('/', async (req, res) => {
  try {
    const { username, password } = req.body || {};

    // 1) Basic presence validation.
    if (!username || !password) {
      return res.json({ return_code: 'MISSING_FIELDS', message: 'Username and password are required' });
    }

    // 2) Look up the active user by username. Only active accounts can log in (CLAUDE.md).
    const result = await query(
      'SELECT id, password_hash, display_name FROM app_users WHERE username = $1 AND active = true',
      [username]
    );

    // 3) Verify the password. We return the SAME generic INVALID_CREDENTIALS whether the username is unknown or the password is
    //    wrong, so we don't leak which usernames exist. When the user is unknown we still run a bcrypt.compare against a throwaway
    //    hash to keep the response time roughly constant (mitigates username-enumeration via timing).
    const user = result.rows[0];
    const hashToCheck = user ? user.password_hash : '$2b$12$0000000000000000000000000000000000000000000000000000a';
    const passwordOk = await bcrypt.compare(password, hashToCheck);

    if (!user || !passwordOk) {
      return res.json({ return_code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' });
    }

    // 4) Sign a thin JWT — id only. Everything else is looked up per-request by verifyToken (API-RULES).
    const token = jwt.sign({ id: user.id }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

    return res.json({ return_code: 'SUCCESS', token, display_name: user.display_name });
  } catch (err) {
    logger.error('[login] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Login failed' });
  }
});

module.exports = router;
