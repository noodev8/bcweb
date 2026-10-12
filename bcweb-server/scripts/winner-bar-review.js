/*
=======================================================================================================================================
Script: scripts/winner-bar-review.js   (is WINNER_BAR stale? — READ ONLY)
=======================================================================================================================================
Purpose: Re-measure the top-20% line that WINNER_BAR (utils/portfolio.js) stands for, so the owner can decide whether to move it.
         Run on request ("is the winner bar stale?") — monthly at most. It changes NOTHING: no write, no bclog row.

         The rule it measures (owner, 2026-10-12): WINNER_BAR = the 12-month revenue NET OF RETURNS of the style at the top-20% line,
         among styles with any net revenue in the window, rounded to the nearest £50. The revenue is exactly the figure
         utils/portfolioStatus.js tags on — SUM(soldprice * qty) over every sales row in the rolling 12 months, all channels, returns
         included — so the line and the tag can't be measuring different things.

         Prints:
           - the line today, and the rounded bar it suggests;
           - what the CURRENT bar captures (styles, % of selling styles, % of revenue and profit) and what the suggestion would;
           - whether the move clears the ~10% "leave it alone" band (see WINNER_BAR's comment);
           - which catalogue styles would join or leave WINNERS at the suggested bar.

         If the owner says move it: edit WINNER_BAR, record the review date in its comment, and press "Update now" on Repricing's
         Status tab (that is what re-tags). This script never does either.

         The pool includes styles that have since been deleted (they still earned the revenue, so they still shape the line), but the
         join/leave lists are skusummary only — a deleted style can't carry a tag.

Usage:
    node scripts/winner-bar-review.js
=======================================================================================================================================
*/

// Load .env by absolute path (relative to this file), so the script runs from any cwd.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query } = require('../database');
const { WINNER_BAR } = require('../utils/portfolio');

const SHARE = 0.2;          // the top 20% of styles
const ROUND_TO = 50;        // £
const LEAVE_ALONE = 0.1;    // a suggested bar within 10% of the current one isn't worth the churn

const gbp = (n) => `£${Math.round(n).toLocaleString('en-GB')}`;
const pct = (a, b) => (b > 0 ? `${((100 * a) / b).toFixed(1)}%` : '—');

async function main() {
  const r = await query(`
    SELECT s.groupid,
           SUM(s.soldprice * s.qty)::float          AS rev,
           COALESCE(SUM(s.profit), 0)::float        AS prof,
           (ss.groupid IS NOT NULL)                 AS in_catalogue,
           ss.portfolio_status                      AS status
    FROM sales s
    LEFT JOIN skusummary ss ON ss.groupid = s.groupid
    WHERE s.groupid IS NOT NULL AND s.groupid <> ''
      AND s.solddate >= CURRENT_DATE - INTERVAL '12 months'
    GROUP BY s.groupid, ss.groupid, ss.portfolio_status
    HAVING SUM(s.soldprice * s.qty) > 0
    ORDER BY rev DESC, s.groupid
  `);
  const rows = r.rows;
  if (rows.length === 0) { console.log('No net revenue in the last 12 months — nothing to measure.'); return; }

  const totalRev = rows.reduce((a, x) => a + x.rev, 0);
  const totalProf = rows.reduce((a, x) => a + x.prof, 0);
  const k = Math.max(1, Math.round(rows.length * SHARE));
  const line = rows[k - 1].rev;
  const suggested = Math.round(line / ROUND_TO) * ROUND_TO;

  // What a bar captures — the tag's own test is strictly greater than.
  const capture = (bar) => {
    const over = rows.filter((x) => x.rev > bar);
    return {
      styles: over.length,
      share: pct(over.length, rows.length),
      rev: pct(over.reduce((a, x) => a + x.rev, 0), totalRev),
      prof: pct(over.reduce((a, x) => a + x.prof, 0), totalProf),
    };
  };
  const now = capture(WINNER_BAR);
  const next = capture(suggested);
  const drift = Math.abs(suggested - WINNER_BAR) / WINNER_BAR;

  console.log(`Winner bar review — ${new Date().toISOString().slice(0, 10)}`);
  console.log(`  Selling styles (12m net revenue > 0): ${rows.length}, ${gbp(totalRev)} revenue`);
  console.log(`  Top-20% line: style #${k} at ${gbp(line)}  ->  suggested bar ${gbp(suggested)}`);
  console.log('');
  console.log(`  Current   ${gbp(WINNER_BAR).padEnd(7)} ${String(now.styles).padStart(4)} styles (${now.share} of styles)  ${now.rev} of revenue  ${now.prof} of profit`);
  console.log(`  Suggested ${gbp(suggested).padEnd(7)} ${String(next.styles).padStart(4)} styles (${next.share} of styles)  ${next.rev} of revenue  ${next.prof} of profit`);
  console.log('');
  console.log(drift <= LEAVE_ALONE
    ? `  Within ${LEAVE_ALONE * 100}% of the current bar (${(drift * 100).toFixed(1)}%) — KEEP ${gbp(WINNER_BAR)}.`
    : `  ${(drift * 100).toFixed(1)}% away from the current bar — worth moving (owner's call).`);

  if (suggested !== WINNER_BAR) {
    const lo = Math.min(WINNER_BAR, suggested);
    const hi = Math.max(WINNER_BAR, suggested);
    const between = rows.filter((x) => x.in_catalogue && x.rev > lo && x.rev <= hi);
    const verb = suggested < WINNER_BAR ? 'would JOIN' : 'would LEAVE';
    console.log('');
    console.log(`  ${between.length} catalogue style(s) ${verb} WINNERS at ${gbp(suggested)}:`);
    for (const x of between) console.log(`    ${x.groupid.padEnd(32)} ${gbp(x.rev).padStart(8)}   now tagged ${x.status || '—'}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[winner-bar-review] failed:', err.message); process.exit(1); });
