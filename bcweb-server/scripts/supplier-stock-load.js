/*
=======================================================================================================================================
Script: supplier-stock-load — load a supplier's stock list into supplier_stock (owner, 2026-11-27)
=======================================================================================================================================
Usage:  node scripts/supplier-stock-load.js rieker "C:\Users\UserPC\Downloads\rAvailableStockListReport_271126_0301.pdf"          (dry run)
        node scripts/supplier-stock-load.js rieker "<pdf>" --apply                                                                 (writes)

The owner drops the latest list in Downloads and says "load the Rieker list" — no screen (owner: "even if I have to ask you rather
than a front end"). The PDF is read by scripts/supplier-stock-rieker-parse.py (PyMuPDF, via PYTHON_BIN), because the stock levels are
shaded boxes, not text. --apply REPLACES every row for that supplier in one transaction — the list is the whole truth for its day.
Read by the Prospects "Search Amazon" panel (utils/supplierStock.js). migrations/20261127_supplier_stock.sql.
CAN'T GET (owner, 2026-11-27): the same --apply then sets / releases "Can't get" on our Rieker / Remonte sizes from the new list —
utils/supplierStock.js → applyCantGet, through utils/noSupply.js — in the SAME transaction, so the list and the marks never disagree.
The dry run prints how many it would mark and release.
=======================================================================================================================================
*/
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const { execFileSync } = require('child_process');
const { pool } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { applyCantGet } = require('../utils/supplierStock');

const PARSERS = { rieker: 'supplier-stock-rieker-parse.py' };

async function main() {
  const [supplier, pdf] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const apply = process.argv.includes('--apply');
  if (!PARSERS[supplier] || !pdf) throw new Error(`usage: node scripts/supplier-stock-load.js <${Object.keys(PARSERS).join('|')}> <pdf> [--apply]`);
  const python = process.env.PYTHON_BIN;
  if (!python) throw new Error('PYTHON_BIN is not set in .env');

  const out = execFileSync(python, [path.join(__dirname, PARSERS[supplier]), pdf], { maxBuffer: 64 * 1024 * 1024 });
  const parsed = JSON.parse(out.toString('utf8'));
  const listDate = parsed.list_date;
  // A style printed twice would make the one INSERT hit its own row twice (Postgres refuses) — the later print wins.
  const styles = [...new Map(parsed.styles.map((s) => [s.style, s])).values()];
  if (!listDate) throw new Error('No date found on the list');
  if (!styles.length) throw new Error('No styles read from the list');

  const inStock = styles.filter((s) => Object.keys(s.sizes).length);
  const sizes = inStock.reduce((n, s) => n + Object.keys(s.sizes).length, 0);
  console.log(`[supplier-stock-load] ${supplier}: list of ${listDate} — ${styles.length} styles, ${inStock.length} with stock, ${sizes} sizes in stock`);
  const noCost = styles.filter((s) => s.cost === null).length;
  if (noCost) console.log(`  ${noCost} styles without a price`);

  if (!apply) {
    // The marks the new list WOULD set: worked out against the list as it would be, inside a transaction that is rolled back.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await replaceList(client, supplier, styles, listDate);
      const c = await applyCantGet(client, supplier, false);
      console.log(`  Can't get: ${c.sizes} live sizes — would mark ${c.mark.length}, release ${c.release.length}`);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    console.log('  DRY RUN — add --apply to replace the stored list and set the marks');
    return;
  }
  await withTransaction(async (client) => {
    await replaceList(client, supplier, styles, listDate);
    const c = await applyCantGet(client, supplier, true);
    console.log(`  Can't get: ${c.sizes} live sizes — marked ${c.mark.length}, released ${c.release.length}`);
  });
  console.log('  APPLIED');
}

async function replaceList(client, supplier, styles, listDate) {
  await client.query('DELETE FROM supplier_stock WHERE supplier = $1', [supplier]);
  // One set-based insert (no row-by-row): parallel arrays, unnested.
  await client.query(`
    INSERT INTO supplier_stock (supplier, style, season, cost, sizes, list_date)
    SELECT $1, s.style, s.season, s.cost, s.sizes::jsonb, $6::date
      FROM unnest($2::text[], $3::text[], $4::numeric[], $5::text[]) AS s(style, season, cost, sizes)
    ON CONFLICT (supplier, style) DO UPDATE SET season = EXCLUDED.season, cost = EXCLUDED.cost, sizes = EXCLUDED.sizes`,
  [supplier, styles.map((s) => s.style), styles.map((s) => s.season), styles.map((s) => s.cost),
    styles.map((s) => JSON.stringify(s.sizes)), listDate]);
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[supplier-stock-load] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
