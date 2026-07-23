'use client';
/*
=======================================================================================================================================
Component: InvBreakdown
=======================================================================================================================================
Purpose: The "why is that number what it is" deep view for one style on the Inventory browse — opened from a card's Breakdown toggle,
         one card at a time, so the browse itself stays light. It answers the rarer questions the card face deliberately omits:
           - the FULL size range including sold-out zeros (the face chips show only in-stock sizes),
           - where every unit sits across the twelve buckets, the Amazon re-order figure included (shown in full — opening Breakdown IS
             the request for detail, so there is no second "Show detail" toggle to click),
           - jumping off to reprice the style, open its live product page, or grab its image,
           - and whether it is actually selling (recent sales).

         It is handed the InvStockData the card ALREADY fetched on the first size tap / breakdown open, so opening it costs no extra
         round-trip. The size-grid-and-buckets logic here was ported wholesale from the old InvStockPanel (retired in the 2026-07-23
         browse redesign) — the card owns the image, header and per-size locations now, so this keeps only the grid + actions + sales.

THE 12 BUCKETS (docs/inventory-spec.md §3b/§3c). One Amazon story read left to right by how far the stock has travelled, closing on the
re-order figure (Amz tot); then the Birk pre-order book; then Incoming (strictly not-landed-yet) last, since it is empty for most styles
most of the time. Reorder DETAIL_GROUPS to change the layout; nothing else needs touching.
=======================================================================================================================================
*/

