/*
=======================================================================================================================================
Script: scripts/amz-ledger-backfill.js   (one-off: rebuild past FBA stock from the Inventory Ledger -> amz_size_history)
=======================================================================================================================================
Purpose: The size history (utils/amzSizeHistory.js) only starts with the first Update Amazon import after it went live. Amazon's
         Inventory Ledger (Seller Central → Reports → Fulfilment → Inventory Ledger, DETAILED view, CSV) lists every FBA stock movement
         for the last 18 months. This walks each size's stock BACK from today and writes the result into the same table, labelled
         source = 'ledger' (owner, 2026-11-03: "same table for sure"). migrations/20261103c_amz_size_history_ledger.sql.

HOW THE REBUILD WORKS (each rule checked against the 2026-11-03 download — 25k rows, 2 May 2025 – 3 Nov 2026):
  - Only SELLABLE movements count (damaged / defective stock is never for sale).
  - Movements are summed PER DAY before anything else. Read one at a time, a same-day transfer between warehouses (−32 at one, +32
    at another) looks like a dip to nothing that never happened.
  - The walk starts from today's amzfeed.amztotal, NOT amzlive. The ledger counts every pair Amazon physically holds; starting from
    live sent 14 sizes below zero, starting from total left 566 of 571 never below zero and the other 5 out by 1–2 pairs.
    A day that still comes out below zero is written as 0 and counted in the output.
  - The 'Date and Time' column's own date is used (Amazon writes it in UK time, e.g. 2025-05-02T01:00:00+0100).
  - The ledger's LAST day is a part day (the download time), so rows stop the day before it. Today's import figure includes some of
    that last day; the error is a few pairs at most on a size that moved that day.
  - MSKU (Amazon's SKU) → our code through amzfeed.sku. Unknown MSKUs are skipped and counted: the 2026-11-03 file had 341 old listings
    no longer in BCWEB (480 pairs in 18 months) and 87 amzn.gr.* (Amazon's own resale listings for returned pairs — not ours).
  - CHANGE-ONLY like the import: a size's first ledger day is written, then only days its total differs from the day before.
  - Ledger rows hold TOTAL only: live / inbound / price are NULL (the ledger doesn't know them).
  - Never beside a recorded figure: rows only for days BEFORE the first source='import' row (any size). Re-running replaces every
    source='ledger' row, so a later download can be loaded over the top of an earlier one.

Usage:
    node scripts/amz-ledger-backfill.js <ledger.csv>            DRY RUN — works it all out inside a transaction and ROLLS BACK
    node scripts/amz-ledger-backfill.js <ledger.csv> --commit   writes it (one transaction) + a bclog row (section 'Size History')
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { pool } = require('../database');

const WHO = 'Backfill';
const CHUNK = 1000;

/** RFC-4180 CSV (quoted fields, commas inside product titles, doubled quotes) -> array of objects keyed by the header. */
function readCsv(file) {
  const txt = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
  const rows = [];
  let field = '';
  let row = [];
  let quoted = false;
  for (let i = 0; i < txt.length; i += 1) {
    const ch = txt[i];
    if (quoted) {
      if (ch === '"') {
        if (txt[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift() || [];
  return rows.filter((r) => r.length > 1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

const NEEDED = ['MSKU', 'Event Type', 'Quantity', 'Disposition', 'Date and Time'];

function addDay(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Ledger rows -> per MSKU, per day, the net SELLABLE movement; plus the file's first and last day. */
function parseLedger(rows) {
  if (rows.length === 0) throw new Error('The file has no rows');
  const missing = NEEDED.filter((c) => !(c in rows[0]));
  if (missing.length) throw new Error(`Not an Inventory Ledger (detailed view) — missing columns: ${missing.join(', ')}`);

  // Per MSKU, per day: net SELLABLE movement.
  const perSku = new Map();
  let first = '9999';
  let last = '0000';
  for (const r of rows) {
    const day = String(r['Date and Time']).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    if (day < first) first = day;
    if (day > last) last = day;
    if (r.Disposition !== 'SELLABLE') continue;
    const q = Number(r.Quantity);
    if (!Number.isFinite(q)) continue;
    const m = perSku.get(r.MSKU) || new Map();
    m.set(day, (m.get(day) || 0) + q);
    perSku.set(r.MSKU, m);
  }
  return { perSku, first, last };
}

async function main() {
  const file = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!file || !fs.existsSync(file)) throw new Error('Usage: node scripts/amz-ledger-backfill.js <ledger.csv> [--commit]');

  const { perSku, first, last } = parseLedger(readCsv(file));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const msg = await backfill(client, perSku, first, last);
    if (commit) {
      await client.query(
        `INSERT INTO bclog (workstation, section, log, date, time, created_at)
         VALUES ($1, 'Size History', $2, (now() AT TIME ZONE 'Europe/London')::date,
                 to_char(now() AT TIME ZONE 'Europe/London','HH24:MI'), now())`,
        [WHO, msg]
      );
      await client.query('COMMIT');
      console.log('[amz-ledger-backfill] committed');
    } else {
      await client.query('ROLLBACK');
      console.log('[amz-ledger-backfill] DRY RUN — rolled back; run again with --commit to write it');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** The rebuild + write, on a client already inside a transaction (the CLI above, or a rolled-back rehearsal). Returns the log line. */
async function backfill(client, perSku, first, last) {
  {
    const feed = await client.query(`SELECT sku, code, COALESCE(amztotal, 0) AS total FROM amzfeed WHERE sku IS NOT NULL AND code IS NOT NULL`);
    const bySku = new Map(feed.rows.map((f) => [f.sku, f]));

    // Stop before the first recorded import (any size), and before the ledger's own part day.
    const fi = await client.query(`SELECT MIN(day)::text AS d FROM amz_size_history WHERE source = 'import'`);
    let stop = addDay(last, -1);
    if (fi.rows[0].d && fi.rows[0].d <= stop) stop = addDay(fi.rows[0].d, -1);

    const out = [];   // [code, day, total]
    let matched = 0; let skippedGr = 0; let skippedOld = 0; let clippedDays = 0; const clippedSizes = new Set();
    for (const [sku, days] of perSku) {
      const f = bySku.get(sku);
      if (!f) { if (String(sku).startsWith('amzn.gr.')) skippedGr += 1; else skippedOld += 1; continue; }
      matched += 1;
      // Start of the ledger's first day = today's total minus every movement in the file (the last day's included — see header).
      let net = 0;
      for (const q of days.values()) net += q;
      let bal = Number(f.total) - net;
      let prev = null;
      for (let d = first; d <= stop; d = addDay(d, 1)) {
        bal += days.get(d) || 0;
        let v = bal;
        if (v < 0) { v = 0; clippedDays += 1; clippedSizes.add(f.code); }
        if (v !== prev) out.push([f.code, d, v]);
        prev = v;
      }
    }

    const del = await client.query(`DELETE FROM amz_size_history WHERE source = 'ledger'`);
    let written = 0;
    for (let i = 0; i < out.length; i += CHUNK) {
      const chunk = out.slice(i, i + CHUNK);
      const res = await client.query(
        `INSERT INTO amz_size_history (code, day, price, live, inbound, total, source)
         SELECT code, day, NULL, NULL, NULL, total, 'ledger'
         FROM UNNEST($1::text[], $2::date[], $3::int[]) AS x(code, day, total)
         ON CONFLICT (code, day) DO NOTHING`,
        [chunk.map((x) => x[0]), chunk.map((x) => x[1]), chunk.map((x) => x[2])]
      );
      written += res.rowCount;
    }

    const msg = `Ledger backfill ${first} to ${stop}: ${written} rows for ${matched} sizes (replaced ${del.rowCount}); ` +
      `skipped ${skippedOld} old listings + ${skippedGr} Amazon resale; ${clippedDays} size-days below 0 written as 0 (${clippedSizes.size} sizes)`;
    console.log(`[amz-ledger-backfill] ${msg}`);
    if (clippedSizes.size) console.log(`[amz-ledger-backfill] clipped: ${[...clippedSizes].join(', ')}`);
    const size = await client.query(`SELECT pg_size_pretty(pg_total_relation_size('amz_size_history')) AS s`);
    console.log(`[amz-ledger-backfill] table size now ${size.rows[0].s}`);
    return msg;
  }
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .catch((err) => { console.error('[amz-ledger-backfill] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
}

module.exports = { readCsv, parseLedger, backfill };
