/*
=======================================================================================================================================
Util: amzBuyBoxDeck  (THE rules for "Go through" — the Buy Box one-at-a-time screen, /amz/buybox/deck, 2026-11-12)
=======================================================================================================================================
Purpose: Turn the two Buy Box groups that have a job into a short deck of decisions, one size at a time, each with ONE suggested move —
         so a price change is made LOOKING at the Buy Box instead of blind from the Due list (1,076 changes by one person in 22 days,
         median 11 s apart, and 0 in-stock sizes Due on 2026-11-12: the team already gets through everything; the question is whether
         each move is right). PLAN.md step 3 (the Match / Raise presses) — started on the owner's say, 2026-11-12. A TRIAL: it may
         become the main Amazon pricing screen or be folded away. Laptop first (owner: "95% of our price changes will be on laptop"),
         usable on a phone. Reads utils/amzBuyBox.js → readScreen (the stored reading, never Amazon). The write is the normal W-A1
         (POST /amz-apply), sent to Amazon at once — nothing here writes.

THE DECKS (owner agreed the recommendations, 2026-11-12):
  room       "Winning, room to go up" -> RAISE to the next rival above us minus 1p, capped at +5% on our price and at the RRP; never down.
             (Room is still a guess — FBA wins above cheaper self-posters — so the cap keeps each step small; history will show more.)
             AND, when a rival already sells BELOW us, capped at 2% over that cheapest rival (owner, 2026-11-12). Why: across the
             2026-11-12 reading our average share of views was 78% as the cheapest offer, 54% at 0–2% over the cheapest rival, 46% at
             2–5%, 12% at 5–8% and ~0 at 20%+ — the FBA premium over a cheaper self-poster is only a few %. A size already 2%+ over
             the cheaper rival gets NO card (counted as `cheaper_rival`) — raising would give views away.
  can_match  "Losing, can match"      -> MATCH: a penny under the lead price, postage included. A penny under, not level: at our exact
             price Amazon gives the tie to the rival (the 'tie' group). Never under the £3 walk-away — if a penny under would be, the
             suggestion is the lead price itself (a tie, said on the card).
  Every other group's answer is "leave it", so it makes no card.

WHO IS IN A DECK:
  - SOLD IN 30 DAYS only (owner: leave out sizes that sold nothing, at first) — counted as `not_selling`.
  - NOT ACTED ON SINCE THE READING: a size with a price set after its reading (amz_price_log newer than read_at — set_since, any
    screen, any person) leaves the deck and comes back only once a reading has SEEN its new price, if it is still in the group
    (owner agreed: the cooldown is the next reading, not a review date — the same test Team week judges a move by). Counted as
    `waiting`. The review dates are not read and not touched: the Buy Box screen has none (owner, 2026-11-12).
  - can_match: our offer not "not eligible" — no price wins a Buy Box Amazon won't consider us for. Counted as `not_eligible`.
  "Leave" on the screen is a skip for this visit only (nothing stored), like the Buy Box screen's ×.

ORDER — money at stake first, so the first cards are the ones that matter:
  room       pairs a week × the extra profit a pair at the suggested price ("≈ £x a week more if it keeps selling" — shown on the card).
  can_match  pairs in 30 days × the share of views we are NOT shown to (no £ figure: how many more we'd sell is unknown).

PROFIT ON THE CARD: amzProfit is a straight line in price (fees and VAT are % of price, the rest fixed, then ÷1.2), so each card carries
  that line (profit = per_pound × price + at_zero) worked out HERE from two amzProfit calls — the screen prices a typed-in figure
  without a second copy of the formula.
=======================================================================================================================================
*/

const { amzProfit } = require('./amzProfit');
const { readScreen } = require('./amzBuyBox');

const DECKS = ['room', 'can_match'];
const RAISE_CAP = 0.05;            // a raise is at most +5% on our price per step
const OVER_CHEAPER_CAP = 0.02;     // ...and at most 2% over a rival already cheaper than us (header)
const PENNY = 0.01;

const floor2 = (n) => Math.floor(n * 100 + 1e-6) / 100;
const ceil2 = (n) => Math.ceil(n * 100 - 1e-6) / 100;
const r2 = (n) => (n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100);

/** profit = per_pound × price + at_zero (see header). null when the cost is unknown. */
function profitLine(econ) {
  const a = amzProfit({ ...econ, price: 10 }).profit;
  const b = amzProfit({ ...econ, price: 110 }).profit;
  if (a === null || b === null) return null;
  const perPound = (b - a) / 100;
  return { per_pound: Math.round(perPound * 1e6) / 1e6, at_zero: Math.round((a - perPound * 10) * 1e4) / 1e4 };
}

/** The cheapest rival offer priced BELOW us (postage included, as stored), or null when we are the cheapest. */
function cheaperRival(r) {
  const below = (r.offers || []).filter((o) => !o.us && o.price !== null && o.price !== undefined && Number(o.price) < r.our_price - 0.005);
  return below.length ? Math.min(...below.map((o) => Number(o.price))) : null;
}

