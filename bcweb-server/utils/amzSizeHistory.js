/*
=======================================================================================================================================
Util: amzSizeHistory
=======================================================================================================================================
Purpose: Keep a HISTORY of price and FBA stock for every Amazon size (table amz_size_history, migrations/20261103b_amz_size_history.sql
         — read its header for the owner's decisions). amzfeed only knows today; this is what lets pricing tell "didn't sell because it
         was out of stock" from "didn't sell at that price".

WHERE IT RUNS: inside the Update Amazon commit (routes/amz-import-commit.js), in the SAME transaction, straight after the inventory
report has been written onto amzfeed — so the history is exactly what the import just wrote, and a failed import leaves no history
either. Only when the FBA Inventory report was in the files AND wrote rows. No cron: amzfeed changes only on an import, so a nightly
copy would record stale numbers as that day's reading.

THE RULES (owner, 2026-11-03):
  - CHANGE-ONLY. A size gets a row only when price / live / inbound / total differs from its previous row (reserved left out — it
    moves daily and would defeat this). A size's value on a day = its latest row on or before that day.
  - ONE ROW PER SIZE PER DAY. Each import deletes today's rows and writes them again against the previous day's state, so:
      the same file twice -> the same rows (nothing new);  a later import with new numbers -> today's row holds the latest;
      a later import back to yesterday's values -> no row today (nothing really changed).
  - 3 YEARS, purged here as it writes. A row older than the cut-off goes only if a NEWER row is also at or before the cut-off, i.e.
    it was already superseded when the window starts — so the row in force at the cut-off stays and every day inside the window can
    be read. A size gone from amzfeed loses its last old row too (nothing left to read it for).
  - amz_size_history_run: one line per import DAY, so "nothing changed" and "no import" can be told apart.

Exports:
  recordSizeHistory(client, { inbound, who }) -> { day, sizes, changed, imports }
  readHistoryStatus(db)                       -> the status line for Update Amazon + the dashboard's stale warning
=======================================================================================================================================
*/

const { safeNumeric, LONDON_TODAY_SQL } = require('./sql');

const KEEP_YEARS = 3;
// The dashboard warns only after this many days with NO inventory import. "More than 3": an import on Friday and none over the
// weekend does not warn on Monday (the team doesn't import at weekends); still none by Tuesday does.
const STALE_AFTER_DAYS = 3;
// Serialises two imports at the same moment, which would otherwise race on today's rows (delete + insert on the same keys).
const LOCK_KEY = 'amz_size_history';

/**
 * Record today's state of every amzfeed size. Call AFTER applyStock(), inside the import's transaction.
 * @param client  transaction client
 * @param inbound Map code -> inbound units, from the inventory report rows (sizes not in the report read 0, as applyStock zeroes them)
 * @param who     display name, for the run line
 */
