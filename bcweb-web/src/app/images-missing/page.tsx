'use client';
/*
=======================================================================================================================================
Page: /images-missing  (Back Office → Missing Images)
=======================================================================================================================================
Purpose: The work list for re-imaging the store (docs/product-images-plan.md). From 2026-07-09 every price push wiped the extra Shopify
         images of the product it touched; those are gone, so staff source pictures again and add them on Add / Modify. This lists
         every Shopify-live product with how many images WE hold, single-image ones first, so the job can be worked through daily.

         "Done" = 2+ images (owner, 2026-10-13: "we are just looking at where there are only single images to start"). Main size is NOT
         part of it — "Low-res main" (< 1500 px) is an optional filter, for when someone is sourcing pictures for a product anyway.
         The hero number is the in-stock single-image count — the one figure that should go down (in-stock first: those can sell today).

         Default order: Winners → Steady → New → Losers, then most stock — the styles that earn most get fixed first (owner priority).
         Row → the product on Add / Modify, with a Back link here. The whole list (~300) comes back once and filters run client-side.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getImagesMissing, MissingImageRow } from '@/lib/api';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const STATUS_ORDER: Record<string, number> = { WINNERS: 0, STEADY: 1, NEW: 2, LOSERS: 3 };
const STATUS_LABEL: Record<string, string> = { WINNERS: 'Winner', STEADY: 'Steady', NEW: 'New', LOSERS: 'Loser' };

type Show = 'single' | 'all';
type Stock = 'in' | 'all';

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-3 py-1 text-xs font-medium transition-colors ' +
        (on ? 'border-slate-800 bg-slate-800 text-white' : 'border-slate-300 bg-white text-slate-600 hover:border-slate-400')
      }
    >
      {children}
    </button>
  );
}

function Thumb({ imagename }: { imagename: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-slate-200 bg-white">
      {imagename && !failed && (
        <Image src={IMAGE_BASE + encodeURIComponent(imagename)} alt="" fill sizes="40px" onError={() => setFailed(true)} className="object-contain" />
      )}
    </div>
  );
}

export default function ImagesMissingPage() {
  const { data, error, isLoading } = useApiQuery(['images-missing'], getImagesMissing);
  const [show, setShow] = useState<Show>('single');
  const [stock, setStock] = useState<Stock>('in');
  const [status, setStatus] = useState<string>('');
  const [brand, setBrand] = useState<string>('');
  const [lowRes, setLowRes] = useState(false);
  const [inShopify, setInShopify] = useState(false);
  const [term, setTerm] = useState('');

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean) as string[])].sort(), [rows]);
  const addedInShopify = (r: MissingImageRow) => r.shopify_count !== null && r.shopify_count > r.image_count;

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rows
      .filter((r) => (show === 'single' ? !r.done : true))
      .filter((r) => (stock === 'in' ? r.stock > 0 : true))
      .filter((r) => (status ? r.status === status : true))
      .filter((r) => (brand ? r.brand === brand : true))
      .filter((r) => (lowRes ? r.low_res_main : true))
      .filter((r) => (inShopify ? addedInShopify(r) : true))
      .filter((r) => !t || r.groupid.toLowerCase().includes(t) || (r.title || '').toLowerCase().includes(t))
      .sort((a, b) =>
        (STATUS_ORDER[a.status || ''] ?? 9) - (STATUS_ORDER[b.status || ''] ?? 9) || b.stock - a.stock || a.groupid.localeCompare(b.groupid));
  }, [rows, show, stock, status, brand, lowRes, inShopify, term]);

  const s = data?.summary;
  const back = `&from=${encodeURIComponent('/images-missing')}&back=${encodeURIComponent('Missing Images')}`;

  return (
    <AppShell title="Missing Images">
      <div className="max-w-6xl space-y-5">
        {error && <p className="text-sm text-red-600">{error.message}</p>}
        {isLoading && <p className="text-sm text-slate-400">Loading…</p>}

        {s && (
          <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
            <div>
              <div className="text-4xl font-semibold tabular-nums text-slate-900">{s.single_in_stock}</div>
              <div className="text-sm text-slate-500">in stock with a single image</div>
            </div>
            <div className="pb-1 text-sm text-slate-500">
              {s.single} single-image of {s.products} on Shopify
              <span className="text-slate-300"> · </span>
              <span className={s.done_today ? 'font-medium text-emerald-700' : ''}>{s.done_today} done today</span>
              {s.added_in_shopify > 0 && (
                <>
                  <span className="text-slate-300"> · </span>
                  <button type="button" onClick={() => setInShopify((v) => !v)} className="text-amber-700 hover:underline">
                    {s.added_in_shopify} with images added in Shopify
                  </button>
                </>
              )}
              {!s.shopify_ok && <span className="text-slate-400"> · Shopify counts unavailable</span>}
            </div>
          </div>
        )}

        {data && (
          <div className="flex flex-wrap items-center gap-2">
            <Chip on={show === 'single'} onClick={() => setShow('single')}>Single image</Chip>
            <Chip on={show === 'all'} onClick={() => setShow('all')}>All</Chip>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <Chip on={stock === 'in'} onClick={() => setStock('in')}>In stock</Chip>
            <Chip on={stock === 'all'} onClick={() => setStock('all')}>Any stock</Chip>
            <span className="mx-1 h-4 w-px bg-slate-200" />
            <Chip on={lowRes} onClick={() => setLowRes((v) => !v)}>Low-res main</Chip>
            {inShopify && <Chip on onClick={() => setInShopify(false)}>Added in Shopify ×</Chip>}
            <select value={status} onChange={(e) => setStatus(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
              <option value="">Any status</option>
              {Object.keys(STATUS_ORDER).map((k) => <option key={k} value={k}>{STATUS_LABEL[k]}</option>)}
            </select>
            <select value={brand} onChange={(e) => setBrand(e.target.value)}
              className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
              <option value="">Any brand</option>
              {brands.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
            <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search"
              className="ml-auto w-44 rounded-md border border-slate-300 px-2.5 py-1 text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
        )}

        {data && (
          <>
            <h2 className="text-sm font-medium text-slate-700">{visible.length} {visible.length === 1 ? 'product' : 'products'}</h2>
            {visible.length === 0 ? (
              <p className="text-sm text-slate-500">Nothing here — every product in this view has {data.min_images}+ images.</p>
            ) : (
              <table className="w-full overflow-hidden rounded-lg border border-slate-200 bg-white text-sm">
                <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="hidden px-3 py-2 md:table-cell">Brand</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Stock</th>
                    <th className="px-3 py-2 text-right">Images</th>
                    <th className="hidden px-3 py-2 text-right sm:table-cell">Main</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {visible.map((r) => (
                    <tr key={r.groupid} className="hover:bg-slate-50">
                      <td className="px-3 py-1.5">
                        <Link href={`/products?groupid=${encodeURIComponent(r.groupid)}${back}`} className="flex items-center gap-3">
                          <Thumb imagename={r.imagename} />
                          <span className="min-w-0">
                            <span className="block font-medium text-slate-800">{r.groupid}</span>
                            <span className="block truncate text-xs text-slate-500">{r.title}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="hidden px-3 py-1.5 text-slate-600 md:table-cell">{r.brand}</td>
                      <td className="px-3 py-1.5 text-slate-600">{r.status ? STATUS_LABEL[r.status] || r.status : '—'}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{r.stock}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        <span className={r.done ? 'text-slate-700' : 'font-medium text-slate-900'}>{r.image_count}</span>
                        {addedInShopify(r) && <span className="ml-1 text-xs text-amber-700" title="On Shopify">({r.shopify_count})</span>}
                      </td>
                      <td className={'hidden px-3 py-1.5 text-right tabular-nums sm:table-cell ' + (r.low_res_main ? 'text-slate-400' : 'text-slate-700')}>
                        {r.main_side ? `${r.main_side}px` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
