/*
=======================================================================================================================================
Module: utils/transaction.js
=======================================================================================================================================
Purpose: withTransaction wrapper for atomic multi-statement writes (API-RULES: "Use transaction wrapper for atomic operations").
         The pricing writes MUST be atomic:
           - W1 (apply price): UPDATE skusummary  +  INSERT price_change_log must either both land or neither. We must never flip
             shopifychange=1 / move the review date without also writing the audit row (and vice-versa).
           - W2 (park): a single UPDATE, but we still run it through the same wrapper for consistency.

How it works: checks ONE client out of the central pool, issues BEGIN, hands that same client to the callback, then COMMITs on
success or ROLLBACKs on any thrown error, and always releases the client. The callback must run all its statements on the passed-in
client (not the shared query() helper) so they share the transaction.
=======================================================================================================================================
*/

const { pool } = require('../database');
const logger = require('./logger');

/*
 * withTransaction(callback)
 *   callback: async (client) => result   — run your queries via client.query(...) so they share the transaction.
 * Returns whatever the callback returns. Rolls back and re-throws if the callback throws.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    // Any failure inside the callback (or the COMMIT) unwinds the whole unit of work.
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      logger.error('[transaction] ROLLBACK failed:', rollbackErr.message);
    }
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { withTransaction };
