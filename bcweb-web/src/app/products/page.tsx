'use client';
/*
=======================================================================================================================================
Page: /products  (Add / Modify Product — Stage 1 search + Stage 2a load)
=======================================================================================================================================
Purpose: Entry screen for the Add / Modify Product module. Master-detail:
           - LEFT: search the master product list by GROUPID (GET /product-search?term=), results in groupid sort order.
           - RIGHT: click a result to load that product's header (GET /product-get?groupid=) and show the legacy "Add / Modify" fields.
         The results list stays put while you click between products (e.g. flicking through the colours of one model). When a search
         finds nothing, that empty state is the cue to create a new product (creation arrives in a later stage).

         Edit Stage 1: the attribute/enum fields are editable dropdowns with a SAVE (POST /product-update): brand, colour, product type,
         gender, segment, season. Everything else (price, title, width/material, sizes) stays read-only for now — price will go through
         the pricing W1 route (shopifychange + log), title/sizes are their own later stages.
=======================================================================================================================================
*/

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import {
  searchProducts, getProduct, getProductLookups, updateProduct,
  ProductRow, ProductDetail, ProductLookups, ProductEditFields,
} from '@/lib/api';
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

// Editable dropdown for an attribute field. Includes a blank option (clear), and — crucially — folds the CURRENT value into the list
// if it isn't in the lookup (e.g. brand 'Lazy Dogz' exists on products but not in the brand table), so editing never silently drops it.
function EditSelect({
  label, value, options, onChange, mono,
}: { label: string; value: string; options: string[]; onChange: (v: string) => void; mono?: boolean }) {
  const opts = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <div>
      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={'w-full rounded-md border border-slate-300 bg-white px-2 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 ' + (mono ? 'font-mono' : '')}
      >
        <option value="">—</option>
        {opts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// Pull the editable attribute/enum fields out of a loaded product (null -> '' so they bind to <select> cleanly).
function fieldsFromDetail(d: ProductDetail): ProductEditFields {
  return {
    brand: d.brand ?? '', colour: d.colour ?? '', segment: d.segment ?? '',
    season: d.season ?? '', gender: d.gender ?? '', producttype: d.producttype ?? '',
  };
}

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

  // ---- Edit state (edit Stage 1: attribute/enum fields) --------------------------------------------------------------------------
  const [lookups, setLookups] = useState<ProductLookups | null>(null);       // dropdown options (loaded once)
  const [edit, setEdit] = useState<ProductEditFields | null>(null);          // current form values
  const [baseline, setBaseline] = useState<ProductEditFields | null>(null);  // loaded values — for dirty-check + reset
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  // Are there unsaved edits? (compare current form to the loaded baseline)
  const dirty = !!edit && !!baseline && JSON.stringify(edit) !== JSON.stringify(baseline);

  // Load the dropdown option lists once. If this fails (non-auth), the selects still work with each product's current value.
  useEffect(() => {
    (async () => {
      const res = await getProductLookups();
      if (res.success && res.data) setLookups(res.data);
      else if (res.return_code === 'UNAUTHORIZED') logout();
    })();
  }, [logout]);

  // Update one field in the form and clear the "Saved" flash (so it doesn't linger over fresh edits).
  function setField(k: keyof ProductEditFields, v: string) {
    setEdit((prev) => (prev ? { ...prev, [k]: v } : prev));
    setSaveOk(false);
  }

  async function onSave() {
    if (!detail || !edit) return;
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    const res = await updateProduct(detail.groupid, edit);
    if (res.success && res.data) {
      const saved = res.data.saved;
      setBaseline(saved);
      setEdit(saved);
      // Keep every other field of the loaded product; just fold the saved attribute values back in so the panel stays consistent.
      setDetail((prev) => (prev ? { ...prev, ...saved } : prev));
      setSaveOk(true);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setSaveError(res.error || 'Save failed');
    }
    setSaving(false);
  }

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
    // A fresh search invalidates the current selection (and any in-progress edit).
    setSelected(null);
    setDetail(null);
    setDetailError(null);
    setEdit(null);
    setBaseline(null);
    setSaveError(null);
    setSaveOk(false);
    setLastTerm(q);
    setSearched(true);
    setLoading(false);
  }

  async function onSelect(groupid: string) {
    setSelected(groupid);
    setDetail(null);
    setDetailError(null);
    setEdit(null);
    setBaseline(null);
    setSaveError(null);
    setSaveOk(false);
    setDetailLoading(true);
    const res = await getProduct(groupid);
    if (res.success && res.data) {
      setDetail(res.data);
      // Seed the edit form + baseline from the loaded values.
      const f = fieldsFromDetail(res.data);
      setEdit(f);
      setBaseline(f);
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

                {/* Attributes — edit Stage 1: editable dropdowns + SAVE. Width/Material stay read-only (no legacy control yet). */}
                {edit && (
                  <div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <EditSelect label="Brand" value={edit.brand} options={lookups?.brands || []} onChange={(v) => setField('brand', v)} />
                      <EditSelect label="Colour" value={edit.colour} options={lookups?.colours || []} onChange={(v) => setField('colour', v)} />
                      <EditSelect label="Product Type" value={edit.producttype} options={lookups?.productTypes || []} onChange={(v) => setField('producttype', v)} />
                      <EditSelect label="Gender" value={edit.gender} options={lookups?.genders || []} onChange={(v) => setField('gender', v)} />
                      <EditSelect label="Segment" value={edit.segment} options={lookups?.segments || []} onChange={(v) => setField('segment', v)} mono />
                      <EditSelect label="Season" value={edit.season} options={lookups?.seasons || []} onChange={(v) => setField('season', v)} />
                      <Field label="Width" value={detail.width} />
                      <Field label="Material" value={detail.material} />
                    </div>

                    {/* Save bar for the attribute fields. */}
                    <div className="mt-3 flex items-center gap-3">
                      <button
                        onClick={onSave}
                        disabled={!dirty || saving}
                        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                      {dirty && !saving && (
                        <button
                          onClick={() => { setEdit(baseline); setSaveError(null); setSaveOk(false); }}
                          className="text-xs text-slate-500 hover:text-slate-700"
                        >
                          Reset
                        </button>
                      )}
                      {!dirty && !saving && !saveOk && <span className="text-xs text-slate-400">No unsaved changes</span>}
                      {saveOk && !dirty && <span className="text-xs font-medium text-green-600">Saved.</span>}
                      {saveError && <span className="text-xs text-red-600">{saveError}</span>}
                    </div>
                  </div>
                )}

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

                <p className="mt-4 text-xs text-slate-400">Price, title and sizes are read-only here — those arrive in later stages.</p>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
