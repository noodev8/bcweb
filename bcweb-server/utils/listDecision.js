/*
=======================================================================================================================================
Util: listDecision
=======================================================================================================================================
Purpose: THE shared decision layer of Deep sellers (/analytics/deep-sizes) and Clearance (Range's "No sale 9 months+" list,
         /analytics/slow-sizes/list?band=cl). Owner, 2026-11-06: each stays its own screen "to reduce the list of each and help us
         focus", with one decision layer under both. Table list_decision (migrations/20261106b_list_decision.sql — read its header).

THE DECISION = an action picked BY HAND for a style's sizes on that list, a look-again date, and the style's MEASURE at that moment.
         It goes back to the list's To decide view when the look-again date arrives OR the measure grows (owner: both). The web side
         tests that (bcweb-web/src/lib/listDecisions.ts → isDue) against the measure it shows, which is the same number as here.

THE MEASURE ("has it got deeper?"):
  deep       the qty OVER across the style's deep sizes (utils/deepSizes.js), so another delivery, or another size going deep, brings it
             back; selling some off never does.
  clearance  the qty IN STOCK across the style's 9-month+ sizes (utils/slowSizes.js + datedFromFirstArrival, as Range's list), so a
             size newly crossing 9 months brings it back.
         Worked out HERE from the live list, never sent by the screen. A style that isn't on the list right now can't be decided.

THE ACTIONS (keys; the screen owns the wording, bcweb-web/src/lib/listDecisions.ts):
  deep       shopify (Shopify price) · amazon (Amazon price) · off (Off-channel) · harvest
  clearance  shopify50 (Shopify 50% of RRP) · ebay · amazon (clear on Amazon) · joblot · shop (another shop, sale-or-return) ·
             cm3 (CM3 shop / personal sales) · harvest
  HARVEST (owner's word, kept): take the hit, wait for spring, clear some at a decent price. By hand only, never from Seasons.
         Choosing an action only records it; any price move is its own step.

LOOK AGAIN = a whole number of days (the standard 3 · 7 · 14 · 30, any 1–365 accepted) or SPRING = the next 1 March after today
         (London), so every Harvest style comes back as one batch.
=======================================================================================================================================
Exports:
  LISTS                       { deep: { section, actions[] }, clearance: { ... } }
  springDate(today)           'YYYY-MM-DD' — the next 1 March strictly after today
  londonToday()               Promise<'YYYY-MM-DD'>
  readMeasures(list)          Map groupid -> measure, for every style on the list right now
=======================================================================================================================================
*/

const { query } = require('../database');
const { readDeepSizes } = require('./deepSizes');
const { readSlowSizes, datedFromFirstArrival } = require('./slowSizes');

const LISTS = {
  deep: { section: 'Deep sellers', actions: ['shopify', 'amazon', 'off', 'harvest'] },
  clearance: { section: 'Clearance', actions: ['shopify50', 'ebay', 'amazon', 'joblot', 'shop', 'cm3', 'harvest'] },
};

async function londonToday() {
  const r = await query(`SELECT to_char((now() AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS d`);
  return r.rows[0].d;
}

// The next 1 March strictly after today (on 1 March itself, next year's).
function springDate(today) {
  const [y, m] = today.split('-').map(Number);
  return `${m < 3 ? y : y + 1}-03-01`;   // Jan / Feb → this March; from 1 March on → next March
}

async function readMeasures(list) {
  const out = new Map();
  if (list === 'deep') {
    const { sizes } = await readDeepSizes();
    for (const s of sizes) out.set(s.groupid, (out.get(s.groupid) || 0) + s.over);
  } else if (list === 'clearance') {
    const { today, cutoff, sizes } = await readSlowSizes();
    await datedFromFirstArrival(sizes, today, cutoff);
    for (const s of sizes) if (s.clearance) out.set(s.groupid, (out.get(s.groupid) || 0) + s.units);
  }
  return out;
}

module.exports = { LISTS, springDate, londonToday, readMeasures };
