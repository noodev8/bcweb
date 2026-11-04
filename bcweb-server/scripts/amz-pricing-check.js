/*
=======================================================================================================================================
Script: scripts/amz-pricing-check.js   (READ ONLY — the /amz-pricing skill runs this)
=======================================================================================================================================
Purpose: Print THE Amazon pricing standard's verdict for every size of a style (rules: utils/amzPricingStandard.js — read its header).
         Writes nothing: it runs inside a READ ONLY transaction. Prices are changed by a person, on the normal Amazon screens.

Usage:
    node scripts/amz-pricing-check.js <style text> [options]      e.g.  IVES-WHITE   or   FLE030-IVES-WHITE
    node scripts/amz-pricing-check.js --top 10 [options]           the 10 styles with the most Amazon pairs in 12 months

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
  const o = { text: null, top: null, mode: 'lean', report: null, to: null, json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--push') o.mode = 'push';
    else if (a === '--json') o.json = true;
    else if (a === '--top') o.top = Number(argv[(i += 1)]);
    else if (a === '--report') o.report = argv[(i += 1)];
    else if (a === '--to') o.to = argv[(i += 1)];
    else if (!a.startsWith('--')) o.text = a;
    else throw new Error(`Unknown option ${a}`);
  }
  if (o.to && !/^\d{4}-\d{2}-\d{2}$/.test(o.to)) throw new Error('--to must be YYYY-MM-DD');
  if (o.top !== null && !(o.top > 0)) throw new Error('--top needs a number');
  if (!o.text && !o.top) throw new Error('Give a style (e.g. IVES-WHITE) or --top N');
  if (o.report && !fs.existsSync(o.report)) throw new Error(`No such file: ${o.report}`);
  return o;
}

const money = (v) => (v === null || v === undefined ? '—' : `£${Number(v).toFixed(2)}`);
const pad = (s, n) => String(s ?? '').padEnd(n);
const lpad = (s, n) => String(s ?? '').padStart(n);

function printStyle(res) {
  const { style: st, sizes } = res;
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
    const extra = [s.reason, s.note].filter(Boolean).join(' · ');
    if (extra) console.log(`      ${extra}`);
  }
  if (!st.buyBoxChecked) console.log(`  Business Report wanted (child item) for ${st.reportFrom} to ${st.asOf} to check the Buy Box.`);
}

async function main() {
  const o = args(process.argv.slice(2));
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const asOf = o.to || (await client.query(`SELECT (now() AT TIME ZONE 'Europe/London')::date::text AS d`)).rows[0].d;
    let styles;
    if (o.top) styles = (await std.topStyles(client, o.top, asOf)).map((r) => r.groupid);
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
