/*
=======================================================================================================================================
Util: amzDue  (THE one meaning of Amazon "due" — docs/amz-buybox/PLAN.md decisions 21 and 26, owner 2026-11-13)
=======================================================================================================================================
Purpose: Decide, for every Amazon size, whether it needs pricing now. One rule on every screen (owner: "Option 1, one rule everywhere"),
         so Daily's "Amazon to price", the Amazon Pricing home's tiles and the lists' Due switches can never disagree.

THE RULE — two halves, every size in exactly one:
  BUY BOX HALF   a size the Buy Box answers in CHILLED (utils/amzBuyBoxDeck.js → readDeck): live at FBA and selling (an Amazon sale in
                 30 days), or NEW (landed in 30 days, no Amazon sale yet). It is due when it has a CARD (New / Raise / Cut, reason
                 `ready`) — its review date no longer decides (decision 21: "Buy Box decides for selling FBA sizes"). A Leave answer, or a
                 card waiting (left / changed / raised), is not due.
  REVIEW HALF    everything else — sold nothing in 30 days ("Not selling"), inbound only, out of stock, priced ahead of arrival, live but
                 not read yet: due when its review date (skumap.next_amz_price_review) is empty or has come round, as before.
  Why Chilled: a dashboard figure mustn't depend on a mood picked later (decision 23). The home's tiles show the chosen mood's cards.
  Set / Leave on a card still push the review date 4 weeks, so a size that stops selling joins the review half on a sensible date.
  No fallback when the hourly Buy Box reading stops (owner: "rare and we will notice and price manually until fixed").

Usage, in JS: const side = await readBuyBoxSide(db); then dueBy(side, code, reviewDue) per row. `db` is anything with .query (the
       pool, a client).
Usage, in SQL (the routes that count / limit in SQL — Repricing, the status / segment / Selling | Stuck lists, the skill):
       const p = sideParams(side); pass p.bb and p.cards as two text[] parameters and put dueSql('a.code', 'm.next_amz_price_review',
       '$7', '$8') where the old "review IS NULL OR review <= CURRENT_DATE" test was. Same rule, so every screen counts the same.
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
 * Is this size due? { due, by: 'buybox' | 'review', answer, reason }. reviewDue = its review date is empty or today / passed.
 */
function dueBy(side, code, reviewDue) {
  const b = side.get(code);
  if (b) return { due: b.card, by: 'buybox', answer: b.answer, reason: b.reason };
  return { due: !!reviewDue, by: 'review', answer: null, reason: null };
}

/** The Buy Box half as two arrays for SQL: bb = every code it answers, cards = the ones with a card (due). */
function sideParams(side) {
  const bb = []; const cards = [];
  for (const [code, b] of side) { bb.push(code); if (b.card) cards.push(code); }
  return { bb, cards };
}

/**
 * THE rule as a SQL boolean (header). codeCol / reviewCol are trusted column expressions (never request input); bbParam / cardsParam
 * the placeholders holding sideParams' arrays; onExpr the day "due" is judged on (the skill's --on; default today).
 */
function dueSql(codeCol, reviewCol, bbParam, cardsParam, onExpr = 'CURRENT_DATE') {
  return `(CASE WHEN ${codeCol} = ANY(${bbParam}::text[]) THEN ${codeCol} = ANY(${cardsParam}::text[])
                ELSE (${reviewCol} IS NULL OR ${reviewCol} <= ${onExpr}) END)`;
}

module.exports = { DUE_MOOD, readBuyBoxSide, dueBy, sideParams, dueSql };
