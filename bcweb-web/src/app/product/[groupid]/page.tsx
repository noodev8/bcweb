'use client';
/*
=======================================================================================================================================
Page: /product/<groupid>  (the product hub — one style, opened out to its sizes)
=======================================================================================================================================
Purpose: The second rung of the hub (owner, 2026-09-22): "Double click to drill down if on groupid level — CODE, Stock, Amz Price,
         Shopify Price, Total Sold for code." Same four numbers as the list, one grain down, so a decision that turns out to be about
         one SIZE rather than the whole style can be made here instead of on a pricing screen.

         The hand-off cards are repeated at the bottom, pointing at the same style. That is not a duplicate of the list's row: by the
         time you have opened the sizes you have usually stopped browsing and started deciding, and sending you back up a level to
         reach the card you now want would undo the trip.

SHOPIFY PRICE IS BOTH A HEADER FIELD AND A COLUMN (owner, 2026-09-22 — "I was looking for it"). It shipped as a header field only,
on the reasoning that skusummary.shopifyprice is STYLE grain, so a column would repeat one number down every row and imply the sizes
could differ. The owner knew that and wanted the column anyway, which settles it: the eye reads across a row when it is comparing two
channels, and sending it up to the header to fetch the other half of the comparison is a worse cost than a repeated cell. The column
is drawn in muted text so it still reads as a constant rather than six independent figures.
  The underlying asymmetry has NOT changed, and it is the thing to keep: Amazon's price genuinely varies by size and Shopify's cannot.
  CLAUDE.md records that the retired match_amazon_price autopilot was killed precisely because one thin size could set a whole style's
  price. So amz_price stays a real per-row value; the Shopify column is the same number by definition, not by coincidence.

EVERY SIZE IS LISTED, INCLUDING SOLD-OUT ONES (0, not absent). localstock holds in-stock rows only, so the size range comes from skumap
(CLAUDE.md landmine, same rule as inv-stock.js) — "we have none in a 39" is the answer the operator needs, and a missing row reads as
"we don't stock a 39", which is a different fact and the wrong one.

BARCODES ARE JUST A COLUMN (owner, 2026-09-22 — "no point having barcode button, may as well just show the barcode"). It was a popup
in the original sketch, then a panel behind a toggle, and it is now neither: a barcode is one short string per size, it costs a column,
and a control whose only job is to reveal something that always fits is a control not worth pressing. The column sits on the size table
rather than in a list of its own because the size is the thing you are matching the barcode TO.
=======================================================================================================================================
*/

import { Suspense } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import CopyButton from '@/components/CopyButton';
import ProductNavCards from '@/components/ProductNavCards';
import { getProductVariants } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useApiQuery } from '@/lib/useApiQuery';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

function money(v: number | null): string {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}

export default function ProductDrillPage() {
  // useSearchParams must sit inside a Suspense boundary for Next's build (App Router).
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <ProductDrillContent />
    </Suspense>
  );
}