/** The suggested move for one stored row of the Buy Box screen. Returns { price, note } or null when there is no move. */
function suggest(r) {
  if (r.our_price === null) return null;
  if (r.group === 'room') {
    if (r.next_up === null) return null;
    let p = floor2(Math.min(r.next_up - PENNY, r.our_price * (1 + RAISE_CAP)));
    let note = p <= r.next_up - PENNY - 0.005 ? 'Capped at +5% — the next rival is further up' : 'A penny under the next rival above us';
    if (r.rrp !== null && p > r.rrp) { p = floor2(r.rrp); note = 'Capped at the RRP'; }
    const cheaper = cheaperRival(r);
    if (cheaper !== null && p > floor2(cheaper * (1 + OVER_CHEAPER_CAP))) {
      p = floor2(cheaper * (1 + OVER_CHEAPER_CAP));
      note = `Capped at 2% over the cheaper rival (${'£' + cheaper.toFixed(2)})`;
    }
    return p > r.our_price + 0.005 ? { price: p, note } : null;
  }
  if (r.group === 'can_match') {
    if (r.bb_price === null) return null;
    const under = r2(r.bb_price - PENNY);
    if (r.walk !== null && under < ceil2(r.walk)) {
      return { price: r2(r.bb_price), note: 'Level with the lead — a penny under would be below the £3 walk-away (a tie usually goes to them)' };
    }
    return { price: under, note: 'A penny under the lead price, postage included' };
  }
  return null;
}

async function readDeck(db) {
  const screen = await readScreen(db);
  const counts = Object.fromEntries(DECKS.map((d) => [d, 0]));
  const leftOut = Object.fromEntries(DECKS.map((d) => [d, { not_selling: 0, waiting: 0, not_eligible: 0, cheaper_rival: 0 }]));

  const picked = [];
  for (const r of screen.rows) {
    if (!DECKS.includes(r.group)) continue;
    if (r.set_since !== null) { leftOut[r.group].waiting += 1; continue; }
    if (!(r.sold30 > 0)) { leftOut[r.group].not_selling += 1; continue; }
    if (r.group === 'can_match' && r.our_eligible === false) { leftOut[r.group].not_eligible += 1; continue; }
    const s = suggest(r);
    if (!s) { if (r.group === 'room' && cheaperRival(r) !== null) leftOut[r.group].cheaper_rival += 1; continue; }
    picked.push({ r, s });
  }

  // The style's picture (the thumbnails' imagename), one query for the whole deck.
  const groupids = [...new Set(picked.map((p) => p.r.groupid).filter(Boolean))];
  const imgs = groupids.length
    ? await db.query(`SELECT groupid, imagename FROM skusummary WHERE groupid = ANY($1)`, [groupids])
    : { rows: [] };
  const imageOf = Object.fromEntries(imgs.rows.map((x) => [x.groupid, x.imagename || null]));

  // cost / fbafee / tax for the profit line — readScreen doesn't return them, so read them for the picked sizes only.
  const codes = picked.map((p) => p.r.code);
  const econRows = codes.length
    ? await db.query(
      `SELECT a.code, a.fbafee, sk.cost, sk.tax FROM amzfeed a JOIN skumap m ON m.code = a.code
       LEFT JOIN skusummary sk ON sk.groupid = m.groupid WHERE a.code = ANY($1)`, [codes])
    : { rows: [] };
  const econOf = Object.fromEntries(econRows.rows.map((x) => [x.code, { cost: x.cost, fbafee: x.fbafee, tax: x.tax }]));

  const cards = picked.map(({ r, s }) => {
    const econ = econOf[r.code] || {};
    const profitNow = amzProfit({ ...econ, price: r.our_price }).profit;
    const profitSuggest = amzProfit({ ...econ, price: s.price }).profit;
    const perWeek = r.sold30 * 7 / 30;
    let stake;
    let gain = null;
    if (r.group === 'room') {
      gain = profitNow !== null && profitSuggest !== null ? r2(perWeek * (profitSuggest - profitNow)) : null;
      stake = gain ?? 0;
    } else {
      stake = r.sold30 * (100 - (r.our_share ?? 0)) / 100;
    }
    counts[r.group] += 1;
    return {
      deck: r.group, code: r.code, groupid: r.groupid, title: r.title, brand: r.brand, asin: r.asin, imagename: imageOf[r.groupid] ?? null,
      read_at: r.read_at, live: r.live, total: r.total, sold30: r.sold30, weeks_left: r.weeks_left,
      our_price: r.our_price, rrp: r.rrp, walk: r.walk,
      holder: r.holder, bb_price: r.bb_price, lead_share: r.lead_share, our_share: r.our_share, next_up: r.next_up, rivals: r.rivals,
      rival_at_our_price: r.rival_at_our_price, amazon_retail: r.amazon_retail,
      offers: r.offers, featured: r.featured,
      suggest: s.price, suggest_note: s.note,
      profit_now: profitNow, profit_suggest: profitSuggest, profit_line: profitLine(econ),
      gain_week: gain, stake,
    };
  });
  cards.sort((a, b) => b.stake - a.stake || b.sold30 - a.sold30 || a.code.localeCompare(b.code));

  return { cards, counts, left_out: leftOut, last_all: screen.last_all, running: screen.running };
}

module.exports = { DECKS, RAISE_CAP, OVER_CHEAPER_CAP, cheaperRival, suggest, profitLine, readDeck };
