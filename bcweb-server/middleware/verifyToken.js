/*
=======================================================================================================================================
Module: middleware/verifyToken.js
=======================================================================================================================================
Purpose: JWT authentication middleware for all protected routes (every pricing route). Implements the API-RULES contract exactly:

  - The JWT carries ONLY the app user's id ({ id }). Nothing else is trusted from the token.
  - On every request we verify the signature, then LOOK UP the user in the DB by that id and attach the fresh details to
    req.user = { id, display_name }. This is why `changed_by` on a price change is always the DB display_name resolved here —
    never a value sent by the client (CLAUDE.md). If someone forged a display name it would be ignored; we only trust the id in a
    validly-signed token, and read the name from app_users.
  - Only active users pass (active = true). A deactivated user's existing tokens stop working immediately.

Note on filename: API-RULES originally mentioned middleware/auth.js, but this project standardised on middleware/verifyToken.js
(now reflected in both API-RULES and CLAUDE.md). We follow that filename; the exported function is `verifyToken`, honouring
API-RULES's rule of a single verifyToken function. `optionalAuth` is provided for future modules that may want to work with or
without a token.

Auth failures return HTTP 200 with return_code UNAUTHORIZED (API-RULES: never send raw 4xx for API-level outcomes).
=======================================================================================================================================
*/

const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { query } = require('../database');
const logger = require('../utils/logger');

// Pull "Bearer <token>" out of the Authorization header. Returns the token string, or null if absent/malformed.
function extractBearer(req) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme === 'Bearer' && token) return token;
  return null;
}

// Verify + resolve the user. Returns { id, display_name } on success, or null on any failure (bad/expired token, unknown/inactive user).
async function resolveUser(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret); // throws on bad signature or expiry
  } catch (err) {
    return null;
  }
  if (!payload || !payload.id) return null;

  // Token is valid — now fetch the CURRENT user record. The token is intentionally thin; the DB is the source of truth (API-RULES).
  const result = await query(
    'SELECT id, display_name FROM app_users WHERE id = $1 AND active = true',
    [payload.id]
  );
  if (result.rows.length === 0) return null; // user deleted or deactivated since the token was issued
  return { id: result.rows[0].id, display_name: result.rows[0].display_name };
}

// Required auth: block the request unless a valid token resolves to an active user.
async function verifyToken(req, res, next) {
  const token = extractBearer(req);
  if (!token) {
    return res.json({ return_code: 'UNAUTHORIZED', message: 'Missing authentication token' });
  }
  try {
    const user = await resolveUser(token);
    if (!user) {
      return res.json({ return_code: 'UNAUTHORIZED', message: 'Invalid or expired session' });
    }
    req.user = user; // { id, display_name } — used by write routes for changed_by
    return next();
  } catch (err) {
    logger.error('[verifyToken] error:', err.message);
    return res.json({ return_code: 'SERVER_ERROR', message: 'Authentication check failed' });
  }
}

// Optional auth: attach req.user if a valid token is present, but never block. For future modules that allow anonymous reads.
async function optionalAuth(req, res, next) {
  const token = extractBearer(req);
  if (token) {
    try {
      const user = await resolveUser(token);
      if (user) req.user = user;
    } catch (err) {
      logger.error('[optionalAuth] error:', err.message);
    }
  }
  return next();
}

module.exports = { verifyToken, optionalAuth };
