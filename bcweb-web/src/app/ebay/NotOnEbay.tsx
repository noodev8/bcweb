'use client';
/*
=======================================================================================================================================
Component: NotOnEbay — the "Not on eBay" view of /ebay (Add build, steps 1–2 — owner, 2026-11-01)
=======================================================================================================================================
Purpose: every style that could go on eBay and isn't there yet (GET /ebay-candidates → server routes/ebay-candidates.js), with a
         readiness check against the listing rules (server utils/ebayCandidates.js + utils/ebayListingRules.js — the same rules the
         List button re-checks with). The LISTING FORM in a style's drop-down is the one thing here that writes: POST /ebay-list.

KEPT PLAIN, like the On eBay view (owner: "the screen is too busy"): code first and large (→ the product page), title as a tooltip,
brand in its own column, the eBay category, Stock (local + FBA live), the Shopify price (= the eBay price — £4.50 postage like
Shopify) and the eBay profit at it. NO READINESS COLUMN: a style that needs something gets an icon after its code (hover = what),
red when it is blocked, amber when the form will only ask for a material; a ready style shows nothing. Filters: All · Ready ·
Needs material · Blocked.

A CLICK ON A ROW opens what the listing would carry: category, department, Style (from the title, or the type's default), material
(stored, from the title, or "the form will ask"), photos, description, and the in-stock sizes with UK size, barcode, local, FBA.

THE LISTING FORM (step 2 — owner decisions): Price (the Shopify price, editable; the eBay profit beside it, recalculated as you type
by GET /ebay-profit-preview — the server's formula), Style (from the title / the type default, editable), Material (required — saved back
to the style in BCWEB). "List on eBay" asks once inline (no browser dialog): style, sizes, pairs, price + £4.50 postage. On success the
row is marked Listed with a link to the listing, for this visit; it leaves the list at the next Refresh. The On eBay view's cached read
is dropped so it reads eBay afresh when next opened. Errors show eBay's own words — fix and press again (the listing build is
idempotent). A blocked style shows no form.

REFRESH: each load reads eBay live (to know what's listed already) — fetched only when this view is opened, and then only on Refresh.
=======================================================================================================================================
*/

import { Fragment, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { mutate } from 'swr';
import { ArrowPathIcon, CheckCircleIcon, ChevronRightIcon, ExclamationTriangleIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getEbayCandidates, getEbayProfitPreview, listOnEbay, type EbayCandidate, type EbayListResult, type EbayMissing } from '@/lib/api';

const NO_ROWS: EbayCandidate[] = [];

const MISSING: Record<EbayMissing, string> = {
  category: 'No eBay category for this gender / type yet',
  photos: 'No photos',
  description: 'No Shopify description',
  price: 'No Shopify price',
  uk_size: 'A size in stock has no UK size',
  uk_size_dup: 'Two sizes in stock have the same UK size',
  barcode: 'A size in stock has no barcode',
  title: 'No title',
  title_long: 'Title is over eBay’s 80 characters',
};

type Filter = 'all' | 'ready' | 'todo' | 'missing';

function money(v: number | null) {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}
function signedMoney(v: number | null) {
  if (v === null) return '—';
  return v < 0 ? `−£${Math.abs(v).toFixed(2)}` : `£${v.toFixed(2)}`;
}
function londonTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
}

