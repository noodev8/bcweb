/*
=======================================================================================================================================
Util: unitAge
=======================================================================================================================================
Purpose: THE UNIT LEDGER — every pair we hold, dated, now and at every month end since Goods In started logging. Owner, 2026-10-14:
         "Only units, not pricing or styles. We bought it, we sell it. How many have we got and are we getting through them." Read by
         GET /analytics-sell-through (Reports -> Sell-through).

NO PER-UNIT STORAGE, ON PURPOSE. The owner first pictured giving each physical pair its own identity ("the exact same sku can arrive
         twice ... 2 units came in, 1 sold, the other is still on the shelf"). It isn't stored because it can't be known: when two
         identical pairs sit on a shelf nobody records which one was picked. So each pair's arrival date is DERIVED, oldest sells first
         (FIFO) per code: the pairs of a code we still hold are its NEWEST arrivals. Nothing is written — no table, no column.

THE THREE FACTS (all already in the DB):
  IN    = incoming_stock — Goods In writes one row per scanned pair (quantity_added; legacy rows can carry more than 1), dated
          arrival_date. Logged since 31 Dec 2024.
  OUT   = sales, ALL channels, NET of returns (return rows carry negative qty, so SUM puts them back in the pot — owner: "Just add them
          back into the pot", no separate returns line).
  HELD  = the utils/financeStock.js definition at CODE grain — localstock #FREE not deleted + amzfeed.amztotal. FBA pairs count the
          same as shelf pairs (owner, same day); sending a pair to FBA is a move, never "out".

PAST MONTH ENDS ARE RECONSTRUCTED BACKWARDS per code: held then = held now − arrived since + sold since (floored at 0). Only totals are
         stored per night (stock_daily), so this is the only way to age past stock. Checked against stock_daily on 2026-10-14: over
         Oct 2025 -> Sep 2026, in − out was +702 and the nightly reading rose ~+700, so stock adjustments are noise at this grain.

BEFORE 2025. A held pair that can't be matched to a logged arrival came in before the log began (or off-book). It is its own band
         ('pre') — in early-2025 month ends it is most of the stock, which is the 2024 stock being worked through, not an error.

NO "OLD" LINE. The owner chose not to fix a number for "old" yet (2026-10-14). Bands are descriptive (0-3m, 3-6m, 6-12m, 12m+); don't
         turn one into a rule or a flag without the owner. Note the 2026-10-10 Slow header rejected "aged stock" as a STOCK-NEEDS
         rule; this is the owner's own later ask, as a view of what was bought and how fast it went — not a forecast.

         READ-ONLY.
=======================================================================================================================================
Exports:
  BANDS                     ['m0_3','m3_6','m6_12','m12','pre']
  loadUnitLedger() -> {
    today,                                   // UK date, YYYY-MM-DD
    months: [{ month, end, partial, in, sold, profit, held, bands: {m0_3..pre} }],   // oldest -> newest, rolling 24 months
    cohorts: [{ month, in, left_3m, left_6m, left_now }],    // pairs of each arrival month still held (null = not reached yet)
    styles: [{ groupid, title, brand, units, bands, oldest, sold_90 }],              // held now, oldest-heavy first
    recent: { d1: {in, sold}, d7: {...}, d30: {...}, d90: {...} },
    year_ago: { date, held, bands }                  // the same day a year ago, rebuilt the same way (Stock Position's compare)
  }
=======================================================================================================================================
*/

const { query } = require('../database');

const LOG_START = '2025-01';   // first full month of incoming_stock (the first row is 31 Dec 2024)
// ROLLING 24 MONTHS (owner, 2026-10-14). Enough for every row of the last year to carry its year-earlier compare, and it bounds the
// rebuild: held is reconstructed backwards from today and the error grows ~40 pairs a month back (see PAST MONTH ENDS above), so an
// ever-growing history would get ever rougher at its far end. The window starts at LOG_START until that is over 24 months ago.
const WINDOW_MONTHS = 24;
const BANDS = ['m0_3', 'm3_6', 'm6_12', 'm12', 'pre'];

