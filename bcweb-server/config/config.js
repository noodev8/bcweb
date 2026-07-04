/*
=======================================================================================================================================
Module: config/config.js
=======================================================================================================================================
Purpose: Central place for JWT / auth configuration, read from environment variables. Per API-RULES ("Store auth configuration in
         config/config.js") no route or middleware reads process.env.JWT_* directly — they import from here. Keeps secrets in one
         place and makes it obvious which env vars the auth layer needs.

No secrets are hard-coded. If JWT_SECRET is missing we fail loudly at startup rather than signing tokens with `undefined`.
=======================================================================================================================================
*/

// Fail fast at boot if the signing secret is absent — a server that signs JWTs with an undefined secret is a security hole.
if (!process.env.JWT_SECRET) {
  throw new Error('[config] JWT_SECRET is not set. Add it to bcweb-server/.env before starting the server.');
}

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET,
    // Token lifetime. CLAUDE.md default is 12h. jsonwebtoken accepts the raw string (e.g. "12h").
    expiresIn: process.env.JWT_EXPIRES_IN || '12h'
  },
  // bcrypt cost factor for hashing passwords in seed-user.js / login comparison timing.
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10)
};
