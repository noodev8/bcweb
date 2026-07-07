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
         gender, segment, season. Title and sizes are editable too (own save endpoints); price stays read-only for now (its own later stage).

         Create: when a search finds nothing, the empty state becomes a "create new product" form (same header fields) that writes the
         basics for a brand-new groupid via POST /product-create, then loads it into the normal edit panel to carry on (sizes, price, …).
=======================================================================================================================================
*/

import { useState, useEffect } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import SizeEditor from '@/components/SizeEditor';
import PriceEditor from '@/components/PriceEditor';
import ImageUploader from '@/components/ImageUploader';
import {
  searchProducts, getProduct, getProductLookups, updateProduct, createProduct,
  ProductRow, ProductDetail, ProductLookups, ProductEditFields,
} from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// Small read-only field: a label above a value styled to look like a (disabled) input. flag() formats the legacy 0/1 values.
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

// Pull the editable header fields out of a loaded product (null -> '' so they bind to inputs cleanly).
function fieldsFromDetail(d: ProductDetail): ProductEditFields {
  return {
    brand: d.brand ?? '', colour: d.colour ?? '', segment: d.segment ?? '',
    season: d.season ?? '', gender: d.gender ?? '', producttype: d.producttype ?? '', title: d.title ?? '',
  };
}

// Generate a Shopify title from the current dropdown values — a port of the legacy PowerBuilder routine. It emits editable
// placeholders (<Any detail>, <Narrow/Regular> Fit) for the user to fill in. groupid/segment/season are intentionally NOT used.
// Rules: Birkenstock has no gender but gets the "<Narrow/Regular> Fit" width reminder; non-Birkenstock prepends the gender unless
// Unisex; product type "<Other>" drops the type from the title. Output is whitespace-normalised to single spaces (the legacy code
// had a double space in one branch, and empty fields could otherwise leave stray spaces).
function generateTitle(f: ProductEditFields): string {
  const { brand, colour, producttype, gender } = f;
  const isOther = producttype.toUpperCase() === '<OTHER>';
  const isBirk = brand.toUpperCase() === 'BIRKENSTOCK';
  const isUnisex = gender.toUpperCase() === 'UNISEX';

  let raw: string;
  if (isOther) {
    if (isBirk) raw = `${brand} <Any detail> ${colour} <Narrow/Regular> Fit`;
    else if (isUnisex) raw = `${brand} <Any detail> ${colour}`;
    else raw = `${gender} ${brand} <Any detail> ${colour}`;
  } else if (isBirk) {
    raw = `${brand} <Any detail> ${producttype} ${colour} <Narrow/Regular> Fit`;
  } else if (isUnisex) {
    raw = `${brand} <Any detail> ${producttype} ${colour}`;
  } else {
    raw = `${gender} ${brand} <Any detail> ${producttype} ${colour}`;
  }
  return raw.replace(/\s+/g, ' ').trim();
}

// A blank set of editable header fields — the starting point for a brand-new product.
const emptyFields: ProductEditFields = {
  brand: '', colour: '', segment: '', season: '', gender: '', producttype: '', title: '',
};

// Sensible gender/season defaults per product type, applied when the user picks a Product Type on a NEW product (the common case is
// Womens, and the season tracks the footwear type). Only these types have a default; anything else leaves gender/season untouched.
const PRODUCT_TYPE_DEFAULTS: Record<string, { gender: string; season: string }> = {
  Sandals: { gender: 'Womens', season: 'Summer' },
  Boots: { gender: 'Womens', season: 'Winter' },
  Shoes: { gender: 'Womens', season: 'Any' },
};