async function recordSizeHistory(client, { inbound, who }) {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [LOCK_KEY]);
  const d = await client.query(`SELECT ${LONDON_TODAY_SQL}::text AS day`);
  const day = d.rows[0].day;

  // Today is written again from scratch against the state BEFORE today — that is the whole one-row-per-day rule.
  await client.query(`DELETE FROM amz_size_history WHERE day = $1`, [day]);

  const codes = [...inbound.keys()];
  const qty = codes.map((c) => inbound.get(c));
  const ins = await client.query(
    `WITH inb AS (
       SELECT code, MAX(n) AS n FROM (SELECT UNNEST($2::text[]) AS code, UNNEST($3::int[]) AS n) x GROUP BY code
     ),
     cur AS (
       SELECT a.code,
              ROUND(${safeNumeric('a.amzprice')}, 2) AS price,
              COALESCE(a.amzlive, 0)  AS live,
              COALESCE(i.n, 0)        AS inbound,
              COALESCE(a.amztotal, 0) AS total
       FROM amzfeed a LEFT JOIN inb i ON i.code = a.code
       WHERE a.code IS NOT NULL AND a.code <> ''
     ),
     prev AS (
       SELECT DISTINCT ON (code) code, price, live, inbound, total
       FROM amz_size_history WHERE day < $1::date
       ORDER BY code, day DESC
     )
     INSERT INTO amz_size_history (code, day, price, live, inbound, total)
     SELECT c.code, $1::date, c.price, c.live, c.inbound, c.total
     FROM cur c LEFT JOIN prev p ON p.code = c.code
     WHERE p.code IS NULL
        OR (c.price, c.live, c.inbound, c.total) IS DISTINCT FROM (p.price, p.live, p.inbound, p.total)`,
    [day, codes, qty]
  );
  const changed = ins.rowCount;

  // 3 years, purged as we write (see header for why the row in force at the cut-off survives).
  await client.query(
    `DELETE FROM amz_size_history h
     WHERE h.day < $1::date - make_interval(years => $2)
       AND ( EXISTS (SELECT 1 FROM amz_size_history n
                     WHERE n.code = h.code AND n.day > h.day AND n.day <= $1::date - make_interval(years => $2))
             OR NOT EXISTS (SELECT 1 FROM amzfeed a WHERE a.code = h.code) )`,
    [day, KEEP_YEARS]
  );
  await client.query(`DELETE FROM amz_size_history_run WHERE day < $1::date - make_interval(years => $2)`, [day, KEEP_YEARS]);

  const sizes = await client.query(`SELECT COUNT(*)::int AS n FROM amzfeed WHERE code IS NOT NULL AND code <> ''`);
  const run = await client.query(
    `INSERT INTO amz_size_history_run (day, imports, sizes, changed, last_at, last_by)
     VALUES ($1::date, 1, $2, $3, now(), $4)
     ON CONFLICT (day) DO UPDATE SET
       imports = amz_size_history_run.imports + 1,
       sizes   = EXCLUDED.sizes,
       changed = EXCLUDED.changed,
       last_at = EXCLUDED.last_at,
       last_by = EXCLUDED.last_by
     RETURNING imports`,
    [day, sizes.rows[0].n, changed, who || null]
  );

  return { day, sizes: sizes.rows[0].n, changed, imports: run.rows[0].imports };
}

/**
 * The status line. Never throws for a missing table (migration not applied yet) — returns null, and the screens show nothing.
 * stale = more than STALE_AFTER_DAYS London days since the last inventory import (none ever = not stale: nothing to warn about yet).
 */
async function readHistoryStatus(db) {
  try {
    const r = await db.query(
      `SELECT to_char(MAX(day), 'DD Mon YYYY')          AS last_day,
              to_char(MIN(day), 'DD Mon YYYY')          AS first_day,
              COUNT(*)::int                             AS days,
              (${LONDON_TODAY_SQL} - MAX(day))::int     AS days_since,
              (SELECT COUNT(*)::int FROM amz_size_history) AS rows,
              pg_total_relation_size('amz_size_history') + pg_total_relation_size('amz_size_history_run') AS bytes
       FROM amz_size_history_run`
    );
    const x = r.rows[0];
    if (!x || x.days === 0) return { lastDay: null, firstDay: null, days: 0, daysSince: null, rows: 0, bytes: Number(x?.bytes || 0), stale: false, staleAfterDays: STALE_AFTER_DAYS };
    return {
      lastDay: x.last_day,
      firstDay: x.first_day,
      days: x.days,
      daysSince: x.days_since,
      rows: x.rows,
      bytes: Number(x.bytes),
      stale: x.days_since > STALE_AFTER_DAYS,
      staleAfterDays: STALE_AFTER_DAYS,
    };
  } catch (err) {
    if (/amz_size_history/.test(err.message)) return null;   // table not there yet
    throw err;
  }
}

module.exports = { recordSizeHistory, readHistoryStatus, KEEP_YEARS, STALE_AFTER_DAYS };
