'use client';

import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

// Click-to-sort column headers for the Repricing price lists (Shopify + Amazon). The list opens in the SERVER'S order (the order its
// route chose — best sellers / most stock first); a header click sorts by that column, a second click reverses it. Sorting is
// client-side over the rows already loaded — the lists are the whole qualifying set (see CLAUDE.md), so nothing is missed. Nulls
// always sink to the bottom whichever way round. The sort lives in the URL (?sort=price.desc) so a drill round-trip returns to it —
// the page's own list URL (listHref) must carry `sort` through.

export type SortDir = 'asc' | 'desc';
type SortValue = number | string | null | undefined;

export function useTableSort<T, K extends string>(rows: T[], getters: Record<K, (r: T) => SortValue>) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const raw = searchParams.get('sort');
  const [rk, rd] = (raw || '').split('.');
  const sort = rk in getters && (rd === 'asc' || rd === 'desc') ? { key: rk as K, dir: rd as SortDir } : null;

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = getters[sort.key];
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a), vb = get(b);
      const na = va === null || va === undefined || va === '';
      const nb = vb === null || vb === undefined || vb === '';
      if (na || nb) return na === nb ? 0 : na ? 1 : -1;
      const d = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' });
      return d * dir;
    });
    // getters is a fresh object literal each render; its functions are pure, so the key is what matters
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort?.key, sort?.dir]);

  // First click: numbers high→low, text A→Z (firstDir); clicking the lit column again flips it.
  function onSort(key: K, firstDir: SortDir) {
    const dir = sort && sort.key === key ? (sort.dir === 'asc' ? 'desc' : 'asc') : firstDir;
    const q = new URLSearchParams(searchParams.toString());
    q.set('sort', `${key}.${dir}`);
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }

  return { sorted, sort, onSort };
}

// `compact` (Shopify vs Amazon, 2026-10-07): px-3 to match px-3 cells, one-line label, and on a right-aligned column the sort arrow
// goes BEFORE the label — its slot is reserved even when hidden, so on the right it pushed the label in off the numbers' edge.
// Off by default, so the other lists look exactly as before.
export function SortableTh<K extends string>({ label, sortKey, sort, onSort, firstDir = 'desc', align = 'left', title, compact = false }: {
  label: string;
  sortKey: K;
  sort: { key: K; dir: SortDir } | null;
  onSort: (key: K, firstDir: SortDir) => void;
  firstDir?: SortDir;
  align?: 'left' | 'right';
  title?: string;
  compact?: boolean;
}) {
  const active = sort?.key === sortKey;
  const arrow = <span className={'text-[10px] ' + (active ? '' : 'invisible')}>{active && sort!.dir === 'asc' ? '▲' : '▼'}</span>;
  const arrowFirst = compact && align === 'right';
  return (
    <th className={(compact ? 'px-3' : 'px-4') + ' py-2 font-medium ' + (align === 'right' ? 'text-right' : '')} title={title} aria-sort={active ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        onClick={() => onSort(sortKey, firstDir)}
        className={'inline-flex items-center gap-1 uppercase tracking-wide hover:text-slate-800 ' + (compact ? 'whitespace-nowrap ' : '') + (active ? 'text-slate-800' : '')}
      >
        {arrowFirst && arrow}
        {label}
        {!arrowFirst && arrow}
      </button>
    </th>
  );
}
