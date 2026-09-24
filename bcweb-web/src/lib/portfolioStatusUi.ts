// Shared look-and-words for the five portfolio statuses (skusummary.portfolio_status), used by the Winners screen and Repricing's
// Status tab so a status reads the same — same colour, same one-line rule — wherever it appears.
import type { PortfolioStatusName } from '@/lib/api';

// What each status means, in a few words. Mirrors the rules in bcweb-server/utils/portfolioStatus.js — if a rule moves there, move
// it here.
export const STATUS_RULE: Record<PortfolioStatusName, string> = {
  WINNERS: 'over £1,500 in 12 months',
  STEADY: 'sold in the last 3 months',
  NEW: 'created under 90 days ago',
  HARVEST: 'out of season',
  LOSERS: 'none of the above',
};

// Categorical slots 1–5 of the dataviz reference palette, in rule order — fixed per status, never by rank, so a status keeps its colour
// whatever its size. Validated as a set (adjacent CVD ΔE ≥ 9.1). Three sit under 3:1 on white, so the colour is only ever a KEY beside
// the status name, never the only thing identifying it.
export const STATUS_COLOR: Record<PortfolioStatusName, string> = {
  WINNERS: '#2a78d6',
  STEADY: '#eb6834',
  NEW: '#1baf7a',
  HARVEST: '#eda100',
  LOSERS: '#e87ba4',
};

// The Repricing list behind a status, on one channel (/pricing = Shopify styles, /amz = Amazon SKUs). `from`/`back` set where its
// "← back" link returns to.
//   bar     WINNERS on Shopify only — a Winners-screen dial mark; the list keeps the winners over it (so it matches the card).
//   showAll open with the Due switch OFF (?pending=1), parked rows included — so the list is the card's whole number, not just
//           what is due. The Winners screen uses it ("which ones are they?"); Repricing's tiles don't (that screen is for working
//           through what's due).
export function statusListHref(
  status: PortfolioStatusName, from: string, back: string, channel: 'shopify' | 'amazon' = 'shopify',
  opts: { bar?: number | null; showAll?: boolean } = {},
): string {
  const base = channel === 'amazon' ? '/amz' : '/pricing';
  const bar = opts.bar && status === 'WINNERS' && channel === 'shopify' ? `&bar=${opts.bar}` : '';
  const all = opts.showAll ? '&pending=1' : '';
  return `${base}/${encodeURIComponent(status)}?by=status${bar}${all}&from=${encodeURIComponent(from)}&back=${encodeURIComponent(back)}`;
}

// Format a dial mark for a crumb or back label: 2500 -> "over £2,500".
export function barLabel(bar: number): string {
  return `over £${bar.toLocaleString('en-GB')}`;
}
