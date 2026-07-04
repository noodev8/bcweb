/*
=======================================================================================================================================
Module: utils/logger.js
=======================================================================================================================================
Purpose: One central, level-gated logger so we can control how noisy each server is from a single .env knob (LOG_LEVEL) instead of
         sprinkling `if (process.env...)` checks through every route. All application code should call logger.error/info/debug rather
         than console.* directly. (Standalone CLI scripts like scripts/seed-user.js are the exception — their output is the point and
         they may run without LOG_LEVEL set, so they keep using console.* directly.)

Why an explicit LOG_LEVEL and not NODE_ENV: it lets us flip logging on/off per environment independently of NODE_ENV. In particular
we can temporarily raise the level on the production VPS to debug a live issue WITHOUT changing NODE_ENV (which affects other behaviour).

Levels (each includes everything above it):
    silent  -> nothing at all
    error   -> only genuine failures (DB errors, failed W1/W2 transactions, uncaught route errors)   <-- production default
    info    -> error + request log line + server lifecycle
    debug   -> info + anything extra we add while developing                                          <-- local dev default

Config: set LOG_LEVEL in bcweb-server/.env. If unset/unrecognised we fall back to 'info' (a safe middle ground).
=======================================================================================================================================
*/

// Numeric rank so a single ">= threshold" comparison decides whether a given call prints.
const RANK = { silent: 0, error: 1, info: 2, debug: 3 };

// Resolve the configured level once at load. Unknown/blank values fall back to 'info' rather than throwing — logging config
// should never be able to crash the server.
const configured = (process.env.LOG_LEVEL || '').trim().toLowerCase();
const current = RANK[configured] ?? RANK.info;

module.exports = {
  // Genuine failures. Kept even in production (LOG_LEVEL=error) — this is often the only breadcrumb when a live pricing write fails.
  error: (...args) => { if (current >= RANK.error) console.error(...args); },
  // Routine information: the per-request api log line, server startup, etc. Silenced in production.
  info:  (...args) => { if (current >= RANK.info)  console.log(...args); },
  // Verbose development-only detail. Silenced unless LOG_LEVEL=debug.
  debug: (...args) => { if (current >= RANK.debug) console.log(...args); },
};
