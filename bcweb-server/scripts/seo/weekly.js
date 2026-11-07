/*
=======================================================================================================================================
Script: scripts/seo/weekly.js   (THE SEO progress report — READ ONLY)
=======================================================================================================================================
Purpose: The scoreboard and the breakdown, in one run: trailing-12-month organic clicks (THE number), organic 7d / 28d, organic vs
         paid, then site → page type → page, and the CTR-vs-position curve with the pages earning below their own band.

         Target is CLICKS. Impressions say whether we are shown at all, position whether anyone looks there, CTR whether being shown
         earned the click — all diagnostics. Never judge on 7d / 28d (in July that is sandals, not progress): a 12-month window holds
         every season once, so it only moves when something real changed. See docs/seo/README.md.

         Stores nothing. Search Console serves 16 months retroactively. The owner decided (2026-11-07) NOT to keep a longer monthly
         history ("Dont need that long history") — so the trailing-12 line has only the few points GSC's 16 months allow.

         Paid clicks come from google_campaign_daily (the Google Ads CSV import on BCWEB's Google Ads screen). It is campaign-level
         and lags GSC, so it is an outline only; a window with missing days is marked partial, not read as a fall.

Moved from C:\scripts\seo\weekly.py (2026-11-07). Same windows, bands and rules.

Usage:
    node scripts/seo/weekly.js                    (the full report)
    node scripts/seo/weekly.js --trend            (trailing 12 + every month GSC holds, then stop)
    node scripts/seo/weekly.js --type collections (narrow the page sections to one type)
    node scripts/seo/weekly.js --top 25           (rows per section, default 15)
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const { parseArgs } = require('util');
const { gscQuery, gscEnd, addDays, ymd } = require('../../utils/searchConsole');
const { classify, short, totals, num, pct, signed, L, R, rule } = require('../../utils/seo');

// CTR-vs-position bands: narrow near the top (CTR moves fast there), wide further out (flat, few pages). MIN_IMPR keeps a page with
// a handful of impressions from setting a band's median on noise.
const BANDS = [[1, 3], [3, 5], [5, 7], [7, 9], [9, 11], [11, 14], [14, 20], [20, 100]];
const MIN_IMPR = 250;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const bandOf = (pos) => { const b = BANDS.find(([lo, hi]) => pos >= lo && pos < hi); return b ? `${b[0]}-${b[1]}` : null; };

/*
 * Every month GSC still holds: { key, clicks, impr, complete }. Partial months (the current one, and the earliest — cut by the
 * 16-month limit) are flagged, not dropped: they are real data, but set against a full month they invent a fall that is only
 * missing days.
 */
async function monthly(end) {
  const rows = await gscQuery({ start: addDays(end, -16 * 31), end, dimensions: ['date'] });
  if (!rows.length) return [];
  const months = new Map();
  for (const r of rows) {
    const k = r.keys[0].slice(0, 7);
    const m = months.get(k) || { clicks: 0, impr: 0 };
    m.clicks += r.clicks; m.impr += r.impressions;
    months.set(k, m);
  }
  const dataStart = rows.reduce((a, r) => (r.keys[0] < a ? r.keys[0] : a), rows[0].keys[0]);
  const endS = ymd(end);
  return [...months.keys()].sort().map((key) => {
    const [y, mo] = key.split('-').map(Number);
    const first = `${key}-01`;
    const last = ymd(new Date(y, mo, 0));          // day 0 of next month = last day of this one
    return { key, ...months.get(key), complete: first >= dataStart && last <= endS };
  });
}

// Trailing-12 totals, one per complete month. Its month-on-month change IS the year-over-year change for the month that rolled in.
function rolling12(months) {
  const full = months.filter((m) => m.complete);
  const out = [];
  for (let i = 11; i < full.length; i++) {
    const w = full.slice(i - 11, i + 1);
    out.push({ key: full[i].key, clicks: w.reduce((a, m) => a + m.clicks, 0), impr: w.reduce((a, m) => a + m.impr, 0) });
  }
  return out;
}

