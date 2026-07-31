'use client';
/*
=======================================================================================================================================
Page: /customer-orders  (Customer Orders — the fulfilment module)
=======================================================================================================================================
Purpose: What customers have bought and whether we can send it, ported from the legacy PowerBuilder Status screen. Its own module and
         its own route.

WHY IT LEFT ORDER STATUS: it started life as a third "stage" on /order-status, sharing the stage-switch cards with TO PLACE and ON
ORDER. That was wrong on two counts. First, it isn't the same job — those two are PROCUREMENT (what we're buying, split on the
`orderdate` marker), this is FULFILMENT, the other direction entirely. They share the `orderstatus` table and nothing else. Second,
and the reason it actually moved: it's worked daily against a 100+ row grid, and the three stage cards ate the top of the viewport
on every single visit for a switch nobody wanted while working this list.

The screen it lands on is therefore deliberately bare — back link, title, and straight into the grid. The vertical space the cards
were taking is now the point of the page. The controls that WERE below them (filters, find box, the per-order action bar) are pinned
to the top of the viewport inside CustomerOrderList, so an operator can scroll to a row 80 lines down and act on it without scrolling
back up — which is the reason the cards had to go.

/order-status?stage=customer still works: the module home redirects it here, so the bookmarks and links made while this was a stage
keep landing on the right screen.

UPDATE ORDERS sits in the title row. It's the same control as the one on Analytics -> Sales — the shared component, not a second copy
— and it's here because this is the screen where you find out an order is missing: a customer says they've bought something and it
isn't on the list. See the header of UpdateOrdersButton for what is and isn't shared between the two call sites, and for why the label
and the route it calls (/order-sync) use different words. In the title row rather than
in the pinned control block below because it acts on the WHOLE list, not on the selected order, and pressing it is a once-in-a-while
thing — the pinned block is for the actions you take mid-scroll.
=======================================================================================================================================
*/

import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import AppShell from '@/components/AppShell';
import CustomerOrderList from '@/components/CustomerOrderList';
import UpdateOrdersButton from '@/components/UpdateOrdersButton';
import { CUSTOMER_ORDERS_KEY } from '@/lib/orderStatusUi';

export default function CustomerOrdersPage() {
  const [updateError, setUpdateError] = useState<string | null>(null);

  // A sync inserts customer order lines and archives shipped ones, so the grid below is stale the moment a run finishes. Revalidated
  // through SWR's global mutate on the list's own key rather than by handing a refresh callback down into CustomerOrderList: the list
  // owns that query, and this page has no business holding a second subscription to it just to be able to poke it.
  const { mutate } = useSWRConfig();
  const onUpdated = useCallback(async () => { await mutate(CUSTOMER_ORDERS_KEY); }, [mutate]);

  return (
    <AppShell
      title="Customer Orders"
      backHref="/dashboard"
      backLabel="Dashboard"
      headerRight={<UpdateOrdersButton onDone={onUpdated} onError={setUpdateError} />}
    >
      {updateError && (
        <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{updateError}</div>
      )}
      <CustomerOrderList />
    </AppShell>
  );
}
