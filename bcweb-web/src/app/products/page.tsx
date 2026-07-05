'use client';
/*
=======================================================================================================================================
Page: /products  (Add / Modify Product — Stage 1 search + Stage 2a load)
=======================================================================================================================================
Purpose: Entry screen for the Add / Modify Product module. Master-detail:
           - LEFT: search the master product list by GROUPID (GET /product-search?term=), results in groupid sort order.
           - RIGHT: click a result to load that product's header (GET /product-get?groupid=) and show the legacy "Add / Modify" fields.
         The results list stays put while you click between products (e.g. flicking through the colours of one model). Read-only for
         now — making fields editable + SAVE is the next increment. When a search finds nothing, that empty state is the cue to create
         a new product (creation arrives in a later stage).
=======================================================================================================================================
*/

import { useState } from 'react';
import Image from 'next/image';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { searchProducts, getProduct, ProductRow, ProductDetail } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// Small read-only field: a label above a value styled to look like a (disabled) input, so the layout already reads as the eventual
// edit form. money()/flag() format the legacy values consistently.
function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</label>
      <div className={'rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 ' + (mono ? 'font-mono' : '')}>
        {value === null || value === undefined || value === '' ? <span className="text-slate-400">—</span> : value}
      </div>
    </div>
  );
}
const money = (n: number | null) => (n === null ? null : `£${n.toFixed(2)}`);
const flag = (b: boolean) => (b ? 'Yes' : 'No');

// Product image lives on our image server, keyed by the bare filename in skusummary.imagename.
const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

// Renders the product image with a graceful fallback: no filename, or a load failure (missing file), shows a placeholder instead of
// a broken-image icon. Keyed by groupid at the call site so the failed-state resets when you switch products.
function ProductImage({ imagename }: { imagename: string | null }) {
  const [failed, setFailed] = useState(false);
  const box = 'flex h-28 w-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-slate-200 bg-white';
  if (!imagename || failed) {
    return <div className={box + ' text-center text-[11px] text-slate-400'}>{imagename ? 'Image not found' : 'No image'}</div>;
  }
  return (
    <div className={'relative ' + box}>
      {/* next/image with `fill` so it fits the fixed 112px box; host is whitelisted in next.config.js. object-contain letterboxes
          non-square product shots. onError falls back to the placeholder above (e.g. filename points at a missing file). */}
      <Image
        src={IMAGE_BASE + encodeURIComponent(imagename)}
        alt=""
        fill
        sizes="112px"
        onError={() => setFailed(true)}
        className="object-contain"
      />
    </div>
  );
}

