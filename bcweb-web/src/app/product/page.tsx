'use client';
/*
=======================================================================================================================================
Page: /product  (the product hub — list)
=======================================================================================================================================
Purpose: The front door, built around the way the owner now works (2026-09-22): "We always start with PRODUCT. That's becoming my
         mindset. From the product, I need to find what I need or adjust anything about it, without hunting around for the correct
         screen." So: search, get a row per style with the four numbers that say what KIND of job this is, pick one, and leave for the
         right screen with the groupid already filled in.

         The four numbers are the whole design. Stock, Amazon price, Shopify price, 30-day sold — between them they answer "is this a
         pricing job, an ordering job or a catalogue job" without opening any of those screens to find out. Everything else a style
         has is one card away and stays there.

THE DASHBOARD SEARCH BOX LANDS HERE, not on /inventory (changed 2026-09-22). That box used to BE the Inventory tile — the dashboard
has no Inventory card precisely because the box was it — so this change takes Inventory's front door away, and the replacement is
deliberate rather than incidental: Inventory is the first card on the hand-off row (ProductNavCards), one click further than before,
and the header tab is untouched. What made it worth doing is that the search box's job was never "open Inventory", it was "start from
a product", and Inventory only ever answered one of the several questions that follow.
  THE THUMBNAIL COLUMN IS NOT DECORATION, and it is the part of this screen most likely to be "tidied" by someone counting columns.
  Inventory's whole premise is that the normal result is a dozen near-identical black Arizonas and the PICTURE is how a human tells
  them apart. A hub that listed groupids alone would be worse than the screen it sits in front of, and the operator would bounce
  straight through to Inventory to identify the row — which is the trip this page exists to remove.

SELECT AND DRILL ARE DIFFERENT GESTURES, which is what the owner's two options collapse into once both are on screen ("grey out the
buttons until a groupid is selected, or wait for a double click" — both, as it turns out, because they do different jobs):
  - ONE CLICK selects. That lights the hand-off cards, which is the common case: most visits end by leaving for another module, not
    by opening the sizes.
  - DOUBLE-CLICK, Enter, or the row's own › button drills to the sizes. Three ways in on purpose — double-click is what the owner
    asked for and what the legacy grid did, Enter is what every other list on this platform does (useListCursor), and the › is the
    only one of the three that is VISIBLE, so the gesture is discoverable by someone who was told neither.
  The first click of a double-click selects, which is harmless — the row it selects is the row about to open.

THE SEARCH TERM LIVES IN THE URL (?q=). Not local state: every hand-off card sends `from` = this exact URL, so the back link on the
far screen has to be able to rebuild the list. A term held only in a useState would come back to an empty hub and the operator would
retype it, which is the specific annoyance this whole feature is against.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import { MagnifyingGlassIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import { getProductOverview, ProductOverviewRow } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';
import { useListCursor } from '@/lib/useListCursor';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
// Stable empty identity so the render's reads don't allocate a new array each pass.
const NO_ROWS: ProductOverviewRow[] = [];

function money(v: number | null): string {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}

/**
 * The Amazon cell: a SPREAD, printed as one value only when the sizes genuinely agree.
 * Amazon prices per size — IVES BLACKSOLE runs £36.69–£40.89 across six — and CLAUDE.md records that the retired match_amazon_price
 * autopilot was killed for exactly that: there is no single Amazon price, and treating one as if there were let a thin size set the
 * whole style's. So this cell never averages. `live=false` means the style has no FBA stock and the spread is over its dead feed
 * rows, which is worth seeing but is not a price anyone can buy at — drawn dimmed, with the reason in the tooltip.
 */
function AmazonCell({ r }: { r: ProductOverviewRow }) {
  if (r.amz_low === null) return <span className="text-slate-300">—</span>;
  const one = r.amz_low === r.amz_high;
  const text = one ? `£${r.amz_low.toFixed(2)}` : `£${r.amz_low.toFixed(2)}–${r.amz_high!.toFixed(2)}`;
  const title = [
    one ? `One price across ${r.amz_sizes} size${r.amz_sizes === 1 ? '' : 's'}.` : `Amazon prices per size — ${r.amz_sizes} sizes span this range.`,
    r.amz_live ? 'In stock at FBA.' : 'No FBA stock: this is what the listing WOULD sell at, not a price on sale today.',
  ].join(' ');
  return (
    <span className={r.amz_live ? 'text-slate-700' : 'text-slate-400 italic'} title={title}>
      {text}
    </span>
  );
}

export default function ProductHubPage() {
  // useSearchParams must sit inside a Suspense boundary for Next's build (App Router) — same thin wrapper every other page here uses.
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <ProductHubContent />
    </Suspense>
  );
}

function ProductHubContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get('q') || '').trim();

  // What is being TYPED, separate from the committed term in the URL. Force-uppercased to match the dashboard box, Inventory's
  // Contains box and both Find pages, so a term reads identically wherever it is re-typed.
  const [term, setTerm] = useState(q.toUpperCase());
  const [selected, setSelected] = useState<string | null>(null);

  const { data, error, busy } = useApiQuery(q ? ['product-overview', q] : null, () => getProductOverview(q));
  const rows = data?.rows ?? NO_ROWS;

  // This page's own URL, handed to every destination as ?from= so its back link rebuilds this exact list. Built from the COMMITTED
  // term, not the typed one — the back link has to reproduce what is on screen, not what someone half-typed before leaving.
  const selfUrl = q ? `/product?q=${encodeURIComponent(q)}` : '/product';

  const keys = useMemo(() => rows.map((r) => r.groupid), [rows]);

  function drill(groupid: string) {
    router.push(`/product/${encodeURIComponent(groupid)}?from=${encodeURIComponent(selfUrl)}`);
  }

  // Keyboard cursor over the rows — same hook, same gesture as /inventory and the other lists. Selection follows the cursor so the
  // hand-off cards always point at the row the eye is on; Enter opens it.
  const cursor = useListCursor({
    keys,
    onEnter: (key) => drill(key),
    onMove: (key) => setSelected(key),
  });

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const next = term.trim();
    if (!next) return;
    setSelected(null);
    // push, not replace: Back from a narrowed search returns to the previous one rather than out of the hub entirely.
    router.push(`/product?q=${encodeURIComponent(next)}`);
  }

  return (
    <AppShell title="Product" backHref="/dashboard" backLabel="Dashboard">
      <form onSubmit={onSearch} className="mb-4 flex items-stretch gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Product — title, groupid, SKU code or Amazon SKU…"
            aria-label="Search a product"
            className={
              'w-full rounded-lg border-2 border-slate-300 bg-white py-3 pl-12 pr-4 text-base text-slate-900 shadow-sm ' +
              'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
            }
          />
        </div>
        <button
          type="submit"
          className={
            'inline-flex shrink-0 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-6 text-base font-medium ' +
            'text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500/30'
          }
        >
          Search
        </button>
      </form>

      {/* The hand-off row sits ABOVE the list, not under it: it is the destination of most visits, and putting it below a list of
          unknown length would mean scrolling to reach the thing you came for. Greyed until a row is picked. */}
      <div className="mb-4">
        <ProductNavCards groupid={selected} from={selfUrl} />
      </div>

      {!q && (
        <p className="text-sm text-slate-400">
          Search for a product to start. Everything else on this screen works off the one you pick.
        </p>
      )}
      {busy && <p className="text-sm text-slate-400">Searching…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}
      {q && !busy && !error && rows.length === 0 && <p className="text-sm text-slate-400">No matches for “{q}”.</p>}

      {rows.length > 0 && (
        <>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="w-14 px-2 py-2" />
                  <th className="px-3 py-2 font-medium">Group ID</th>
                  <th className="px-3 py-2 font-medium">Product</th>
                  {/* One stock number, local + Amazon (owner). The tooltip carries the split and the one way this can disagree with
                      Inventory — see the route header on the Birk pre-order book. */}
                  <th className="px-3 py-2 text-right font-medium" title="On our shelf plus held at Amazon">Stock</th>
                  <th className="px-3 py-2 text-right font-medium" title="Amazon prices per size, so this is the range, never an average">Amazon</th>
                  <th className="px-3 py-2 text-right font-medium">Shopify</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold in the last 30 days, all channels">Sold 30d</th>
                  <th className="w-10 px-2 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => {
                  const isSel = selected === r.groupid;
                  return (
                    <tr
                      key={r.groupid}
                      ref={cursor.itemRef(r.groupid)}
                      onClick={() => { setSelected(r.groupid); cursor.setCursor(r.groupid); }}
                      onDoubleClick={() => drill(r.groupid)}
                      title="Click to select · double-click to open the sizes"
                      className={'cursor-pointer ' + (isSel ? 'bg-brand-50' : 'hover:bg-slate-50')}
                    >
                      {/* Intrinsic size is unknown (legacy image library), so next/image gets a fixed box and object-contain
                          letterboxes it — the same treatment every other product thumbnail on the platform gets. Deliberately NOT
                          `unoptimized`: next.config.js sets a year-long minimumCacheTTL because image filenames are immutable, and
                          opting out of the optimiser would opt out of that cache too. */}
                      <td className="px-2 py-1.5">
                        <div className="relative h-10 w-10 overflow-hidden rounded border border-slate-200 bg-white">
                          {r.imagename && (
                            <Image src={IMAGE_BASE + r.imagename} alt="" fill sizes="40px" className="object-contain" />
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{r.groupid}</td>
                      <td className="px-3 py-1.5 text-slate-700">
                        {r.title || <span className="text-slate-400">—</span>}
                        {r.segment && <span className="ml-2 text-xs text-slate-400">{r.segment}</span>}
                      </td>
                      <td
                        className="px-3 py-1.5 text-right tabular-nums text-slate-700"
                        title={`${r.local} on our shelf + ${r.amazon} at Amazon. Excludes the Birkenstock pre-order book, so this can read lower than the Inventory card.`}
                      >
                        {r.stock}
                      </td>
                      {/* nowrap: a spread is one value, and letting "36.69-40.89" break after the dash stacks it into what reads
                          as two separate prices. The column is narrow enough that it wrapped at ordinary window widths. */}
                      <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums"><AmazonCell r={r} /></td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{money(r.price)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{r.sold30}</td>
                      <td className="px-2 py-1.5 text-right">
                        {/* The VISIBLE way in to the sizes. Double-click and Enter both do the same thing, but neither announces
                            itself — this does. stopPropagation so it opens rather than just selecting. */}
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); drill(r.groupid); }}
                          title="Open this product's sizes"
                          aria-label={`Open sizes for ${r.groupid}`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        >
                          <ChevronRightIcon className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* The cap is a safety net, not a shortlist (utils/listLimit.js) — but a list that silently stopped at 100 would let someone
              believe they had seen the whole set, so when it bites it says so. */}
          <p className="mt-2 text-xs text-slate-400">
            {data?.truncated
              ? `Showing ${data.count} of ${data.total} matches — narrow the search to see the rest.`
              : `${rows.length} ${rows.length === 1 ? 'product' : 'products'}.`}
          </p>
        </>
      )}
    </AppShell>
  );
}
