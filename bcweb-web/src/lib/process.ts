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
// (styleDue — New Additions' Due switch — went with the switch on 2026-11-06; git history.)