export default function ProductsPage() {
  const { logout } = useAuth();

  // ---- Search state (left) -------------------------------------------------------------------------------------------------------
  const [term, setTerm] = useState('');
  const [lastTerm, setLastTerm] = useState('');
  const [results, setResults] = useState<ProductRow[]>([]);
  const [limited, setLimited] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- Detail state (right) ------------------------------------------------------------------------------------------------------
  const [selected, setSelected] = useState<string | null>(null);   // highlighted groupid
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    setLoading(true);
    setError(null);
    const res = await searchProducts(q);
    if (res.success && res.data) {
      setResults(res.data.results);
      setLimited(res.data.limited);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Search failed');
      setResults([]);
      setLimited(false);
    }
    // A fresh search invalidates the current selection.
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    setLastTerm(q);
    setSearched(true);
    setLoading(false);
  }

  async function onSelect(groupid: string) {
    setSelected(groupid);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(true);
    const res = await getProduct(groupid);
    if (res.success && res.data) {
      setDetail(res.data);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setDetailError(res.error || 'Failed to load product');
    }
    setDetailLoading(false);
  }

  return (
    <AppShell title="Add / Modify Product" backHref="/dashboard" backLabel="Dashboard">
      {/* Search bar */}
      <form onSubmit={onSearch} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            value={term}
            // Group IDs are upper-case (e.g. 0128221-GIZEH), so force the input to caps as the user types. Matching is
            // case-insensitive server-side (ILIKE) either way; this just keeps what's shown consistent with the data.
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Group ID (e.g. 0128221-GIZEH)"
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 font-mono text-sm uppercase focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      {loading && <p className="text-sm text-slate-400">Searching…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {/* No match -> the cue to create a new product (creation arrives in a later stage). */}
      {searched && !loading && !error && results.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center">
          <p className="text-sm text-slate-600">
            No product found for <span className="font-mono font-medium text-slate-800">{lastTerm}</span>.
          </p>
          <p className="mt-1 text-xs text-slate-400">Creating a new product from here arrives in a later stage.</p>
        </div>
      )}

      {limited && !loading && (
        <div className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Showing the first 25 matches — narrow your search (e.g. add the colour) to see the rest.
        </div>
      )}

      {/* Master-detail: results list stays on the left; the picked product's fields fill the right. */}
      {results.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* LEFT — results list */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-1">
            <ul className="divide-y divide-slate-100">
              {results.map((r) => {
                const active = r.groupid === selected;
                return (
                  <li key={r.groupid}>
                    <button
                      onClick={() => onSelect(r.groupid)}
                      className={'block w-full px-3 py-2 text-left hover:bg-slate-50 ' + (active ? 'bg-brand-50' : '')}
                    >
                      <span className={'block font-mono text-xs ' + (active ? 'text-brand-700' : 'text-slate-700')}>{r.groupid}</span>
                      <span className="block truncate text-xs text-slate-400">{r.title || '—'}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {/* RIGHT — detail panel */}
          <div className="lg:col-span-2">
            {!selected && (
              <div className="flex h-full min-h-[12rem] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-400">
                Select a product to view its details
              </div>
            )}
            {selected && detailLoading && <p className="text-sm text-slate-400">Loading {selected}…</p>}
            {selected && detailError && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{detailError}</div>}

            {detail && !detailLoading && (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                {/* Header: the key + generated title on the left, product image on the right (as on the legacy screen). */}
                <div className="mb-4 flex items-start justify-between gap-4 border-b border-slate-100 pb-3">
                  <div className="min-w-0">
                    <div className="font-mono text-lg font-semibold text-slate-900">{detail.groupid}</div>
                    <div className="mt-0.5 text-sm text-slate-500">{detail.title || <span className="text-slate-400">No title</span>}</div>
                    <div className="mt-1 truncate font-mono text-[11px] text-slate-400" title={detail.imagename || undefined}>
                      {detail.imagename || 'No image name'}
                    </div>
                  </div>
                  <ProductImage key={detail.groupid} imagename={detail.imagename} />
                </div>

                {/* Attribute fields (the legacy dropdowns, read-only for now) */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Brand" value={detail.brand} />
                  <Field label="Colour" value={detail.colour} />
                  <Field label="Product Type" value={detail.producttype} />
                  <Field label="Gender" value={detail.gender} />
                  <Field label="Segment" value={detail.segment} mono />
                  <Field label="Season" value={detail.season} />
                  <Field label="Width" value={detail.width} />
                  <Field label="Material" value={detail.material} />
                </div>

                {/* Pricing + flags */}
                <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-5">
                  <Field label="Cost" value={money(detail.cost)} />
                  <Field label="RRP" value={money(detail.rrp)} />
                  <Field label="Price" value={money(detail.price)} />
                  <Field label="Tax" value={flag(detail.tax)} />
                  <Field label="Shopify" value={flag(detail.shopify)} />
                </div>

                {/* Sizes (skumap) — Code / Barcode / Size Display. UK size omitted until we need it. */}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <div className="mb-2 flex items-baseline justify-between">
                    <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Sizes</h3>
                    <span className="text-xs text-slate-400">{detail.sizes.length} variant{detail.sizes.length === 1 ? '' : 's'}</span>
                  </div>
                  {detail.sizes.length === 0 ? (
                    <p className="text-sm text-slate-400">No sizes on record.</p>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                          <tr>
                            <th className="px-3 py-2 font-medium">Code</th>
                            <th className="px-3 py-2 font-medium">Barcode</th>
                            <th className="px-3 py-2 font-medium">Size Display</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {detail.sizes.map((s) => (
                            <tr key={s.code} className="hover:bg-slate-50">
                              <td className="px-3 py-1.5 font-mono text-xs text-slate-700">{s.code}</td>
                              <td className="px-3 py-1.5 font-mono text-xs text-slate-600">{s.barcode || <span className="text-slate-300">—</span>}</td>
                              <td className="px-3 py-1.5 text-slate-700">{s.sizeDisplay || <span className="text-slate-300">—</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <p className="mt-4 text-xs text-slate-400">Read-only preview — editing &amp; save arrive in the next stage.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
