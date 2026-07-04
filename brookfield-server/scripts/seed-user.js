/*
=======================================================================================================================================
Script: scripts/seed-user.js
=======================================================================================================================================
Purpose: One-off setup script for the app login. It:
  1. Ensures the app_users table exists (CLAUDE.md marks it "create this"). CREATE TABLE IF NOT EXISTS so it's safe to re-run.
  2. Inserts the first application user with a bcrypt-hashed password. There is no public signup (CLAUDE.md) — users are added by
     running this script.

The JWT will carry only the user's id; the display_name inserted here is what lands in price_change_log.changed_by on every price
change. Default display_name is "Andreas" (CLAUDE.md).

Usage (from brookfield-server/):
  node scripts/seed-user.js <username> <password> [displayName]
  npm run seed -- <username> <password> [displayName]
Examples:
  node scripts/seed-user.js andreas 'S0me-Strong-Pass' Andreas
  node scripts/seed-user.js andreas 'S0me-Strong-Pass'          # displayName defaults to "Andreas"

Re-running with an existing username updates that user's password + display_name (so it doubles as a password reset).
No passwords are hard-coded — they are passed on the command line and hashed before storage (API-RULES).
=======================================================================================================================================
*/

require('dotenv').config();
const bcrypt = require('bcrypt');
const { query, pool } = require('../database');
const config = require('../config/config');

async function main() {
  const [, , username, password, displayNameArg] = process.argv;
  const displayName = displayNameArg || 'Andreas';

  if (!username || !password) {
    console.error('Usage: node scripts/seed-user.js <username> <password> [displayName]');
    process.exit(1);
  }

  // 1) Ensure the table exists. Columns per CLAUDE.md: id serial pk, username unique, password_hash, display_name, active default true.
  await query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name  TEXT NOT NULL,
      active        BOOLEAN NOT NULL DEFAULT true
    )
  `);

  // 2) Hash the password with the configured bcrypt cost factor. The plaintext never touches the DB.
  const hash = await bcrypt.hash(password, config.bcryptRounds);

  // 3) Upsert on username: create the user, or reset password/display_name if it already exists. active is (re)set true.
  const result = await query(`
    INSERT INTO app_users (username, password_hash, display_name, active)
    VALUES ($1, $2, $3, true)
    ON CONFLICT (username)
    DO UPDATE SET password_hash = EXCLUDED.password_hash,
                  display_name  = EXCLUDED.display_name,
                  active        = true
    RETURNING id, username, display_name, active
  `, [username, hash, displayName]);

  const u = result.rows[0];
  console.log(`Seeded app user -> id=${u.id} username=${u.username} display_name="${u.display_name}" active=${u.active}`);
  await pool.end();
}

main().catch((err) => {
  console.error('[seed-user] failed:', err.message);
  process.exit(1);
});
