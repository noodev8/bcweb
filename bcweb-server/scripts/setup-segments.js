/*
=======================================================================================================================================
Script: scripts/setup-segments.js
=======================================================================================================================================
Purpose: One-off / re-runnable setup for the Segments module — steps 1 & 2 of docs/segments-spec.md. It:
  1. Ensures the three registry tables exist (CREATE TABLE IF NOT EXISTS — safe to re-run):
       - `segment`             — stable id per segment (name = skusummary.segment join key).           [step 1]
       - `area`                — the work areas (Shopify / Amazon / Housekeeping …); grows over time.    [step 2]
       - `segment_area_state`  — one review clock per (segment, area): cadence_days + next_review_date + off. [step 2]
       - `segment_worklog`     — one row per work event (who/when/note); source of "last worked".       [step 3 read / step 5 writes]
  2. Seeds the three starting areas (ON CONFLICT DO NOTHING — never clobbers later cadence/sort edits).
  3. Runs the reconcile once: mirrors `segment` from DISTINCT skusummary.segment AND seeds a clock row for every
     active segment × active area (utils/segmentReconcile.js).

It only ever writes to these NEW tables (and reads skusummary). It does NOT touch product rows. Additive and reversible.

Cadence defaults (days) are seeds, overridable per (segment, area) later: Shopify 30, Amazon 30, Housekeeping 91. The exact set of
cadence "pills" the UI offers is still open (spec §7) — these are just the fallbacks a freshly-seen segment starts on. (Shopify's
cadence is now vestigial — its clock is DERIVED from product review dates, spec §9 — but kept for schema uniformity.)

Usage (from bcweb-server/):
  node scripts/setup-segments.js            # create tables + seed areas + reconcile (commits)
  node scripts/setup-segments.js --dry-run  # do it all on TEMP copies, print counts, roll back — proves it, persists nothing

The API points at the LIVE prod DB, so use --dry-run first to see what the reconcile would do before committing.
=======================================================================================================================================
*/

require('dotenv').config();
const { query, pool } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { reconcileSegments } = require('../utils/segmentReconcile');

// ---- DDL builders. One definition, two flavours: permanent (IF NOT EXISTS) or session TEMP (for --dry-run; ON COMMIT DROP). -------
// A TEMP table shadows the permanent name for this session, so the reconcile SQL and FKs resolve to the temp copies unchanged.
const P = (temp, name, body) =>
  `CREATE ${temp ? 'TEMP ' : ''}TABLE ${temp ? '' : 'IF NOT EXISTS '}${name} (${body})${temp ? ' ON COMMIT DROP' : ''}`;

const SEGMENT_BODY = `
  id          SERIAL PRIMARY KEY,
  name        TEXT UNIQUE NOT NULL,
  active      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()`;

const AREA_BODY = `
  id                   SERIAL PRIMARY KEY,
  name                 TEXT UNIQUE NOT NULL,
  default_cadence_days INT NOT NULL DEFAULT 30,
  sort                 INT NOT NULL DEFAULT 0,
  active               BOOLEAN NOT NULL DEFAULT true`;

const STATE_BODY = `
  segment_id        INT NOT NULL REFERENCES segment(id),
  area_id           INT NOT NULL REFERENCES area(id),
  cadence_days      INT NOT NULL,
  next_review_date  DATE,
  off               BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (segment_id, area_id)`;

// Append-only work log. `worked_by` is the operator's display_name (resolved server-side on write, spec §5). One row per work event.
const WORKLOG_BODY = `
  id          SERIAL PRIMARY KEY,
  segment_id  INT NOT NULL REFERENCES segment(id),
  area_id     INT NOT NULL REFERENCES area(id),
  worked_by   TEXT NOT NULL,
  worked_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  note        TEXT`;

// Seed the starting areas. DO NOTHING so a re-run never overwrites cadence/sort the owner has since tuned.
// NOTE: the third area was originally 'Remove'; renamed to 'Housekeeping' (spec §9.4). Fresh builds seed the new name directly; an
// existing prod DB is migrated by migrations/2026-07-11-rename-remove-to-housekeeping.sql (id stable, so clocks/worklog carry across).
const SEED_AREAS = `
  INSERT INTO area (name, default_cadence_days, sort, active) VALUES
    ('Shopify',      30, 1, true),
    ('Amazon',       30, 2, true),
    ('Housekeeping', 91, 3, true)
  ON CONFLICT (name) DO NOTHING`;

async function createSchema(run, temp) {
  // Order matters: segment_area_state + segment_worklog FK-reference segment + area, so those must exist first.
  await run(P(temp, 'segment', SEGMENT_BODY));
  await run(P(temp, 'area', AREA_BODY));
  await run(P(temp, 'segment_area_state', STATE_BODY));
  if (!temp) {
    // Additive migration for a segment_area_state created before the "off" (N/A) flag existed. IF NOT EXISTS -> safe to re-run.
    await run('ALTER TABLE segment_area_state ADD COLUMN IF NOT EXISTS off BOOLEAN NOT NULL DEFAULT false');
  }
  await run(P(temp, 'segment_worklog', WORKLOG_BODY));
  await run(SEED_AREAS);
}

async function runDryRun() {
  // Build the whole schema as TEMP tables, reconcile against real skusummary, print, then force a ROLLBACK so nothing persists.
  const summary = await withTransaction(async (client) => {
    const run = (text, params) => client.query(text, params);
    await createSchema(run, true);
    const result = await reconcileSegments(client);
    const clocks = await client.query(`
      SELECT s.name AS segment, a.name AS area, st.cadence_days, st.next_review_date
      FROM segment_area_state st
      JOIN segment s ON s.id = st.segment_id
      JOIN area a ON a.id = st.area_id
      ORDER BY s.name, a.sort LIMIT 6`);
    result.sampleClocks = clocks.rows;
    const err = new Error('__dry_run_rollback__');
    err.__summary = result;
    throw err;
  }).catch((err) => {
    if (err.message === '__dry_run_rollback__') return err.__summary;
    throw err;
  });
  return summary;
}

async function main() {
  if (process.argv.includes('--dry-run')) {
    const s = await runDryRun();
    console.log('[setup-segments] DRY RUN (rolled back, nothing persisted):');
    console.log('  counts :', { added: s.added, reactivated: s.reactivated, deactivated: s.deactivated, clocksSeeded: s.clocksSeeded, active: s.active });
    console.log('  sample clocks:');
    console.table(s.sampleClocks);
    await pool.end();
    return;
  }

  // Real run — create the permanent schema, seed areas, reconcile (all idempotent).
  await createSchema((text, params) => query(text, params), false);
  console.log('[setup-segments] segment / area / segment_area_state ready; areas seeded.');

  const summary = await withTransaction((client) => reconcileSegments(client));
  console.log('[setup-segments] reconcile:', summary);

  await pool.end();
}

main().catch((err) => {
  console.error('[setup-segments] failed:', err.message);
  process.exit(1);
});