// Create-a-new-product form. Shown in place of the "no match" dead-end: the searched term seeds the Group ID (editable, upper-cased),
// and the same header dropdowns + title/Generate as the edit panel let the user fill the basics. On success it hands the new groupid
// back to the page, which loads it into the normal edit panel to carry on (sizes, price, …). Price/sizes are deliberately NOT here —
// this writes only the header basics (POST /product-create). onUnauthorized bubbles an expired session up to the page's logout.
function NewProductForm({
  initialGroupid, lookups, onCreated, onUnauthorized,
}: {
  initialGroupid: string;
  lookups: ProductLookups | null;
  onCreated: (groupid: string, title: string) => void;
  onUnauthorized: () => void;
}) {
  const [groupid, setGroupid] = useState(initialGroupid.toUpperCase());
  const [fields, setFields] = useState<ProductEditFields>({ ...emptyFields });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Live "does this Group ID already exist?" check. The field is editable (the search term may be a fragment/typo), so we guard
  // against pointing a NEW product at an existing key: create is an INSERT and the server rejects a clash, but we check here too so
  // the user finds out immediately (Create is blocked) instead of after clicking.
  const [exists, setExists] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const gid = groupid.trim().toUpperCase();
    if (!gid) { setExists(false); setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    // Debounce so we don't hit the API on every keystroke. getProduct succeeds iff the groupid exists.
    const t = setTimeout(async () => {
      const res = await getProduct(gid);
      if (cancelled) return;
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setExists(res.success);
      setChecking(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [groupid, onUnauthorized]);

  const set = (k: keyof ProductEditFields, v: string) => { setFields((p) => ({ ...p, [k]: v })); setError(null); };

  // Picking a Product Type also seeds the gender/season defaults for that type (Womens + a season that fits the footwear).
  const setProductType = (v: string) => {
    const d = PRODUCT_TYPE_DEFAULTS[v];
    setFields((p) => (d ? { ...p, producttype: v, gender: d.gender, season: d.season } : { ...p, producttype: v }));
    setError(null);
  };

  async function onCreate() {
    const gid = groupid.trim().toUpperCase();
    if (!gid) { setError('Group ID is required'); return; }
    if (exists) { setError('That Group ID already exists — use Search to edit it'); return; }
    if (/[<>]/.test(fields.title)) { setError('Title still has <…> placeholders — fill them in before saving'); return; }
    setCreating(true);
    setError(null);
    const res = await createProduct(gid, fields);
    if (res.success && res.data) {
      onCreated(res.data.groupid, fields.title);
      return; // page swaps this form out for the loaded product
    }
    if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
    setError(res.error || 'Create failed');
    setCreating(false);
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 border-b border-slate-100 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">Create a new product</h2>
        <p className="mt-1 text-xs text-slate-400">
          No product matched your search — fill in the basics to add a new one. Sizes and price come after, once it&apos;s created.
        </p>
      </div>

      {/* Group ID — pre-filled from the search term, still editable (it becomes the product key, upper-cased). */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Group ID</label>
        <input
          value={groupid}
          onChange={(e) => { setGroupid(e.target.value.toUpperCase()); setError(null); }}
          placeholder="e.g. 0128999-NEWSTYLE"
          className={'w-full rounded-md border px-3 py-2 font-mono text-sm uppercase text-slate-800 focus:outline-none focus:ring-1 ' +
            (exists ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500')}
        />
        {exists && (
          <p className="mt-1 text-xs text-red-600">This Group ID already exists — use Search to edit it (a new product can&apos;t reuse a key).</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <EditSelect label="Brand" value={fields.brand} options={lookups?.brands || []} onChange={(v) => set('brand', v)} />
        <EditSelect label="Colour" value={fields.colour} options={lookups?.colours || []} onChange={(v) => set('colour', v)} />
        <EditSelect label="Product Type" value={fields.producttype} options={lookups?.productTypes || []} onChange={setProductType} />
        <EditSelect label="Gender" value={fields.gender} options={lookups?.genders || []} onChange={(v) => set('gender', v)} />
        <EditSelect label="Segment" value={fields.segment} options={lookups?.segments || []} onChange={(v) => set('segment', v)} mono />
        <EditSelect label="Season" value={fields.season} options={lookups?.seasons || []} onChange={(v) => set('season', v)} />
      </div>

      {/* Title + Generate — comes AFTER the fields, since Generate builds the title from them. */}
      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Title</label>
        <div className="flex gap-2">
          <input
            value={fields.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Product title"
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={() => set('title', generateTitle(fields))}
            title="Generate from Brand / Product Type / Colour / Gender"
            className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Generate
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={onCreate}
          disabled={creating || checking || exists || !groupid.trim()}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {creating ? 'Creating…' : 'Create product'}
        </button>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
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

  // Fill the title from the current brand/colour/product-type/gender selections (the legacy "generate" button).
  function onGenerateTitle() {
    setEdit((prev) => (prev ? { ...prev, title: generateTitle(prev) } : prev));
    setSaveOk(false);
  }

  async function onSave() {
    if (!detail || !edit) return;
    if (/[<>]/.test(edit.title)) { setSaveError('Title still has <…> placeholders — fill them in before saving'); return; }
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

    // Convenience: if the search pinned down exactly one product, load it straight away (skip the extra click).
    if (res.success && res.data && res.data.results.length === 1) {
      onSelect(res.data.results[0].groupid);
    }
  }

  // A new product was just created: drop it into the (now single-row) results list and load it into the detail panel so the user
  // carries straight on with the normal edit flow (sizes, price, …). The product now exists, so getProduct in onSelect will find it.
  async function onCreated(groupid: string, title: string) {
    setResults([{ groupid, title: title || null }]);
    setLimited(false);
    setError(null);
    await onSelect(groupid);
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

      {/* No match -> the cue to create a new product: the empty state IS the create form, seeded with the searched Group ID. */}
      {searched && !loading && !error && results.length === 0 && (
        <NewProductForm
          key={lastTerm}
          initialGroupid={lastTerm}
          lookups={lookups}
          onCreated={onCreated}
          onUnauthorized={logout}
        />
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
                    <div className="mt-1 truncate font-mono text-[11px] text-slate-400" title={detail.imagename || undefined}>
                      {detail.imagename || 'No image name'}
                    </div>
                  </div>
                  {/* Main image + upload/replace. Uses the on-screen title (edit form) to seed the SEO filename server-side. */}
                  <ImageUploader
                    key={detail.groupid}
                    groupid={detail.groupid}
                    imagename={detail.imagename}
                    title={edit?.title ?? detail.title ?? ''}
                    onUploaded={(imagename) => setDetail((prev) => (prev ? { ...prev, imagename } : prev))}
                  />
                </div>

                {/* Editable header fields + SAVE. Width/Material stay read-only (no legacy control yet). */}
                {edit && (
                  <div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      <EditSelect label="Brand" value={edit.brand} options={lookups?.brands || []} onChange={(v) => setField('brand', v)} />
                      <EditSelect label="Colour" value={edit.colour} options={lookups?.colours || []} onChange={(v) => setField('colour', v)} />
                      <EditSelect label="Product Type" value={edit.producttype} options={lookups?.productTypes || []} onChange={(v) => setField('producttype', v)} />
                      <EditSelect label="Gender" value={edit.gender} options={lookups?.genders || []} onChange={(v) => setField('gender', v)} />
                      <EditSelect label="Segment" value={edit.segment} options={lookups?.segments || []} onChange={(v) => setField('segment', v)} mono />
                      <EditSelect label="Season" value={edit.season} options={lookups?.seasons || []} onChange={(v) => setField('season', v)} />
                    </div>

                    {/* Shopify Title — comes AFTER the fields, since Generate builds the title from them. */}
                    <div className="mt-3">
                      <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">Title</label>
                      <div className="flex gap-2">
                        <input
                          value={edit.title}
                          onChange={(e) => setField('title', e.target.value)}
                          placeholder="Product title"
                          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        <button
                          type="button"
                          onClick={onGenerateTitle}
                          title="Generate from Brand / Product Type / Colour / Gender"
                          className="shrink-0 rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Generate
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">After generating, replace the &lt;…&gt; placeholders (detail, and Narrow/Regular fit for Birkenstock).</p>
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

                {/* Price (skusummary) — editable: Cost / RRP / Shopify Price / Tax. Shopify on/off flag stays read-only (own control). */}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <PriceEditor
                    key={detail.groupid}
                    groupid={detail.groupid}
                    cost={detail.cost}
                    rrp={detail.rrp}
                    price={detail.price}
                    tax={detail.tax}
                    onSaved={(s) => setDetail((prev) => (prev ? { ...prev, cost: s.cost, rrp: s.rrp, price: s.price, tax: s.tax } : prev))}
                  />
                  <div className="mt-3">
                    <Field label="Shopify" value={flag(detail.shopify)} />
                  </div>
                </div>

                {/* Sizes (skumap) — editable: barcode + size display, with add / remove / reorder. */}
                <div className="mt-4 border-t border-slate-100 pt-4">
                  {/* brand/gender feed the "Generate sizes" template — use the live edit selections so it reflects the current choice. */}
                  <SizeEditor
                    key={detail.groupid}
                    groupid={detail.groupid}
                    sizes={detail.sizes}
                    brand={edit?.brand ?? detail.brand ?? ''}
                    gender={edit?.gender ?? detail.gender ?? ''}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
