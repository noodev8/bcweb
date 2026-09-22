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

THE SHOPIFY PRICE IS IN THE HEADER, NOT A COLUMN — the one place this screen's shape differs from what was asked for, and the reason
is worth keeping. skusummary.shopifyprice is STYLE grain; there is no per-size Shopify price in the schema. A Shopify column would
print the same number down every row and quietly suggest the sizes could differ. Amazon's genuinely can — CLAUDE.md records that the
retired match_amazon_price autopilot was killed precisely because one thin size could set a whole style's price — so amz_price stays a
real per-row column, and the difference between the two channels is visible on the screen rather than flattened into a repeated cell.

EVERY SIZE IS LISTED, INCLUDING SOLD-OUT ONES (0, not absent). localstock holds in-stock rows only, so the size range comes from skumap
(CLAUDE.md landmine, same rule as inv-stock.js) — "we have none in a 39" is the answer the operator needs, and a missing row reads as
"we don't stock a 39", which is a different fact and the wrong one.

BARCODES ARE A PANEL, NOT A POPUP (owner wondered about "a new window or popup allowing barcode copy"). A panel because the rule for
this whole feature is that navigation stays on one tab and comes back; a popup is one more window to dismiss, and all a barcode needs
is to be readable and copyable next to the size it belongs to. Toggled from the Barcode card, drawn as an extra column on the same
table rather than a second list — the size is the thing you are matching the barcode TO, so splitting them apart would mean reading
two tables at once.
=======================================================================================================================================
*/

import { Suspense, useState } from 'react';
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

  const [showBarcodes, setShowBarcodes] = useState(false);

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
          {/* Header — the style-level frame the size rows sit inside. Shopify price lives here; see the note at the top. */}
          <div className="mb-4 flex gap-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
              {header.imagename && (
                <Image src={IMAGE_BASE + header.imagename} alt={header.title || groupid} fill sizes="112px" className="object-contain" />
              )}
            </div>
            <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Shopify price</dt>
                <dd className="font-medium tabular-nums text-slate-800" title="One price for the whole style — Shopify does not price per size">
                  {money(header.price)}
                  {header.rrp !== null && header.price !== null && header.rrp > header.price && (
                    <span className="ml-2 text-xs font-normal text-slate-400 line-through">{money(header.rrp)}</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Cost</dt>
                <dd className="font-medium tabular-nums text-slate-800">{money(header.cost)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Stock</dt>
                <dd
                  className="font-medium tabular-nums text-slate-800"
                  title={`${header.local} on our shelf + ${header.amazon} at Amazon. Excludes the Birkenstock pre-order book, so this can read lower than the Inventory card.`}
                >
                  {header.stock}
                  <span className="ml-2 text-xs font-normal text-slate-400">{header.local} here · {header.amazon} amz</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Sold 30d</dt>
                <dd className="font-medium tabular-nums text-slate-800">{header.sold30}</dd>
              </div>
              <div className="col-span-2 sm:col-span-4">
                <dt className="text-xs uppercase tracking-wide text-slate-400">Segment</dt>
                <dd className="text-slate-700">{header.segment || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Size</th>
                  <th className="px-3 py-2 text-right font-medium" title="On our shelf plus held at Amazon">Stock</th>
                  <th className="px-3 py-2 text-right font-medium" title="This size's own Amazon price — they differ size to size">Amazon</th>
                  <th className="px-3 py-2 text-right font-medium" title="Units sold in the last 30 days, all channels">Sold 30d</th>
                  {showBarcodes && <th className="px-3 py-2 font-medium">Barcode</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  // A sold-out size is drawn quietly rather than dropped — it is still an answer ("none in a 39"), just not one to
                  // read as stock. See the header note on where the size range comes from.
                  <tr key={r.code} className={r.stock === 0 ? 'text-slate-400' : ''}>
                    <td className="px-3 py-1.5 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-1.5">{r.size}</td>
                    <td
                      className="px-3 py-1.5 text-right tabular-nums"
                      title={`${r.local} on our shelf + ${r.amazon} at Amazon`}
                    >
                      {r.stock}
                    </td>
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
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.sold30}</td>
                    {showBarcodes && (
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
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rows.length === 0 && <p className="mt-2 text-sm text-slate-400">This product carries no sizes.</p>}

          {/* The hand-off row again, pointing at this same style — see the header on why it is repeated rather than left on the list. */}
          <div className="mt-4">
            <ProductNavCards
              groupid={groupid}
              from={selfUrl}
              onBarcode={() => setShowBarcodes((v) => !v)}
              barcodeOpen={showBarcodes}
            />
          </div>
        </>
      )}
    </AppShell>
  );
}
