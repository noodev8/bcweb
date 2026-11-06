/*
=======================================================================================================================================
Script: scripts/amz-pricing-check.js   (READ ONLY — the /amz-pricing skill runs this)
=======================================================================================================================================
Purpose: Print THE Amazon pricing standard's verdict for every size of a style (rules: utils/amzPricingStandard.js — read its header).
         Writes nothing: it runs inside a READ ONLY transaction. Prices are changed by a person, on the normal Amazon screens.

Usage:
    node scripts/amz-pricing-check.js <style text> [options]      e.g.  IVES-WHITE   or   FLE030-IVES-WHITE
    node scripts/amz-pricing-check.js --top 10 [options]           the 10 styles with the most Amazon pairs in 12 months
    node scripts/amz-pricing-check.js --due [N] [options]          THE WORK LIST: every size Due on the Amazon screens today (review
                            date passed or none, FBA stock), sizes needing a decision first, most FBA pairs first;
                            N styles shown in full (default 10). A size decided on is parked (amz-price-set / amz-review-set), so
                            the next run moves on — the same rotation as the team's manual Due list (owner, 2026-11-04).
    --due-on YYYY-MM-DD     with --due: what will be Due on that day (look ahead; verdicts are still today's)
    --grid                  with --due: one short row per size needing a decision — the glance view (owner, 2026-11-04)
    --all                   with --due: the OVERRIDE — parked sizes too (shown "PARKED to <date>")

Options:
    --push                  Revenue Push suggestions (default Lean on profit)
    --report <file.csv>     a Business Report (Detail Page Sales and Traffic by Child Item) — turns on the Buy Box check. The CSV has
                            no dates in it: download it for the dates this script prints ("Business Report wanted").
    --to YYYY-MM-DD         judge as of a past day (e.g. --to 2026-03-16 for last winter); default today
    --json                  print the raw result instead of the table
=======================================================================================================================================
*/

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const { pool } = require('../database');
const std = require('../utils/amzPricingStandard');

const LABEL = {
  LOST_BUY_BOX: 'LOST BUY BOX',
  TOO_HIGH: 'TOO HIGH',
  NOT_PRICE: 'NOT PRICE',
  LEAVE: 'LEAVE',
  ROOM_TO_GO_UP: 'ROOM TO GO UP',
  CANT_TELL: "CAN'T TELL",
};

function args(argv) {
  const o = { text: null, top: null, due: null, dueOn: null, all: false, grid: false, mode: 'lean', report: null, to: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--push') o.mode = 'push';
    else if (a === '--json') o.json = true;
    else if (a === '--top') o.top = Number(argv[(i += 1)]);
    else if (a === '--due') o.due = /^\d+$/.test(argv[i + 1] || '') ? Number(argv[(i += 1)]) : 10;
    else if (a === '--report') o.report = argv[(i += 1)];
    else if (a === '--to') o.to = argv[(i += 1)];
    else if (a === '--due-on') o.dueOn = argv[(i += 1)];
    else if (a === '--all') o.all = true;
    else if (a === '--grid') o.grid = true;
    else if (!a.startsWith('--')) o.text = a;
    else throw new Error(`Unknown option ${a}`);
  }
  if (o.to && !/^\d{4}-\d{2}-\d{2}$/.test(o.to)) throw new Error('--to must be YYYY-MM-DD');
  if (o.top !== null && !(o.top > 0)) throw new Error('--top needs a number');
  if (o.dueOn && (o.due === null || !/^\d{4}-\d{2}-\d{2}$/.test(o.dueOn))) throw new Error('--due-on YYYY-MM-DD goes with --due');
  if (o.all && o.due === null) throw new Error('--all goes with --due');
  if (o.due !== null && !(o.due > 0)) throw new Error('--due N needs a number above 0');
  if (o.due !== null && o.to) throw new Error('--due is today only (review dates have no history) — drop --to');
  if (!o.text && !o.top && o.due === null) throw new Error('Give a style (e.g. IVES-WHITE), --top N or --due');
  if (o.report && !fs.existsSync(o.report)) throw new Error(`No such file: ${o.report}`);
  return o;
}

const money = (v) => (v === null || v === undefined ? '—' : `£${Number(v).toFixed(2)}`);
const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);

// Verdicts that need a person's decision; LEAVE is parked for REVIEW_AFTER_LEAVE_DAYS; CAN'T TELL stays Due for the team.
const ACTION = new Set(['LOST_BUY_BOX', 'TOO_HIGH', 'ROOM_TO_GO_UP', 'NOT_PRICE']);

