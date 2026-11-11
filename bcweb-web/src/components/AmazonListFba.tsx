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

         The old .xlsm button (AmazonExport) sits behind a ⋯ as the backup (owner, 2026-11-10: "not in ur face all the time"); the
         Add / Modify page drops the whole block once every size with a barcode is on Amazon (green AMZ).

         QUIET (2026-11-11, owner: use the new button in place of the old upload buttons on the other screens): AMZ loaded's sizes
         panel and Amazon Order's "No AMZ" detail row use it too — an outline button matching those screens' action buttons, no
         heading or help line, the .xlsm still behind the ⋯.

         Mount with key={groupid} so it resets per product.
=======================================================================================================================================
*/

import { useState, type ReactNode } from 'react';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
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

export default function AmazonListFba({ groupid, sizesCount, onListed, backup, quiet = false }: {
  groupid: string; sizesCount: number;
  quiet?: boolean;      // compact outline button for list screens' detail rows — no heading, no help line
  backup?: ReactNode;   // the old .xlsm button, shown only from the ⋯ (owner: "just as a backup but not in ur face all the time")
  onListed?: (codes: string[]) => void;   // told the codes Amazon accepted, so the Sizes table's AMZ tags update without a reload
}) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<AmzListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showBackup, setShowBackup] = useState(false);

  async function onList() {
    setBusy(true);
    setError(null);
    setData(null);
    const res = await amazonList(groupid, true);
    setBusy(false);
    if (res.success && res.data) {
      setData(res.data);
      const listed = res.data.sizes.filter((s) => s.state === 'listed').map((s) => s.code);
      if (listed.length) onListed?.(listed);
    } else if (res.return_code === 'UNAUTHORIZED') logout();
    else setError(res.error || 'Amazon listing failed');
  }

  const noSizes = sizesCount < 1;
  const summary = data ? PARTS.filter((p) => data.counts[p.state]).map((p) => `${data.counts[p.state]} ${p.label}`).join(' · ') : '';
  const detail = data ? data.sizes.map((s) => `${s.code}: ${s.state.replace(/_/g, ' ')}${s.message ? ` — ${s.message}` : ''}`).join('\n') : '';
  const bad = data ? (data.counts.refused ?? 0) + (data.counts.not_in_catalogue ?? 0) + (data.counts.no_barcode ?? 0) : 0;

  return (
    <div>
      {!quiet && (
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Amazon</h3>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onList}
          disabled={busy || noSizes}
          title={noSizes ? 'Add and save sizes first.' : 'Lists every size with a barcode on Amazon’s existing listing, at the RRP, Fulfilled by Amazon.'}
          className={quiet
            ? 'inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40'
            : 'rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300'}
        >
          {busy ? 'Listing on Amazon…' : 'List on Amazon (FBA)'}
        </button>
        {backup && (
          <button
            type="button"
            onClick={() => setShowBackup((v) => !v)}
            title="Backup: the Seller Central upload file"
            aria-label="More Amazon options"
            className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <EllipsisHorizontalIcon className="h-5 w-5" />
          </button>
        )}
        {data && (
          <span title={detail} className={`cursor-help text-xs font-medium ${data.counts.listed ? 'text-green-700' : bad ? 'text-amber-600' : 'text-slate-500'}`}>
            {summary || 'Nothing to list'}
          </span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {!quiet && (
        <p className="mt-1 text-[11px] text-slate-400">
          One press lists it at the RRP, Fulfilled by Amazon — you can move on straight away. Live on Amazon within minutes.
        </p>
      )}
      {backup && showBackup && (
        <div className="mt-3 rounded-md border border-dashed border-slate-200 p-2">
          <p className="mb-1.5 text-[11px] text-slate-400">Backup — the old Seller Central upload file (lists as FBM, switch to FBA by hand):</p>
          {backup}
        </div>
      )}
    </div>
  );
}
