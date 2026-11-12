/*
=======================================================================================================================================
Module: utils/amzBuyBoxTeam.js  — THE copy of the Buy Box "Team week" rules (owner, 2026-11-12; docs/amz-buybox/PLAN.md point 12)
=======================================================================================================================================
Purpose: What each person's Amazon price changes did to the Buy Box, per week, plus the moves worth talking through. READ ONLY:
         it only reads amz_price_log, amz_buybox_history, amz_size_history, sales and today's cost. Nothing is stored.

WHY: the owner wants to see "staff progress and what they have actually achieved. Will also motivate them". The headline is
         RESULTS, not activity (1,080 changes at 11 seconds each would look brilliant as a count). Agreement with the system sits
         behind it as a list to talk through, never a score. Sales are credited to NO ONE: season and stock explain too much of them.

WHICH MOVES: every amz_price_log row by a PERSON. 'Manual' (Seller Central, seen by the nightly report) and 'Claude' (the
         amz-pricing skill) are left out. Holds (same price) are counted for context only: they are neither credited nor listed.

WHEN A MOVE IS THE PERSON'S (owner, 2026-11-12: "yes, that's the right rule"):
  BEFORE = the Buy Box reading in force just before the move (the latest amz_buybox_history row before it; history is change-only).
  AFTER  = the first reading after the move in which AMAZON SHOWS THE NEW PRICE. A price is only live once Amazon has it, so a
           reading that still shows the old price isn't the move's result. History writes a row whenever our price changes, so
           that row exists once Amazon takes the price.
  SUPERSEDED = another price change on the same size (by anyone) before AFTER. Only the later move is judged ("if the price
           changes again before the next reading, only the later move is judged"), and the earlier one is neither credited nor listed.
  WAITING = no reading after yet (the next hourly read will judge it).
  NOT JUDGED = no reading before (Buy Box history starts 2026-11-12, so earlier moves are never judged) or a size with no rival
           (ALONE — price is purely demand, the pricing standard's job; owner, 2026-11-12: Alone sizes left off).

  WON BACK   = before, we were shown to < 100% of views; the new price is at or below the lead price (postage included — or up to
               2% over it when the lead was a self-poster, Go through's trial, 2026-11-12); and
               AFTER shows us to MORE views. A cut that doesn't reach the lead can't be what won the views; a rival moved.
  RAISE KEPT = a raise, before we were shown to SOME views (> 0%: a 0% size has no Buy Box to keep), and AFTER shows the same or
               more. Credited with the extra profit on the pairs sold AT the raised price since (Amazon sales, net of returns,
               until the next price change): pairs × (profit at the new price − profit at the old), today's cost / FBA fee.
  Everything else is credited to nobody, whichever way the share moved (rivals move the share too: 2 of 12 holds gained views
  on the first morning without any price change).

MOVES TO LOOK AT TOGETHER (owner, 2026-11-12: "yes, those five rules"), judged on BEFORE, so they show straight away:
  1 'held'      a cut when we were already shown to 100% (the Buy Box was ours — unless it was a demand call; the one to talk about)
  2 'under'     a cut to more than 1% below the lead price (matching would have done; the rest is margin given away)
  3 'tie'       a cut on a tie at our price (going under starts the race with the copier)
  4 'not_live'  a cut on a size with no stock live at FBA (Amazon can't feature it, so no price fixes it). Only when we weren't
                shown at all before: being featured proves stock was live, whatever the day's stock row says.
  5 'walk'      any change to a price under the £3 walk-away (today's cost)
  A move can match several. Worded on screen as what the system would have done otherwise, never as a mark against someone.

WEEKS: Monday 00:00 UK time. 'this' = Monday to now, 'last' = the week before. A move belongs to the week it was made in; a raise's
         pairs are counted up to now.
=======================================================================================================================================
*/

const { amzProfit, priceForProfit } = require('./amzProfit');
const { SETTINGS } = require('./amzPricingStandard');

const NOT_PEOPLE = ['Manual', 'Claude'];
const UNDER_LEAD = 0.01;     // rule 2: more than 1% below the lead price
const PENNY = 0.005;

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const isUs = (h) => h === 'US' || h === 'US_SHARED';
const r2 = (n) => Math.round(n * 100) / 100;

