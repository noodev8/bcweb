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
=======================================================================================================================================
*/

import Link from 'next/link';
import { CubeIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import GoodsInStation from '@/components/GoodsInStation';

export default function GoodsInPage() {
  return (
    // The two C3-Amazon benches link to each other (owner, 2026-10-15): Amazon-bound units booked in here are boxed there.
    <AppShell headerRight={
        <Link href="/amz-shipment"
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50">
          <CubeIcon className="h-4 w-4" />AMZ Shipment
        </Link>
      }>
      <GoodsInStation />
    </AppShell>
  );
}
