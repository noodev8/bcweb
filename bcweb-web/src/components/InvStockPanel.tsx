'use client';
/*
=======================================================================================================================================
Component: InvStockPanel
=======================================================================================================================================
Purpose: One style's stock position — the compact size grid (Order / Total / Local per size) plus the product image. Slice 2 of the
         Inventory module (docs/inventory-spec.md §3a).

Why the image sits here and is reasonably large: a normal filtered list is a dozen near-identical black Arizonas, and the picture is
how the operator confirms they are looking at the right one before walking to the rack (owner). It is identification, not decoration.

Sizes print skumap's DISPLAY SIZE verbatim — the label the operator typed and the customer sees ("36 EU / 3.5 UK", or just "5 UK"
on a UK-sized brand like Lunar). A customer in the shop says "five and a half", not "39", so the UK size has to be on screen rather
than converted in the operator's head; the display field already handles that, per brand, without this screen deriving anything.

ONLY Total and Local are shown (owner). The breakdown behind them — what is on order, what is at Amazon, what is picked — belongs to
the next drill down, not here: this grid answers "have we got it, in that size" and nothing else. `onOrder` still arrives on the row
type and is used by later slices; do not strip it from the API because no column reads it today.

Every size from skumap is shown, INCLUDING sold-out ones reading 0. "We have none in a 39" is the answer the operator needs; a missing
row would read as "we don't stock a 39", which is a different and wrong answer.
=======================================================================================================================================
*/

import Image from 'next/image';
import { useState } from 'react';
import { InvStockData, InvBuckets, InvSizeRow } from '@/lib/api';
import InvLocations from '@/components/InvLocations';
import InvSales from '@/components/InvSales';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

// The Show Detail columns, appended to the RIGHT of Total/Local so the two columns the operator already reads never move when the
// toggle flips. Labels are short because the row is wide even now.
//
// THE SHAPE (owner, after real use): the always-visible Local column IS the "here" answer, so there is no "Here" GROUP — a group
// header over one stray column implied a fourth place stock lives. Everything Amazon-shaped now sits under ONE "Amazon" heading,
// ending in Amz tot; then Birk PO; then Incoming last. Incoming is empty for most styles most of the time, so parking it on the far
// right means the columns that usually carry a value are the ones you see without scrolling. Reorder this array to change the
// layout; nothing else needs touching.
//
// Each column carries its own accessors, so a group is just data. Amz tot reads off the row rather than out of `buckets`, which is
// why `get`/`getTotal` exist instead of a bare bucket key.
//
// COLUMNS THE EARLIER CUTS HAD, DELIBERATELY GONE (owner):
//   - Free / Picked      -> folded into the always-visible Local column. Local already IS free + picked + amz-earmarked, so "Free"
//                           was the same number told twice. What mattered was "is any of this spoken for", now a small "Pick n" tag
//                           on the Local figure instead of a whole column.
//   - Amz bay            -> merged into Amz res. The bay is a PLACE, not a different kind of allocation, and the locations table
//                           below already names it row by row. One column, and you drill for the where.
//   - Demand             -> a claim on stock, not stock. Never drove a decision here.
//   - Arr loc / Arr amz  -> arrived stock has already been booked into localstock, so it was being read twice: once in Local and
//                           again as "incoming". Incoming now means ONLY what has not landed yet.
type DetailCol = {
  key: string;
  label: string;
  title: string;
  get: (s: InvSizeRow) => number;
  getTotal: (t: InvStockData['totals']) => number;
  // Set on a column that is a CONCLUSION rather than a raw bucket (today: Amz tot). Drawn heavier, because in a wall of small
  // numbers the one you actually act on must not look like the four you skim past.
  strong?: boolean;
};

// Helper for the twelve plain bucket columns.
const bucket = (key: keyof InvBuckets, label: string, title: string): DetailCol => ({
  key, label, title,
  get: (s) => s.buckets[key],
  getTotal: (t) => t.buckets[key],
});

