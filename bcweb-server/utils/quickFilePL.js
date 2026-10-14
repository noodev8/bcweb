/*
=======================================================================================================================================
Util: quickFilePL
=======================================================================================================================================
Purpose: Read QuickFile's "Segmented Profit and Loss Report" (segmented by Months → CSV Download) into the monthly figures Reports →
         Revenue uses (owner, 2026-10-14: QuickFile doesn't give a rolling 12 months easily; the monthly CSV does, and monthly is what
         lets the screen add up exactly the right 12 months — shoe sales are too seasonal to scale a part year up).

         Each P&L code maps to ONE line on the Revenue screen (expense_figure channel + name):
           4000 General Sales            ACC  Turnover           — the accounts' turnover, shown beside ours as a check, not used in sums
           5003 Packaging, 7501 Postage  SHP  Shipping
           6201 Advertising              SHP  Advertising        — all Shopify's (owner: no Amazon ads)
           6003 Seller Fees              AMZ  Seller fees        — EVERY channel's; the route takes Shopify Payments + PayPal off
           7004 Wages, 7007 Pensions     ALL  Wages
           7100 Rent                     ALL  Rent
           anything else with a code     ALL  General expenses   — incl. 5100 Carriage (inbound)
         Not taken: 5000 General Purchases (cost of goods is ours, per pair SOLD — purchases include stock still on the shelf) and
         4902 Commissions Received (a little income, left out). Total / profit rows have no code and are skipped.

         Months that haven't ENDED are skipped: QuickFile shows the current month part-posted (rent and wages in, sales not), which
         would read as a month of costs with no sales.
=======================================================================================================================================
Exports:
  parsePL(text, today) -> { ok, months: [{ from, to, lines: { 'CH|Name': amount } }], skipped: [label] } | { ok:false, reason }
  lineFor(code)        -> { channel, name } | null
=======================================================================================================================================
*/

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function lineFor(code) {
  if (code === '4000') return { channel: 'ACC', name: 'Turnover' };
  if (code === '5000' || code === '4902') return null;
  if (code === '5003' || code === '7501') return { channel: 'SHP', name: 'Shipping' };
  if (code === '6201') return { channel: 'SHP', name: 'Advertising' };
  if (code === '6003') return { channel: 'AMZ', name: 'Seller fees' };
  if (code === '7004' || code === '7007') return { channel: 'ALL', name: 'Wages' };
  if (code === '7100') return { channel: 'ALL', name: 'Rent' };
  return { channel: 'ALL', name: 'General expenses' };
}

// One CSV line → fields. QuickFile quotes every field; numbers carry thousands commas inside the quotes.
function fields(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const pad = (n) => String(n).padStart(2, '0');

// 'Nov 2025' → { from: '2025-11-01', to: '2025-11-30' } (string arithmetic only — no Date parsing of a local date).
function monthSpan(label) {
  const m = /^([A-Z][a-z]{2}) (\d{4})$/.exec(label.trim());
  const i = m ? MONTHS.indexOf(m[1]) : -1;
  if (i < 0) return null;
  const y = Number(m[2]);
  const last = new Date(Date.UTC(y, i + 1, 0)).getUTCDate();
  return { from: `${y}-${pad(i + 1)}-01`, to: `${y}-${pad(i + 1)}-${pad(last)}` };
}

function parsePL(text, today) {
  const rows = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).map(fields);
  const head = rows.find((r) => r[0] === 'Account' && r[1] === 'Code');
  if (!head) return { ok: false, reason: 'Not a QuickFile P&L CSV (no "Account","Code" header row).' };
  const spans = head.slice(2).map(monthSpan);
  if (!spans.length || spans.some((s) => !s)) {
    return { ok: false, reason: 'Columns are not months — segment the report by Months before CSV Download.' };
  }
  const months = spans.map((s) => ({ ...s, lines: {} }));
  const skipped = [];
  for (const r of rows) {
    const code = (r[1] || '').trim();
    if (!/^\d{4}$/.test(code)) continue;
    const line = lineFor(code);
    if (!line) continue;
    const key = `${line.channel}|${line.name}`;
    r.slice(2).forEach((v, i) => {
      const n = Number(String(v).replace(/,/g, ''));
      if (!Number.isFinite(n)) return;
      months[i].lines[key] = (months[i].lines[key] || 0) + n;
    });
  }
  const done = months.filter((m) => m.to < today);
  months.filter((m) => m.to >= today).forEach((m) => skipped.push(m.from.slice(0, 7)));
  for (const m of done) for (const k of Object.keys(m.lines)) m.lines[k] = Math.round(m.lines[k] * 100) / 100;
  return { ok: true, months: done, skipped };
}

module.exports = { parsePL, lineFor };