// 'YYYY-MM-DD' -> whole days since epoch, in UTC so BST never shifts a day (CLAUDE.md: never hand a pg DATE to the JS Date parser).
function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

// Age band of a pair that arrived on `arr` (null = before the log) as at day number `at`. Months as 30.4-day steps: 91 / 183 / 365.
function band(arr, at) {
  if (arr === null) return 'pre';
  const age = at - arr;
  if (age <= 91) return 'm0_3';
  if (age <= 183) return 'm3_6';
  if (age <= 365) return 'm6_12';
  return 'm12';
}

const emptyBands = () => ({ m0_3: 0, m3_6: 0, m6_12: 0, m12: 0, pre: 0 });

// Month list from the later of LOG_START and WINDOW_MONTHS back, to the current month, each with its last day (the current month ends
// "today"). Arrivals before the window still date held pairs; they just get no month row or delivery row of their own.
function monthList(today) {
  const out = [];
  const [ty, tm] = today.split('-').map(Number);
  const [ly, lm] = LOG_START.split('-').map(Number);
  const first = Math.max(ty * 12 + (tm - 1) - (WINDOW_MONTHS - 1), ly * 12 + (lm - 1));   // months since year 0
  let y = Math.floor(first / 12), m = (first % 12) + 1;
  while (y < ty || (y === ty && m <= tm)) {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();   // day 0 of next month = last day of this one
    const partial = y === ty && m === tm;
    out.push({ month: key, end: partial ? today : `${key}-${String(last).padStart(2, '0')}`, partial });
    m += 1; if (m === 13) { m = 1; y += 1; }
  }
  return out;
}

