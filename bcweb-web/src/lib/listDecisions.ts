/*
=======================================================================================================================================
Lib: listDecisions — the wording and the To decide test of the decision layer shared by Deep sellers and Clearance (owner, 2026-11-06).
=======================================================================================================================================
  The server keeps the keys and the rules (bcweb-server/utils/listDecision.js, migrations/20261106b_list_decision.sql); this file owns
  what the screens SAY and the defaults they offer. A new action = a key in the server's LISTS AND a line here.

  LOOK AGAIN (owner, 2026-11-06): the standard pricing periods 3 · 7 · 14 · 30 days (lib/reviewPeriods.ts); a price action defaults to
  14, everything else to 30; HARVEST offers Spring (the next 1 March, from the server) or 30 days and defaults to Spring, so every
  Harvest style comes back as one batch when the season turns.

  TO DECIDE = no decision, OR its look-again date has arrived, OR its measure has grown since (owner chose both). The measure shown is
  the same number the server saved: Deep sellers = the style's qty over; Clearance = its qty in stock in its 9-month+ sizes.
=======================================================================================================================================
*/

import type { DecisionList, ListDecision } from '@/lib/api';
import { REVIEW_PERIODS } from '@/lib/reviewPeriods';

export type LookAgain = number | 'spring';
export interface ListAction { key: string; label: string; dflt: LookAgain }

export const LIST_ACTIONS: Record<DecisionList, ListAction[]> = {
  deep: [
    { key: 'shopify', label: 'Shopify price', dflt: 14 },
    { key: 'amazon', label: 'Amazon price', dflt: 14 },
    { key: 'off', label: 'Off-channel', dflt: 30 },
    { key: 'harvest', label: 'Harvest', dflt: 'spring' },
  ],
  clearance: [
    { key: 'shopify50', label: 'Shopify 50%', dflt: 30 },
    { key: 'ebay', label: 'eBay', dflt: 30 },
    { key: 'amazon', label: 'Amazon', dflt: 30 },
    { key: 'joblot', label: 'Job lot', dflt: 30 },
    { key: 'shop', label: 'Other shop', dflt: 30 },
    { key: 'cm3', label: 'CM3 shop', dflt: 30 },
    { key: 'harvest', label: 'Harvest', dflt: 'spring' },
  ],
};

export const actionOf = (list: DecisionList, key: string) => LIST_ACTIONS[list].find((a) => a.key === key) ?? null;
export const lookAgainChoices = (a: ListAction): LookAgain[] => (a.dflt === 'spring' ? ['spring', 30] : REVIEW_PERIODS);

export const isDue = (d: ListDecision | undefined, measureNow: number, today: string) =>
  !d || d.look_again <= today || measureNow > d.measure;

// "1 Mar" / "1 Mar 28" from 'YYYY-MM-DD', read by split (CLAUDE.md: never the JS Date parser for a pg date).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function shortDate(ymd: string, today: string) {
  const [y, m, d] = ymd.split('-').map(Number);
  const ty = Number(today.slice(0, 4));
  return `${d} ${MONTHS[m - 1]}${y === ty || (y === ty + 1 && m < Number(today.slice(5, 7))) ? '' : ` ${String(y).slice(2)}`}`;
}
