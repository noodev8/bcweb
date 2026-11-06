// Shared by the dashboard's Daily (New stuff) and Reports → New Additions — both read GET /process-overview, the NEW SKUS (first
// Goods In arrival in the last 90 days). The rules themselves are server-side in bcweb-server/utils/processMap.js.
import type { ProcessChannel, ProcessSizeRow } from '@/lib/api';

export const CHANNELS: { id: ProcessChannel; label: string }[] = [
  { id: 'AMZ', label: 'Amazon' },
  { id: 'SHP', label: 'Shopify' },
  { id: 'CM3', label: 'Shop' },
  { id: 'EBY', label: 'eBay' },
];

// Sold = netted a sale over every channel together since its first arrival (sold one and it came back = not sold) — the server's rule,
// which also counts Daily's figure (row.net).
export const isSold = (r: ProcessSizeRow) => r.net > 0;
// Net units sold, never below 0 (a return of a pair sold before the window can't make it negative on screen).
export const unitsSold = (r: ProcessSizeRow) => Math.max(r.net, 0);

// PRICE DUE for a new style (owner, 2026-11-05, option A): it still has an UNSOLD new size, and Shopify is due (per style) or an unsold
// size is due on Amazon. Sold sizes are ticked off, so they never make a style due.
export function styleDue(sizes: ProcessSizeRow[]) {
  const unsold = sizes.filter((r) => !isSold(r));
  if (unsold.length === 0) return { due: false, shp: false, amz: 0 };
  const shp = sizes[0].shpDue;
  const amz = unsold.filter((r) => r.amzDue).length;
  return { due: shp || amz > 0, shp, amz };
}
