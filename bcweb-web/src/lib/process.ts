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
