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

         Default order (owner, 2026-10-13): everything NOT Birkenstock first, then Birkenstock; within each, New → Winners → Steady →
         Losers, then most stock. Why: the wipe weeks showed no conversion drop on Birkenstock (159 styles, mostly price RISES at the
         time, which should have hurt) — buyers already know what an Arizona looks like and the main image never went. Unfamiliar
         brands and trial products have no picture in the buyer's head, so the gallery is the pitch; too few sales to measure, so they
         go first on judgement. Birkenstock is still on the list, just later.

         Under the hero: the date the in-stock list would be clear at ONE A DAY (calendar days, from today). A target, not a quota —
         doing more just brings it forward, and it moves on its own as the count drops.

         TEMPORARY (owner, 2026-10-13): a product marked "Only one image available" on Add / Modify counts as done (no second picture
         exists). The "One image only" chip lists the marked ones so a mark can be checked or undone. Goes with skusummary.single_image_ok_at.

         Row → the product on Add / Modify, with a Back link here. The whole list (~300) comes back once and filters run client-side.
=======================================================================================================================================
*/

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { useImageSlot } from '@/lib/imageSlot';
import { getImagesMissing, MissingImageRow } from '@/lib/api';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const STATUS_ORDER: Record<string, number> = { NEW: 0, WINNERS: 1, STEADY: 2, LOSERS: 3 };
const STATUS_LABEL: Record<string, string> = { WINNERS: 'Winner', STEADY: 'Steady', NEW: 'New', LOSERS: 'Loser' };
const LATER_BRAND = 'Birkenstock';   // familiar to buyers — after every other brand (see header)

// Today + n days, e.g. "4 Apr 2027".
function dateInDays(n: number) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

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

// one.com answers a burst of image fetches with 429 (seen 2026-10-13: a screen of thumbnails, a dozen refused). So, as on Inventory
// (InvStyleCard / lib/imageSlot): load only when near the viewport, through the app-wide lane (5 at a time), and retry an error with a
// growing pause before showing the empty box. Once Vercel has optimised a file it's cached a year, so this is a first-view problem.
const MAX_RETRIES = 3;

function Thumb({ imagename }: { imagename: string | null }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [errors, setErrors] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const failed = errors >= MAX_RETRIES;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) { setNear(true); io.disconnect(); } }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const { granted, done } = useImageSlot(near && !!imagename && !failed);
  const onError = () => {
    done();
    const n = errors + 1;   // one error per mount (the retry remounts), so the render's value is current
    setErrors(n);
    if (n < MAX_RETRIES) window.setTimeout(() => setReloadKey((k) => k + 1), 800 * n);
  };

  return (
    <div ref={boxRef} className="relative h-10 w-10 shrink-0 overflow-hidden rounded border border-slate-200 bg-white">
      {imagename && granted && !failed && (
        <Image key={reloadKey} src={IMAGE_BASE + encodeURIComponent(imagename)} alt="" fill sizes="40px" loading="eager"
          onLoad={done} onError={onError} className="object-contain" />
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
  const [marked, setMarked] = useState(false);
  const [term, setTerm] = useState('');

  const rows = useMemo(() => data?.rows ?? [], [data]);
  const brands = useMemo(() => [...new Set(rows.map((r) => r.brand).filter(Boolean) as string[])].sort(), [rows]);
  const addedInShopify = (r: MissingImageRow) => r.shopify_count !== null && r.shopify_count > r.image_count;

  const visible = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rows
      .filter((r) => (marked ? r.single_ok : show === 'single' ? !r.done : true))
      .filter((r) => (stock === 'in' ? r.stock > 0 : true))
      .filter((r) => (status ? r.status === status : true))
      .filter((r) => (brand ? r.brand === brand : true))
      .filter((r) => (lowRes ? r.low_res_main : true))
      .filter((r) => (inShopify ? addedInShopify(r) : true))
      .filter((r) => !t || r.groupid.toLowerCase().includes(t) || (r.title || '').toLowerCase().includes(t))
      .sort((a, b) =>
        Number(a.brand === LATER_BRAND) - Number(b.brand === LATER_BRAND)
        || (STATUS_ORDER[a.status || ''] ?? 9) - (STATUS_ORDER[b.status || ''] ?? 9)
        || b.stock - a.stock || a.groupid.localeCompare(b.groupid));
  }, [rows, show, stock, status, brand, lowRes, inShopify, marked, term]);

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
              {s.single_in_stock > 0 && (
                <div className="text-xs text-slate-400">At one a day: done by {dateInDays(s.single_in_stock)}</div>
              )}
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
            <Chip on={marked} onClick={() => setMarked((v) => !v)}>One image only</Chip>
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
              <p className="text-sm text-slate-500">
                {marked ? 'Nothing marked as one image only.' : `Nothing here — every product in this view has ${data.min_images}+ images.`}
              </p>
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
                        {r.single_ok && r.image_count < data.min_images && <span className="ml-1 text-xs text-slate-400">only</span>}
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