async function loadUnitLedger() {
  // UK today — Goods In stamps arrival_date in Europe/London, and the pg session runs UTC.
  const t = await query(`SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS today,
                                to_char((now() AT TIME ZONE 'Europe/London')::date - interval '1 year', 'YYYY-MM-DD') AS year_ago`);
  const today = t.rows[0].today;
  const yearAgo = t.rows[0].year_ago;
  const months = monthList(today);
  const mIndex = new Map(months.map((p, i) => [p.month, i]));

  const [heldQ, arrQ, soldQ, recentQ, metaQ] = await Promise.all([
    // HELD now, per code (financeStock's definition at code grain).
    query(`SELECT code, SUM(q)::int AS q FROM (
             SELECT code, qty AS q FROM localstock WHERE COALESCE(deleted, 0) = 0 AND ordernum = '#FREE'
             UNION ALL
             SELECT code, amztotal FROM amzfeed WHERE code IS NOT NULL
           ) x GROUP BY code HAVING SUM(q) > 0`),
    // IN — every logged arrival, newest first within a code (the FIFO order: held pairs are the newest).
    query(`SELECT code, to_char(arrival_date, 'YYYY-MM-DD') AS d, GREATEST(quantity_added, 1)::int AS q
           FROM incoming_stock WHERE code IS NOT NULL AND arrival_date IS NOT NULL
           ORDER BY code, arrival_date DESC, id DESC`),
    // OUT — net units per code per month across the window (returns are negative rows, SUM nets them).
    query(`SELECT code, to_char(solddate, 'YYYY-MM') AS m, SUM(qty)::int AS q, COALESCE(SUM(profit), 0)::float AS profit
           FROM sales WHERE solddate >= $1::date AND code IS NOT NULL
           GROUP BY code, 2`, [`${months[0].month}-01`]),
    // The top boxes: today / 7 / 30 / 90 days (90 added 2026-10-15, owner — the house "sell within 90 days"), in and out. UK dates throughout.
    query(`WITH d AS (SELECT (now() AT TIME ZONE 'Europe/London')::date AS today)
           SELECT
             (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d WHERE arrival_date = d.today)::int        AS in_1,
             (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d WHERE arrival_date > d.today - 7)::int    AS in_7,
             (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d WHERE arrival_date > d.today - 30)::int   AS in_30,
             (SELECT COALESCE(SUM(GREATEST(quantity_added,1)),0) FROM incoming_stock, d WHERE arrival_date > d.today - 90)::int   AS in_90,
             (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate = d.today)::int       AS sold_1,
             (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate > d.today - 7)::int   AS sold_7,
             (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate > d.today - 30)::int  AS sold_30,
             (SELECT COALESCE(SUM(qty),0) FROM sales, d WHERE solddate > d.today - 90)::int  AS sold_90`),
    // Style facts for the list: code -> groupid, title, brand, and net units sold in 90 days.
    query(`SELECT m.code, m.groupid, t.shopifytitle AS title, NULLIF(TRIM(ss.brand), '') AS brand
           FROM skumap m
           LEFT JOIN skusummary ss ON ss.groupid = m.groupid
           LEFT JOIN title t       ON t.groupid  = m.groupid`),
  ]);

  // Net units per code sold AFTER the same day a year ago — undone to rebuild what was held that day (Stock Position, 2026-10-15:
  // "now against a year ago" must be the same day, not a month end — mid-month the two differ by a fortnight of sales and deliveries).
  const soldSinceYAQ = await query(`SELECT code, SUM(qty)::int AS q FROM sales WHERE solddate > $1::date AND code IS NOT NULL GROUP BY code`,
                                   [yearAgo]);

  const sold90Q = await query(`SELECT groupid, SUM(qty)::int AS q FROM sales
                               WHERE solddate > (now() AT TIME ZONE 'Europe/London')::date - 90 AND groupid IS NOT NULL
                               GROUP BY groupid`);

  // Per code: held now, arrivals (newest first, as day numbers + month), monthly net sold.
  const held = new Map(heldQ.rows.map((r) => [r.code, r.q]));
  const arrivals = new Map();
  const inByMonth = new Array(months.length).fill(0);
  for (const r of arrQ.rows) {
    if (!arrivals.has(r.code)) arrivals.set(r.code, []);
    const mi = mIndex.has(r.d.slice(0, 7)) ? mIndex.get(r.d.slice(0, 7)) : -1;   // -1 = before the window (or the 31 Dec 2024 rows)
    arrivals.get(r.code).push({ day: dayNum(r.d), date: r.d, mi, q: r.q });
    if (mi >= 0) inByMonth[mi] += r.q;
  }
  const soldByCode = new Map();
  const soldByMonth = new Array(months.length).fill(0);
  const profitByMonth = new Array(months.length).fill(0);
  for (const r of soldQ.rows) {
    const mi = mIndex.get(r.m);
    if (mi === undefined) continue;
    if (!soldByCode.has(r.code)) soldByCode.set(r.code, new Array(months.length).fill(0));
    soldByCode.get(r.code)[mi] += r.q;
    soldByMonth[mi] += r.q;
    profitByMonth[mi] += r.profit;
  }

  const ends = months.map((p) => dayNum(p.end));
  const heldAt = months.map(() => emptyBands());
  const heldTotal = new Array(months.length).fill(0);
  // cohortLeft[i][c] = pairs that arrived in month c still held at the end of month i
  const cohortLeft = months.map(() => new Array(months.length).fill(0));

  const info = new Map(metaQ.rows.map((r) => [r.code, r]));
  const styles = new Map();
  const nowIdx = months.length - 1;
  const soldSinceYA = new Map(soldSinceYAQ.rows.map((r) => [r.code, r.q]));
  const yaDay = dayNum(yearAgo);
  const yaBands = emptyBands();
  let yaHeld = 0;

  const codes = new Set([...held.keys(), ...arrivals.keys(), ...soldByCode.keys()]);
  for (const code of codes) {
    const arr = arrivals.get(code) || [];
    const sold = soldByCode.get(code) || new Array(months.length).fill(0);
    const now = held.get(code) || 0;

    // Walk the month ends newest -> oldest, undoing each later month's arrivals and sales.
    let h = now;
    for (let i = nowIdx; i >= 0; i--) {
      if (i < nowIdx) {
        const arrivedAfter = arr.filter((a) => a.mi === i + 1).reduce((s, a) => s + a.q, 0);
        h = h - arrivedAfter + sold[i + 1];
      }
      const hi = Math.max(0, h);
      if (hi === 0) continue;
      heldTotal[i] += hi;

      // FIFO: the hi pairs held are the newest arrivals on or before this month end; anything beyond them predates the log.
      let left = hi;
      for (const a of arr) {
        if (left === 0) break;
        if (a.day > ends[i]) continue;
        const take = Math.min(left, a.q);
        left -= take;
        heldAt[i][band(a.day, ends[i])] += take;
        if (a.mi >= 0) cohortLeft[i][a.mi] += take;
        if (i === nowIdx) addStyle(code, take, band(a.day, ends[i]), a.date);
      }
      if (left > 0) {
        heldAt[i].pre += left;
        if (i === nowIdx) addStyle(code, left, 'pre', null);
      }
    }

    // The same day a year ago: held now − arrived since + sold since (floored), then FIFO over the arrivals on or before that day.
    let ya = Math.max(0, now - arr.filter((a) => a.day > yaDay).reduce((s, a) => s + a.q, 0) + (soldSinceYA.get(code) || 0));
    yaHeld += ya;
    for (const a of arr) {
      if (ya === 0) break;
      if (a.day > yaDay) continue;
      const take = Math.min(ya, a.q);
      ya -= take;
      yaBands[band(a.day, yaDay)] += take;
    }
    yaBands.pre += ya;
  }

  function addStyle(code, q, b, date) {
    const m = info.get(code);
    const gid = m?.groupid || code;
    if (!styles.has(gid)) {
      styles.set(gid, { groupid: gid, title: m?.title || null, brand: m?.brand || null, units: 0, bands: emptyBands(), oldest: undefined });
    }
    const s = styles.get(gid);
    s.units += q;
    s.bands[b] += q;
    // oldest dated arrival; null once any pair predates the log (the oldest is "before 2025")
    if (date === null) s.oldest = null;
    else if (s.oldest !== null && (s.oldest === undefined || date < s.oldest)) s.oldest = date;
  }

  const sold90 = new Map(sold90Q.rows.map((r) => [r.groupid, r.q]));
  const styleList = [...styles.values()]
    .map((s) => ({ ...s, oldest: s.oldest ?? null, sold_90: sold90.get(s.groupid) || 0 }))
    // oldest-heavy first: pairs over a year (incl. before 2025), then 6-12m, then most pairs
    .sort((a, b) => (b.bands.m12 + b.bands.pre) - (a.bands.m12 + a.bands.pre)
      || b.bands.m6_12 - a.bands.m6_12 || b.units - a.units || a.groupid.localeCompare(b.groupid));

  const r = recentQ.rows[0];
  return {
    today,
    months: months.map((p, i) => ({
      month: p.month, end: p.end, partial: p.partial,
      in: inByMonth[i], sold: soldByMonth[i], profit: Math.round(profitByMonth[i]),
      held: heldTotal[i], bands: heldAt[i],
    })),
    // Per arrival month: how many of its pairs were still held 3 and 6 month-ends later, and now. A window not yet reached is null.
    cohorts: months.map((p, c) => ({
      month: p.month,
      in: inByMonth[c],
      left_3m: c + 3 <= nowIdx && !months[c + 3].partial ? cohortLeft[c + 3][c] : null,
      left_6m: c + 6 <= nowIdx && !months[c + 6].partial ? cohortLeft[c + 6][c] : null,
      left_now: cohortLeft[nowIdx][c],
    })).filter((c) => c.in > 0),
    styles: styleList,
    recent: {
      d1: { in: r.in_1, sold: r.sold_1 },
      d7: { in: r.in_7, sold: r.sold_7 },
      d30: { in: r.in_30, sold: r.sold_30 },
      d90: { in: r.in_90, sold: r.sold_90 },
    },
    year_ago: { date: yearAgo, held: yaHeld, bands: yaBands },
  };
}

module.exports = { BANDS, loadUnitLedger };