import { ArrowTopRightOnSquareIcon, ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { InvStockData, InvBuckets, InvSizeRow } from '@/lib/api';
import InvSales from '@/components/InvSales';
import CopyButton from '@/components/CopyButton';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// The public storefront product URL is handle-based (skusummary.handle is the slug). Used to email a customer a link to the live page.
const STORE_PRODUCT_BASE = 'https://brookfieldcomfort.com/products/';

type DetailCol = {
  key: string;
  label: string;
  title: string;
  get: (s: InvSizeRow) => number;
  getTotal: (t: InvStockData['totals']) => number;
  // Set on a column that is a CONCLUSION rather than a raw bucket (today: Amz tot). Drawn heavier, because in a wall of small numbers
  // the one you actually act on must not look like the four you skim past.
  strong?: boolean;
};

// Helper for the plain bucket columns.
const bucket = (key: keyof InvBuckets, label: string, title: string): DetailCol => ({
  key, label, title,
  get: (s) => s.buckets[key],
  getTotal: (t) => t.buckets[key],
});

const DETAIL_GROUPS: { group: string; cols: DetailCol[] }[] = [
  {
    group: 'AMZ',
    cols: [
      bucket('amzAlloc', 'Res',
        'Here but earmarked for Amazon — in practice the C3-Amazon bay. The locations above give the exact shelf. '
        + 'Still pickable for a Shopify customer.'),
      bucket('transit', 'Transit', 'Collected by DPD within the last 2 days — gone from our racks, not yet on Amazon’s books'),
      bucket('amzInbound', 'Inbound', 'Booked in at Amazon, not yet live'),
      bucket('amzLive', 'Live', 'Sellable FBA stock at Amazon'),
      {
        // "Tot", not "Total": the headline Total column must be the only thing on this grid called Total.
        key: 'amazonTotal', label: 'Tot',
        title: 'THE RE-ORDER FIGURE: everything at, heading to, or set aside for Amazon — Live + Inbound + Transit + Amazon on '
             + 'order + Amz res. This is what you go by when deciding how many to send.',
        get: (s) => s.amazonTotal,
        getTotal: (t) => t.amazonTotal,
        strong: true,
      },
    ],
  },
  {
    group: 'Birk PO',
    cols: [
      {
        key: 'birkOnOrder', label: 'On order',
        title: 'Birkenstock pre-order book: units requested minus those already arrived (arrived stock is counted in Local)',
        get: (s) => s.birkOnOrder,
        getTotal: (t) => t.birkOnOrder,
      },
    ],
  },
  {
    group: 'Incoming',
    cols: [
      bucket('onOrderLocal', 'SHP', 'Ordered for us (orderstatus type 2), not yet arrived'),
      bucket('onOrderAmz', 'AMZ', 'Ordered for Amazon (orderstatus type 3), not yet arrived — counted in the AMZ Total'),
    ],
  },
];

const DETAIL_COL_COUNT = DETAIL_GROUPS.reduce((n, g) => n + g.cols.length, 0);

// Print the human-entered size label (skumap.optionsize: "38 EU / 5 UK", or just "5 UK" on a UK-sized brand) — do not derive it. The
// fallback only fires if it is blank (none are today) and deliberately does not reconstruct the EU/UK pair.
function sizeLabel(s: { sizeDisplay: string | null; eu: string; uksize: string | null }): string {
  return s.sizeDisplay || s.uksize || s.eu;
}

export default function InvBreakdown({ data }: { data: InvStockData }) {
  const src = data.imagename ? IMAGE_BASE + data.imagename : null;
  const productUrl = data.handle ? STORE_PRODUCT_BASE + data.handle : null;

  return (
    <div className="border-t border-slate-200 bg-slate-50/40">
      {/* ---- Jump-off actions. Reprice this style, open its live page, or grab the image. NEW TAB throughout, so a mid-lookup jump
              never costs the operator the browse they were scrolling. Shopify is groupid-grain (straight to the drill); Amazon is
              per-size, so it opens the Find screen pre-filled. ---- */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-4 py-2.5 text-xs">
        <span className="text-slate-400">Reprice</span>
        <a
          href={`/pricing/style/${encodeURIComponent(data.groupid)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700 hover:bg-emerald-100"
        >
          Shopify ↗
        </a>
        <a
          href={`/amz/find?q=${encodeURIComponent(data.groupid)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700 hover:bg-amber-100"
        >
          Amazon ↗
        </a>
        {productUrl && (
          <>
            <span className="mx-1 text-slate-200">|</span>
            <a
              href={productUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the live product page in a new tab"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100"
            >
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" /> Product page
            </a>
            <CopyButton value={productUrl} label="product page link" />
          </>
        )}
        {src && (
          <>
            <span className="mx-1 text-slate-200">|</span>
            <a
              href={src}
              download={data.imagename || undefined}
              target="_blank"
              rel="noopener noreferrer"
              title="Download this image"
              className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-1.5 py-0.5 font-medium text-slate-600 hover:bg-slate-100"
            >
              <ArrowDownTrayIcon className="h-3.5 w-3.5" /> Image
            </a>
          </>
        )}
      </div>

      {/* ---- Full size grid: EVERY size from skumap, sold-out ones reading 0 (the face chips show only in-stock sizes). Show detail
              expands the same grid to the twelve buckets, scrolling inside its own box so the card never scrolls sideways. ---- */}
      <div className="px-4 pb-3">
        {/* Always scrolls inside its own box — the bucket grid is wide, but the card/page never scrolls sideways. */}
        <div className="overflow-x-auto">
          {/* w-auto, not w-full: every numeric column is fixed width, so a full-width table would dump the slack into the Size column. */}
          <table className="w-auto text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr className="text-[10px] text-slate-400">
                <th className="py-1 pr-3" />
                <th className="border-r-2 border-slate-200 py-1 px-3" colSpan={2} />
                {DETAIL_GROUPS.map((g) => (
                  <th key={g.group} colSpan={g.cols.length} className="border-l border-slate-200 py-1 px-2 text-center font-medium">
                    {g.group}
                  </th>
                ))}
              </tr>
              <tr className="border-b border-slate-200">
                <th className="py-1.5 pr-6 font-medium">Size</th>
                {/* Local first, then Total, with a real rule after Total to mark where "the answer" ends and "the evidence" begins. */}
                <th className="w-16 py-1.5 px-3 text-right font-semibold text-slate-700">Local</th>
                <th className="w-16 border-r-2 border-slate-200 py-1.5 pl-3 pr-4 text-right font-semibold text-slate-700">Total</th>
                {DETAIL_GROUPS.map((g) =>
                  g.cols.map((c, i) => (
                    <th
                      key={c.key}
                      title={c.title}
                      className={`w-14 whitespace-nowrap py-1.5 px-2 text-right font-medium ${i === 0 ? 'border-l border-slate-200' : ''} ${c.strong ? 'text-slate-700' : ''}`}
                    >
                      {c.label}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.sizes.map((s) => (
                <tr key={s.code} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap py-1.5 pr-6 text-slate-700">{sizeLabel(s)}</td>
                  {/* Zeros greyed rather than blank. Local carries a "Pick n" tag when some of it is committed to an order — the units
                      are still on the shelf, but an operator about to promise the last pair needs to see it is spoken for. */}
                  <td className={`py-1.5 px-3 text-right font-semibold tabular-nums ${s.local ? 'text-slate-900' : 'text-slate-300'}`}>
                    {s.local}
                    {s.buckets.picked > 0 && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 align-middle text-[10px] font-medium text-amber-700">
                        Pick {s.buckets.picked}
                      </span>
                    )}
                  </td>
                  <td className={`border-r-2 border-slate-200 py-1.5 pl-3 pr-4 text-right font-semibold tabular-nums ${s.total ? 'text-slate-900' : 'text-slate-300'}`}>{s.total}</td>
                  {DETAIL_GROUPS.map((g) =>
                    g.cols.map((c, i) => {
                      const v = c.get(s);
                      return (
                        <td
                          key={c.key}
                          className={`py-1.5 px-2 text-right tabular-nums ${v ? (c.strong ? 'font-semibold text-slate-900' : 'text-slate-700') : 'text-slate-300'} ${i === 0 ? 'border-l border-slate-100' : ''}`}
                        >
                          {v}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
              {data.sizes.length === 0 && (
                <tr>
                  <td colSpan={3 + DETAIL_COL_COUNT} className="py-4 text-center text-sm text-slate-400">No sizes set up for this style.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Is it actually selling — collapsed, lazily fetched (see InvSales). */}
      <InvSales groupid={data.groupid} />
    </div>
  );
}
