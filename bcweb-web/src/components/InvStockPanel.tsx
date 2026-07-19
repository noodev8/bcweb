'use client';
/*
=======================================================================================================================================
Component: InvStockPanel
=======================================================================================================================================
Purpose: One style's stock position — the compact size grid (Order / Total / Local per size) plus the product image. Slice 2 of the
         Inventory module (docs/inventory-spec.md §3a).

Why the image sits here and is reasonably large: a normal filtered list is a dozen near-identical black Arizonas, and the picture is
how the operator confirms they are looking at the right one before walking to the rack (owner). It is identification, not decoration.

Sizes read "36 EU / 3.5 UK". A customer in the shop says "five and a half", not "39" — so the UK size has to be on screen, not
converted in the operator's head. skumap.uksize is 100% populated and already stores the "3.5 UK" suffix, so we print it verbatim.

ONLY Total and Local are shown (owner). The breakdown behind them — what is on order, what is at Amazon, what is picked — belongs to
the next drill down, not here: this grid answers "have we got it, in that size" and nothing else. `onOrder` still arrives on the row
type and is used by later slices; do not strip it from the API because no column reads it today.

Every size from skumap is shown, INCLUDING sold-out ones reading 0. "We have none in a 39" is the answer the operator needs; a missing
row would read as "we don't stock a 39", which is a different and wrong answer.
=======================================================================================================================================
*/

import Image from 'next/image';
import { useState } from 'react';
import { InvStockData, InvBuckets } from '@/lib/api';
import InvLocations from '@/components/InvLocations';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

// The Show Detail columns: the twelve buckets in three walking groups, appended to the RIGHT of Total/Local so the two columns the
// operator already reads never move when the toggle flips. Labels are short because twelve columns is already a lot of width.
const BUCKET_GROUPS: { group: string; cols: { key: keyof InvBuckets; label: string; title: string }[] }[] = [
  {
    group: 'Here',
    cols: [
      { key: 'free', label: 'Free', title: 'Unallocated and unpicked' },
      { key: 'picked', label: 'Picked', title: 'Committed to an order, still on the shelf until packed' },
      { key: 'amzReserved', label: 'Amz res', title: 'Earmarked for Amazon, still in its normal rack' },
      { key: 'amzBay', label: 'Amz bay', title: 'In the C3-Amazon staging bay — still pickable for a Shopify customer' },
    ],
  },
  {
    group: 'Incoming',
    cols: [
      { key: 'onOrderLocal', label: 'Ord loc', title: 'Local order (type 2), not yet arrived' },
      { key: 'onOrderAmz', label: 'Ord amz', title: 'Amazon order (type 3), not yet arrived' },
      { key: 'arrivedLocal', label: 'Arr loc', title: 'Local order arrived, not yet shelved' },
      { key: 'arrivedAmz', label: 'Arr amz', title: 'Amazon order arrived (held 7 days)' },
    ],
  },
  {
    group: 'At Amazon',
    cols: [
      { key: 'amzLive', label: 'Live', title: 'Sellable FBA stock at Amazon' },
      { key: 'amzInbound', label: 'Inbound', title: 'Booked in at Amazon, not yet live' },
      { key: 'boxed', label: 'Boxed', title: 'In an Amazon box awaiting DPD' },
      { key: 'transit', label: 'Transit', title: 'Collected by DPD within the last 2 days' },
    ],
  },
];

const DETAIL_COL_COUNT = BUCKET_GROUPS.reduce((n, g) => n + g.cols.length, 0) + 2; // + Amazon total + Demand

