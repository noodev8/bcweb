/*
=======================================================================================================================================
Script: scripts/setup-social.js
=======================================================================================================================================
Purpose: One-off / re-runnable setup for the Social module — Phase 1 of docs/social-module-spec.md. Creates the three `social_` tables
         (CREATE TABLE IF NOT EXISTS — safe to re-run):
           - `social_asset`        — one row per uploaded image (the one.com public URL is the durable bit).
           - `social_post`         — one row per composed post, platform-agnostic.
           - `social_post_target`  — one row per post PER PLATFORM. This is the table that makes Instagram (Phase 3) a publisher
                                     branch rather than a migration, so it exists in full from day one even though v1 is FB-only.

         These are NEW tables — no legacy landmines — so they use proper types throughout: real `timestamptz`, real `jsonb`, no
         `character varying` price nonsense. Nothing here touches product rows; it is additive and reversible (see --drop).

Usage (from bcweb-server/):
  node scripts/setup-social.js            # create tables + index (commits)
  node scripts/setup-social.js --dry-run  # do it all on TEMP copies, print the resulting shape, roll back — proves it, persists nothing
  node scripts/setup-social.js --drop     # DESTRUCTIVE: drop all three tables. Refuses if any post rows exist unless --force.

The API points at the LIVE prod DB, so use --dry-run first.
=======================================================================================================================================
*/

require('dotenv').config();
const { query, pool } = require('../database');
const { withTransaction } = require('../utils/transaction');

const DRY = process.argv.includes('--dry-run');
const DROP = process.argv.includes('--drop');
const FORCE = process.argv.includes('--force');

// ---- DDL. One definition, two flavours: permanent (IF NOT EXISTS) or session TEMP (--dry-run; ON COMMIT DROP). --------------------
// Same trick as setup-segments.js: a TEMP table shadows the permanent name for this session, so FKs between the three resolve to the
// temp copies unchanged and we get a genuine rehearsal rather than a syntax check.
const P = (temp, name, body) =>
  `CREATE ${temp ? 'TEMP ' : ''}TABLE ${temp ? '' : 'IF NOT EXISTS '}${name} (${body})${temp ? ' ON COMMIT DROP' : ''}`;

// public_url is stored, not derived from filename + a base-URL env var. If the host ever moves, already-published posts must keep
// pointing at the URL Meta actually fetched — a derived URL would silently rewrite history.
const ASSET_BODY = `
  id          SERIAL PRIMARY KEY,
  filename    TEXT NOT NULL,
  public_url  TEXT NOT NULL,
  width       INT  NOT NULL,
  height      INT  NOT NULL,
  bytes       INT  NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()`;

// link_url is the BARE collection URL — no UTM. The UTM is built at publish time (utils/socialPublish.js) so `utm_source` can differ
// per platform from one stored post. Storing a UTM'd link would make the same post untrackable across FB and IG.
const POST_BODY = `
  id           SERIAL PRIMARY KEY,
  caption      TEXT NOT NULL,
  link_url     TEXT,
  campaign     TEXT,
  angle        TEXT,
  asset_id     INT NOT NULL REFERENCES social_asset(id),
  scheduled_at TIMESTAMPTZ NOT NULL,
  created_by   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()`;

// status drives the sweep's claim (SCHEDULED -> PUBLISHING is the double-post guard), so it is CHECK-constrained rather than free text:
// a typo'd status would silently make a post invisible to the sweep and it would never go out.
// metrics is jsonb on purpose — Meta renames insight fields (IG impressions -> views), and columns would have us migrating on their
// schedule. Store the raw response, read known keys defensively.
const TARGET_BODY = `
  id           SERIAL PRIMARY KEY,
  post_id      INT  NOT NULL REFERENCES social_post(id) ON DELETE CASCADE,
  platform     TEXT NOT NULL CHECK (platform IN ('FB','IG')),
  status       TEXT NOT NULL DEFAULT 'SCHEDULED'
                 CHECK (status IN ('SCHEDULED','PUBLISHING','POSTED','FAILED','CANCELLED')),
  remote_id    TEXT,
  claimed_at   TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  error        TEXT,
  attempts     INT NOT NULL DEFAULT 0,
  metrics      JSONB,
  metrics_at   TIMESTAMPTZ,
  UNIQUE (post_id, platform)`;

const TABLES = [
  ['social_asset', ASSET_BODY],
  ['social_post', POST_BODY],
  ['social_post_target', TARGET_BODY]
];

// The sweep's hot query is "SCHEDULED targets due now", so lead on status. The volume here is a few posts a day — nothing else needs
// tuning, and an index per whim would be noise.
const INDEXES = [
  ['idx_social_target_status', 'social_post_target (status, post_id)'],
  ['idx_social_post_scheduled', 'social_post (scheduled_at)']
];

