'use client';
/*
=======================================================================================================================================
Component: PickLink
=======================================================================================================================================
Purpose: The "N to pick" link in the Customer Orders title row — a way through to /pick that also answers, without going there, the
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
      href="/pick"
      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
    >
      <HandRaisedIcon className="h-4 w-4 text-slate-400" />
      {/* Undefined while the count is still loading — the link is useful before the number arrives, so it renders without it rather
          than holding a skeleton in the title row. */}
      {n === undefined ? 'Pick' : n === 0 ? 'Nothing to pick' : `${n} to pick`}
    </Link>
  );
}
