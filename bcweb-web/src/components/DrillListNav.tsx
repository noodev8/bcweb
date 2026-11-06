'use client';
/*
=======================================================================================================================================
Component: DrillListNav
=======================================================================================================================================
Purpose: ‹ Prev · 3 of 25 · Next › on a pricing drill (Shopify /pricing/style/<groupid>, Amazon /amz/sku/<code>), stepping through the
         LIST the drill was opened from without going back to it (owner, 2026-11-05: "price due and price navigation back and forth" —
         built for New Additions, which prices a run of new styles / sizes one after another).

HOW: the list screen calls saveDrillList(id, …) on the click that opens a drill, and links with ?list=<id>. The drill renders
<DrillListNav current={key} />, which reads that list back and links its neighbours with the same ?from= and ?list=, so ← Back still
returns to the list. The list is a SNAPSHOT taken at the click: pricing a style takes it out of a Due list, and the walk must not skip
or reshuffle under you.

sessionStorage, per tab (owner: navigation stays on the same tab): read with useSyncExternalStore (server snapshot null — no hydration
mismatch, no mount effect). Missing, unreadable, or the drill not on the list = renders nothing; the drill works as before.
=======================================================================================================================================
*/

import Link from 'next/link';
import { useMemo, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/20/solid';

export interface DrillList {
  base: string;     // the drill path the key is appended to, e.g. '/pricing/style/'
  keys: string[];   // groupids or codes, in the list's order
  from: string;     // the list's own URL — every step carries it as ?from=, so ← Back returns there
  label: string;    // what the list is, for the tooltip ("New Additions")
}

const storeKey = (id: string) => `drill-list:${id}`;

export function saveDrillList(id: string, list: DrillList) {
  try { sessionStorage.setItem(storeKey(id), JSON.stringify(list)); } catch { /* private mode / blocked: the drill just has no Prev/Next */ }
}

// The href for one step of a saved list.
export function drillListHref(id: string, list: Pick<DrillList, 'base' | 'from'>, key: string) {
  return `${list.base}${encodeURIComponent(key)}?from=${encodeURIComponent(list.from)}&list=${encodeURIComponent(id)}`;
}

const noSubscribe = () => () => {};

export default function DrillListNav({ current }: { current: string }) {
  const id = useSearchParams().get('list');
  // The raw string is the snapshot (stable between renders); parsed below.
  const raw = useSyncExternalStore(
    noSubscribe,
    () => { if (!id) return null; try { return sessionStorage.getItem(storeKey(id)); } catch { return null; } },
    () => null,
  );
  const list = useMemo<DrillList | null>(() => {
    if (!raw) return null;
    try { return JSON.parse(raw) as DrillList; } catch { return null; }
  }, [raw]);

  if (!id || !list) return null;
  const i = list.keys.indexOf(current);
  if (i < 0) return null;
  const prev = i > 0 ? list.keys[i - 1] : null;
  const next = i < list.keys.length - 1 ? list.keys[i + 1] : null;

  const btn = 'inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-sm font-medium text-slate-700 transition hover:border-brand-500 hover:bg-brand-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400';
  const off = 'inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 text-sm text-slate-300';
  return (
    <nav aria-label={`Step through ${list.label}`} className="flex items-center gap-2">
      {prev ? (
        <Link href={drillListHref(id, list, prev)} className={btn} title={prev}><ChevronLeftIcon className="h-4 w-4" />Prev</Link>
      ) : (
        <span className={off}><ChevronLeftIcon className="h-4 w-4" />Prev</span>
      )}
      <span className="text-xs tabular-nums text-slate-500" title={`Your place in ${list.label}, as it was when you opened it`}>
        {i + 1} of {list.keys.length}
      </span>
      {next ? (
        <Link href={drillListHref(id, list, next)} className={btn} title={next}>Next<ChevronRightIcon className="h-4 w-4" /></Link>
      ) : (
        <span className={off}>Next<ChevronRightIcon className="h-4 w-4" /></span>
      )}
    </nav>
  );
}