async function drop() {
  const { rows } = await query(`SELECT to_regclass('social_post') IS NOT NULL AS present`);
  if (rows[0].present) {
    const { rows: c } = await query(`SELECT COUNT(*)::int AS n FROM social_post`);
    if (c[0].n > 0 && !FORCE) {
      console.error(`REFUSING: social_post has ${c[0].n} row(s). Re-run with --force if you really mean it.`);
      process.exitCode = 1;
      return;
    }
    if (c[0].n > 0) console.log(`--force: dropping ${c[0].n} post row(s) with the tables.`);
  }
  await withTransaction(async (client) => {
    // Reverse order so the FKs come apart cleanly.
    for (const [name] of [...TABLES].reverse()) {
      await client.query(`DROP TABLE IF EXISTS ${name} CASCADE`);
      console.log(`dropped ${name}`);
    }
  });
}

async function create() {
  await withTransaction(async (client) => {
    for (const [name, body] of TABLES) {
      await client.query(P(DRY, name, body));
      console.log(`${DRY ? '[temp] ' : ''}table ready: ${name}`);
    }

    // Additive column patches for installs created by an earlier run of this script. IF NOT EXISTS keeps it a no-op on a fresh create.
    //   claimed_at — stamped when the sweep claims a row (SCHEDULED -> PUBLISHING). The spec's "any PUBLISHING row older than 15
    //   minutes is FAILED (interrupted)" rule is unimplementable without it: status alone records THAT a row was claimed, never WHEN,
    //   so a crashed sweep would strand the row as PUBLISHING forever and the post would never go out or show as failed.
    if (!DRY) {
      await client.query(`ALTER TABLE social_post_target ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`);
      console.log('column ready: social_post_target.claimed_at');
    }

    // TEMP tables get their own indexes implicitly scoped to the session; naming them the same is fine because they vanish on commit.
    for (const [idx, def] of INDEXES) {
      await client.query(`CREATE INDEX ${DRY ? '' : 'IF NOT EXISTS '}${DRY ? `tmp_${idx}` : idx} ON ${def}`);
      console.log(`${DRY ? '[temp] ' : ''}index ready: ${idx}`);
    }

    // Prove the shape — and, on a dry run, prove the FKs and CHECKs actually bite before we commit anything permanent.
    if (DRY) {
      const a = await client.query(
        `INSERT INTO social_asset (filename, public_url, width, height, bytes, uploaded_by)
         VALUES ('probe.jpg','https://social.brookfieldcomfort.com/probe.jpg',1200,628,4768,'setup') RETURNING id`
      );
      const p = await client.query(
        `INSERT INTO social_post (caption, link_url, campaign, asset_id, scheduled_at, created_by)
         VALUES ('probe','https://example.com','birkenstock',$1, now() + interval '1 day','setup') RETURNING id`,
        [a.rows[0].id]
      );
      await client.query(`INSERT INTO social_post_target (post_id, platform) VALUES ($1,'FB')`, [p.rows[0].id]);
      console.log('[temp] insert probe OK (asset -> post -> target)');

      for (const [sql, label] of [
        [`INSERT INTO social_post_target (post_id, platform) VALUES (${p.rows[0].id},'TIKTOK')`, 'platform CHECK'],
        [`INSERT INTO social_post_target (post_id, platform) VALUES (${p.rows[0].id},'FB')`, 'one-target-per-platform UNIQUE'],
        [`INSERT INTO social_post (caption, asset_id, scheduled_at, created_by) VALUES ('x',999999, now(),'setup')`, 'asset FK']
      ]) {
        try {
          await client.query('SAVEPOINT s');
          await client.query(sql);
          console.log(`[temp] !! ${label} did NOT reject — constraint is wrong`);
          await client.query('ROLLBACK TO SAVEPOINT s');
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT s');
          console.log(`[temp] ${label} correctly rejected`);
        }
      }

      const shape = await client.query(
        `SELECT table_name, column_name, data_type
           FROM information_schema.columns
          WHERE table_name IN ('social_asset','social_post','social_post_target')
          ORDER BY table_name, ordinal_position`
      );
      console.log('\n--- resulting shape ---');
      let last = '';
      for (const r of shape.rows) {
        if (r.table_name !== last) { console.log(`  ${r.table_name}`); last = r.table_name; }
        console.log(`    ${r.column_name.padEnd(14)} ${r.data_type}`);
      }
      throw new Error('__DRY_RUN_ROLLBACK__');
    }
  });
}

(async () => {
  try {
    if (DROP) await drop();
    else await create();
    if (!DRY) console.log(`\nDone${DROP ? ' (dropped)' : ''}.`);
  } catch (e) {
    if (e.message === '__DRY_RUN_ROLLBACK__') {
      console.log('\nDRY RUN — rolled back, nothing persisted.');
    } else {
      console.error('FAILED:', e.message);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
})();
