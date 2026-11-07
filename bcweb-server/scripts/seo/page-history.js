/*
=======================================================================================================================================
Script: scripts/seo/page-history.js   (one page, week by week — the experiment tracker — READ ONLY)
=======================================================================================================================================
Purpose: How a page moved over time: clicks, impressions and impression-weighted position per week (Monday-start), with the change
         dates from docs/seo/CHANGELOG.md marked on the week they fall in. This is how an experiment is read — "did position move
         after the change, and how long did it take?" — and it is how the size-6 blog's climb was measured (2026-11-07: rewritten
         11 Aug, #1 on the question searches by the week of 7 Sep, ~4 weeks, held since).

         Read POSITION first, then clicks (that is the order they move; a page shows impressions weeks before clicks). Compare weeks,
         not single days — page-level days are noise. The last ~3 days of GSC are incomplete and are not shown.

         --contains narrows to queries containing a word (e.g. the question searches, --contains why).
         --compare adds a second page in the same table — the control: sandals are seasonal, so a change is judged against an
         untouched page over the same weeks, never against the page's own past.

New 2026-11-07 (the Python folder had no per-page history; the size-6 read was done by hand).

Usage:
    node scripts/seo/page-history.js --page /blogs/info/why-doesnt-birkenstock-make-a-uk-size-6-brookfield-comfort
    node scripts/seo/page-history.js --page /collections/birkenstock-mayari --since 2026-09-01
    node scripts/seo/page-history.js --page /products/x --contains narrow
    node scripts/seo/page-history.js --page /products/x --compare /products/control-y
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const { gscQuery, gscEnd, addDays, ymd } = require('../../utils/searchConsole');
const { toUrl, short, SEO_DOCS, num, L, R } = require('../../utils/seo');

// Monday of the week a 'YYYY-MM-DD' falls in.
function weekOf(s) {
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return ymd(addDays(dt, -((dt.getDay() + 6) % 7)));
}

// Change dates for a URL from the CHANGELOG table rows (| date | url | ...), so the table can mark them.
function changesFor(url) {
  const f = path.join(SEO_DOCS, 'CHANGELOG.md');
  if (!fs.existsSync(f)) return [];
  const p = url.replace(/^https?:\/\/[^/]+/, '');
  return fs.readFileSync(f, 'utf8').split('\n')
    .map((line) => line.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+)\|/))
    .filter((m) => m && m[2].trim() === p)
    .map((m) => m[1]);
}

async function weekly(url, since, end, contains) {
  const filters = [{ dimension: 'page', operator: 'equals', expression: url }];
  if (contains) filters.push({ dimension: 'query', operator: 'contains', expression: contains });
  const weeks = new Map();
  for (const r of await gscQuery({ start: since, end, dimensions: ['date'], filters })) {
    const w = weekOf(r.keys[0]);
    const a = weeks.get(w) || { c: 0, i: 0, pw: 0 };
    a.c += r.clicks; a.i += r.impressions; a.pw += r.position * r.impressions;
    weeks.set(w, a);
  }
  return weeks;
}

async function main() {
  const { values: args } = parseArgs({
    options: { page: { type: 'string' }, since: { type: 'string' }, contains: { type: 'string' }, compare: { type: 'string' } },
  });
  if (!args.page) { console.error('Give --page <path or URL>'); process.exit(1); }

  const end = gscEnd();
  // 20 weeks by default. Snapped back to its Monday so the first row is a whole week, not a part week that reads as a dip.
  const since = weekOf(args.since || ymd(addDays(end, -7 * 20)));
  const url = toUrl(args.page);
  const ctrl = args.compare ? toUrl(args.compare) : null;
  const a = await weekly(url, since, end, args.contains);
  const b = ctrl ? await weekly(ctrl, since, end, args.contains) : null;
  const marks = changesFor(url).map(weekOf);

  console.log(`\n${short(url, 90)}`);
  if (ctrl) console.log(`vs control ${short(ctrl, 80)}`);
  console.log(`weekly, ${since} to ${ymd(end)}${args.contains ? ` - queries containing "${args.contains}"` : ''}\n`);
  const head = `  ${L('week of', 11)} ${R('clicks', 6)} ${R('impr', 6)} ${R('pos', 5)}`;
  console.log(ctrl ? `${head}   |  control ${R('clicks', 6)} ${R('impr', 6)} ${R('pos', 5)}` : head);

  const allWeeks = [...new Set([...a.keys(), ...(b ? b.keys() : [])])].sort();
  for (const w of allWeeks) {
    const x = a.get(w) || { c: 0, i: 0, pw: 0 };
    let line = `  ${L(w, 11)} ${R(num(x.c), 6)} ${R(num(x.i), 6)} ${R(x.i ? (x.pw / x.i).toFixed(1) : '-', 5)}`;
    if (b) {
      const y = b.get(w) || { c: 0, i: 0, pw: 0 };
      line += `   |          ${R(num(y.c), 6)} ${R(num(y.i), 6)} ${R(y.i ? (y.pw / y.i).toFixed(1) : '-', 5)}`;
    }
    if (marks.includes(w)) line += '   <- change logged (CHANGELOG)';
    console.log(line);
  }
  console.log('\n  Read position first, then clicks. The latest week may be short (GSC lags ~3 days).\n');
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error('[seo/page-history] failed:', err.message); process.exit(1); });
