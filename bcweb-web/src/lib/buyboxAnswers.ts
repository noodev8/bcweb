/*
=======================================================================================================================================
Lib: buyboxAnswers — the words for the Buy Box answers and reasons (2026-11-12, PLAN.md decisions 13–20)
=======================================================================================================================================
One copy of the on-screen wording, shared by the Amazon Pricing home (/amz), Sizes at Amazon (/amz/buybox) and Pricing (the cards, /amz/buybox/deck — was "Go through", renamed 2026-11-13, owner: "We are pricing here"). The RULES are server-side
(utils/amzBuyBoxDeck.js); this file only names them. Words chosen with the owner: "Not for this screen" (not "Not a Buy Box job"), "Not selling" since 2026-11-13.
The Fierce / Chilled / Climb moods are gone (owner, 2026-11-21: "We only use chilled") — one set of rules.
=======================================================================================================================================
*/

import type { AmzAnswer, AmzLostPart } from '@/lib/api';

export const ANSWERS: { key: AmzAnswer; label: string; rule: string; dot: string; bar: string }[] = [
  { key: 'new', label: 'New', rule: 'Landed at Amazon in the last 30 days, no Amazon sale yet — get the first sale: a penny under the lead (1% under a self-poster), never below break-even', dot: 'bg-violet-500', bar: 'bg-violet-400' },
  { key: 'raise', label: 'Raise', rule: 'We’re in the window and the other sellers are well above us — go up a little and stay in it. Sold in the last 30 days', dot: 'bg-emerald-500', bar: 'bg-emerald-400' },
  { key: 'cut', label: 'Cut', rule: 'Someone else is in the window and we can go under them and still keep £3 a pair — a penny under, 1% under a self-poster. Sold in the last 30 days', dot: 'bg-red-500', bar: 'bg-red-400' },
  { key: 'leave', label: 'Leave', rule: 'Selling, nothing to gain — already in the best place, or the other seller is too cheap to follow', dot: 'bg-slate-500', bar: 'bg-slate-500' },
  // 'off' is NOT SELLING on screen since 2026-11-13 (was "Not for this screen"): the Amazon Pricing home's fourth tile is "Not selling ·
  // due" (PLAN.md decision 25), and these sizes are its in-stock part — priced from the list by their review date (decision 21).
  { key: 'off', label: 'Not selling', rule: 'Sold nothing on Amazon in 30 days — another seller isn’t the reason. Priced from Not selling · due when its review date comes round', dot: 'bg-slate-300', bar: 'bg-slate-300' },
];

// Why a size has its answer: the waiting reasons for a card that isn't ready, else the Buy Box group (utils/amzBuyBox.js → classify).
export const REASONS: Record<string, string> = {
  ready: 'To price',
  left: 'Left on Pricing — back when its price would change, or after 7 days',
  changed: 'A price set since the reading — back after the next one',
  raised: 'Raised, waiting for a sale at the new price',
  top: 'Winning, at the top',
  alone: 'Alone — no other seller',
  dearer: 'A dearer rival is shown',
  cant_match: 'Too cheap to follow (under our £3)',
  no_bb: 'No Buy Box',
  tie: 'Tie at our price',
  cheaper_rival: 'Already 2% over a cheaper rival',
  rrp: 'At the RRP',
  not_eligible: 'Not eligible (Seller Central)',
  self_poster: 'A self-poster leads — 1% under it would go under our £3',
  can_match: 'Can match — no move',
  unknown: 'No cost on the style',
  error: 'Not read',
  recent: 'Sold on Amazon in the last 3 months — resting',
  older: 'Not sold on Amazon in 3+ months, or never',
  lead: 'We’re shown',
  breakeven: 'Going under the lead would be a loss',
};

export const reasonLabel = (r: string) => REASONS[r] ?? r;

// WHERE WE DON'T HAVE THE BUY BOX (owner, 2026-11-21): the Amazon Pricing strip's three parts and their cards (/amz/lost-cards).
// The split is server-side (utils/amzBuyBox.js → lostPart); these are only its words. "Rival" = whoever has it — FBM, FBA or
// Amazon (owner: "We dont care"); prices postage included.
export const LOST_TEXT: Record<AmzLostPart, { label: string; hint: string }> = {
  cheaper: { label: 'rival cheaper than us', hint: 'Biggest price gap first' },
  level: { label: 'rival at our price or dearer', hint: 'Price isn’t the reason' },
  nobody: { label: 'nobody has it', hint: 'Amazon shows no one' },
};