function printTrend(months) {
  console.log(rule(74));
  console.log('MONTHLY - the chart. Compare a month to the SAME month a year back.');
  console.log(rule(74));
  if (!months.length) { console.log('  No data.'); return; }
  const peak = Math.max(...months.map((m) => m.clicks)) || 1;
  const byKey = new Map(months.map((m) => [m.key, m]));
  console.log(`  ${L('month', 9)} ${R('clicks', 7)} ${R('impr', 9)} ${R('CTR', 6)} ${R('vs yr', 7)}`);
  for (const m of months) {
    const ly = byKey.get(`${Number(m.key.slice(0, 4)) - 1}${m.key.slice(4)}`);
    // Only compare complete months to complete months.
    const yoy = ly && ly.clicks && ly.complete && m.complete ? `${signed(Math.round(((m.clicks - ly.clicks) / ly.clicks) * 100))}%` : '-';
    const bar = '#'.repeat(Math.floor((m.clicks / peak) * 24));
    console.log(`  ${L(m.key, 9)} ${R(num(m.clicks), 7)} ${R(num(m.impr), 9)} ${R(pct(m.impr ? (m.clicks / m.impr) * 100 : 0), 6)} `
      + `${R(yoy, 7)}  ${bar}${m.complete ? '' : '  PARTIAL'}`);
  }
  console.log('\n  Bars are clicks. PARTIAL months are missing days, not losing traffic -');
  console.log('  never read a partial month as a fall.');
}

// Paid clicks in a window and how many days of it have data (the import lags, so a short count = partial, not a fall).
async function paid(start, end) {
  const { query } = require('../../database');
  const r = await query(
    `SELECT COALESCE(SUM(clicks), 0)::float AS clicks, COUNT(DISTINCT snapshot_date)::int AS days
     FROM google_campaign_daily WHERE snapshot_date BETWEEN $1 AND $2`,
    [ymd(start), ymd(end)],
  );
  return r.rows[0];
}