export default function NotOnEbay() {
  const { data, error, isLoading, busy, refresh } = useApiQuery(['ebay-candidates'], () => getEbayCandidates(), {
    revalidateIfStale: false, revalidateOnReconnect: false,
  });
  const rows = data?.rows ?? NO_ROWS;

  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  // Listed on this visit (groupid -> result) — shown as Listed until the next Refresh drops the row.
  const [listed, setListed] = useState<Record<string, EbayListResult>>({});

  function onListed(groupid: string, result: EbayListResult) {
    setListed((prev) => ({ ...prev, [groupid]: result }));
    // The On eBay view reads eBay only on Refresh; drop its cached read so it reads afresh when next opened.
    mutate(['ebay-listings'], undefined, { revalidate: false });
  }

  const counts = useMemo(() => ({
    all: rows.length,
    ready: rows.filter((r) => r.status === 'ready').length,
    todo: rows.filter((r) => r.status === 'todo').length,
    missing: rows.filter((r) => r.status === 'missing').length,
  }), [rows]);

  const visible = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return rows.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (terms.length === 0) return true;
      const hay = `${r.groupid} ${r.title || ''} ${r.brand || ''} ${r.category?.name || ''}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [rows, filter, search]);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => refresh()}
          disabled={busy}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          <ArrowPathIcon className={'h-4 w-4 ' + (busy ? 'animate-spin' : '')} />
          {busy ? 'Reading eBay…' : 'Refresh'}
        </button>
        <p className="text-sm text-slate-500">
          Styles in stock (local + FBA) not on eBay yet, Birkenstock left out
          {data ? <>. Read at {londonTime(data.read_at)}{data.on_ebay_styles > 0 && <> · {data.on_ebay_styles} with a trial listing not shown</>}.</> : '.'}
        </p>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Reading eBay and our stock…</p>}
      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error.message}</div>}

      {data && (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {([['all', 'All'], ['ready', 'Ready'], ['todo', 'Needs material'], ['missing', 'Blocked']] as [Filter, string][]).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setFilter(k)}
                aria-pressed={filter === k}
                className={'rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition ' +
                  (filter === k ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50')}
              >
                {label} <span className={'tabular-nums ' + (filter === k ? 'text-white/80' : 'text-slate-400')}>{counts[k]}</span>
              </button>
            ))}
            <div className="relative ml-auto w-full sm:w-64">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2 h-5 w-5 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search code, title or brand"
                className="w-full rounded-md border border-slate-300 py-1.5 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>

          {/* One page scroll bar, sticky headings — as the On eBay view. */}
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:overflow-x-clip">
            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {rows.length === 0 ? 'Every style in stock is on eBay (Birkenstock aside).' : 'No style matches.'}
              </p>
            ) : (
              <table className="min-w-full text-sm">
                <thead className="text-xs text-slate-500">
                  <tr>
                    <Th className="pl-3 text-left" title="Our code — click it to open the product; hover for the title">Code</Th>
                    <Th className="text-left">Brand</Th>
                    <Th className="text-left" title="The eBay category the rules give it">eBay category</Th>
                    <Th className="text-center" title="Our stock: local + FBA live">Stock</Th>
                    <Th className="text-center" title="Sizes in stock">Sizes</Th>
                    <Th className="text-right" title="Shopify price — the eBay price will start here (£4.50 postage, like Shopify)">Price</Th>
                    <Th className="pr-3 text-right" title="Profit on one eBay sale at this price, with the £4.50 postage the buyer pays (EBY formula)">Profit</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const isOpen = open === r.groupid;
                    return (
                      <Fragment key={r.groupid}>
                        <tr
                          onClick={() => setOpen(isOpen ? null : r.groupid)}
                          aria-expanded={isOpen}
                          className={'cursor-pointer border-b border-slate-100 ' + (isOpen ? 'bg-slate-50' : 'hover:bg-slate-50')}
                        >
                          <td className="whitespace-nowrap py-2 pl-3 pr-2" title={r.title || undefined}>
                            <div className="flex items-center gap-1.5">
                              <ChevronRightIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                              <Link href={`/product/${encodeURIComponent(r.groupid)}?from=${encodeURIComponent('/ebay?view=not')}`} onClick={(e) => e.stopPropagation()}
                                className="font-mono text-[15px] font-semibold tracking-tight text-slate-900 hover:text-brand-700 hover:underline">{r.groupid}</Link>
                              {listed[r.groupid]
                                ? <span className="inline-flex items-center gap-0.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700"><CheckCircleIcon className="h-3.5 w-3.5" />Listed</span>
                                : <Readiness row={r} />}
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.brand || '—'}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.category?.name || <span className="text-red-600">none</span>}</td>
                          <td className="px-2 py-2 text-center font-medium tabular-nums">{r.stock}</td>
                          <td className="px-2 py-2 text-center tabular-nums text-slate-600">{r.sizes.length}</td>
                          <td className="whitespace-nowrap px-2 py-2 text-right tabular-nums text-slate-800">{money(r.price)}</td>
                          <td className={'whitespace-nowrap py-2 pl-2 pr-3 text-right tabular-nums ' + (r.profit !== null && r.profit < 0 ? 'text-red-600' : 'text-slate-700')}>{signedMoney(r.profit)}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={7} className="px-4 pb-4 pt-1"><Detail row={r} listed={listed[r.groupid] || null} onListed={(res) => onListed(r.groupid, res)} /></td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </>
  );
}

function Th({ children, className = '', title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <th title={title} className={'sticky top-0 z-10 whitespace-nowrap bg-slate-50 px-2 py-1.5 font-medium shadow-[inset_0_-1px_0_rgb(226_232_240)] ' + className}>
      {children}
    </th>
  );
}

// One icon after the code, only when something is needed: red = blocked, amber = the form will ask for a material.
function Readiness({ row }: { row: EbayCandidate }) {
  if (row.status === 'ready') return null;
  const lines = row.status === 'missing'
    ? row.missing.map((m) => MISSING[m] || m)
    : ['No material — the listing form will ask for it'];
  return (
    <span title={lines.join('\n')} aria-label={lines.join(', ')} className="inline-flex cursor-help">
      <ExclamationTriangleIcon className={'h-4 w-4 ' + (row.status === 'missing' ? 'text-red-600' : 'text-amber-500')} />
    </span>
  );
}

// What the listing would carry, and the listing form (step 2).
function Detail({ row: r, listed, onListed }: { row: EbayCandidate; listed: EbayListResult | null; onListed: (res: EbayListResult) => void }) {
  const facts: [string, ReactNode][] = [
    ['eBay category', r.category ? r.category.name : <span className="text-red-600">none — {r.gender || '?'} / {r.producttype || '?'}</span>],
    ['Department', r.department || '—'],
    ['Style', r.style ? <>{r.style.value} <span className="text-slate-400">({r.style.from === 'title' ? 'from the title' : 'default for the type'})</span></> : '—'],
    ['Material', r.material ? <>{r.material.value} <span className="text-slate-400">({r.material.from === 'stored' ? 'stored' : 'from the title'})</span></> : <span className="text-amber-700">none — the form will ask</span>],
    ...(r.type ? [['Type', r.type] as [string, ReactNode]] : []),
    ['Colour', r.colour || '—'],
    ['Photos', r.photos ? r.photos : <span className="text-red-600">none</span>],
    ['Description', r.has_description ? 'Shopify description' : <span className="text-red-600">none</span>],
    ['Title', <span key="t" className="text-slate-600">{r.title || '—'} <span className="text-slate-400">({r.title_length}/80)</span></span>],
  ];
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-lg border border-slate-200 bg-white p-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {facts.map(([k, v]) => (
          <Fragment key={k}>
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-800">{v}</dd>
          </Fragment>
        ))}
      </dl>
      <table className="text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-1.5 pr-4 text-left font-medium">Code</th>
            <th className="py-1.5 pr-4 text-left font-medium">UK size</th>
            <th className="py-1.5 pr-4 text-left font-medium">Barcode</th>
            <th className="py-1.5 pr-4 text-center font-medium">Local</th>
            <th className="py-1.5 text-center font-medium">FBA</th>
          </tr>
        </thead>
        <tbody>
          {r.sizes.map((z) => (
            <tr key={z.code} className="border-b border-slate-100 last:border-0">
              <td className="py-1.5 pr-4 font-mono text-xs text-slate-600">{z.code}</td>
              <td className="py-1.5 pr-4">{z.uk_size || <span className="text-red-600">none</span>}</td>
              <td className="py-1.5 pr-4 font-mono text-xs tabular-nums text-slate-700">{z.ean || <span className="font-sans text-red-600">none</span>}</td>
              <td className="py-1.5 pr-4 text-center tabular-nums">{z.local || <span className="text-slate-300">·</span>}</td>
              <td className="py-1.5 text-center tabular-nums">{z.fba || <span className="text-slate-300">·</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="w-full border-t border-slate-100 pt-4">
        {listed ? <ListedNote result={listed} />
          : r.status === 'missing' ? <p className="text-sm text-red-700">Blocked — {r.missing.map((m) => MISSING[m] || m).join(' · ')}. Fix it in BCWEB, then Refresh.</p>
          : <ListForm row={r} onListed={onListed} />}
      </div>
    </div>
  );
}

function ListedNote({ result }: { result: EbayListResult }) {
  return (
    <div className="text-sm">
      <p className="font-medium text-emerald-700">
        Listed on eBay — {result.sizes} size{result.sizes === 1 ? '' : 's'}, {result.pairs} pair{result.pairs === 1 ? '' : 's'}.{' '}
        <a href={result.url} target="_blank" rel="noopener noreferrer" className="underline hover:text-emerald-900">Open it on eBay</a>
      </p>
      {result.warnings.length > 0 && <p className="mt-1 text-xs text-amber-700">eBay noted: {result.warnings.join(' · ')}</p>}
    </div>
  );
}

const inputClass = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';

// THE LISTING FORM — see the header. Price, Style, Material, then List on eBay -> confirm -> POST /ebay-list.
function ListForm({ row: r, onListed }: { row: EbayCandidate; onListed: (res: EbayListResult) => void }) {
  const [priceText, setPriceText] = useState(r.price !== null ? r.price.toFixed(2) : '');
  const [style, setStyle] = useState(r.style?.value || '');
  const [material, setMaterial] = useState(r.material?.value || '');
  const [previewPrice, setPreviewPrice] = useState<number | null>(r.price);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const price = Number(priceText);
  const priceOk = priceText.trim() !== '' && Number.isFinite(price) && price > 0;
  const canList = priceOk && style.trim() !== '' && material.trim() !== '';

  // Profit beside the price: the row's own figure at the Shopify price; otherwise the server works it out (debounced as you type).
  const atShopify = previewPrice !== null && r.price !== null && Math.abs(previewPrice - r.price) < 0.005;
  const preview = useApiQuery(
    previewPrice !== null && !atShopify ? ['ebay-profit', r.groupid, previewPrice] : null,
    () => getEbayProfitPreview(r.groupid, previewPrice as number),
  );
  const profit = atShopify ? r.profit : (preview.data ?? null);

  function onPrice(v: string) {
    setPriceText(v);
    setConfirming(false);
    if (timer.current) clearTimeout(timer.current);
    const n = Number(v);
    timer.current = setTimeout(() => setPreviewPrice(v.trim() !== '' && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null), 400);
  }

  async function list() {
    setBusy(true);
    setErr(null);
    const res = await listOnEbay(r.groupid, Math.round(price * 100) / 100, style.trim(), material.trim());
    setBusy(false);
    setConfirming(false);
    if (res.success && res.data) { onListed(res.data); return; }
    setErr(res.error || 'Could not list it on eBay');
  }

  const fba = r.sizes.reduce((a, z) => a + z.fba, 0);
  return (
    <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        Price (£)
        <input inputMode="decimal" value={priceText} onChange={(e) => onPrice(e.target.value)} className={inputClass + ' w-28 tabular-nums'} />
      </label>
      <div className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        eBay profit
        <span className={'py-1.5 text-sm tabular-nums ' + (profit !== null && profit < 0 ? 'text-red-600' : 'text-slate-800')}>
          {priceOk ? (preview.busy && !atShopify ? '…' : signedMoney(profit)) : '—'}
          <span className="ml-1 text-xs font-normal text-slate-400">+ £4.50 postage</span>
        </span>
      </div>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        Style
        <input value={style} maxLength={65} onChange={(e) => { setStyle(e.target.value); setConfirming(false); }} className={inputClass + ' w-40'} />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-slate-500">
        <span>Material{!r.material && <span className="ml-1 text-amber-700">— needed, saved to the style</span>}</span>
        <input value={material} maxLength={65} placeholder="e.g. Leather" onChange={(e) => { setMaterial(e.target.value); setConfirming(false); }}
          className={inputClass + ' w-40 ' + (material.trim() === '' ? 'border-amber-400' : '')} />
      </label>

      {!confirming ? (
        <button type="button" disabled={!canList || busy} onClick={() => setConfirming(true)}
          className="h-9 rounded-md bg-brand-600 px-4 text-sm font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-40">
          List on eBay
        </button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
          <span>
            List <strong className="font-mono">{r.groupid}</strong> at <strong>£{price.toFixed(2)}</strong> + £4.50 postage —{' '}
            {r.sizes.length} size{r.sizes.length === 1 ? '' : 's'}, {r.stock} pair{r.stock === 1 ? '' : 's'}{fba > 0 ? ` (${fba} at FBA)` : ''}?
          </span>
          <button type="button" disabled={busy} onClick={list}
            className="h-8 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
            {busy ? 'Listing…' : 'Yes, list it'}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}
            className="h-8 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">
            Cancel
          </button>
        </div>
      )}
      {err && <p className="w-full text-sm text-red-700">{err}</p>}
    </div>
  );
}
