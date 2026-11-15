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

export const stepListHref = (key: LadderListKey, chip?: LadderChip) => `/analytics/slow-sizes/step?key=${key}${chip && chip !== 'due' ? `&when=${chip}` : ''}`;
