/*
=======================================================================================================================================
Script: scripts/amz-moves-review.js   (READ ONLY — the /amz-pricing skill runs this: "check the price moves")
=======================================================================================================================================
Purpose: Did our Amazon price moves work? (owner, 2026-11-21: "yes, build it" — PLAN.md decisions 29–31 were agreed from the first run of
         this review, done by hand). For every real price move in a period (amz_price_log, holds and Seller Central detections left
         out) it reads the Buy Box just before and just after the move (amz_buybox_history) and the Amazon sales after it, and prints:
           1  DID THE PRICE WORK PAY — pairs and profit a day on the sizes we moved vs the sizes nobody moved, against the month before,
              and the same days last year (what the season did). The moved sizes include new stock landing — said under the table.
           2  RAISES from a size holding the box — kept it at the next reading, by step (checks the +3% cap, decision 29).
           3  CUTS when we did NOT hold the box — won it, and did the rival come back down under us ("followed"), by who led and how
              far under the lead we went (checks "1% under a self-poster, or leave", decision 30).
           4  BY WHERE THE MOVE WAS MADE (the log note: Pricing cards, Due cards, search, by hand) — sales after vs the 30 days before.
         Every row says how many moves it rests on. Writes nothing (BEGIN READ ONLY). No rule here — it reports; the owner decides.

How it is measured:
  - A move = an amz_price_log row with changed_at set, |new − old| >= 1p, old_price > 0, changed_by <> 'Manual' (Seller Central
    detections aren't our moves). Its window runs to the size's next move, or the end of the period / now.
  - Before / after = the last Buy Box reading at or before the move / the first reading more than 30 minutes after it, inside the
    window. Held / kept / won = our share of views >= 50%. Followed = the first reading after shows another seller leading BELOW
    the lead price before the move. Readings start 2026-11-12, hourly 08–18 GMT, so a move made in the evening is judged next morning.
  - Sales = channel 'AMZ', qty > 0, timed by solddate + ordertime (Europe/London). The sales sync runs with Update Orders, so the
    newest sales may not be in yet — the header says the last sale it has.
  - Pairs a week = pairs after ÷ the days the moves' windows were open × 7, summed over the moves in the row.
  - Section 1's days are whole London days, today included (so today counts as a full day while it is still going).

Usage:
    node scripts/amz-moves-review.js                         the last 28 days
    node scripts/amz-moves-review.js --from 2026-11-11       from that day to now
    node scripts/amz-moves-review.js --from 2026-11-11 --to 2026-12-01
    --json                                                   the raw rows instead of the tables
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { pool } = require('../database');

const HELD = 50;               // share of views (%) that counts as holding the box
const AFTER_MIN = 30;          // the "after" reading is the first one more than this many minutes after the move

function args(argv) {
  const o = { from: null, to: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--from') o.from = argv[++i];
    else if (a === '--to') o.to = argv[++i];
    else if (a === '--json') o.json = true;
    else throw new Error(`Unknown option ${a}`);
  }
  for (const k of ['from', 'to']) if (o[k] && !/^\d{4}-\d{2}-\d{2}$/.test(o[k])) throw new Error(`--${k} must be YYYY-MM-DD`);
  return o;
}

// Where the move was made, from the log note (the screens write these notes).
function source(note) {
  const n = note || '';
  if (/^Buy Box (New|Raise|Cut|Match)/.test(n)) return 'Pricing cards';
  if (n.startsWith('No Buy Box card')) return 'Buy Box strip cards';
  if (n.startsWith('Due card')) return 'Due cards';
  if (n.startsWith('Search card')) return 'Search cards';
  if (n.startsWith('Step card')) return 'Step cards';
  if (n.startsWith('Style price')) return 'Style price';
  if (n.includes('(amz-pricing)')) return 'Claude (amz-pricing)';
  if (n === '') return 'No note (list / price screen)';
  return 'Other';
}
const LEAD = { OTHER_MFN: 'self-poster', OTHER_FBA: 'FBA seller', AMAZON: 'Amazon', NONE: 'nobody' };

async function readMoves(db, from, to) {
  const { rows } = await db.query(`
    WITH s AS (
      SELECT code, qty,
             CASE WHEN ordertime ~ '^[0-9]{1,2}:[0-9]{2}' THEN (solddate::text || ' ' || ordertime)::timestamp AT TIME ZONE 'Europe/London'
                  ELSE solddate::timestamp AT TIME ZONE 'Europe/London' + interval '12 hours' END AS ts
      FROM sales WHERE channel = 'AMZ' AND qty > 0 AND solddate >= $1::date - 31
    ),
    mv AS (
      SELECT l.id, l.code, l.changed_at, l.changed_by, COALESCE(l.notes, '') AS notes,
             l.old_price::float8 AS old_price, l.new_price::float8 AS new_price,
             LEAST(COALESCE(LEAD(l.changed_at) OVER (PARTITION BY l.code ORDER BY l.changed_at, l.id), $2::timestamptz), $2::timestamptz, now()) AS end_at
      FROM amz_price_log l
      WHERE l.changed_at IS NOT NULL AND abs(l.new_price - l.old_price) >= 0.005 AND l.old_price > 0 AND l.changed_by <> 'Manual'
    )
    SELECT mv.id, mv.code, mv.changed_at, mv.changed_by, mv.notes, mv.old_price, mv.new_price, mv.end_at,
      EXTRACT(epoch FROM mv.end_at - mv.changed_at)::float8 / 86400 AS days,
      (SELECT COALESCE(SUM(qty), 0) FROM s WHERE s.code = mv.code AND s.ts >= mv.changed_at AND s.ts < mv.end_at)::int AS sold_after,
      (SELECT COALESCE(SUM(qty), 0) FROM s WHERE s.code = mv.code AND s.ts >= mv.changed_at - interval '30 days' AND s.ts < mv.changed_at)::int AS sold_30_before,
      b.our_share::float8 AS share_before, b.holder AS holder_before, b.bb_price::float8 AS lead_before,
      a.our_share::float8 AS share_after, a.holder AS holder_after, a.bb_price::float8 AS lead_after
    FROM mv
    LEFT JOIN LATERAL (SELECT our_share, holder, bb_price FROM amz_buybox_history h
                       WHERE h.code = mv.code AND h.read_at <= mv.changed_at ORDER BY h.read_at DESC LIMIT 1) b ON true
    LEFT JOIN LATERAL (SELECT our_share, holder, bb_price FROM amz_buybox_history h
                       WHERE h.code = mv.code AND h.read_at > mv.changed_at + make_interval(mins => $3) AND h.read_at < mv.end_at
                       ORDER BY h.read_at LIMIT 1) a ON true
    WHERE mv.changed_at >= $1::date AND mv.changed_at < $2::timestamptz
    ORDER BY mv.changed_at, mv.id`, [from, to, AFTER_MIN]);
  return rows.map((r) => ({
    ...r,
    dir: r.new_price < r.old_price ? 'cut' : 'raise',
    pct: (r.new_price / r.old_price - 1) * 100,
    vsLead: r.lead_before ? (r.new_price / r.lead_before - 1) * 100 : null,   // our new price against the lead before, %
    src: source(r.notes),
    followed: r.lead_before !== null && r.lead_after !== null && r.holder_after !== 'US' && r.holder_after !== 'US_SHARED'
      && r.lead_after < r.lead_before - 0.005,
  }));
}

// Section 1: moved vs not moved — pairs / profit a day, this period vs the 31 days before, and both a year earlier.
async function readPay(db, from, to) {
  const { rows } = await db.query(`
    WITH moved AS (SELECT DISTINCT code FROM amz_price_log WHERE changed_at >= $1::date AND changed_at < $2::timestamptz
                     AND changed_at IS NOT NULL AND abs(new_price - old_price) >= 0.005 AND old_price > 0 AND changed_by <> 'Manual'),
    w AS (SELECT * FROM (VALUES
            ('now',  $1::date,                         (($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/London')::date + 1),
            ('prev', $1::date - 31,                    $1::date),
            ('ly',   ($1::date - interval '1 year')::date, ((($2::timestamptz - interval '1 microsecond') AT TIME ZONE 'Europe/London')::date + 1 - interval '1 year')::date),
            ('lyprev', ($1::date - interval '1 year')::date - 31, ($1::date - interval '1 year')::date)) v(win, d0, d1))
    SELECT w.win, (s.code IN (SELECT code FROM moved)) AS moved, (w.d1 - w.d0) AS days,
           COALESCE(SUM(s.qty), 0)::int AS pairs, COALESCE(SUM(s.profit), 0)::float8 AS profit
    FROM w LEFT JOIN sales s ON s.channel = 'AMZ' AND s.qty > 0 AND s.solddate >= w.d0 AND s.solddate < w.d1
    GROUP BY 1, 2, 3`, [from, to]);
  const get = (win, moved) => rows.find((r) => r.win === win && r.moved === moved) || { pairs: 0, profit: 0, days: (rows.find((r) => r.win === win) || {}).days || 1 };
  return [true, false].map((moved) => {
    const day = (win, k) => { const r = get(win, moved); return r.days ? r[k] / r.days : 0; };
    return {
      group: moved ? 'Sizes we moved' : 'Sizes nobody moved',
      now: day('now', 'pairs'), prev: day('prev', 'pairs'), ly: day('ly', 'pairs'), lyprev: day('lyprev', 'pairs'),
      profitNow: day('now', 'profit'), profitPrev: day('prev', 'profit'),
      ppNow: get('now', moved).pairs ? get('now', moved).profit / get('now', moved).pairs : null,
      ppPrev: get('prev', moved).pairs ? get('prev', moved).profit / get('prev', moved).pairs : null,
    };
  });
}

// --- printing ---------------------------------------------------------------------------------------------------------------------
const pc = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '-');
const chg = (a, b) => (b ? `${a >= b ? '+' : ''}${Math.round((100 * (a - b)) / b)}%` : '-');
const f1 = (n) => (n === null || n === undefined ? '-' : n.toFixed(1));
const f2 = (n) => (n === null || n === undefined ? '-' : n.toFixed(2));
const money = (n) => (n === null || n === undefined ? '-' : `£${n.toFixed(2)}`);
function table(head, rows) {
  const all = [head, ...rows].map((r) => r.map((c) => String(c)));
  const w = head.map((_, i) => Math.max(...all.map((r) => r[i].length)));
  return all.map((r, j) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ') + (j === 0 ? '\n' + w.map((x) => '-'.repeat(x)).join('  ') : '')).join('\n');
}
function perWeek(ms) {
  const days = ms.reduce((s, m) => s + m.days, 0);
  return days ? (ms.reduce((s, m) => s + m.sold_after, 0) / days) * 7 : null;
}
function bucketRows(ms, buckets, cols) {
  return buckets.map(([label, test]) => { const b = ms.filter(test); return [label, b.length, ...cols.map((c) => c(b))]; });
}

function print(moves, pay, o, meta) {
  const out = [];
  out.push(`AMAZON PRICE MOVES ${o.from} to ${o.toLabel} — ${moves.length} moves on ${new Set(moves.map((m) => m.code)).size} sizes`
    + ` (${moves.filter((m) => m.dir === 'cut').length} cuts, ${moves.filter((m) => m.dir === 'raise').length} raises).`);
  out.push(`Sales in to ${meta.lastSale}. Buy Box readings from 2026-11-12, hourly 08–18 GMT. "Held" = our share of views ≥ ${HELD}%.`);

  out.push('\n1  DID THE PRICE WORK PAY — Amazon pairs a day (all sizes that sold, moved = any real move in the period)');
  out.push(table(['', 'now', 'month before', 'change', 'same days LY', 'LY month before', 'LY change', 'profit/day now', 'before', '£/pair now', 'before'],
    pay.map((p) => [p.group, f1(p.now), f1(p.prev), chg(p.now, p.prev), f1(p.ly), f1(p.lyprev), chg(p.ly, p.lyprev),
      money(p.profitNow), money(p.profitPrev), money(p.ppNow), money(p.ppPrev)])));
  out.push('   The change against last year\'s change is what the season doesn\'t explain. Moved sizes include new stock landing (its New-card');
  out.push('   cut), so part of their lift is the stock, not the price.');

  const raises = moves.filter((m) => m.dir === 'raise' && m.share_before !== null && m.share_after !== null && m.share_before >= HELD);
  out.push(`\n2  RAISES from a size holding the box — ${raises.length} with a reading before and after`);
  out.push(table(['step', 'moves', 'kept the box', 'share after', 'sold after', 'pairs/wk'],
    bucketRows(raises, [['under 2%', (m) => m.pct < 2], ['2–3%', (m) => m.pct >= 2 && m.pct < 3], ['3–5%', (m) => m.pct >= 3 && m.pct < 5],
      ['5–10%', (m) => m.pct >= 5 && m.pct < 10], ['10%+', (m) => m.pct >= 10]],
    [(b) => pc(b.filter((m) => m.share_after >= HELD).length, b.length),
      (b) => (b.length ? `${Math.round(b.reduce((s, m) => s + m.share_after, 0) / b.length)}%` : '-'),
      (b) => pc(b.filter((m) => m.sold_after > 0).length, b.length), (b) => f2(perWeek(b))])));

  const cuts = moves.filter((m) => m.dir === 'cut' && m.share_before !== null && m.share_after !== null && m.share_before < HELD && m.vsLead !== null);
  out.push(`\n3  CUTS when we did NOT hold the box — ${cuts.length} with a reading before and after, by who led and our new price against their price`);
  for (const h of ['OTHER_MFN', 'OTHER_FBA', 'AMAZON']) {
    const c = cuts.filter((m) => m.holder_before === h);
    if (!c.length) continue;
    out.push(`   Lead: ${LEAD[h]} (${c.length})`);
    out.push(table(['  our price vs the lead', 'moves', 'won the box', 'rival followed', 'sold after'],
      bucketRows(c, [['  over the lead', (m) => m.vsLead > 0.5], ['  within 0.5% (a penny / level)', (m) => m.vsLead > -0.5 && m.vsLead <= 0.5],
        ['  0.5–2% under', (m) => m.vsLead <= -0.5 && m.vsLead > -2], ['  2%+ under', (m) => m.vsLead <= -2]],
      [(b) => pc(b.filter((m) => m.share_after >= HELD).length, b.length), (b) => pc(b.filter((m) => m.followed).length, b.length),
        (b) => pc(b.filter((m) => m.sold_after > 0).length, b.length)])));
  }
  const noLead = moves.filter((m) => m.dir === 'cut' && m.holder_before === 'NONE');
  if (noLead.length) {
    const judged = noLead.filter((m) => m.share_after !== null);
    out.push(`   Nobody had the box (${noLead.length}): ${judged.length} read after, won ${pc(judged.filter((m) => m.share_after >= HELD).length, judged.length)}; `
      + `${noLead.filter((m) => m.sold_after > 0).length} sold after.`);
  }

  out.push('\n4  BY WHERE THE MOVE WAS MADE — Amazon pairs a week per size, after the move vs the 30 days before it');
  const srcs = [...new Set(moves.map((m) => m.src))];
  const rows = [];
  for (const s of srcs) for (const d of ['cut', 'raise']) {
    const b = moves.filter((m) => m.src === s && m.dir === d);
    if (!b.length) continue;
    const before = (b.reduce((x, m) => x + m.sold_30_before, 0) / 30 / b.length) * 7;
    const sorted = b.map((m) => m.pct).sort((x, y) => x - y);
    rows.push([`${s} · ${d}`, b.length, `${sorted[Math.floor(sorted.length / 2)].toFixed(1)}%`, b.reduce((x, m) => x + m.sold_after, 0), f2(perWeek(b)), f2(before)]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  out.push(table(['', 'moves', 'median move', 'pairs after', 'pairs/wk after', 'before'], rows));
  out.push('   Most sizes sell under a pair a week: a row resting on a few moves, or on moves made in the last few days, says little.');
  console.log(out.join('\n'));
}

async function main() {
  const o = args(process.argv.slice(2));
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const today = (await client.query(`SELECT (now() AT TIME ZONE 'Europe/London')::date AS d, ((now() AT TIME ZONE 'Europe/London')::date - 28)::text AS f`)).rows[0];
    o.from = o.from || today.f;
    // --to is a day: the period runs to the END of it (London). Without it, to now.
    const to = o.to ? (await client.query(`SELECT (($1::date + 1)::timestamp AT TIME ZONE 'Europe/London') AS t`, [o.to])).rows[0].t : new Date();
    o.toLabel = o.to || 'now';
    const moves = await readMoves(client, o.from, to);
    const pay = await readPay(client, o.from, to);
    const meta = { lastSale: (await client.query(`SELECT max(solddate)::text || ' ' || COALESCE(max(ordertime) FILTER (WHERE solddate = (SELECT max(solddate) FROM sales WHERE channel = 'AMZ')), '') AS d FROM sales WHERE channel = 'AMZ'`)).rows[0].d };
    if (o.json) console.log(JSON.stringify({ from: o.from, to: o.toLabel, meta, pay, moves }, null, 1));
    else print(moves, pay, o, meta);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
