/*
=======================================================================================================================================
Module: utils/segmentReconcile.js
=======================================================================================================================================
Purpose: Keep the `segment` registry table mirrored to reality (Segments spec §2.1 / §6-A). Segment *membership* lives in
         `skusummary.segment` (a free-text tag on each product) and is fluid — products get reassigned and segments renamed at any
         time. The registry gives each segment a STABLE `id` that cadence, review clocks and the work-log hang off. This reconcile is
         the ONLY thing that inserts / (de)activates registry rows; it is never hand-maintained.

What it does (idempotent — safe to run on every /segments read, spec §6-A):
  1. INSERT any DISTINCT skusummary.segment name we've never seen.
  2. REACTIVATE a registry row that had gone inactive but whose name is present in skusummary again.
  3. DEACTIVATE a registry row whose name is no longer present in skusummary (kept, not deleted — so its work history survives a
     segment that emptied out or was renamed away).
  4. SEED a clock row (`segment_area_state`) for every active segment × active area that doesn't have one yet — cadence copied
     from the area's default, next_review_date NULL (never worked). ON CONFLICT DO NOTHING preserves any per-segment cadence
     override / review date already set. (Requires the `area` + `segment_area_state` tables — created by scripts/setup-segments.js.)

SAFETY GUARD (spec §8): if the DISTINCT read returns ZERO rows we do NOTHING. A transient empty read must never be allowed to
deactivate the entire registry. (INSERT/REACTIVATE would no-op anyway; DEACTIVATE is the dangerous one, so we bail before it.)

Transaction: pass the withTransaction client when you want this to share a caller's transaction (the /segments endpoint will);
pass nothing and it runs each statement on the shared pool. It never writes to skusummary — only to the `segment` registry table.
=======================================================================================================================================
*/

const { query: poolQuery } = require('../database');
const logger = require('./logger');

// Canonical "which segments exist right now" definition — DISTINCT non-blank skusummary.segment. Mirrors GET /pricing-segments'
// membership rule (segment <> ''), plus btrim() so a whitespace-only tag counts as blank. The raw (un-trimmed) value is what gets
// stored, because that string is the join key back to the products (spec §4).
const PRESENT_NAMES_SQL = `
  SELECT DISTINCT segment
  FROM skusummary
  WHERE segment IS NOT NULL AND btrim(segment) <> ''
`;

/*
 * reconcileSegments(client?)
 *   client: optional pg client from withTransaction to share a transaction; omit to use the shared pool.
 * Returns { added, reactivated, deactivated, active, skipped }.
 */
async function reconcileSegments(client) {
  const run = client ? (text, params) => client.query(text, params) : (text, params) => poolQuery(text, params);

  // Guard: never let an empty read cascade into a mass-deactivate.
  const present = await run(PRESENT_NAMES_SQL);
  if (present.rows.length === 0) {
    logger.warn('[segmentReconcile] skusummary returned 0 segments — skipping reconcile (guard against mass-deactivate)');
    return { added: 0, reactivated: 0, deactivated: 0, clocksSeeded: 0, active: 0, skipped: true };
  }

  // 1) New names → insert (default active=true). Existing names are left untouched by DO NOTHING.
  const inserted = await run(`
    INSERT INTO segment (name, active)
    SELECT DISTINCT segment, true
    FROM skusummary
    WHERE segment IS NOT NULL AND btrim(segment) <> ''
    ON CONFLICT (name) DO NOTHING
    RETURNING name
  `);

  // 2) Names present again but currently inactive → reactivate (keeps their existing id/history).
  const reactivated = await run(`
    UPDATE segment SET active = true
    WHERE active = false
      AND name IN (${PRESENT_NAMES_SQL})
    RETURNING name
  `);

  // 3) Active names no longer present in skusummary → deactivate (never delete). NOT IN is safe here: the subquery excludes NULLs.
  const deactivated = await run(`
    UPDATE segment SET active = false
    WHERE active = true
      AND name NOT IN (${PRESENT_NAMES_SQL})
    RETURNING name
  `);

  // 4) Ensure a clock row exists for every active segment × active area. Seeds cadence from the area default and
  //    next_review_date NULL (never worked → renders overdue/grey). ON CONFLICT preserves existing cadence/review rows.
  const seededClocks = await run(`
    INSERT INTO segment_area_state (segment_id, area_id, cadence_days, next_review_date)
    SELECT s.id, a.id, a.default_cadence_days, NULL
    FROM segment s
    CROSS JOIN area a
    WHERE s.active = true AND a.active = true
    ON CONFLICT (segment_id, area_id) DO NOTHING
    RETURNING segment_id
  `);

  const activeCount = await run('SELECT COUNT(*)::int AS n FROM segment WHERE active = true');

  const summary = {
    added: inserted.rowCount,
    reactivated: reactivated.rowCount,
    deactivated: deactivated.rowCount,
    clocksSeeded: seededClocks.rowCount,
    active: activeCount.rows[0].n,
    skipped: false,
  };
  logger.info(
    `[segmentReconcile] added=${summary.added} reactivated=${summary.reactivated} ` +
    `deactivated=${summary.deactivated} clocksSeeded=${summary.clocksSeeded} active=${summary.active}`
  );
  return summary;
}

module.exports = { reconcileSegments, PRESENT_NAMES_SQL };
