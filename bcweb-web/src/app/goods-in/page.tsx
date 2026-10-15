'use client';
/*
=======================================================================================================================================
Page: /goods-in  (Goods In — booking a delivery onto the shelf)
=======================================================================================================================================
Purpose: The far end of the Order Status errand. Stock ordered from a supplier turns up in boxes; this is where each unit is scanned,
         told which shelf it belongs on, and written into stock. It is the only screen on the platform that ADDS units.

Ported from the legacy PowerBuilder Goods In screen (source in docs/goodsin/). The BEHAVIOUR is the legacy behaviour — Amazon-bound
units go to the C3-Amazon staging shelf, everything else goes to the shelf the operator picked, an unresolvable scan stops the line.
The layout is not: see the header on GoodsInStation for why the whole screen is one enormous destination word.

EVERYTHING IT READS IS LIVE: /goods-in-expected is the real ON ORDER stage of `orderstatus` (placed, not yet arrived, every supplier)
and /goods-in-lookup resolves each scan against the real `skumap`. What does not exist yet is the WRITE that books a unit in, so the
run is held client-side and the screen says so on its face. src/lib/goodsInWrite.ts carries the contract for that route, taken off the
legacy source, and is the only file that has to change when it lands.

UNLOCKED AMZ BOX WARNING (owner, 2026-10-15: "just auto have a warning on goods in if theres an unlocked amz box"). A standing strip
above the station names every AMZ box not yet locked, with a link to AMZ Shipment to finish it. Warning only — booking in never waits
on it. Read from /amz-shipment-boxes, re-checked every 30 s and on returning to the tab so a lock on the other bench clears it.
=======================================================================================================================================
*/

import Link from 'next/link';
import { CubeIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import GoodsInStation from '@/components/GoodsInStation';
import { getAmzShipmentBoxes } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

export default function GoodsInPage() {
  return (
    // The two C3-Amazon benches link to each other (owner, 2026-10-15): Amazon-bound units booked in here are boxed there, and the
    // link opens AMZ Shipment on the NEWEST box — the one this bench has most likely just been filling.
    <AppShell title="Goods In" bigTitle headerRight={
        <Link href="/amz-shipment?box=newest"
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50">
          <CubeIcon className="h-4 w-4" />AMZ Shipment
        </Link>
      }>
      <UnlockedAmzBoxes />
      <GoodsInStation />
    </AppShell>
  );
}

// See UNLOCKED AMZ BOX WARNING in the header. Its own cache key, so AMZ Shipment's load of the same route isn't disturbed. Only boxes
// with something in them exist in amzshipment, so every box returned is a packed one; nothing shows while loading or on an error.
function UnlockedAmzBoxes() {
  const { data } = useApiQuery(['goods-in-amz-boxes'], getAmzShipmentBoxes, { refreshInterval: 30000, revalidateOnFocus: true });
  const open = (data?.boxes ?? []).filter((b) => !b.locked).map((b) => `Box ${b.box}`);
  if (open.length === 0) return null;
  const names = open.length > 1 ? `${open.slice(0, -1).join(', ')} and ${open[open.length - 1]}` : open[0];
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3 text-lg text-amber-900">
      <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
      <span className="flex-1"><span className="font-bold">AMZ {names} {open.length === 1 ? 'isn’t' : 'aren’t'} locked.</span> Lock {open.length === 1 ? 'it' : 'them'} on AMZ Shipment once done.</span>
      <Link href="/amz-shipment?box=newest"
        className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100">
        Open AMZ Shipment
      </Link>
    </div>
  );
}
