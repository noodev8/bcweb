/*
=======================================================================================================================================
Lib: stockLadder  (the Stock ladder's words on screen — design docs/stock-ladder.md, rules bcweb-server/utils/stockLadder.js)
=======================================================================================================================================
One home for what each step is called, its rule in a few words, and its AIM (owner, 2026-11-15) — the reason line on a step's price
cards. Range's front (/analytics/slow-sizes), the step lists (/analytics/slow-sizes/step) and the step cards (/amz/step-cards) read it.

AIM, not a price rule (owner, 2026-11-15, option A): the cards start at today's price and suggest nothing; the aim only says what the
step is for. Arrived and Sold 90 have no cards (the Buy Box prices those sizes), so no aim.
=======================================================================================================================================
*/

import type { LadderListKey, LadderWhen } from '@/lib/api';

export const LIST_TEXT: Record<LadderListKey, { name: string; rule: string }> = {
  arrived: { name: 'Arrived', rule: 'came in from 0 stock' },
  sold: { name: 'Sold 90', rule: 'sold in 90 days' },
  overstocked: { name: 'Overstocked', rule: "sold in 90 days · over 4 months' worth" },
  unsold90: { name: 'Unsold 90', rule: '91 to 180 days' },
  unsold180: { name: 'Unsold 180', rule: 'to 9 months' },
  clearance: { name: 'Clearance', rule: '9 months + · until sold out' },
};

// The four lists that open price cards (server utils/stockLadderList.js → CARD_KEYS).
export const CARD_LISTS: LadderListKey[] = ['overstocked', 'unsold90', 'unsold180', 'clearance'];

export const isLadderList = (v: string | null): v is LadderListKey => !!v && v in LIST_TEXT;

// The step's aim for one size — the card's reason line.
export function stepAim(key: LadderListKey, idleDays: number, over: number): string {
  switch (key) {
    case 'overstocked': return `Overstocked — ${over} pair${over === 1 ? '' : 's'} over 4 months' worth · sell down`;
    case 'unsold90': return `Unsold ${idleDays} days — a gentle cut`;
    case 'unsold180': return `Unsold ${idleDays} days — a firmer cut`;
    case 'clearance': return `Clearance — no sale for ${idleDays} days · clear the lot, a loss is OK`;
    default: return '';
  }
}

// THE SHOPIFY CARD'S REASON LINE in step mode (owner, 2026-11-15: "will I know why it is there? … if 1 size was sold or more than 1
// size and only 1 size wasn't"). A Shopify card is a STYLE, so on a stuck step it says two things:
//   the sizes we HOLD — how many, and how long since any of them sold (every held size is on this step or later: a style holding a
//     size that sold more recently is carded on that size's step, or not at all if it is selling — server pricing-all-list);
//   the WHOLE STYLE — when a size now sold out sold more recently, so a selling style's leftovers read as leftovers:
//     "Unsold 180 — 1 size left, unsold 263 days · the style's other sizes sold out, last sale 4 days ago · a firmer cut".
export interface ShopifyStepFacts { onStep: number; held: number; heldIdle: number | null; styleLastSale: number | null }
const STUCK_AIM: Partial<Record<LadderListKey, string>> = {
  unsold90: 'a gentle cut', unsold180: 'a firmer cut', clearance: 'clear the lot, a loss is OK',
};
export function shopifyStepReason(key: LadderListKey, f: ShopifyStepFacts): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  if (key === 'arrived') return `Arrived — ${plural(f.onStep, 'size')} waiting for a first sale`;
  const aim = STUCK_AIM[key];
  if (!aim) return `${LIST_TEXT[key].name} — ${plural(f.onStep, 'size')}`;
  const days = f.heldIdle ?? 0;
  const heldPart = f.held === 1 ? `1 size left, unsold ${days} days` : `${f.held} sizes left, none sold for ${days} days`;
  const soldOut = f.styleLastSale !== null && f.styleLastSale < days
    ? ` · the style's other sizes sold out, last sale ${f.styleLastSale === 0 ? 'today' : `${plural(f.styleLastSale, 'day')} ago`}` : '';
  return `${LIST_TEXT[key].name} — ${heldPart}${soldOut} · ${aim}`;
}

// The list's chips, in order (owner: "Due · Within a week · Later · All"; the list opens on Due). Buy Box sizes are under All only.
export type LadderChip = 'due' | 'week' | 'later' | 'all';
export const CHIPS: { key: LadderChip; label: string }[] = [
  { key: 'due', label: 'Due' },
  { key: 'week', label: 'Within a week' },
  { key: 'later', label: 'Later' },
  { key: 'all', label: 'All' },
];
export const isChip = (v: string | null): v is LadderChip => v === 'due' || v === 'week' || v === 'later' || v === 'all';
export const inChip = (when: LadderWhen, chip: LadderChip) => chip === 'all' || when === chip;

// Clearance has its own screen (owner, 2026-11-15 — every SKU, the three channels side by side; docs/stock-ladder.md), so Range's step 5
// box and the Clearance step cards' Back both go there, not to the Amazon-only step list.
export const CLEARANCE_HREF = '/analytics/slow-sizes/clearance';
// THE CHOICE steps (owner, 2026-11-15): their Range box opens Amazon | Shopify (step/page.tsx → StepChoice), not the list. Arrived
// has no Amazon list (its door is the Buy Box's New cards); Unsold 90 / 180 keep their step list at &side=amazon.
export const CHOICE_STEPS: LadderListKey[] = ['arrived', 'unsold90', 'unsold180'];
export const stepChoiceHref = (key: LadderListKey) => `/analytics/slow-sizes/step?key=${key}`;
// Range's box: the choice, Clearance's own screen, or the list.
export const stepBoxHref = (key: LadderListKey) => (CHOICE_STEPS.includes(key) ? stepChoiceHref(key) : stepListHref(key));
// The step's Amazon LIST (the chips, Price these) — the step cards' Back and the list's own chips.
export const stepListHref = (key: LadderListKey, chip?: LadderChip) => (key === 'clearance' ? CLEARANCE_HREF
  : `/analytics/slow-sizes/step?key=${key}${CHOICE_STEPS.includes(key) && key !== 'arrived' ? '&side=amazon' : ''}`
    + `${chip && chip !== 'due' ? `&when=${chip}` : ''}`);
