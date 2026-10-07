'use client';
/*
=======================================================================================================================================
Page: /pick  (Pick — the physical shelf)
=======================================================================================================================================
Purpose: What has to come off a shelf, and the four things you can say about a unit once you've walked to it. Ported from the legacy
         PowerBuilder Pick screen; the whole module is one column, `localstock.qty` (see utils/pick.js server-side).

THIS SCREEN IS THE DESKTOP HALF OF A JOB THAT MOSTLY HAPPENS ON A PHONE. The mobile app does the picking, scanner in hand, and it
writes the same rows — so this list moves under you and every action reports what it actually hit rather than assuming. What the
desktop is for is the sit-down version: seeing what's outstanding, fixing a mis-pick, marking something not found, and scanning a
handful through without walking anywhere. That is why the find box is the first thing on the screen and the only autofocused control.

WHY IT ISN'T INSIDE CUSTOMER ORDERS, which is the obvious place given the Shopify list is nothing but customer order lines: the
Amazon half isn't. Those are '#FREE' units flagged for FBA with no order behind them at all, and they take completely different
actions. Half the module would have had nowhere to live. It also keeps the daily fulfilment grid from growing a second job.

IT IS IN THE DAILY BAND on the dashboard (owner, 2026-09-03), having spent its first weeks in STOCK & PRODUCTS on the argument that
DAILY was only the screens a day is STARTED on and this was one you dropped into when something needed a second look. In practice it
is opened at the start of the day alongside the customer orders it picks against, so it sits with them.

NO LABELS, NO CSV EXPORT, NO CHECK AMZ. The legacy screen's label machinery existed to assign picks to different pickers so they
wouldn't cross-pick each other; that isn't how the work is done any more (owner). If picker assignment ever comes back, note that
`localstock.assigned` is still there and still NULL on every live row.
BACK LINK ONLY WHEN A SCREEN SENT YOU (owner, 2026-10-07 — "easily come back" to Customer Orders after pressing its pick button).
PickLink adds ?from=/customer-orders&back=Customer Orders, so the trip there and back is one click each way. A dashboard arrival
carries ?from=<group id> instead, which is not a path, so it gets no back link here and AppShell's logo does the return as it does on
every dashboard screen. A plain visit or bookmark gets no back link either.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import PickList from '@/components/PickList';
import { useUrlParam } from '@/lib/useUrlParam';

export default function PickPage() {
  const from = useUrlParam('from');
  const backHref = from?.startsWith('/') ? from : undefined;
  const backLabel = useUrlParam('back') || 'Back';

  return (
    <AppShell backHref={backHref} backLabel={backLabel}>
      <PickList />
    </AppShell>
  );
}
