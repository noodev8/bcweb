'use client';
/*
=======================================================================================================================================
Component: SizeEditor
=======================================================================================================================================
Purpose: Editable size list for a product (skumap). Barcode and Size Display are editable inline; Code is locked (derived groupid-<size>).
         Supports Add (type the size code, in the brand's own convention — not necessarily EU), Remove, and manual re-order (Up/Down).
         Saves the FULL list in order via POST /product-sizes,
         which reconciles skumap (renumber optionsize by position, update existing by code, insert new, hard-delete removed).

         Self-contained: manages its own edit state and save. Mount with key={groupid} so it resets cleanly when the product changes.
=======================================================================================================================================
*/

import { useState, useRef } from 'react';
import { ChevronUpIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { updateProductSizes, ProductSize, ShopifyPushResult } from '@/lib/api';
import { sizeTemplate, lookupTemplateSize } from '@/lib/sizeTemplates';
import { useAuth } from '@/contexts/AuthContext';
import ShopifyPushNote from '@/components/ShopifyPushNote';

interface Row { code: string; sizeDisplay: string; barcode: string; uksize: string; }

// Map API sizes (nulls -> '') into editable rows.
function toRows(sizes: ProductSize[]): Row[] {
  return sizes.map((s) => ({ code: s.code, sizeDisplay: s.sizeDisplay || '', barcode: s.barcode || '', uksize: s.uksize || '' }));
}
// The standard run for this brand+gender as editable rows (code = groupid-<suffix>, uksize from the template, barcode blank).
function templateRows(groupid: string, brand?: string, gender?: string): Row[] {
  return sizeTemplate(brand || '', gender || '').map((t) => ({
    code: `${groupid}-${t.codeSuffix}`, sizeDisplay: t.size, uksize: t.uksize, barcode: '',
  }));
}
// Stable key of the meaningful content, for dirty-checking (order matters).
const rowsKey = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.code, r.sizeDisplay, r.barcode, r.uksize]));

