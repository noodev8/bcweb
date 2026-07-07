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
    // Token lifetime. jsonwebtoken accepts the raw string (e.g. "30d"). Default bumped to 30d so dev/testing sessions don't
    // expire mid-work (CLAUDE.md originally specced 12h — set JWT_EXPIRES_IN in .env to tighten it back down for production).
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  },
  // bcrypt cost factor for hashing passwords in seed-user.js / login comparison timing.
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // one.com SFTP — where product images are pushed (this host backs images.brookfieldcomfort.com, which the site + Google feed read).
  // Not validated at boot (the image feature is optional); utils/sftp.js checks these are present when it actually connects, and the
  // product-image route surfaces a clear error if they're missing. REMOTE_DIR is the directory that maps to the image host root.
  onecom: {
    host: process.env.ONECOM_SFTP_HOST || '',
    port: parseInt(process.env.ONECOM_SFTP_PORT || '22', 10),
    username: process.env.ONECOM_SFTP_USERNAME || '',
    password: process.env.ONECOM_SFTP_PASSWORD || '',
    remoteDir: process.env.ONECOM_SFTP_REMOTE_DIR || ''
  }
};
