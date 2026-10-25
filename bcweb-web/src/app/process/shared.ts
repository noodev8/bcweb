// Shared by the Process page and the screens its cards open (/process/unsold). The rules themselves are server-side in
// bcweb-server/utils/processMap.js — these only read the per-channel blocks it returns.
import type { ProcessChannel, ProcessSizeRow } from '@/lib/api';

export const CHANNELS: { id: ProcessChannel; label: string }[] = [
  { id: 'AMZ', label: 'Amazon' },
  { id: 'SHP', label: 'Shopify' },
  { id: 'CM3', label: 'Shop' },
];

export const isSold = (r: ProcessSizeRow) => CHANNELS.some((c) => r.channels[c.id].block !== 'not_sold');
export const isWinner = (r: ProcessSizeRow) => CHANNELS.some((c) => ['once_good', 'multi_good'].includes(r.channels[c.id].block));

// 'YYYY-MM-DD' -> '25 Oct'. Parsed as parts, never through Date (a bare date string is read as UTC/local and can shift a day).
export function shortDate(d: string | null): string {
  if (!d) return '—';
  const [y, m, day] = d.split('-').map(Number);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1];
  return `${day} ${mon}${y !== new Date().getFullYear() ? ` ${y}` : ''}`;
}

// The big-number card, shared so the screens the cards open look like Process itself.
export const boxCls = 'inline-flex min-w-[10rem] flex-col rounded-xl border bg-white px-6 py-4 text-left shadow-sm transition';