export default function InvStockPanel({ data }: { data: InvStockData }) {
  const [imgFailed, setImgFailed] = useState(false);
  const src = data.imagename ? IMAGE_BASE + data.imagename : null;

  // Locations are driven by a CHOSEN SIZE, not shown for the whole style (owner). The operator's question is "where are the 38s",
  // not "list every rack this style touches" — a popular style spans a dozen racks across eight sizes, which is noise. Clicking the
  // selected size again clears it. Parent passes key={groupid}, so picking a different style resets this to null.
  const [sizeCode, setSizeCode] = useState<string | null>(null);
  const locationsForSize = sizeCode ? data.locations.filter((l) => l.code === sizeCode) : [];
  const chosen = data.sizes.find((s) => s.code === sizeCode) || null;

  // Show Detail expands the same grid to the twelve buckets — mirroring the toggle on the legacy PowerBuilder screen. Compact is the
  // default because that is what you read with a customer waiting; the breakdown answers the rarer "why is that number what it is".
  const [detail, setDetail] = useState(false);

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Header — title and groupid, so the panel is self-identifying once the list is scrolled away below it. */}
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <div className="text-sm font-medium text-slate-800">{data.title || 'Untitled product'}</div>
        <div className="font-mono text-xs text-slate-500">{data.groupid}</div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* ---- Size grid ---- */}
        <div className="min-w-0 flex-1">
          {/* Detail mode is wide (16 columns). It scrolls INSIDE this container so the page body never scrolls sideways. */}
          <div className={detail ? 'overflow-x-auto' : ''}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              {detail && (
                <tr className="text-[10px] text-slate-400">
                  <th className="py-1 pr-3" />
                  <th className="py-1 px-3" colSpan={2} />
                  {BUCKET_GROUPS.map((g) => (
                    <th key={g.group} colSpan={g.cols.length} className="border-l border-slate-200 py-1 px-2 text-center font-medium">
                      {g.group}
                    </th>
                  ))}
                  <th colSpan={2} className="border-l border-slate-200 py-1 px-2 text-center font-medium">Derived</th>
                </tr>
              )}
              <tr className="border-b border-slate-200">
                <th className="py-1.5 pr-3 font-medium">Size</th>
                <th className="py-1.5 px-3 text-right font-medium">Total</th>
                <th className="py-1.5 pl-3 text-right font-medium">Local</th>
                {detail && BUCKET_GROUPS.map((g) =>
                  g.cols.map((c, i) => (
                    <th
                      key={c.key}
                      title={c.title}
                      className={`whitespace-nowrap py-1.5 px-2 text-right font-medium ${i === 0 ? 'border-l border-slate-200' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))
                )}
                {detail && (
                  <>
                    <th title="PDF p7 re-order figure: everything at or heading to Amazon, including stock still here earmarked for it"
                        className="whitespace-nowrap border-l border-slate-200 py-1.5 px-2 text-right font-medium">Amz tot</th>
                    <th title="Paid, unfulfilled customer orders — a claim on stock, not stock"
                        className="whitespace-nowrap py-1.5 px-2 text-right font-medium">Demand</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sizes.map((s) => (
                <tr
                  key={s.code}
                  onClick={() => setSizeCode((prev) => (prev === s.code ? null : s.code))}
                  className={`cursor-pointer ${sizeCode === s.code ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="whitespace-nowrap py-1.5 pr-3 text-slate-700">
                    {s.eu} EU{s.uksize ? <span className="text-slate-400"> / {s.uksize}</span> : null}
                  </td>
                  {/* Zeros greyed rather than blank — a zero is a real answer and must be visibly zero, not an empty cell that
                      could read as "not loaded". */}
                  <td className={`py-1.5 px-3 text-right tabular-nums ${s.total ? 'text-slate-700' : 'text-slate-300'}`}>{s.total}</td>
                  <td className={`py-1.5 pl-3 text-right font-semibold tabular-nums ${s.local ? 'text-slate-900' : 'text-slate-300'}`}>{s.local}</td>
                  {detail && BUCKET_GROUPS.map((g) =>
                    g.cols.map((c, i) => (
                      <td
                        key={c.key}
                        className={`py-1.5 px-2 text-right tabular-nums ${s.buckets[c.key] ? 'text-slate-700' : 'text-slate-300'} ${i === 0 ? 'border-l border-slate-100' : ''}`}
                      >
                        {s.buckets[c.key]}
                      </td>
                    ))
                  )}
                  {detail && (
                    <>
                      <td className={`border-l border-slate-100 py-1.5 px-2 text-right tabular-nums ${s.amazonTotal ? 'text-slate-700' : 'text-slate-300'}`}>{s.amazonTotal}</td>
                      <td className={`py-1.5 px-2 text-right tabular-nums ${s.demand ? 'text-slate-700' : 'text-slate-300'}`}>{s.demand}</td>
                    </>
                  )}
                </tr>
              ))}
              {data.sizes.length === 0 && (
                <tr>
                  <td colSpan={detail ? 3 + DETAIL_COL_COUNT : 3} className="py-4 text-center text-sm text-slate-400">No sizes set up for this style.</td>
                </tr>
              )}
            </tbody>
            {data.sizes.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-200 text-sm">
                  <td className="py-1.5 pr-3 text-xs uppercase tracking-wide text-slate-500">All sizes</td>
                  <td className="py-1.5 px-3 text-right tabular-nums text-slate-600">{data.totals.total}</td>
                  <td className="py-1.5 pl-3 text-right font-bold tabular-nums text-slate-900">{data.totals.local}</td>
                  {detail && BUCKET_GROUPS.map((g) =>
                    g.cols.map((c, i) => (
                      <td key={c.key} className={`py-1.5 px-2 text-right tabular-nums text-slate-600 ${i === 0 ? 'border-l border-slate-200' : ''}`}>
                        {data.totals.buckets[c.key]}
                      </td>
                    ))
                  )}
                  {detail && (
                    <>
                      <td className="border-l border-slate-200 py-1.5 px-2 text-right tabular-nums text-slate-600">{data.totals.amazonTotal}</td>
                      <td className="py-1.5 px-2 text-right tabular-nums text-slate-600">{data.totals.demand}</td>
                    </>
                  )}
                </tr>
              </tfoot>
            )}
          </table>
          </div>

          {/* Show Detail — mirrors the PowerBuilder toggle. Off by default. */}
          {data.sizes.length > 0 && (
            <label className="mt-2 inline-flex cursor-pointer select-none items-center gap-2 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={detail}
                onChange={(e) => setDetail(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Show detail
            </label>
          )}
        </div>

        {/* ---- Image ---- */}
        <div className="shrink-0 sm:w-44">
          {src && !imgFailed ? (
            <div className="relative aspect-square w-full overflow-hidden rounded-md border border-slate-200 bg-white">
              <Image src={src} alt="" fill sizes="176px" onError={() => setImgFailed(true)} className="object-contain" />
            </div>
          ) : (
            <div className="flex aspect-square w-full items-center justify-center rounded-md border border-dashed border-slate-200 text-center text-[11px] text-slate-400">
              {data.imagename ? 'Image not found' : 'No image'}
            </div>
          )}
        </div>
      </div>

      {/* Where the stock physically is — for the CHOSEN size only. Sits under the grid: you read "have we got a 38?" first, then
          click the 38 to find out which rack. Until a size is picked there is nothing useful to show, so we prompt instead. */}
      {chosen ? (
        <InvLocations rows={locationsForSize} sizeLabel={`${chosen.eu} EU${chosen.uksize ? ` / ${chosen.uksize}` : ''}`} />
      ) : (
        <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-slate-400">
          Choose a size to see where it is.
        </div>
      )}
    </div>
  );
}
