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

YOUR AMZ BOX (2026-10-16 — replaced the unlocked-box warning). Amazon units booked in here go into the user's AMZ box, which lives in
this browser until it's packed on AMZ Shipment (src/lib/amzActiveBox.ts). A strip above the station says how many shoes are in it,
with a link to go and pack it. Closable (owner, 2026-10-16: "they might not care rn"): × hides it for this tab until that box is packed.
After a Pack that came straight back here (AMZ Shipment's tick-box), a green strip says the number the box was given — the packer
writes it on the carton — until closed or the next shoe is scanned.

PACK FROM HERE (owner, 2026-10-28: "let the user pack an amz shipment box from goods in so dont need to swap screen"). The strip's
Pack box opens the same Box size pop-up as AMZ Shipment (components/AmzBoxSizeDialog) and makes the same POST /amz-shipment-pack with
the same box from src/lib/amzActiveBox.ts — a refill (an unpacked box) packs back under its own number, a stale refill is dropped with
the shoes kept, exactly as there. Then the green "that's Box n" strip. Looking at, editing, deleting and shipping boxes stay on AMZ
Shipment.
=======================================================================================================================================
*/

import Link from 'next/link';
import { useState } from 'react';
import SizeDialog from '@/components/AmzBoxSizeDialog';
import { packAmzShipmentBox } from '@/lib/api';
import { CheckCircleIcon, CubeIcon, XMarkIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import GoodsInStation from '@/components/GoodsInStation';
import { useAuth } from '@/contexts/AuthContext';
import {
  activeUnits, dismissPacked, useActiveBox, readActiveBox, setActiveDims, packedActiveBox, setRefill, type ActiveDims,
} from '@/lib/amzActiveBox';

export default function GoodsInPage() {
  return (
    // The two C3-Amazon benches link to each other (owner, 2026-10-15): Amazon-bound units booked in here are boxed there.
    <AppShell title="Goods In" bigTitle headerRight={
        <Link href="/amz-shipment"
          className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50">
          <CubeIcon className="h-4 w-4" />AMZ Shipment
        </Link>
      }>
      <YourAmzBox />
      <GoodsInStation />
    </AppShell>
  );
}

// See YOUR AMZ BOX in the header. The hide flag is per tab (sessionStorage), every access guarded — blocked storage just means it isn't
// remembered across a visit to AMZ Shipment.
const HIDE_KEY = 'goodsIn.hideAmzBox';
function loadHidden(): boolean {
  try { return sessionStorage.getItem(HIDE_KEY) === '1'; } catch { return false; }
}
function YourAmzBox() {
  const user = useAuth().displayName || '';
  const box = useActiveBox(user);
  const units = activeUnits(box);
  const [hidden, setHidden] = useState(loadHidden);
  // The box was packed (empty again) -> forget the close, so the next box shows. Setting state while rendering is React's pattern for
  // state that follows other values (no effect needed); the guard stops it repeating.
  if (units === 0 && hidden) {
    setHidden(false);
    try { sessionStorage.removeItem(HIDE_KEY); } catch { /* nothing to forget */ }
  }
  function hide() {
    setHidden(true);
    try { sessionStorage.setItem(HIDE_KEY, '1'); } catch { /* not remembered */ }
  }
  const [sizeOpen, setSizeOpen] = useState(false);
  const [packing, setPacking] = useState(false);
  const [packError, setPackError] = useState<string | null>(null);
  // Focus back to the scan box (GoodsInStation's only input) so the gun keeps working after the pop-up.
  const refocus = () => setTimeout(() => document.querySelector<HTMLInputElement>('input[aria-label="Scan a barcode"]')?.focus(), 0);

  // PACK (see the header) — AMZ Shipment's pack(), minus that screen's own state. Read fresh from the store: a shoe scanned while the
  // pop-up was open is in the box too.
  async function pack(d: ActiveDims) {
    const now = readActiveBox(user);
    if (packing || activeUnits(now) === 0) return;
    setActiveDims(user, d);
    setSizeOpen(false);
    setPacking(true);
    setPackError(null);
    const res = await packAmzShipmentBox(now.lines.map((l) => ({ code: l.code, qty: l.qty })), d, now.refill);
    setPacking(false);
    if (!res.success || !res.data) {
      if (res.return_code === 'STALE' && now.refill) {
        setRefill(user, null);
        setPackError(`Box ${now.refill.box} has changed on another screen, so it wasn’t replaced. Press Pack box again to pack this as a new box.`);
      } else {
        setPackError(`Not packed: ${res.error || 'error'}`);
      }
      refocus();
      return;
    }
    packedActiveBox(user, res.data.box);
    refocus();
  }
  return (
    <>
      {box.lastPacked !== null && (
        <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border-2 border-emerald-300 bg-emerald-50 px-4 py-3 text-lg text-emerald-900">
          <CheckCircleIcon className="h-6 w-6 shrink-0" />
          <span className="flex-1"><span className="font-bold">Packed — that’s Box {box.lastPacked}.</span> Write {box.lastPacked} on the carton.</span>
          <button type="button" onClick={() => dismissPacked(user)} aria-label="Close"
            className="shrink-0 rounded-md p-1 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      {units > 0 && !hidden && (
        <div role="status" className="mb-3 flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-base text-slate-700">
          <CubeIcon className="h-5 w-5 shrink-0 text-slate-500" />
          <span className="flex-1"><span className="font-semibold">Your AMZ box: {units} {units === 1 ? 'shoe' : 'shoes'}</span>, not packed yet.</span>
          {packError && <span className="text-sm font-medium text-red-700">{packError}</span>}
          <button type="button" onClick={() => { setPackError(null); setSizeOpen(true); }} disabled={packing}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-40">
            <CheckCircleIcon className="h-4 w-4" />{packing ? 'Packing…' : box.refill ? `Pack as Box ${box.refill.box}` : 'Pack box'}
          </button>
          <button type="button" onClick={hide} aria-label="Close" title="Hide this until the box is packed"
            className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      )}
      {sizeOpen && units > 0 && (
        <SizeDialog
          initial={box.dims}
          packLabel={box.refill ? `Pack as Box ${box.refill.box}` : 'Pack box'}
          canPack={!packing}
          onPack={(d) => void pack(d)}
          onClose={() => { setSizeOpen(false); refocus(); }}
        />
      )}
    </>
  );
}
