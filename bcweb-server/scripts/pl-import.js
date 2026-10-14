/*
=======================================================================================================================================
Script: pl-import
=======================================================================================================================================
Purpose: Load QuickFile's monthly P&L CSV (Reports → Segmented Profit and Loss, by Months → CSV Download) into expense_figure, one
         row per screen line per month, for Reports → Revenue (2026-10-14). Mapping and rules: utils/quickFilePL.js.

             node scripts/pl-import.js <csv> [<csv> ...]            # dry run — prints each month's lines, writes nothing
             node scripts/pl-import.js <csv> [<csv> ...] --apply    # replaces those months' rows

         Overlap is fine: a month already stored is replaced by the newer file. Months not yet ended are skipped. The first run also
         removes the old 12-month figures typed from the P&L screenshots (any row spanning more than one month on these lines), so a
         month is never counted twice.
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { pool, query } = require('../database');
const { withTransaction } = require('../utils/transaction');
const { parsePL } = require('../utils/quickFilePL');

const NAMES = ['ACC|Turnover', 'SHP|Shipping', 'SHP|Advertising', 'AMZ|Seller fees', 'ALL|Wages', 'ALL|Rent', 'ALL|General expenses'];

(async () => {
  const files = process.argv.slice(2).filter((a) => a !== '--apply');
  const apply = process.argv.includes('--apply');
  if (!files.length) throw new Error('Usage: node scripts/pl-import.js <csv> [<csv> ...] [--apply]');
  const today = (await query('SELECT CURRENT_DATE::text AS d')).rows[0].d;

  const byMonth = new Map();   // later files win for the same month
  for (const f of files) {
    const r = parsePL(fs.readFileSync(f, 'utf8'), today);
    if (!r.ok) throw new Error(`${f}: ${r.reason}`);
    if (r.skipped.length) console.log(`${f}: skipped ${r.skipped.join(', ')} (not ended yet)`);
    for (const m of r.months) byMonth.set(m.from, m);
  }
  const months = [...byMonth.values()].sort((a, b) => a.from.localeCompare(b.from));
  for (const m of months) {
    console.log(m.from.slice(0, 7), NAMES.map((k) => `${k.split('|')[1]} ${(m.lines[k] || 0).toFixed(2)}`).join(' · '));
  }
  if (!apply) { console.log('Dry run — nothing written. Add --apply to store.'); return; }

  await withTransaction(async (c) => {
    for (const k of NAMES) {
      const [channel, name] = k.split('|');
      // The screenshot-era 12-month rows on these lines, so nothing is counted twice.
      await c.query(`DELETE FROM expense_figure WHERE channel = $1 AND name = $2 AND period_to - period_from > 31`, [channel, name]);
      for (const m of months) {
        await c.query(`DELETE FROM expense_figure WHERE channel = $1 AND name = $2 AND period_from = $3 AND period_to = $4`,
          [channel, name, m.from, m.to]);
        await c.query(`INSERT INTO expense_figure (channel, name, amount, period_from, period_to, note, created_by)
                       VALUES ($1, $2, $3, $4, $5, 'QuickFile P&L CSV', 'Andreas')`, [channel, name, m.lines[k] || 0, m.from, m.to]);
      }
    }
  });
  console.log(`Stored ${months.length} months (${months[0].from.slice(0, 7)} .. ${months[months.length - 1].from.slice(0, 7)}).`);
})()
  .catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; })
  .finally(() => pool.end());