export default function SizeEditor({ groupid, sizes, brand, gender, onSaved }: { groupid: string; sizes: ProductSize[]; brand?: string; gender?: string; onSaved?: (sizes: ProductSize[]) => void }) {
  const { logout } = useAuth();
  // Auto-fill: a product with NO sizes (e.g. just created) starts pre-populated with the brand/gender template so there's one less
  // step — the user reviews/tweaks and Saves. A product that already has sizes loads them as-is. Baseline stays the LOADED state
  // (empty for a new product), so an auto-filled grid shows as unsaved until the user saves it.
  const [rows, setRows] = useState<Row[]>(() => (sizes.length > 0 ? toRows(sizes) : templateRows(groupid, brand, gender)));
  const [baseline, setBaseline] = useState<string>(() => rowsKey(toRows(sizes)));
  const [newSize, setNewSize] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);
  const [push, setPush] = useState<ShopifyPushResult | null>(null);   // Shopify re-push outcome, when the product is live

  // Barcode auto-advance: refs to each barcode <input> (by row index) so a completed scan/type can jump focus to the next row.
  // `advanced` remembers rows we've already jumped from so going BACK to fix a barcode doesn't yank focus away on every keystroke;
  // a row only re-arms once its barcode is fully CLEARED (owner's rule — not merely dropped below 13). We do NOT select the next
  // field's contents on focus, so an accidental double-scan won't silently overwrite an existing barcode.
  const barcodeRefs = useRef<(HTMLInputElement | null)[]>([]);
  const advanced = useRef<Record<number, boolean>>({});
  // Index of the row we just auto-jumped focus INTO (from a 13-digit onChange advance), so we can swallow the scanner's
  // trailing Enter/CR keystroke — it lands on the newly-focused field (not the one just completed) and would otherwise
  // cause a second advance, skipping a row. Cleared as soon as that row sees real input.
  const justAdvancedTo = useRef<number | null>(null);

  const dirty = rowsKey(rows) !== baseline;

  function touch() { setSaveOk(false); setPush(null); }

  function setCell(i: number, key: 'sizeDisplay' | 'barcode' | 'uksize', v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
    touch();
  }
  // Barcode field: store the digits (parent input already strips non-digits) and, once a full 13-digit barcode is present, jump
  // focus down to the next barcode field ONCE. Longer/shorter barcodes are never blocked — 13 just triggers the convenience jump
  // (a future non-Birkenstock brand with a different length still types freely). The last row keeps focus (nothing below to jump to).
  // Owner's rule: only advance into a BLANK next field — if the next row already carries a barcode, hold focus so a scan can't
  // overwrite or skip past an already-populated size (re-scanning a partly-filled run stays put on each completed cell).
  function onBarcodeChange(i: number, raw: string) {
    if (justAdvancedTo.current === i) justAdvancedTo.current = null;   // real input into the jumped-to row — no longer expecting its stray Enter
    const digits = raw.replace(/\D/g, '');
    setCell(i, 'barcode', digits);
    if (digits.length >= 13 && !advanced.current[i] && i < rows.length - 1 && !rows[i + 1].barcode) {
      advanced.current[i] = true;
      justAdvancedTo.current = i + 1;
      barcodeRefs.current[i + 1]?.focus();
    }
    if (digits.length === 0) advanced.current[i] = false;   // re-arm only when the field is fully cleared
  }
  // Manual/scanner escape hatch: Enter (or a scanner's carriage return, if it sends one) advances too. Harmless if it doesn't.
  // But a scanner that sends digits-then-Enter fires that Enter AFTER the 13-digit onChange has already jumped focus to the
  // next row, so the keydown lands there, not on the row that just completed — swallow it once rather than double-advancing.
  function onBarcodeKeyDown(i: number, e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (justAdvancedTo.current === i) { justAdvancedTo.current = null; return; }
      if (i < rows.length - 1 && !rows[i + 1].barcode) barcodeRefs.current[i + 1]?.focus();
    }
  }
  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    setRows((prev) => {
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    touch();
  }
  function removeRow(i: number) {
    setRows((prev) => prev.filter((_, idx) => idx !== i));
    touch();
  }
  function addRow() {
    const size = newSize.trim();
    setAddError(null);
    if (!size) return;
    if (/\s/.test(size)) { setAddError('Size cannot contain spaces'); return; }
    const code = `${groupid}-${size}`;
    if (rows.some((r) => r.code === code)) { setAddError(`Size ${size} already exists`); return; }
    // If the typed size is part of this brand/gender's standard run, borrow its full display + UK size (brand-accurate EU→UK), so a
    // manual add matches the auto-fill. Otherwise fall back to the typed size with a blank UK size for the user to fill. Barcode blank.
    const tpl = lookupTemplateSize(brand || '', gender || '', size);
    setRows((prev) => [...prev, { code, sizeDisplay: tpl ? tpl.size : size, barcode: '', uksize: tpl ? tpl.uksize : '' }]);
    setNewSize('');
    touch();
  }

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    setPush(null);
    const res = await updateProductSizes(groupid, rows.map((r) => ({ code: r.code, sizeDisplay: r.sizeDisplay, barcode: r.barcode, uksize: r.uksize })));
    if (res.success && res.data) {
      const saved = toRows(res.data.sizes);
      setRows(saved);
      setBaseline(rowsKey(saved));
      setSaveOk(true);
      setPush(res.data.shopify ?? null);
      // Report the saved list up so the parent's detail.sizes is current — the Shopify toggle reads sizesCount from it, so without
      // this a freshly-created product (loaded with no sizes) would still refuse "Turn on" after you saved a size list.
      onSaved?.(res.data.sizes);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setSaveError(res.error || 'Failed to save sizes');
    }
    setSaving(false);
  }

  const inputCls = 'w-full rounded border border-slate-300 px-2 py-1 font-mono text-xs text-slate-800 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500';
  const iconBtn = 'rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30';

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Sizes</h3>
        <span className="text-xs text-slate-400">{rows.length} variant{rows.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-hidden rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Barcode</th>
              <th className="px-3 py-2 font-medium">Size Display</th>
              <th className="px-3 py-2 font-medium">UK Size</th>
              <th className="px-3 py-2 text-right font-medium">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-3 text-slate-400">No sizes — add one below.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.code} className="align-middle">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="px-3 py-1.5">
                  {/* Barcode is a numeric EAN — strip any non-digit as the user types. A full 13-digit entry auto-advances to the
                      next barcode field (see onBarcodeChange); Enter does the same. */}
                  <input ref={(el) => { barcodeRefs.current[i] = el; }} value={r.barcode} onChange={(e) => onBarcodeChange(i, e.target.value)} onKeyDown={(e) => onBarcodeKeyDown(i, e)} inputMode="numeric" placeholder="—" className={inputCls} />
                </td>
                <td className="px-3 py-1.5">
                  {/* This is the customer-facing DISPLAY SIZE, shown verbatim on the public site and across the internal screens.
                      Match the brand's own convention — "42 EU / 8 UK" for an EU-sized brand, just "8 UK" for a UK-sized one — rather
                      than forcing EU onto a brand that isn't sized that way. */}
                  <input value={r.sizeDisplay} onChange={(e) => setCell(i, 'sizeDisplay', e.target.value)} placeholder="e.g. 42 EU / 8 UK  ·  or  5 UK" className={inputCls} />
                </td>
                <td className="px-3 py-1.5">
                  {/* UK size feeds the Google Merchant feed (size / size_system=UK). Keep the " UK" suffix (e.g. "4 UK"); the feed strips it. */}
                  <input value={r.uksize} onChange={(e) => setCell(i, 'uksize', e.target.value)} placeholder="e.g. 8 UK" className={inputCls} />
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className={iconBtn} title="Move up"><ChevronUpIcon className="h-4 w-4" /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} className={iconBtn} title="Move down"><ChevronDownIcon className="h-4 w-4" /></button>
                    <button type="button" onClick={() => removeRow(i)} className={iconBtn + ' hover:text-red-600'} title="Remove"><XMarkIcon className="h-4 w-4" /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Add a new size: type the size CODE — the tail that becomes groupid-<code> and is read back as RIGHT(code,2). It follows the
          brand's coding, not a fixed system: "42" for an EU-sized brand, "08" for a UK-sized one. NOT the customer-facing label (that
          is the Display Size column); this is the internal key. If it matches the brand/gender template, the display + UK size auto-fill. */}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={newSize}
          onChange={(e) => { setNewSize(e.target.value); setAddError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } }}
          placeholder="Add size code (e.g. 42)"
          className="w-40 rounded-md border border-slate-300 px-3 py-1.5 font-mono text-xs focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        />
        <button type="button" onClick={addRow} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50">
          Add
        </button>
        {addError && <span className="text-xs text-red-600">{addError}</span>}
      </div>

      {/* Save bar. */}
      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={onSave}
          disabled={!dirty || saving}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {saving ? 'Saving…' : 'Save sizes'}
        </button>
        {dirty && !saving && (
          <button onClick={() => { setRows(toRows(sizes)); setBaseline(rowsKey(toRows(sizes))); setSaveError(null); setSaveOk(false); setPush(null); setAddError(null); }} className="text-xs text-slate-500 hover:text-slate-700">
            Reset
          </button>
        )}
        {!dirty && !saving && !saveOk && <span className="text-xs text-slate-400">No unsaved changes</span>}
        {saveOk && !dirty && <span className="text-xs font-medium text-green-600">Saved.</span>}
        {saveOk && !dirty && <ShopifyPushNote result={push} />}
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      </div>
    </div>
  );
}
