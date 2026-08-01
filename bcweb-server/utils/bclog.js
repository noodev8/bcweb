/*
=======================================================================================================================================
Module: utils/bclog.js
=======================================================================================================================================
Purpose: Write one row to `bclog`, the shared activity log that both this platform and the legacy PowerBuilder app read. It answers
         "who did what, when" across modules — Inventory adjustments, Order Sync runs, Amazon imports, and now Social.

         writeBcLog(client, { who, section, log })   — inside an existing transaction (pass the client)
         logActivity({ who, section, log })          — standalone, its own connection

WHY `workstation` HOLDS A PERSON'S NAME
         In PowerBuilder that column held the machine name. bcweb writes the LOGIN NAME instead, because the point of the log is which
         operator did something, not which PC (owner's call — see routes/inv-adjust.js, which set the precedent). Automated writers
         (the publish sweep) use a clear non-human label like 'Scheduler' so a cron action is never mistaken for a person's.

WHY date AND time ARE SEPARATE, AND LONDON-LOCAL
         Legacy columns: `date` is a DATE and `time` is a 'HH24:MI' string, both in Europe/London, because that is what PowerBuilder
         renders. `created_at` is the real timestamptz and is what any new code should sort and reason on. We write all three.

         `bclog.id` is GENERATED ALWAYS — never write it, the DB fills it.
=======================================================================================================================================
*/

const { query } = require('../database');
const logger = require('./logger');

const SQL = `
  INSERT INTO bclog (workstation, section, log, date, time, created_at)
  VALUES ($1, $2, $3,
          (now() AT TIME ZONE 'Europe/London')::date,
          to_char(now() AT TIME ZONE 'Europe/London', 'HH24:MI'),
          now())`;

// Transaction-aware: pass the client so the audit row lands or rolls back WITH the thing it describes. A log row for a write that
// did not happen is worse than no log row.
async function writeBcLog(client, { who, section, log }) {
  await client.query(SQL, [who || 'unknown', section, String(log).slice(0, 250)]);
}

// Standalone version for callers with nothing to join to (the publish sweep, which deliberately runs outside a transaction).
// Best-effort by design: failing to log must never fail the action that succeeded — a post that went out but wasn't logged is a
// bookkeeping problem, whereas throwing here would turn it into a "failed" post that is actually live.
async function logActivity({ who, section, log }) {
  try {
    await query(SQL, [who || 'unknown', section, String(log).slice(0, 250)]);
  } catch (err) {
    logger.error(`[bclog] could not write "${section}: ${log}":`, err.message);
  }
}

module.exports = { writeBcLog, logActivity };
