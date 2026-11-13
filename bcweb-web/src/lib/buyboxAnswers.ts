/*
=======================================================================================================================================
Lib: buyboxAnswers — the words for the Buy Box answers, moods and reasons (2026-11-12, PLAN.md decisions 13–20)
=======================================================================================================================================
One copy of the on-screen wording, shared by the Buy Box screen and Pricing (the cards, /amz/buybox/deck — was "Go through", renamed 2026-11-13, owner: "We are pricing here"). The RULES are server-side
(utils/amzBuyBoxDeck.js); this file only names them. Words chosen with the owner: "Not for this screen" (not "Not a Buy Box job");
moods Fierce / Chilled / Climb (names that clash with nothing BCWEB already uses — Hot, Push, Lean, Boost, Harvest, Clearance).
=======================================================================================================================================
*/

import type { AmzAnswer, AmzMood } from '@/lib/api';

export const ANSWERS: { key: AmzAnswer; label: string; rule: string; dot: string; bar: string }[] = [
  { key: 'new', label: 'New', rule: 'Landed at Amazon in the last 30 days, no Amazon sale yet — get the first sale: a penny under the lead, never below break-even', dot: 'bg-violet-500', bar: 'bg-violet-400' },
  { key: 'raise', label: 'Raise', rule: 'We’re in the window and the other sellers are well above us — go up a little and stay in it. Sold in the last 30 days', dot: 'bg-emerald-500', bar: 'bg-emerald-400' },
  { key: 'cut', label: 'Cut', rule: 'Someone else is in the window and we can go under them and still keep £3 a pair. Sold in the last 30 days', dot: 'bg-red-500', bar: 'bg-red-400' },
  { key: 'leave', label: 'Leave', rule: 'Selling, nothing to gain — already in the best place, or the other seller is too cheap to follow', dot: 'bg-slate-500', bar: 'bg-slate-500' },
  { key: 'off', label: 'Not for this screen', rule: 'Sold nothing on Amazon in 30 days — another seller isn’t the reason. These stay on the Due list', dot: 'bg-slate-300', bar: 'bg-slate-300' },
];

// short = the one line on the Buy Box screen's mood card.
export const MOODS: { key: AmzMood; label: string; sub: string; raise: string; cut: string; short: string }[] = [
  { key: 'fierce', label: 'Fierce', sub: 'Shift stock', raise: 'No raises', cut: 'More cuts — sizes that stopped selling too, and a penny under a seller copying our price', short: 'No raises · more cuts, even sizes that stopped selling' },
  { key: 'chilled', label: 'Chilled', sub: 'A normal day', raise: 'Small steps up, at most 5%', cut: 'Just under the seller in the window, keeping £3 a pair. Sold in 30 days', short: 'Raises up to 5% · cut just under the window' },
  { key: 'climb', label: 'Climb', sub: 'Reach for more', raise: 'Bigger steps up, at most 8%', cut: 'No cuts — let the other sellers sell out first', short: 'Raises up to 8% · no cuts' },
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
  no_raise: 'Room to go up — no raises in Fierce',
  no_cut: 'Could cut — no cuts in Climb',
  can_match: 'Can match — no move',
  unknown: 'No cost on the style',
  error: 'Not read',
  recent: 'Sold on Amazon in the last 3 months — resting',
  older: 'Not sold on Amazon in 3+ months, or never',
  lead: 'We’re shown',
  breakeven: 'Matching would be a loss',
};

export const reasonLabel = (r: string) => REASONS[r] ?? r;
