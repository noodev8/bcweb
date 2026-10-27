// Shared by the dashboard's Daily (New stuff) and Reports → New Additions — both read GET /process-overview. The rules themselves are
// server-side in bcweb-server/utils/processMap.js.
import type { ProcessChannel, ProcessSizeRow } from '@/lib/api';

export const CHANNELS: { id: ProcessChannel; label: string }[] = [
  { id: 'AMZ', label: 'Amazon' },
  { id: 'SHP', label: 'Shopify' },
  { id: 'CM3', label: 'Shop' },
];

// Sold = netted a sale on any channel (sold one and it came back = not sold).
export const isSold = (r: ProcessSizeRow) => CHANNELS.some((c) => r.channels[c.id].net > 0);
// Units sold on every channel together, net of returns (a channel that netted below 0 counts 0).
export const unitsSold = (r: ProcessSizeRow) => CHANNELS.reduce((n, c) => n + Math.max(r.channels[c.id].net, 0), 0);

// New stuff's figure, in PAIRS (owner, 2026-10-27): pairs bought (Goods In) and sold, and unsold = bought − sold as a % of bought —
// kept LOW by better prospects. Shared so Daily and New Additions show the same number. Nothing bought = 0%.
// A size's sales count only UP TO the pairs bought (owner, 2026-10-27): a test listing on placeholder stock (UKD-Tests, added on
// Inventory, never through Goods In) that sells counts nothing until the real pair is ordered and booked in on Goods In — then it is
// 1 bought, 1 sold. Without the cap the sale would count against 0 bought and flatter the figure.
export function pairsSummary(rows: ProcessSizeRow[]) {
  let bought = 0, sold = 0;
  for (const r of rows) { bought += r.bought; sold += Math.min(unitsSold(r), r.bought); }
  const unsoldPct = bought > 0 ? Math.round((Math.max(bought - sold, 0) / bought) * 100) : 0;
  return { bought, sold, unsoldPct };
}
