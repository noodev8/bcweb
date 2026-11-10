'use client';
/*
=======================================================================================================================================
Component: AmazonListFba
=======================================================================================================================================
Purpose: "List on Amazon (FBA)" for ONE style on Add / Modify (2026-11-10, owner: "do all new stuff as a new button" — the .xlsm
         AmazonExport button stays beside it as the fallback). Rules on the server, utils/amzListing.js.

         1. The button asks Amazon to CHECK every size with a barcode that isn't on Amazon yet — nothing is created.
         2. One line per size: Ready (ASIN, price) · Already on Amazon · No barcode · Not on Amazon's catalogue (list by hand) ·
            Amazon refused (Amazon's reason).
         3. "List n sizes" + an inline confirm → listed for real at the RRP, Fulfilled by Amazon; the result per size replaces the check.
         Our Amazon products (amzfeed) get the new sizes from the next Update Orders, with their FNSKU.

         Mount with key={groupid} so it resets per product.
=======================================================================================================================================
*/

import { useState } from 'react';
import { amazonList, type AmzListData, type AmzListState } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

const STATE: Record<AmzListState, { label: string; cls: string }> = {
  ready:            { label: 'Ready',                                    cls: 'text-green-700' },
  listed:           { label: 'Listed',                                   cls: 'text-green-700 font-semibold' },
  on_amazon:        { label: 'Already on Amazon',                        cls: 'text-slate-400' },
  no_barcode:       { label: 'No barcode',                               cls: 'text-amber-600' },
  not_in_catalogue: { label: "Not on Amazon's catalogue — list by hand", cls: 'text-amber-600' },
  refused:          { label: 'Amazon refused',                           cls: 'text-red-600' },
};

export default function AmazonListFba({ groupid, sizesCount }: { groupid: string; sizesCount: number }) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState<'check' | 'list' | null>(null);
  const [data, setData] = useState<AmzListData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function go(commit: boolean) {
    setBusy(commit ? 'list' : 'check');
    setError(null);
    setConfirming(false);
    const res = await amazonList(groupid, commit);
    setBusy(null);
    if (res.success && res.data) setData(res.data);
    else if (res.return_code === 'UNAUTHORIZED') logout();
    else setError(res.error || 'Amazon listing failed');
  }

  const ready = data && !data.committed ? data.sizes.filter((s) => s.state === 'ready').length : 0;
  const noSizes = sizesCount < 1;

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => go(false)}
          disabled={busy !== null || noSizes}
          title={noSizes ? 'Add and save sizes first.' : 'Amazon checks each size first — nothing is listed until you confirm.'}
          className="rounded-md border border-brand-600 bg-white px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === 'check' ? 'Checking with Amazon…' : data ? 'Check again' : 'List on Amazon (FBA)'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      <p className="mt-1 text-[11px] text-slate-400">
        Lists each size with a barcode on Amazon&apos;s existing listing, at the RRP, Fulfilled by Amazon. Checks first.
      </p>

      {data && (
        <div className="mt-3 rounded-md border border-slate-200">
          <table className="w-full text-xs">
            <tbody>
              {data.sizes.map((s) => (
                <tr key={s.code} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="px-2 py-1.5 font-mono text-slate-700 whitespace-nowrap">{s.code}</td>
                  <td className={`px-2 py-1.5 ${STATE[s.state].cls}`}>
                    {STATE[s.state].label}
                    {s.message && (
                      <div className="mt-0.5 max-w-xl text-[11px] font-normal text-red-500" title={s.message}>
                        {s.message.length > 160 ? `${s.message.slice(0, 160)}…` : s.message}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500 whitespace-nowrap">
                    {s.asin && (
                      <a href={`https://www.amazon.co.uk/dp/${s.asin}`} target="_blank" rel="noreferrer" className="hover:text-brand-700 hover:underline">
                        {s.asin}
                      </a>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-right text-slate-600 whitespace-nowrap">
                    {(s.state === 'ready' || s.state === 'listed') && `£${data.price.toFixed(2)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {ready > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 bg-slate-50 px-2 py-2">
              {!confirming ? (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={busy !== null}
                  className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                >
                  List {ready} size{ready === 1 ? '' : 's'} on Amazon
                </button>
              ) : (
                <>
                  <span className="text-sm text-slate-700">
                    List {ready} size{ready === 1 ? '' : 's'} on Amazon as FBA at £{data.price.toFixed(2)}?
                  </span>
                  <button
                    type="button"
                    onClick={() => go(true)}
                    disabled={busy !== null}
                    className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {busy === 'list' ? 'Listing…' : 'Yes, list'}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} disabled={busy !== null} className="text-sm text-slate-500 hover:text-slate-700">
                    Cancel
                  </button>
                </>
              )}
            </div>
          )}

          {data.committed && (data.counts.listed ?? 0) > 0 && (
            <p className="border-t border-slate-200 bg-green-50 px-2 py-2 text-xs text-green-800">
              Sent to Amazon. They go live within minutes; the next Update Orders adds them to our Amazon products with their FNSKU.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