async function main() {
  const { values: args } = parseArgs({
    options: { type: { type: 'string' }, top: { type: 'string', default: '15' }, trend: { type: 'boolean', default: false } },
  });
  const top = Number(args.top) || 15;
  const end = gscEnd();

  console.log(`\nSEO PROGRESS - brookfieldcomfort.com - data to ${ymd(end)}\n`);

  // ---- THE SCOREBOARD: trailing 12 months ----
  console.log(rule(74));
  console.log('TRAILING 12 MONTHS - the scoreboard. This must go up.');
  console.log(rule(74));
  const months = await monthly(end);
  const r12 = rolling12(months);
  if (r12.length < 2) {
    console.log('  Not enough complete months yet.');
  } else {
    console.log(`  ${L('to end of', 11)} ${R('clicks', 8)} ${R('chg', 7)} ${R('impr', 10)} ${R('CTR', 7)}`);
    r12.forEach((m, i) => {
      const chg = i ? signed(m.clicks - r12[i - 1].clicks) : '-';
      console.log(`  ${L(m.key, 11)} ${R(num(m.clicks), 8)} ${R(chg, 7)} ${R(num(m.impr), 10)} ${R(pct(m.impr ? (m.clicks / m.impr) * 100 : 0), 7)}`);
    });
    const move = ((r12[r12.length - 1].clicks - r12[0].clicks) / r12[0].clicks) * 100;
    console.log(`\n  ${move >= 0 ? '+' : ''}${move.toFixed(1)}% across the window shown. Each step is one month replacing the same`);
    console.log('  month a year earlier, so a fall means we lost ground on that month.');
    console.log('  GSC serves 16 months, so only a few points exist (no longer history is kept - owner, 2026-11-07).');
  }

  if (args.trend) {
    console.log();
    printTrend(months);
    console.log('\n  A fall is not automatically failure: dropping products removes');
    console.log('  pages, impressions and clicks by design. See docs/seo/README.md,');
    console.log("  'What we are trying to beat'.\n");
    return;
  }

  // ---- SITE: 7d vs prior 7d, 28d vs prior 28d ----
  const periods = [
    ['last 7d', addDays(end, -6), end],
    ['prior 7d', addDays(end, -13), addDays(end, -7)],
    ['last 28d', addDays(end, -27), end],
    ['prior 28d', addDays(end, -55), addDays(end, -28)],
  ];
  const site = {};
  for (const [name, s, e] of periods) site[name] = totals(await gscQuery({ start: s, end: e }));

  console.log();
  console.log(rule(74));
  console.log('ORGANIC - target is clicks (7d/28d is season, not progress)');
  console.log(rule(74));
  console.log(`  ${L('window', 16)} ${R('clicks', 7)} ${R('chg', 7)} ${R('impr', 9)} ${R('CTR', 7)} ${R('pos', 6)}`);
  const priorOf = { 'last 7d': 'prior 7d', 'last 28d': 'prior 28d' };
  for (const [name] of periods) {
    const t = site[name];
    const p = priorOf[name] ? site[priorOf[name]].clicks : null;
    const d = p == null ? '-' : signed(t.clicks - p);
    const pd = p ? `(${signed(Math.round(((t.clicks - p) / p) * 100))}%)` : '';
    console.log(`  ${L(name, 16)} ${R(num(t.clicks), 7)} ${R(d, 7)} ${R(num(t.impr), 9)} ${R(pct(t.ctr), 7)} ${R(t.pos.toFixed(1), 6)}  ${pd}`);
  }

  // ---- PAID: outline only ----
  // Paid is campaign-level (one campaign is ~96% of clicks), so it can't be joined to organic at page or query level — totals are
  // the only honest comparison. Share is context, not a target: its denominator is ad budget, so it falls when spend rises.
  console.log();
  console.log(rule(74));
  console.log('VS PAID - context, not a target (share falls when ad spend rises)');
  console.log(rule(74));
  try {
    for (const name of ['last 28d', 'prior 28d']) {
      const [, s, e] = periods.find((p) => p[0] === name);
      const p = await paid(s, e);
      const org = site[name].clicks;
      const share = org + p.clicks ? (org / (org + p.clicks)) * 100 : 0;
      console.log(`  ${L(name, 12)} organic ${R(num(org), 6)}   paid ${R(num(p.clicks), 7)}   organic ${R(share.toFixed(0), 4)}%${p.days < 28 ? '  (paid partial)' : ''}`);
    }
  } catch (err) {
    console.log(`  Paid data unavailable (${err.message}). Refresh via the Import panel on BCWEB's Google Ads screen.`);
  }

  // ---- BY TYPE: 28d vs prior 28d ----
  const nowRows = await gscQuery({ start: periods[2][1], end: periods[2][2], dimensions: ['page'] });
  const priorRows = await gscQuery({ start: periods[3][1], end: periods[3][2], dimensions: ['page'] });
  const byType = (rows) => rows.reduce((m, r) => { const t = classify(r.keys[0]); (m[t] = m[t] || []).push(r); return m; }, {});
  const nowT = byType(nowRows); const priorT = byType(priorRows);
  const siteClicks = nowRows.reduce((a, r) => a + r.clicks, 0);

  console.log();
  console.log(rule(74));
  console.log('BY TYPE - 28d vs prior 28d');
  console.log(rule(74));
  console.log(`  ${L('type', 12)} ${R('pages', 6)} ${R('clicks', 7)} ${R('chg', 7)} ${R('% site', 7)} ${R('impr', 9)} ${R('CTR', 7)}`);
  for (const t of Object.keys(nowT).sort((a, b) => totals(nowT[b]).clicks - totals(nowT[a]).clicks)) {
    const c = totals(nowT[t]);
    const pc = priorT[t] ? totals(priorT[t]).clicks : 0;
    console.log(`  ${L(t, 12)} ${R(nowT[t].length, 6)} ${R(num(c.clicks), 7)} ${R(pc ? signed(c.clicks - pc) : 'n/a', 7)} `
      + `${R(`${siteClicks ? ((c.clicks / siteClicks) * 100).toFixed(0) : 0}%`, 7)} ${R(num(c.impr), 9)} ${R(pct(c.ctr), 7)}`);
  }

  // ---- WINNERS: the pages carrying the site, across every type ----
  // Cumulative % is here because the concentration is the story — a handful of URLs are the whole site.
  const priorByUrl = new Map(priorRows.map((r) => [r.keys[0], r]));
  const pool = args.type ? (nowT[args.type] || []) : nowRows;
  const label = args.type ? `${args.type.toUpperCase()} ` : '';
  const poolClicks = pool.reduce((a, r) => a + r.clicks, 0);

  console.log();
  console.log(rule(74));
  console.log(`${label}WINNERS - top ${top} pages by clicks, 28d`);
  console.log(rule(74));
  console.log(`  ${R('#', 2)} ${L('page', 44)} ${L('type', 11)} ${R('clicks', 6)} ${R('chg', 6)} ${R('impr', 8)} ${R('CTR', 6)} ${R('pos', 5)} ${R('cum', 5)}`);
  let running = 0;
  [...pool].sort((a, b) => b.clicks - a.clicks).slice(0, top).forEach((r, i) => {
    const p = priorByUrl.get(r.keys[0]);
    running += r.clicks;
    console.log(`  ${R(i + 1, 2)} ${L(short(r.keys[0], 44), 44)} ${L(classify(r.keys[0]), 11)} ${R(num(r.clicks), 6)} `
      + `${R(p && p.clicks ? signed(r.clicks - p.clicks) : 'n/a', 6)} ${R(num(r.impressions), 8)} ${R(pct(r.impressions ? (r.clicks / r.impressions) * 100 : 0), 6)} `
      + `${R(r.position.toFixed(1), 5)} ${R(`${poolClicks ? ((running / poolClicks) * 100).toFixed(0) : 0}%`, 5)}`);
  });

  // ---- CTR VS POSITION: what a slot is worth, and who is short of it ----
  // Ranking pages by raw CTR just re-discovers that low-ranked pages convert badly. Scoring each page against its OWN band's
  // median separates "ranks badly" (a ranking job) from "ranks fine, earns badly" (a title/snippet job).
  const curve = {};
  for (const r of nowRows) {
    if (r.impressions < MIN_IMPR) continue;
    const b = bandOf(r.position);
    if (b) (curve[b] = curve[b] || []).push((r.clicks / r.impressions) * 100);
  }
  console.log();
  console.log(rule(74));
  console.log(`CTR VS POSITION - 28d, pages >= ${MIN_IMPR} impressions`);
  console.log(rule(74));
  console.log(`  ${L('position', 10)} ${R('pages', 6)} ${R('median CTR', 11)}`);
  for (const [lo, hi] of BANDS) {
    const b = `${lo}-${hi}`;
    if (!curve[b]) continue;
    console.log(`  ${L(b, 10)} ${R(curve[b].length, 6)} ${R(pct(median(curve[b])), 11)}${curve[b].length < 4 ? '   (thin - treat as noise)' : ''}`);
  }

  // Below their own band = the whole realistic title/meta opportunity. The total is the point: if it is small, the CTR play is not
  // a plan and the work is ranking or new pages instead.
  const shortOf = [];
  for (const r of pool) {
    if (r.impressions < MIN_IMPR) continue;
    const b = bandOf(r.position);
    if (!b || !curve[b]) continue;
    const ctr = (r.clicks / r.impressions) * 100; const med = median(curve[b]);
    if (ctr < med) shortOf.push({ r, ctr, med, gap: ((med - ctr) / 100) * r.impressions });
  }
  console.log();
  console.log(rule(74));
  console.log(`${label}BELOW CURVE - ranks fine, earns badly. The title/meta job.`);
  console.log(rule(74));
  console.log(`  ${L('page', 44)} ${R('impr', 7)} ${R('CTR', 6)} ${R('med', 6)} ${R('pos', 5)} ${R('gap', 6)}`);
  for (const x of shortOf.sort((a, b) => b.gap - a.gap).slice(0, top)) {
    console.log(`  ${L(short(x.r.keys[0], 44), 44)} ${R(num(x.r.impressions), 7)} ${R(pct(x.ctr), 6)} ${R(pct(x.med), 6)} ${R(x.r.position.toFixed(1), 5)} ${R(signed(Math.round(x.gap)), 6)}`);
  }
  const total = shortOf.reduce((a, x) => a + x.gap, 0);
  console.log(`\n  Whole opportunity: ${signed(Math.round(total))} clicks/28d if every gap closed to median `
    + `(${poolClicks ? signed(Math.round((total / poolClicks) * 100)) : 0}% on ${num(poolClicks)}).`);
  console.log('  Curve is site-wide for sample size; the list above respects --type.\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/weekly] failed:', err.message); process.exit(1); });
