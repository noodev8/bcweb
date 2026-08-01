/*
=======================================================================================================================================
Module: utils/sftp.js
=======================================================================================================================================
Purpose: Thin wrapper around ssh2-sftp-client for pushing/removing product images on the one.com host that backs
         images.brookfieldcomfort.com. Credentials come from config.onecom (env only — no hard-coded secrets). Each call opens and
         closes its own short-lived connection (image uploads are infrequent; we don't hold a pool).

         putImage(filename, buffer, dir?)  — upload a buffer to <dir>/<filename> (overwrites in place if it exists).
         getImage(filename, dir?)          — download <dir>/<filename> and return it as a Buffer (used to clone an image on Copy).
         deleteImage(filename, dir?)       — remove <dir>/<filename>; a "does not exist" is treated as success (idempotent cleanup).

         `dir` is OPTIONAL and defaults to config.onecom.remoteDir — the product-image webroot, which is what every Add/Modify caller
         wants and passes nothing for. The Social module passes config.social.remoteDir instead, so marketing graphics live in their own
         one.com webroot (social.brookfieldcomfort.com) and never mix with product shots.

         NOTE: these one.com webroot paths are SYMLINKS (sftp.exists() returns 'l', not 'd'). ssh2-sftp-client's recursive mkdir stats
         the parent, sees a non-directory and fails with "Bad path: ... not a directory" — so do NOT try to create subdirectories under
         a webroot from code. Upload straight into it; if a subdirectory is ever genuinely needed, make it in the one.com control panel.

         All throw a clear Error if the SFTP config is incomplete, so the route can return a meaningful return_code rather than a
         confusing connection error.
=======================================================================================================================================
*/

const SftpClient = require('ssh2-sftp-client');
const path = require('path').posix;      // one.com is Unix — always use POSIX '/' joins
const config = require('../config/config');
const logger = require('./logger');

// Ensure we have everything we need before attempting a connection. `dirOverride` (when given) replaces the configured remoteDir --
// the credentials are shared across webroots, only the target directory differs.
function requireConfig(dirOverride) {
  const { host, username, password } = config.onecom;
  const remoteDir = dirOverride || config.onecom.remoteDir;
  const missing = ['host', 'username', 'password'].filter((k) => !config.onecom[k]);
  if (missing.length) {
    throw new Error(`one.com SFTP not configured — missing ${missing.map((m) => `ONECOM_SFTP_${m.toUpperCase()}`).join(', ')} in .env`);
  }
  if (!remoteDir) {
    throw new Error('one.com SFTP not configured — no remote directory (ONECOM_SFTP_REMOTE_DIR, or ONECOM_SOCIAL_REMOTE_DIR for Social)');
  }
  return { host, username, password, remoteDir };
}

function connectOpts() {
  const { host, username, password } = config.onecom;
  return { host, port: config.onecom.port, username, password };
}

// Upload a Buffer to <remoteDir>/<filename>. Overwrites an existing file (same URL) — the intended re-image behaviour.
async function putImage(filename, buffer, dir) {
  const { remoteDir } = requireConfig(dir);
  const sftp = new SftpClient();
  try {
    await sftp.connect(connectOpts());
    const remotePath = path.join(remoteDir, filename);
    await sftp.put(buffer, remotePath);
    logger.info(`[sftp] uploaded ${remotePath} (${buffer.length} bytes)`);
    return remotePath;
  } finally {
    try { await sftp.end(); } catch { /* ignore close errors */ }
  }
}

// Download <remoteDir>/<filename> as a Buffer. `sftp.get` with no destination returns the file contents in memory — the images are
// small (800x800 JPEGs), so we never hit disk. Throws if the file is missing; the caller (Copy) treats that as a best-effort miss.
async function getImage(filename, dir) {
  const { remoteDir } = requireConfig(dir);
  const sftp = new SftpClient();
  try {
    await sftp.connect(connectOpts());
    const remotePath = path.join(remoteDir, filename);
    const buf = await sftp.get(remotePath);           // Buffer when no dst path is given
    logger.info(`[sftp] downloaded ${remotePath} (${buf.length} bytes)`);
    return buf;
  } finally {
    try { await sftp.end(); } catch { /* ignore close errors */ }
  }
}

// Delete <remoteDir>/<filename>. Missing file = success (idempotent). Other errors bubble up.
async function deleteImage(filename, dir) {
  const { remoteDir } = requireConfig(dir);
  const sftp = new SftpClient();
  try {
    await sftp.connect(connectOpts());
    const remotePath = path.join(remoteDir, filename);
    const exists = await sftp.exists(remotePath);
    if (exists) {
      await sftp.delete(remotePath);
      logger.info(`[sftp] deleted ${remotePath}`);
    }
  } finally {
    try { await sftp.end(); } catch { /* ignore close errors */ }
  }
}

module.exports = { putImage, getImage, deleteImage };
