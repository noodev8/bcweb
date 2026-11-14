/*
=======================================================================================================================================
Util: amzDue  (THE one meaning of Amazon "due" — docs/amz-buybox/PLAN.md decisions 21, 26 and 27, owner 2026-11-13)
=======================================================================================================================================
Purpose: Decide, for every Amazon size, whether it is DUE, and count the BUY BOX MOVES. One rule on every screen (owner: "Option 1, one
         rule everywhere"), so Daily, the Amazon Pricing home's tiles and the lists' Due switches can never disagree.

THE RULE — two halves, every size in exactly one:
  BUY BOX HALF   a size the Buy Box answers in CHILLED (utils/amzBuyBoxDeck.js → readDeck): live at FBA and selling (an Amazon sale in
                 30 days), or NEW (landed in 30 days, no Amazon sale yet). NEVER DUE — its review date doesn't decide it (decision 21:
                 "Buy Box decides for selling FBA sizes"; decision 16: Raise / Cut sizes aren't on the Due list). One with a CARD (New /
                 Raise / Cut, reason `ready`) is a BUY BOX MOVE instead — Daily's secondary line, worked "when they have time" on the
                 Amazon Pricing home.
  REVIEW HALF    everything else — sold nothing in 30 days ("Not selling"), inbound only, out of stock, priced ahead of arrival, live but
                 not read yet: DUE when its review date (skumap.next_amz_price_review) is empty or has come round AND IT IS LIVE AT FBA
                 (amzfeed.amzlive > 0). LIVE ONLY (owner, 2026-11-14: "take them off, also dont show the ones coming in. These are just
                 for live stock"): a size with none sellable at Amazon — out of stock, or only on its way in — is never due; its price
                 can't sell anything yet. Its review date is left alone, so it comes back by itself once stock is live.
  DECISION 27 (owner, 2026-11-13: "Lets remove the 1 number rule now ... leave with due and a secondary number of BUY BOX MOVES ...
  they will focus on due down to zero"): until then the cards counted as due too ("Amazon to price" = cards + due), and a live queue
  that refills hourly made the morning number feel like going round in circles. Now Due is a list that reaches zero and stays there;
  the cards are counted beside it.
  Why Chilled: a dashboard figure mustn't depend on a mood picked later (decision 23). The home's tiles show the chosen mood's cards.
  Set / Leave on a card still push the review date 4 weeks, so a size that stops selling joins the review half on a sensible date.
  No fallback when the hourly Buy Box reading stops (owner: "rare and we will notice and price manually until fixed").

Usage, in JS: const side = await readBuyBoxSide(db); then dueBy(side, code, reviewDue) per row; buyBoxMoves(side) = the cards.
       `db` is anything with .query (the pool, a client).
Usage, in SQL (the routes that count / limit in SQL — Repricing, the status / segment / Selling | Stuck lists, New Additions, the skill):
       pass sideParams(side).bb as a text[] parameter and put dueSql('a.code', 'm.next_amz_price_review', '$7') where the old "review
       IS NULL OR review <= CURRENT_DATE" test was. Same rule, so every screen counts the same.
=======================================================================================================================================
*/

const { readDeck } = require('./amzBuyBoxDeck');

const DUE_MOOD = 'chilled';

/**
 * The Buy Box half: Map code -> { answer, reason, card } for every size the Buy Box answers in Chilled ('off' = Not selling is the
 * review half, so it is left out).
 */
async function readBuyBoxSide(db) {
  const d = await readDeck(db, { mood: DUE_MOOD, answersOnly: true });
  const side = new Map();
  for (const [code, [answer, reason]] of Object.entries(d.answer_of)) {
    if (answer === 'off') continue;
    side.set(code, { answer, reason, card: reason === 'ready' });
  }
  return side;
}

/**
 * Is this size due? { due, by: 'buybox' | 'review', answer, reason, card }. reviewDue = its review date is empty or today / passed;
 * live = its sellable FBA stock (amzfeed.amzlive) is above 0. A Buy Box size is never due (header); `card` says it is a Buy Box move.
 */
function dueBy(side, code, reviewDue, live) {
  const b = side.get(code);
  if (b) return { due: false, by: 'buybox', answer: b.answer, reason: b.reason, card: b.card };
  return { due: !!reviewDue && !!live, by: 'review', answer: null, reason: null, card: false };
}

/** Daily's BUY BOX MOVES: the sizes with a card in Chilled. */
function buyBoxMoves(side) {
  let n = 0;
  for (const b of side.values()) if (b.card) n += 1;
  return n;
}

/** The Buy Box half as an array for SQL: every code it answers (never due). cards = those with a card (Buy Box moves). */
function sideParams(side) {
  const bb = []; const cards = [];
  for (const [code, b] of side) { bb.push(code); if (b.card) cards.push(code); }
  return { bb, cards };
}

/**
 * THE rule as a SQL boolean (header): not a Buy Box size, its review date empty or come round, and live at FBA. codeCol / reviewCol
 * are trusted column expressions (never request input); bbParam the placeholder holding sideParams(side).bb; onExpr the day "due" is
 * judged on (the skill's --on; default today). LIVE is tested on amzfeed by code, so every caller gets it without a new column.
 */
function dueSql(codeCol, reviewCol, bbParam, onExpr = 'CURRENT_DATE') {
  return `(NOT ${codeCol} = ANY(${bbParam}::text[]) AND (${reviewCol} IS NULL OR ${reviewCol} <= ${onExpr})`
    + ` AND EXISTS (SELECT 1 FROM amzfeed due_f WHERE due_f.code = ${codeCol} AND COALESCE(due_f.amzlive, 0) > 0))`;
}

module.exports = { DUE_MOOD, readBuyBoxSide, dueBy, buyBoxMoves, sideParams, dueSql };
