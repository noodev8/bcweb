/*
=======================================================================================================================================
Util: stockLadderList  (THE copy of which sizes a Stock ladder list holds, and when each is due — owner 2026-11-15, docs/stock-ladder.md)
=======================================================================================================================================
Purpose: Range's step boxes (and the Overstocked tag) each open a list; four of them then open the Amazon price cards. Both read
         GET /amz-all-list ?step= (the Amazon list, so price, review date and THE due rule are the same as every other Amazon
         screen), and that route asks this util which sizes belong and in what order. Steps themselves: utils/stockLadder.js.

WHO IS ON A LIST (owner, 2026-11-15: "leave Birkenstock and Shopify out of these decisions for now"):
         a SKU on the step (Overstocked = step 1 or 2 SKUs carrying the label; Sold 90 = ALL of step 2, labelled or not)
         AND live at Amazon (amzfeed.amzlive > 0) AND not Birkenstock (brand ILIKE 'birk%', as eBay and AMZ loaded).
         `step_skus` = every SKU on the step, any channel — the screen says how many of them the list shows.

THE LISTS (LIST_KEYS): arrived · sold · overstocked · unsold90 · unsold180 · clearance.
         CARD_KEYS = the four that open price cards (overstocked, unsold90, unsold180, clearance). Arrived and Sold 90 are lists only:
         the Buy Box already prices those sizes (New / Raise / Cut) and a second door to the same sizes was rejected (13 Nov).

WHEN (the list's chips — owner, 2026-11-15: "Due · Within a week · Later · All", opens on Due):
         due     due by THE one Amazon rule (utils/amzDue.js — unchanged; a step never overrides a review date)
         week    not due, review date within 7 days
         later   not due, review date further off
         buybox  the Buy Box answers it (sold on Amazon in 30 days, or New) — never due, never carded here; shown under All only

ORDER: styles together, sizes in size order. Styles by the longest wait among their sizes (Overstocked: most pairs over), so the work
         that has waited longest comes first. The price cards keep the same order.

READ ONLY.
=======================================================================================================================================
Exports:
  LIST_KEYS, CARD_KEYS, WHEN_KEYS
  stepMembers(key) -> { today, step_skus, members: Map(code -> { idle_days, over, over_why, units, order }) }   (null for an unknown key)
  whenOf(due, dueBy, nextReview, today) -> 'due' | 'week' | 'later' | 'buybox'
=======================================================================================================================================
*/

const { query } = require('../database');
const { readStockLadder } = require('./stockLadder');

const LIST_KEYS = ['arrived', 'sold', 'overstocked', 'unsold90', 'unsold180', 'clearance'];
const CARD_KEYS = ['overstocked', 'unsold90', 'unsold180', 'clearance'];
const WHEN_KEYS = ['due', 'week', 'later', 'buybox', 'all'];
const WEEK_DAYS = 7;
const STEP_OF = { arrived: 1, sold: 2, unsold90: 3, unsold180: 4, clearance: 5 };   // overstocked: the label, any step carrying it

const sizeKey = (code) => {
  const s = code.slice(code.lastIndexOf('-') + 1);
  return /^[0-9]+([.][0-9]+)?$/.test(s) ? Number(s) : Infinity;
};

// YYYY-MM-DD plus n days, as text (calendar arithmetic in UTC, never local time).
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

async function stepMembers(key) {
  if (!LIST_KEYS.includes(key)) return null;
  const { today, skus } = await readStockLadder();
  const onStep = skus.filter((s) => (key === 'overstocked' ? s.overstocked : s.step === STEP_OF[key]));
  const live = new Set((await query(
    `SELECT a.code FROM amzfeed a JOIN skusummary sk ON sk.groupid = a.groupid
      WHERE a.code = ANY($1::text[]) AND COALESCE(a.amzlive, 0) > 0 AND COALESCE(sk.brand, '') NOT ILIKE 'birk%'`,
    [onStep.map((s) => s.code)])).rows.map((r) => r.code));
  const rows = onStep.filter((s) => live.has(s.code));

  // ORDER (header): a style's weight = its longest wait (Overstocked: its pairs over), heaviest first; sizes in size order.
  const weight = new Map();
  for (const s of rows) {
    const w = key === 'overstocked' ? (weight.get(s.groupid) || 0) + s.over : Math.max(weight.get(s.groupid) || 0, s.idle_days);
    weight.set(s.groupid, w);
  }
  rows.sort((a, b) => (weight.get(b.groupid) - weight.get(a.groupid)) || a.groupid.localeCompare(b.groupid)
    || (sizeKey(a.code) - sizeKey(b.code)) || a.code.localeCompare(b.code));

  const members = new Map(rows.map((s, i) => [s.code, { idle_days: s.idle_days, over: s.over, over_why: s.over_why, units: s.units, order: i }]));
  return { today, step_skus: onStep.length, members };
}

function whenOf(due, dueBy, nextReview, today) {
  if (due) return 'due';
  if (dueBy === 'buybox') return 'buybox';
  return nextReview && nextReview.slice(0, 10) <= addDays(today, WEEK_DAYS) ? 'week' : 'later';
}

module.exports = { LIST_KEYS, CARD_KEYS, WHEN_KEYS, stepMembers, whenOf };