function printStyle(res, only = null, parkedTo = null) {
  const { style: st } = res;
  const sizes = only ? res.sizes.filter((s) => only.has(s.code)) : res.sizes;
  console.log('');
  console.log(`=== ${st.groupid} — as of ${st.asOf} · ${st.mode === 'push' ? 'REVENUE PUSH' : 'LEAN on profit'} · ` +
    `FBA ${st.stock} pairs, ${st.units28} sold in 28 days, cover ${st.coverWeeks === null ? '—' : `${st.coverWeeks} wks`} · ` +
    `Buy Box ${st.buyBoxChecked ? 'checked' : 'NOT checked'} · next 4 weeks' profit at today's prices ~£${st.profitMonth}`);
  console.log(pad('size', 6) + lpad('price', 8) + '  ' + pad('window', 24) + lpad('stock', 7) + lpad('share', 7) +
    lpad('exp', 6) + lpad('sold', 6) + lpad('BB%', 6) + lpad('median', 9) + '  ' + pad('verdict', 14) + lpad('suggest', 9) +
    lpad('kept', 7) + lpad('walk', 8) + lpad('/wk', 6) + lpad('wks', 6) + lpad('£4wk', 7));
  for (const s of sizes) {
    const win = s.liveStart ? `${s.windowFrom}${s.startUncertain ? '~' : ''} ${s.inStockDays}/${s.windowDays}d` : '—';
    console.log(
      pad(s.size, 6) + lpad(money(s.price), 8) + '  ' + pad(win, 24) + lpad(s.stock ?? '—', 7) +
      lpad(s.normalShare === null ? '—' : `${Math.round(s.normalShare * 100)}%`, 7) +
      lpad(s.expected === null ? '—' : s.expected.toFixed(1), 6) + lpad(s.sold, 6) +
      lpad(s.buyBox === null ? '—' : Math.round(s.buyBox), 6) + lpad(money(s.sisterMedian), 9) + '  ' +
      pad(LABEL[s.verdict], 14) + lpad(s.suggested === null ? '' : money(s.suggested), 9) +
      lpad(s.keptSuggested !== null ? money(s.keptSuggested) : money(s.keptNow), 7) + lpad(money(s.walkAway), 8) +
      lpad(s.ratePerWeek ?? '—', 6) + lpad(s.weeksLeft ?? '—', 6) + lpad(s.profitMonth === null ? '—' : `£${s.profitMonth}`, 7)
    );
    const parked = parkedTo && parkedTo.get(s.code) ? 'PARKED to ' + parkedTo.get(s.code) + ' (override)' : null;
    const extra = [parked, s.reason, s.note].filter(Boolean).join(' · ');
    if (extra) console.log(`      ${extra}`);
  }
  if (!st.buyBoxChecked && !only) console.log(`  Business Report wanted (child item) for ${st.reportFrom} to ${st.asOf} to check the Buy Box.`);
}