/** Everything the Team week panel shows, for this week and last. */
async function readTeamWeek(db) {
  const bounds = (await db.query(
    `SELECT (date_trunc('week', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London') AS this_start,
            ((date_trunc('week', now() AT TIME ZONE 'Europe/London') - interval '7 days') AT TIME ZONE 'Europe/London') AS last_start,
            now() AS now,
            (SELECT min(read_at) FROM amz_buybox_history)::text AS history_from`)).rows[0];

  // Every price change since last Monday (anyone — a later change by Manual / Claude still supersedes), each with the time of
  // the NEXT change on the same size.
  const moves = (await db.query(
    `SELECT id, code, changed_by, old_price::float8 AS old_price, new_price::float8 AS new_price, changed_at,
            changed_at::text AS changed_at_text, (changed_at AT TIME ZONE 'Europe/London')::date::text AS day,
            lead(changed_at) OVER (PARTITION BY code ORDER BY changed_at, id) AS next_at,
            (lead(changed_at) OVER (PARTITION BY code ORDER BY changed_at, id) AT TIME ZONE 'Europe/London')::date::text AS next_day
     FROM amz_price_log WHERE changed_at >= $1 ORDER BY changed_at, id`, [bounds.last_start])).rows;
  const people = moves.filter((m) => m.changed_by && !NOT_PEOPLE.includes(m.changed_by));
  const codes = [...new Set(people.map((m) => m.code))];
  if (!codes.length) return finish(bounds, emptyWeeks());

  // Buy Box history for those sizes (all of it: the reading in force BEFORE a move may be older than the week).
  const hist = new Map();
  for (const h of (await db.query(
    `SELECT code, read_at, our_price::float8 AS our_price, holder, bb_price::float8 AS bb_price, rivals, our_share
     FROM amz_buybox_history WHERE code = ANY($1) ORDER BY code, read_at`, [codes])).rows) {
    if (!hist.has(h.code)) hist.set(h.code, []);
    hist.get(h.code).push(h);
  }
  // FBA live stock per day (change-only; ledger rows carry no live figure, so they are skipped).
  const live = new Map();
  for (const s of (await db.query(
    `SELECT code, day::text AS day, live FROM amz_size_history WHERE code = ANY($1) AND live IS NOT NULL ORDER BY code, day`, [codes])).rows) {
    if (!live.has(s.code)) live.set(s.code, []);
    live.get(s.code).push(s);
  }
  // Today's cost / FBA fee / VAT, as the screen's groups use them.
  const econ = new Map((await db.query(
    `SELECT m.code, sk.cost, sk.tax, a.fbafee, t.shopifytitle AS title
     FROM skumap m LEFT JOIN skusummary sk ON sk.groupid = m.groupid LEFT JOIN amzfeed a ON a.code = m.code
     LEFT JOIN title t ON t.groupid = m.groupid WHERE m.code = ANY($1)`, [codes])).rows.map((r) => [r.code, r]));
  // Amazon sales of those sizes since last Monday (qty -1 = a return), for the raises' pairs.
  const sales = (await db.query(
    `SELECT code, solddate::text AS day, qty, soldprice::float8 AS price FROM sales
     WHERE channel = 'AMZ' AND code = ANY($1) AND solddate >= ($2::timestamptz AT TIME ZONE 'Europe/London')::date`,
    [codes, bounds.last_start])).rows;

  const weeks = emptyWeeks();
  for (const m of people) {
    const week = m.changed_at >= bounds.this_start ? weeks.this : weeks.last;
    const p = personRow(week, m.changed_by);
    const dir = m.new_price > m.old_price + PENNY ? 'up' : m.new_price < m.old_price - PENNY ? 'down' : 'hold';
    if (dir === 'hold') { p.holds += 1; continue; }
    p.changes += 1;
    if (dir === 'down') p.cuts += 1; else p.raises += 1;

    const rows = hist.get(m.code) || [];
    const before = [...rows].reverse().find((h) => h.read_at < m.changed_at) || null;
    if (!before || !(Number(before.rivals) > 0)) { p.not_judged += 1; continue; }

    const e = econ.get(m.code) || {};
    const walk = priceForProfit({ cost: e.cost, fbafee: e.fbafee, tax: e.tax }, SETTINGS.WALK_AWAY_PROFIT);
    const beforeShare = num(before.our_share);
    const leadIsUs = isUs(before.holder);
    const lead = num(before.bb_price);
    const after = rows.find((h) => h.read_at > m.changed_at && h.our_price !== null && Math.abs(h.our_price - m.new_price) < PENNY) || null;
    const superseded = m.next_at && (!after || m.next_at < after.read_at);
    if (superseded) { p.superseded += 1; continue; }

    // The five rules, on BEFORE.
    const why = [];
    if (dir === 'down') {
      if (beforeShare !== null && beforeShare >= 100) why.push('held');
      if (!leadIsUs && lead !== null && m.new_price < lead * (1 - UNDER_LEAD)) why.push('under');
      if (!leadIsUs && lead !== null && before.our_price !== null && Math.abs(lead - before.our_price) < PENNY) why.push('tie');
      const lv = [...(live.get(m.code) || [])].reverse().find((s) => s.day <= m.day);
      // Amazon featuring us at all PROVES stock was live: amz_size_history is one row a day and can lag within it (25511-41-022-38
      // on 12 Nov: shown 100%, yet the day's row said 0 live). So only a size we weren't shown on can be "not live".
      if (lv && !(Number(lv.live) > 0) && !(beforeShare > 0)) why.push('not_live');
    }
    if (walk !== null && m.new_price < walk - PENNY) why.push('walk');

    // The credit, on AFTER.
    let result = null;
    let pairs = 0;
    let extra = 0;
    if (!after) p.waiting += 1;
    else {
      const afterShare = num(after.our_share);
      // "Reached the lead" = at or under it — or, when the lead was a SELF-POSTER, up to 2% over it (Go through's can_match trial,
      // owner 2026-11-12: FBA wins views there, so that cut can be what won them).
      const reach = before.holder === 'OTHER_MFN' ? Math.floor(lead * 102 + 1e-6) / 100 : lead;
      if (dir === 'down' && beforeShare !== null && afterShare !== null && beforeShare < 100 && lead !== null
          && m.new_price <= reach + PENNY && afterShare > beforeShare) {
        result = 'won_back'; p.won_back += 1;
      } else if (dir === 'up' && beforeShare !== null && afterShare !== null && beforeShare > 0 && afterShare >= beforeShare) {
        result = 'raise_kept'; p.raises_kept += 1;
        pairs = sales.filter((s) => s.code === m.code && s.day >= m.day && (!m.next_day || s.day <= m.next_day)
          && s.price >= m.new_price - PENNY).reduce((t, s) => t + Number(s.qty), 0);
        const pNew = amzProfit({ price: m.new_price, cost: e.cost, fbafee: e.fbafee, tax: e.tax }).profit;
        const pOld = amzProfit({ price: m.old_price, cost: e.cost, fbafee: e.fbafee, tax: e.tax }).profit;
        if (pairs > 0 && pNew !== null && pOld !== null) extra = r2(pairs * (pNew - pOld));
        p.kept_pairs += pairs; p.kept_profit = r2(p.kept_profit + extra);
      }
    }
    if (why.length) {
      p.to_look += 1;
      week.look.push({
        id: m.id, code: m.code, title: e.title || null, by: m.changed_by, changed_at: m.changed_at_text,
        old_price: m.old_price, new_price: m.new_price, why,
        before: { share: beforeShare, holder: before.holder, lead_price: lead, our_price: num(before.our_price) },
        after: after ? { share: num(after.our_share) } : null, walk, result,
      });
    }
  }
  return finish(bounds, weeks);
}

function finish(bounds, weeks) {
  for (const w of Object.values(weeks)) {
    w.people = [...w.people.values()].sort((a, b) => b.changes - a.changes || a.name.localeCompare(b.name));
    w.look.sort((a, b) => (a.changed_at < b.changed_at ? 1 : -1));
  }
  return { this_start: bounds.this_start, last_start: bounds.last_start, history_from: bounds.history_from, weeks };
}

function emptyWeeks() {
  return { this: { people: new Map(), look: [] }, last: { people: new Map(), look: [] } };
}
function personRow(week, name) {
  if (!week.people.has(name)) {
    week.people.set(name, { name, changes: 0, cuts: 0, raises: 0, holds: 0, won_back: 0, raises_kept: 0, kept_pairs: 0, kept_profit: 0,
      to_look: 0, waiting: 0, superseded: 0, not_judged: 0 });
  }
  return week.people.get(name);
}

module.exports = { readTeamWeek, NOT_PEOPLE };
