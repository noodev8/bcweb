'use client';
/*
=======================================================================================================================================
Page: /goods-in  (Goods In — booking a delivery onto the shelf)
=======================================================================================================================================
Purpose: The far end of the Order Status errand. Stock ordered from a supplier turns up in boxes; this is where each unit is scanned,
         told which shelf it belongs on, and written into stock. It is the only screen on the platform that ADDS units.

Ported from the legacy PowerBuilder Goods In screen (source in goodsin/). The behaviour is the legacy behaviour — Amazon-bound units
go to the C3-Amazon staging shelf, everything else goes to the shelf the operator picked, an unresolvable scan stops the line — and
the layout is not: see the header on GoodsInStation for why the whole screen is one enormous destination word.

EVERYTHING IT READS IS LIVE: /goods-in-expected is the real ON ORDER stage of `orderstatus` (placed, not yet arrived, every supplier)
and /goods-in-lookup resolves each scan against the real `skumap`. What does not exist yet is the WRITE that books a unit in, so the
run is held client-side and the screen says so on its face. src/lib/goodsInWrite.ts carries the contract for that route, taken off the
legacy source, and is the only file that has to change when it lands.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import GoodsInStation from '@/components/GoodsInStation';

export default function GoodsInPage() {
  return (
    <AppShell title="Goods In" backHref="/dashboard" backLabel="Dashboard">
      <GoodsInStation />
    </AppShell>
  );
}
