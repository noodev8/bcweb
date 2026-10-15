'use client';
/*
=======================================================================================================================================
Component: PickLink
=======================================================================================================================================
Purpose: The "N to pick" tile on the Customer Orders board (moved from the title row, owner 2026-10-15 — it's a count like the board's) — a way through to /pick that also answers, without going there, the
         one question this screen keeps raising: how much of today's list is still sitting on a shelf.

WHY IT EXISTS RATHER THAN JUST A NAV TAB. /pick is not in the header switcher (that bar was deliberately cut to four — see AppShell),
so the only route to it is the dashboard. This is the one screen where you're already asking the question, so it gets the shortcut.

WHY IT CARRIES A NUMBER. A bare link is worth much less than the count: most days the honest answer is "nothing outstanding", and a
link that can tell you that saves the trip entirely. It renders muted at zero rather than hiding — a count that disappears when it
empties takes the reassurance with it (same call as the Pending chip in CustomerOrderList).

SHARES /pick's SWR KEY, so opening the Pick screen from here is served from cache and this link updates for free after an action
there. That is the whole reason the key is exported from PickList rather than built locally.
=======================================================================================================================================
*/

import Link from 'next/link';
import { HandRaisedIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getPickList, type PickList as PickListData } from '@/lib/api';
import { pickListKey } from '@/components/PickList';

export default function PickLink() {
  const { data } = useApiQuery<PickListData>(pickListKey('shopify'), () => getPickList('shopify'));
  const n = data?.counts.shopify;

  return (
    <Link
      // Return ticket: /pick shows "← Customer Orders" when it was opened from here (see the back note in app/pick/page.tsx).
      href={`/pick?from=${encodeURIComponent('/customer-orders')}&back=${encodeURIComponent('Customer Orders')}`}
      // Shaped like the board's StageTile (CustomerOrderList) so it reads as one more number on it — but it's a link out, not a filter.
      className="flex min-w-[96px] flex-1 flex-col justify-center rounded-xl border-2 border-slate-200 bg-white px-4 py-2 text-left transition hover:border-slate-300"
    >
      {/* Undefined while the count is still loading — the tile is useful before the number arrives, so it shows a dash. */}
      <span className={'text-2xl font-bold tabular-nums leading-tight ' + (n ? 'text-slate-900' : 'text-slate-400')}>{n ?? '–'}</span>
      <span className="flex items-center gap-1 text-xs font-semibold text-slate-500">
        <HandRaisedIcon className="h-3.5 w-3.5" />To pick
      </span>
    </Link>
  );
}