function ProductDrillContent() {
  const params = useParams<{ groupid: string }>();
  const searchParams = useSearchParams();
  const groupid = decodeURIComponent(params.groupid);
  // Where we came from — normally the hub list with its search term intact, so Back rebuilds the list rather than emptying it. A
  // deep link with no origin falls back to the bare hub.
  const backTo = searchParams.get('from') || '/product';
  const backLabel = backTo === '/product' ? 'Product' : prettyPathLabel(backTo);

  const { data, error, isLoading } = useApiQuery(['product-variants', groupid], () => getProductVariants(groupid));
  const header = data?.header;
  const rows = data?.rows ?? [];

  // This exact page, handed on as ?from= so a hand-off card's back link returns HERE rather than up to the list — the sizes are what
  // was being looked at, and landing a level above them would lose the place.
  const selfUrl = `/product/${encodeURIComponent(groupid)}?from=${encodeURIComponent(backTo)}`;

  return (
    <AppShell
      title={header?.title || groupid}
      subtitle={groupid}
      subtitleCopy
      backHref={backTo}
      backLabel={backLabel}
    >
      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}

      {header && (
        <>
          {/* HERO HEADER (owner, 2026-09-26 — "a much bigger RRP and PRICE"): the style's headline numbers are the main detail of the
              page, so they are drawn large; the size table below is the supporting evidence. The Shopify and Amazon
              prices were tried up here and taken back out (same day) — the grid already carries both per size. RRP stays as the hero. */}
          <div className="mb-4 flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:flex-row">
            <div className="relative h-40 w-40 shrink-0 sm:order-last overflow-hidden rounded-md border border-slate-200 bg-white">
              {header.imagename && (
                <Image src={IMAGE_BASE + header.imagename} alt={header.title || groupid} fill sizes="160px" className="object-contain" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">RRP</div>
                  <div className="text-4xl font-semibold tabular-nums text-slate-900">{money(header.rrp)}</div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Cost</div>
                  <div className="text-2xl font-medium tabular-nums text-slate-700">{money(header.cost)}</div>
                </div>
                <div title={`${header.local} on our shelf + ${header.amazon} at Amazon. Excludes the Birkenstock pre-order book, so this can read lower than the Inventory card.`}>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Stock</div>
                  <div className="text-2xl font-medium tabular-nums text-slate-700">
                    {header.stock}
                    <span className="ml-2 text-sm font-normal text-slate-400">{header.local} here · {header.amazon} amz</span>
                  </div>
                </div>
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-400">Sold 30d</div>
                  <div className="text-2xl font-medium tabular-nums text-slate-700">{header.sold30}</div>
                </div>
              </div>
              <div className="mt-4 text-sm">
                <span className="text-xs uppercase tracking-wide text-slate-400">Segment </span>
                <span className="text-slate-700">{header.segment || '—'}</span>
              </div>
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  {/* Split rather than summed, same reasoning as the list - "on our shelf" and "at Amazon" are opposite
                      situations and adding them hides which one you are in. */}
                  <th className="px-3 py-2 text-right font-medium" title="Units of this size on our own shelf — pickable today">Local</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units of this size held at Amazon (FBA live + inbound)">Amz</th>
                  <th className="px-3 py-2 text-right font-medium" title="This size's own Amazon price — they differ size to size">Amazon</th>
                  <th className="px-3 py-2 text-right font-medium" title="One price for the whole style — Shopify does not price per size, so every row reads the same">Shopify</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold in the last 30 days, all channels">Sold 30d</th>
                  <th className="px-3 py-2 font-medium">Barcode</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  // A sold-out size is drawn quietly rather than dropped — it is still an answer ("none in a 39"), just not one to
                  // read as stock. See the header note on where the size range comes from.
                  <tr key={r.code} className={r.stock === 0 ? 'text-slate-400' : ''}>{/* stock = local + amz: dim only when there is none ANYWHERE */}
                    <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-1.5">{r.size}</td>
                    <td className={'px-3 py-1.5 text-right tabular-nums ' + (r.local === 0 ? 'text-slate-300' : '')}>{r.local}</td>
                    <td className={'px-3 py-1.5 text-right tabular-nums ' + (r.amazon === 0 ? 'text-slate-300' : '')}>{r.amazon}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {r.amz_price === null ? (
                        <span className="text-slate-300" title="This size has no Amazon (FBA) row">—</span>
                      ) : (
                        // Listed but out of stock is its own state, and a live-looking price on a size nobody can buy is the exact
                        // kind of number that gets acted on by mistake. Dimmed and said so, rather than hidden.
                        <span
                          className={r.amz_live > 0 ? '' : 'italic text-slate-400'}
                          title={r.amz_live > 0 ? `${r.amz_live} in stock at FBA` : 'Listed on Amazon, but no FBA stock — nobody can buy at this price today'}
                        >
                          {money(r.amz_price)}
                        </span>
                      )}
                    </td>
                    {/* The same number on every row, by design (owner asked to see it here rather than only in the header): Shopify
                        prices the STYLE, not the size. Drawn quietly so it reads as a constant running down the table rather than as
                        six independent figures that happen to match. */}
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{money(header.price)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.sold30}</td>
                    <td className="px-3 py-1.5">
                      {r.barcode ? (
                        <span className="inline-flex items-center gap-1">
                          <span className="font-mono text-xs text-slate-700">{r.barcode}</span>
                          <CopyButton value={r.barcode} label={`barcode for ${r.size}`} />
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && <p className="mt-2 text-sm text-slate-400">This product carries no sizes.</p>}

          {/* The hand-off row again, pointing at this same style — see the header on why it is repeated rather than left on the list. */}
          <div className="mt-4">
            <ProductNavCards groupid={groupid} from={selfUrl} />
          </div>
        </>
      )}
    </AppShell>
  );
}
