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

// CN00087 (03/11/2026, -£3,337.52 ex VAT on 6003) reverses QF04086, October 2026's Amazon fees entered twice; October's VAT was already
// filed, so the credit sits in November. Moved back to October so both months read true (owner, 2026-11-03).
const CORRECTIONS = [
  { line: 'AMZ|Seller fees', from: '2026-11-01', to: '2026-10-01', amount: -3337.52, why: 'CN00087 reverses duplicate QF04086' },
];

const NAMES = ['ACC|Turnover', 'SHP|Shipping', 'SHP|Advertising', 'AMZ|Seller fees', 'AMZ|Shipping', 'ALL|Wages', 'ALL|Rent', 'ALL|General expenses'];

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
  // Corrections QuickFile can't make itself (a VAT-filed month is locked, so its error is reversed by a credit in a later month).
  // Each moves an amount from the month it was booked in to the month it belongs to, on whichever of the two this file holds.
  for (const k of CORRECTIONS) {
    for (const m of months) {
      if (m.from === k.from) m.lines[k.line] = (m.lines[k.line] || 0) - k.amount;
      if (m.from === k.to) m.lines[k.line] = (m.lines[k.line] || 0) + k.amount;
    }
  }
  for (const m of months) {
    console.log(m.from.slice(0, 7), NAMES.map((k) => `${k} ${(m.lines[k] || 0).toFixed(2)}`).join(' · '));
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
