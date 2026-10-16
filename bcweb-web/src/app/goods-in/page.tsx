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
Closable (owner, 2026-10-16: "they might not care rn"): × hides it for the boxes it named, for this browser tab. It comes back by
itself if the list changes — a box newly unlocked — so closing it never hides a box it didn't name. And once the list differs from
what was closed it's FORGOTTEN, so a box that gets locked and then unlocked again brings the warning back too (owner, 2026-10-16).
=======================================================================================================================================
*/

import Link from 'next/link';
import { useState } from 'react';
import { CubeIcon, ExclamationTriangleIcon, XMarkIcon } from '@heroicons/react/24/outline';
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
// Closed = the boxes it named when × was pressed (see the header). Kept in sessionStorage so going to AMZ Shipment and back in the same
// tab doesn't bring it straight back; every access guarded (blocked storage just means it isn't remembered).
const HIDE_KEY = 'goodsIn.hideUnlockedAmz';
function loadHidden(): string {
  try { return sessionStorage.getItem(HIDE_KEY) || ''; } catch { return ''; }
}
function UnlockedAmzBoxes() {
  const { data } = useApiQuery(['goods-in-amz-boxes'], getAmzShipmentBoxes, { refreshInterval: 30000, revalidateOnFocus: true });
  const [hidden, setHidden] = useState(loadHidden);
  const open = (data?.boxes ?? []).filter((b) => !b.locked).map((b) => `Box ${b.box}`);
  const shown = open.join(',');
  // The list moved on from what was closed (a box locked, or another unlocked) -> forget the close, so the same box unlocked again
  // later warns again. Only once the read has landed, so a loading render doesn't wipe it. Setting state while rendering is React's
  // pattern for state that follows other values (no effect needed); the guard stops it repeating.
  if (data && hidden && shown !== hidden) {
    setHidden('');
    try { sessionStorage.removeItem(HIDE_KEY); } catch { /* nothing to forget */ }
  }
  if (open.length === 0 || shown === hidden) return null;
  const names = open.length > 1 ? `${open.slice(0, -1).join(', ')} and ${open[open.length - 1]}` : open[0];
  function hide() {
    setHidden(shown);
    try { sessionStorage.setItem(HIDE_KEY, shown); } catch { /* not remembered */ }
  }
  return (
    <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border-2 border-amber-300 bg-amber-50 px-4 py-3 text-lg text-amber-900">
      <ExclamationTriangleIcon className="h-6 w-6 shrink-0" />
      <span className="flex-1"><span className="font-bold">AMZ {names} {open.length === 1 ? 'isn’t' : 'aren’t'} locked.</span> Lock {open.length === 1 ? 'it' : 'them'} on AMZ Shipment once done.</span>
      <Link href="/amz-shipment?box=newest"
        className="shrink-0 rounded-md border border-amber-400 bg-white px-3 py-1 text-sm font-medium text-amber-800 hover:bg-amber-100">
        Open AMZ Shipment
      </Link>
      <button type="button" onClick={hide} aria-label="Close this warning" title="Hide this — it comes back if another box is left unlocked"
        className="shrink-0 rounded-md p-1 text-amber-700 hover:bg-amber-100 hover:text-amber-900">
        <XMarkIcon className="h-5 w-5" />
      </button>
    </div>
  );
}