const DETAIL_GROUPS: { group: string; cols: DetailCol[] }[] = [
  {
    // One Amazon story, read left to right by how far the stock has travelled: set aside here (Amz res — anything allocated 'amz',
    // including what is already boxed, see below) -> with DPD -> booked in -> sellable. Amz tot closes the group: it is the sum of
    // the lot and the number that answers the question the group exists for, "how many more do I send?".
    //
    // THERE IS NO "BOXED" COLUMN, on purpose. Boxing does not move the stock out of localstock — amz-reserved, bay and boxed all
    // leave the same allocated-'amz' row in place — so amzshipment units are ALREADY in Amz res. A Boxed column showed the same
    // pairs twice, and the old formula added them into the re-order figure on top. Both fixed, and the lifecycle doc corrected to
    // match (owner, 2026-07-20).
    group: 'AMZ',
    cols: [
      bucket('amzAlloc', 'Res',
        'Here but earmarked for Amazon — in practice the C3-Amazon bay. The locations table below gives the exact shelf. '
        + 'Still pickable for a Shopify customer.'),
      bucket('transit', 'Transit', 'Collected by DPD within the last 2 days — gone from our racks, not yet on Amazon’s books'),
      bucket('amzInbound', 'Inbound', 'Booked in at Amazon, not yet live'),
      bucket('amzLive', 'Live', 'Sellable FBA stock at Amazon'),
      {
        // "Tot", not "Total": the headline Total column must be the only thing on this grid called Total, or the one number the
        // operator needs to trust becomes ambiguous. The AMZ group header supplies the rest of the meaning.
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
    // The Birkenstock pre-order book. Its own group, never folded into Incoming: an orderstatus line is a warehouse order landing
    // shortly, a Birk PO is a seasonal commitment that may be months away. Mixing them would read as "more is coming than really is".
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
    // Incoming = NOT LANDED YET, full stop. The arrived-but-not-shelved columns were removed because arrived stock is already in
    // localstock, i.e. already counted in Local — showing it here as well made the same units look like two different things.
    group: 'Incoming',
    cols: [
      bucket('onOrderLocal', 'SHP', 'Ordered for us (orderstatus type 2), not yet arrived'),
      bucket('onOrderAmz', 'AMZ', 'Ordered for Amazon (orderstatus type 3), not yet arrived — counted in the AMZ Total'),
    ],
  },
];

const DETAIL_COL_COUNT = DETAIL_GROUPS.reduce((n, g) => n + g.cols.length, 0);

// SIZE LABELLING — print what the human typed, do not compute it (owner, 2026-07-20).
//
// `sizeDisplay` (skumap.optionsize) is the label the operator enters on the Add/Modify sizes screen and the exact string the
// customer sees on the public site. An earlier version of this file DERIVED the label from code + uksize, dropping the "EU" half
// when the two numbers matched. That produced the right answer everywhere — Lunar "5 UK", Birkenstock "38 EU / 5 UK" — but it was
// still second-guessing a decision a person had already made, and it would drift the moment a brand sized things unusually.
//
// The fallback only fires if sizeDisplay is blank (none are today). It deliberately does NOT reconstruct the EU/UK pair: `eu` is
// RIGHT(code,2), which on a UK-sized brand is the UK size, so labelling it "EU" is exactly the bug we removed.
function sizeLabel(s: { sizeDisplay: string | null; eu: string; uksize: string | null }): string {
  return s.sizeDisplay || s.uksize || s.eu;
}

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

  // Spacing is owned by the parent (the panel renders below the list), so no margin on the root here.
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Header — title and groupid, so the panel is self-identifying once the list is scrolled away below it.
          PRICE AND RRP SIT HERE (owner, 2026-07-20) so "how much is it?" is answerable mid-conversation without changing screen.
          Price is the live Shopify price, i.e. what the customer sees if they look it up while you are talking to them.
          RRP is shown only when it is ABOVE the price — as the struck-through "was", which is the only form that helps a price
          conversation. When rrp <= price there is no saving to talk about and printing it invites the wrong comparison. Either can
          be null (junk in the legacy varchar column), in which case it is simply absent rather than shown as £0 or "—". */}
      <div className="flex items-start justify-between gap-4 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-medium text-slate-800">{data.title || 'Untitled product'}</div>
          <div className="font-mono text-xs text-slate-500">{data.groupid}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          {data.price !== null && (
            <div className="flex items-baseline gap-2">
              {data.rrp !== null && data.rrp > data.price && (
                <span className="text-xs text-slate-400 line-through">£{data.rrp.toFixed(2)}</span>
              )}
              <span className="text-lg font-semibold tabular-nums text-slate-900">£{data.price.toFixed(2)}</span>
            </div>
          )}
          {/* Bounce over to price this style when you spot it is under/over-priced. NEW TAB (owner) — Inventory keeps its place so a
              mid-lookup jump does not cost you the list you were on. Shopify is groupid-grain, a straight link to the drill; Amazon
              is per-SIZE, so it goes to the Find screen pre-filled (?q=groupid), which lists this style's sizes to pick — the same
              cross-module pattern Analytics already uses. Links, not router pushes, so the tab genuinely opens fresh. */}
          <div className="flex items-center gap-1 text-xs">
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
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 p-4 sm:flex-row">
        {/* ---- Size grid ---- */}
        <div className="min-w-0 flex-1">
          {/* Detail mode is wide. It scrolls INSIDE this container so the page body never scrolls sideways. */}
          <div className={detail ? 'overflow-x-auto' : ''}>
          {/* w-auto, NOT w-full. Every numeric column is a fixed width, so a full-width table dumps all the leftover space into the
              Size column and shoves Local/Total into the middle of the panel with a hole beside the sizes. Sizing to content keeps
              the grid tight on the left where it is read. */}
          <table className="w-auto text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              {detail && (
                <tr className="text-[10px] text-slate-400">
                  <th className="py-1 pr-3" />
                  {/* Carry the Total/Local rule up through the group-header row so it reads as one continuous divider. */}
                  <th className="border-r-2 border-slate-200 py-1 px-3" colSpan={2} />
                  {DETAIL_GROUPS.map((g) => (
                    <th key={g.group} colSpan={g.cols.length} className="border-l border-slate-200 py-1 px-2 text-center font-medium">
                      {g.group}
                    </th>
                  ))}
                </tr>
              )}
              <tr className="border-b border-slate-200">
                <th className="py-1.5 pr-6 font-medium">Size</th>
                {/* Local and Total are the two columns the screen exists for, so they are darker and heavier than the detail
                    headers beside them. Everything to the right is supporting evidence and is deliberately quieter.
                    LOCAL COMES FIRST (owner, 2026-07-20): with a customer waiting, "what is on our shelf" is the question — and on
                    an Amazon-heavy style (124 total, 3 local) Total is the big number that draws the eye to the wrong answer.
                    A real rule after Total marks where "the answer" ends and "the evidence" begins. */}
                <th className="w-16 py-1.5 px-3 text-right font-semibold text-slate-700">Local</th>
                <th className="w-16 border-r-2 border-slate-200 py-1.5 pl-3 pr-4 text-right font-semibold text-slate-700">Total</th>
                {detail && DETAIL_GROUPS.map((g) =>
                  g.cols.map((c, i) => (
                    <th
                      key={c.key}
                      title={c.title}
                      // w-14 on every detail column so they are all the same width regardless of label length — otherwise "On order"
                      // and "Inbound" bully the short ones and the digits stop lining up down the grid.
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
                <tr
                  key={s.code}
                  onClick={() => setSizeCode((prev) => (prev === s.code ? null : s.code))}
                  className={`cursor-pointer ${sizeCode === s.code ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                >
                  <td className="whitespace-nowrap py-1.5 pr-6 text-slate-700">{sizeLabel(s)}</td>
                  {/* Zeros greyed rather than blank — a zero is a real answer and must be visibly zero, not an empty cell that
                      could read as "not loaded".
                      Local carries a "Pick n" tag when some of it is committed to an order. The units ARE still on the shelf, so
                      they belong in Local — but an operator about to promise the last pair needs to see that it is spoken for.
                      A tag, not a column: it is the exception, and most rows have nothing to say here. */}
                  <td className={`py-1.5 px-3 text-right font-semibold tabular-nums ${s.local ? 'text-slate-900' : 'text-slate-300'}`}>
                    {s.local}
                    {s.buckets.picked > 0 && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1 py-0.5 align-middle text-[10px] font-medium text-amber-700">
                        Pick {s.buckets.picked}
                      </span>
                    )}
                  </td>
                  <td className={`border-r-2 border-slate-200 py-1.5 pl-3 pr-4 text-right font-semibold tabular-nums ${s.total ? 'text-slate-900' : 'text-slate-300'}`}>{s.total}</td>
                  {detail && DETAIL_GROUPS.map((g) =>
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
                  <td colSpan={detail ? 3 + DETAIL_COL_COUNT : 3} className="py-4 text-center text-sm text-slate-400">No sizes set up for this style.</td>
                </tr>
              )}
            </tbody>
            {/* NO ALL-SIZES FOOTER (owner, 2026-07-20). This screen answers "have we got a 39 for the customer in front of me" —
                a total across every size is not an input to that, and it sat in the heaviest position on the grid competing with
                the per-size numbers that actually matter. Re-ordering, which is where a style-level total WOULD earn its place, is
                a different screen. `data.totals` is still returned by the API and still correct if a later slice wants it. */}
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
        <InvLocations rows={locationsForSize} sizeLabel={sizeLabel(chosen)} />
      ) : (
        <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-slate-400">
          Choose a size to see where it is.
        </div>
      )}

      {/* Recent sales last, and collapsed: "have we got it / where is it" comes first every time, and this answers the rarer
          "how is it doing" — worth having to hand, not worth pushing the stock position down the page. */}
      <InvSales groupid={data.groupid} />
    </div>
  );
}
