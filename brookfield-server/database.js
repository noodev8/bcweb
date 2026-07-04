/*
=======================================================================================================================================
Module: database.js
=======================================================================================================================================
Purpose: Owns the single PostgreSQL connection for the whole Brookfield server. Every route imports the exported `query` helper
         (and, for atomic writes, the withTransaction wrapper in utils/transaction.js which pulls a client from THIS pool).

Why a single central pool:
  - node-postgres opens real TCP connections. Creating a pool per-route (or per-request) would exhaust the database's connection
    slots and add latency. One shared, bounded pool (max 20) is the house style (API-RULES: "Always use central database pooling").
  - The web app (Next.js/Vercel) NEVER talks to Postgres directly. Only this server does. This file is the one and only place
    the DB credentials (DB_* env vars) are read.

Schema landmines this codebase must respect (see CLAUDE.md) — enforced in the route SQL, noted here for context:
  - skusummary price columns (shopifyprice/cost/minshopifyprice/maxshopifyprice) are VARCHAR, not numeric. Read via
    NULLIF(col,'')::numeric; write shopifyprice as a 2dp STRING.
  - Never read stock from skusummary.stockvariants/variants (stale). Derive live stock from localstock.
=======================================================================================================================================
*/

const { Pool } = require('pg');

// -------------------------------------------------------------------------------------------------------------------------------
// The one shared connection pool. Built entirely from environment variables — no hard-coded credentials (API-RULES / CLAUDE.md).
// These DB_* values match the owner's existing Python scripts (copied from C:\scripts\.env).
// -------------------------------------------------------------------------------------------------------------------------------
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 20,                      // cap concurrent connections so we never starve the shared production DB
  idleTimeoutMillis: 30000,     // release idle clients after 30s
  connectionTimeoutMillis: 2000 // fail fast (2s) if the DB is unreachable rather than hanging a request
});

// Surface unexpected pool-level errors (e.g. a backend connection dropped) instead of crashing silently.
pool.on('error', (err) => {
  console.error('[database] Unexpected idle client error:', err.message);
});

/*
 * query(text, params)
 * Convenience wrapper for one-off, parameterised queries. ALWAYS pass values via `params` ($1, $2, ...) — never string-interpolate
 * user input into `text` (SQL injection guardrail, CLAUDE.md). Checks a client out of the pool, runs the query, and always releases
 * the client back — even if the query throws — via finally.
 */
async function query(text, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
}

module.exports = { pool, query };