// --due: only the Due sizes of each style. Styles with a size needing a decision come first, TOP SELLERS NOW first (the style's
// Amazon pairs in the last 28 days — owner: the list "will probably be the top sellers at the time"; unlike --top's 12 months it
// moves with the season), then FBA pairs on those sizes. N of them in full, the rest in one line each. LEAVE sizes are listed ready
// to park; a size already parked (--all) needs no park.
function printDue(results, due, o, buyBox, parkedTo) {
  const rows = results.map((res) => {
    const d = due.get(res.style.groupid);
    const mine = res.sizes.filter((s) => d.has(s.code));
    const act = mine.filter((s) => ACTION.has(s.verdict));
    return {
      res,
      act,
      leave: mine.filter((s) => s.verdict === 'LEAVE' && !parkedTo.has(s.code)),
      wait: mine.filter((s) => s.verdict === 'CANT_TELL' && !parkedTo.has(s.code)),
      stake: act.reduce((x, s) => x + (s.stock || 0), 0),
    };
  }).sort((a, b) => (b.act.length > 0) - (a.act.length > 0) || b.res.style.units28 - a.res.style.units28 || b.stake - a.stake || a.res.style.groupid.localeCompare(b.res.style.groupid));
  if (o.json) {
    console.log(JSON.stringify({ settings: std.SETTINGS, due: rows.map((r) => ({ style: r.res.style, action: r.act, leave: r.leave, cantTell: r.wait })) }, null, 2));
    return;
  }
  const nSizes = rows.reduce((x, r) => x + r.act.length + r.leave.length + r.wait.length, 0);
  const withAct = rows.filter((r) => r.act.length);
  console.log(`${o.all ? 'ALL IN STOCK (override — parked sizes included)' : `DUE ${o.dueOn ? `ON ${o.dueOn}` : 'TODAY'}`}: ${nSizes} sizes in ${rows.length} styles · ${withAct.reduce((x, r) => x + r.act.length, 0)} need a decision (${withAct.length} styles) · ` +
    `${rows.reduce((x, r) => x + r.leave.length, 0)} leave · ${rows.reduce((x, r) => x + r.wait.length, 0)} can't tell (stay Due)`);
  if (buyBox) console.log(`Business Report: ${buyBox.size} of our sizes read.`);
  else if (rows.length) {
    const from = rows.reduce((m, r) => (!m || (r.res.style.reportFrom && r.res.style.reportFrom < m) ? r.res.style.reportFrom : m), null);
    console.log(`Buy Box NOT checked — Business Report wanted (child item) for ${from} to ${rows[0].res.style.asOf}.`);
  }
  const shown = withAct.slice(0, o.due);
  // --grid: ONE short row per size needing a decision (owner, 2026-11-04: "show results as a grid ... so I can glance and then ask
  // for more detail") — the glance view; a style's full rows come from running it by name.
  if (o.grid) {
    console.log('');
    console.log(pad('style', 26) + pad('size', 6) + lpad('price', 8) + lpad('BB%', 5) + lpad('sold/exp', 10) + lpad('median', 9) + '  ' +
      pad('verdict', 14) + lpad('suggest', 9) + lpad('stock', 6) + lpad('/wk', 5) + lpad('wks', 6) + '  parked');
    for (const r of shown) {
      for (const s of r.act) {
        console.log(pad(r.res.style.groupid.slice(0, 25), 26) + pad(s.size, 6) + lpad(money(s.price), 8) +
          lpad(s.buyBox === null ? '—' : Math.round(s.buyBox), 5) +
          lpad(`${s.sold}/${s.expected === null ? '—' : s.expected.toFixed(1)}`, 10) + lpad(money(s.sisterMedian), 9) + '  ' +
          pad(LABEL[s.verdict], 14) + lpad(s.suggested === null ? '' : money(s.suggested), 9) + lpad(s.stock ?? '—', 6) +
          lpad(s.ratePerWeek ?? '—', 5) + lpad(s.weeksLeft ?? '—', 6) + '  ' + (parkedTo.get(s.code) || ''));
      }
    }
    const more = withAct.length - shown.length;
    if (more > 0) console.log(`\n${more} more styles need a decision — --due ${withAct.length} --grid to see all.`);
    return;
  }
  for (const r of shown) {
    printStyle(r.res, new Set(r.act.map((s) => s.code)), parkedTo);
    if (r.leave.length) console.log(`  leave → park ${std.SETTINGS.REVIEW_AFTER_LEAVE_DAYS} days: ${r.leave.map((s) => s.code).join(' ')}`);
    if (r.wait.length) console.log(`  can't tell, stay Due: ${r.wait.map((s) => s.size).join(', ')}`);
  }
  const rest = withAct.slice(o.due);
  if (rest.length) {
    console.log(`
More needing a decision (--due ${withAct.length} to see all):`);
    for (const r of rest) console.log(`  ${r.res.style.groupid}: ${r.act.map((s) => `${s.size} ${LABEL[s.verdict]}`).join(', ')}`);
  }
  const leaveOnly = rows.filter((r) => !r.act.length && r.leave.length);
  if (leaveOnly.length) {
    console.log(`
Nothing to decide — leave, park ${std.SETTINGS.REVIEW_AFTER_LEAVE_DAYS} days:`);
    for (const r of leaveOnly) console.log(`  ${r.leave.map((s) => s.code).join(' ')}`);
  }
  const waitOnly = rows.filter((r) => !r.act.length && !r.leave.length && r.wait.length);   // parked-only styles (--all) need nothing
  if (waitOnly.length) console.log(`
Can't tell yet (stay Due): ${waitOnly.map((r) => r.res.style.groupid).join(', ')}`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const asOf = o.to || (await client.query(`SELECT (now() AT TIME ZONE 'Europe/London')::date::text AS d`)).rows[0].d;
    let styles;
    let due = null;
    let parkedTo = new Map();
    if (o.due !== null) {
      const ds = await std.dueStyles(client, { on: o.dueOn, all: o.all });
      parkedTo = new Map(ds.flatMap((r) => Object.entries(r.parked)));
      due = new Map(ds.map((r) => [r.groupid, new Set(r.codes)]));
      styles = [...due.keys()];
    } else if (o.top) styles = (await std.topStyles(client, o.top, asOf)).map((r) => r.groupid);
    else {
      styles = await std.findStyles(client, o.text);
      if (!styles.length) throw new Error(`No style on Amazon matches "${o.text}"`);
      if (styles.length > 1) {
        console.log(`"${o.text}" matches ${styles.length} styles — be more exact:\n  ${styles.join('\n  ')}`);
        return;
      }
    }
    const buyBox = o.report ? await std.readBusinessReport(client, o.report) : null;
    const results = [];
    for (const g of styles) results.push(await std.checkStyle(client, g, { to: o.to, mode: o.mode, buyBox }));
    if (due) { printDue(results, due, o, buyBox, parkedTo); return; }
    if (o.json) console.log(JSON.stringify({ settings: std.SETTINGS, results }, null, 2));
    else {
      if (buyBox) console.log(`Business Report: ${buyBox.size} of our sizes read${buyBox.unknownSkus ? `, ${buyBox.unknownSkus} SKUs not on amzfeed skipped` : ''}.`);
      results.forEach(printStyle);
      console.log('\nkept = £ kept a pair at the suggested price (else today\'s) · walk = the £3-a-pair walk-away price · ~ = start date uncertain (price first seen in a sale)');
      console.log('/wk = pairs a week at this price (in-stock weeks of the window) · wks = weeks of FBA stock at that pace · £4wk = profit over the next 4 weeks at today\'s price, capped at the stock');
    }
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

main()
  .then(() => pool.end())
  .catch((err) => { console.error('[amz-pricing-check] FAILED:', err.message); pool.end().finally(() => process.exit(1)); });
