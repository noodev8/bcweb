'use client';
/*
=======================================================================================================================================
Component: AmazonListFba
=======================================================================================================================================
Purpose: "List on Amazon (FBA)" for ONE style on Add / Modify (2026-11-10, owner: "do all new stuff as a new button" — the .xlsm
         AmazonExport button stays beside it as the fallback). Rules on the server, utils/amzListing.js.

         ONE PRESS, NO CHECK STEP, NO CONFIRM (owner, 2026-11-10: "i dont care about confirming the sizes. i just want to press the
         button and move on"). The press lists every size with a barcode that isn't on Amazon yet, at the RRP, Fulfilled by Amazon, and
         shows one line: "5 listed · 1 not on Amazon's catalogue · 3 refused" — hover for each size and Amazon's reasons. The server
         finishes the job even if the page is left mid-press (Express keeps running after the browser goes), so the operator can move on.
         Our Amazon products (amzfeed) get the new sizes from the next Update Orders, with their FNSKU.

         Mount with key={groupid} so it resets per product.
=======================================================================================================================================
*/

import { useState } from 'react';
import { amazonList, type AmzListData, type AmzListState } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// Order + wording of the one-line result. Ready never appears (that's the unused check mode).
const PARTS: { state: AmzListState; label: string }[] = [
  { state: 'listed', label: 'listed' },
  { state: 'on_amazon', label: 'already on Amazon' },
  { state: 'not_in_catalogue', label: "not on Amazon's catalogue" },
  { state: 'no_barcode', label: 'no barcode' },
  { state: 'refused', label: 'refused' },
];

export default function AmazonListFba({ groupid, sizesCount }: { groupid: string; sizesCount: number }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AmzListData | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onList() {
    setBusy(true);
    setError(null);
    setData(null);
    const res = await amazonList(groupid, true);
    setBusy(false);
    if (res.success && res.data) setData(res.data);
    else if (res.return_code === 'UNAUTHORIZED') logout();
    else setError(res.error || 'Amazon listing failed');
  }

  const noSizes = sizesCount < 1;
  const summary = data ? PARTS.filter((p) => data.counts[p.state]).map((p) => `${data.counts[p.state]} ${p.label}`).join(' · ') : '';
  const detail = data ? data.sizes.map((s) => `${s.code}: ${s.state.replace(/_/g, ' ')}${s.message ? ` — ${s.message}` : ''}`).join('\n') : '';
  const bad = data ? (data.counts.refused ?? 0) + (data.counts.not_in_catalogue ?? 0) + (data.counts.no_barcode ?? 0) : 0;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onList}
          disabled={busy || noSizes}
          title={noSizes ? 'Add and save sizes first.' : 'Lists every size with a barcode on Amazon’s existing listing, at the RRP, Fulfilled by Amazon.'}
          className="rounded-md border border-brand-600 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? 'Listing on Amazon…' : 'List on Amazon (FBA)'}
        </button>
        {data && (
          <span title={detail} className={`cursor-help text-xs font-medium ${data.counts.listed ? 'text-green-700' : bad ? 'text-amber-600' : 'text-slate-500'}`}>
            {summary || 'Nothing to list'}
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        One press lists it at the RRP, Fulfilled by Amazon — you can move on straight away. Live on Amazon within minutes.
      </p>
    </div>
  );
}
