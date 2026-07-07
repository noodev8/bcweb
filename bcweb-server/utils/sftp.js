/*
=======================================================================================================================================
Module: utils/sftp.js
=======================================================================================================================================
Purpose: Thin wrapper around ssh2-sftp-client for pushing/removing product images on the one.com host that backs
         images.brookfieldcomfort.com. Credentials come from config.onecom (env only — no hard-coded secrets). Each call opens and
         closes its own short-lived connection (image uploads are infrequent; we don't hold a pool).

         putImage(filename, buffer)  — upload a buffer to <remoteDir>/<filename> (overwrites in place if it exists).
         deleteImage(filename)       — remove <remoteDir>/<filename>; a "does not exist" is treated as success (idempotent cleanup).

         Both throw a clear Error if the SFTP config is incomplete, so the route can return a meaningful return_code rather than a
         confusing connection error.
=======================================================================================================================================
*/

const SftpClient = require('ssh2-sftp-client');
const path = require('path').posix;      // one.com is Unix — always use POSIX '/' joins
const config = require('../config/config');
const logger = require('./logger');

// Ensure we have everything we need before attempting a connection.
function requireConfig() {
  const { host, username, password, remoteDir } = config.onecom;
  const missing = ['host', 'username', 'password', 'remoteDir'].filter((k) => !config.onecom[k]);
  if (missing.length) {
    throw new Error(`one.com SFTP not configured — missing ${missing.map((m) => `ONECOM_SFTP_${m === 'remoteDir' ? 'REMOTE_DIR' : m.toUpperCase()}`).join(', ')} in .env`);
  }
  return { host, username, password, remoteDir };
}

function connectOpts() {
  const { host, username, password } = config.onecom;
  return { host, port: config.onecom.port, username, password };
}

// Upload a Buffer to <remoteDir>/<filename>. Overwrites an existing file (same URL) — the intended re-image behaviour.
async function putImage(filename, buffer) {
  const { remoteDir } = requireConfig();
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

// Delete <remoteDir>/<filename>. Missing file = success (idempotent). Other errors bubble up.
async function deleteImage(filename) {
  const { remoteDir } = requireConfig();
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

module.exports = { putImage, deleteImage };
