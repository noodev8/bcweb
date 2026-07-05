'use client';
/*
=======================================================================================================================================
Component: SizeEditor
=======================================================================================================================================
Purpose: Editable size list for a product (skumap). Barcode and Size Display are editable inline; Code is locked (derived groupid-<size>).
         Supports Add (type an EU size), Remove, and manual re-order (Up/Down). Saves the FULL list in order via POST /product-sizes,
         which reconciles skumap (renumber optionsize by position, update existing by code, insert new, hard-delete removed).

         Self-contained: manages its own edit state and save. Mount with key={groupid} so it resets cleanly when the product changes.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ChevronUpIcon, ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { updateProductSizes, ProductSize } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface Row { code: string; sizeDisplay: string; barcode: string; }

// Map API sizes (barcode may be null) into editable rows (barcode as '').
function toRows(sizes: ProductSize[]): Row[] {
  return sizes.map((s) => ({ code: s.code, sizeDisplay: s.sizeDisplay || '', barcode: s.barcode || '' }));
}
// Stable key of the meaningful content, for dirty-checking (order matters).
const rowsKey = (rows: Row[]) => JSON.stringify(rows.map((r) => [r.code, r.sizeDisplay, r.barcode]));

export default function SizeEditor({ groupid, sizes }: { groupid: string; sizes: ProductSize[] }) {
  const { logout } = useAuth();
  const [rows, setRows] = useState<Row[]>(() => toRows(sizes));
  const [baseline, setBaseline] = useState<string>(() => rowsKey(toRows(sizes)));
  const [newSize, setNewSize] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const dirty = rowsKey(rows) !== baseline;

  function touch() { setSaveOk(false); }

  function setCell(i: number, key: 'sizeDisplay' | 'barcode', v: string) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
    touch();
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
    // Seed Size Display with the typed size; the user can expand it (e.g. "42 EU / 8 UK"). Barcode starts blank.
    setRows((prev) => [...prev, { code, sizeDisplay: size, barcode: '' }]);
    setNewSize('');
    touch();
  }

  async function onSave() {
    setSaving(true);
    setSaveError(null);
    setSaveOk(false);
    const res = await updateProductSizes(groupid, rows.map((r) => ({ code: r.code, sizeDisplay: r.sizeDisplay, barcode: r.barcode })));
    if (res.success && res.data) {
      const saved = toRows(res.data.sizes);
      setRows(saved);
      setBaseline(rowsKey(saved));
      setSaveOk(true);
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
              <th className="px-3 py-2 text-right font-medium">Order</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-3 text-slate-400">No sizes — add one below.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={r.code} className="align-middle">
                <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{r.code}</td>
                <td className="px-3 py-1.5">
                  <input value={r.barcode} onChange={(e) => setCell(i, 'barcode', e.target.value)} placeholder="—" className={inputCls} />
                </td>
                <td className="px-3 py-1.5">
                  <input value={r.sizeDisplay} onChange={(e) => setCell(i, 'sizeDisplay', e.target.value)} placeholder="e.g. 42 EU / 8 UK" className={inputCls} />
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

      {/* Add a new size: type the EU size (e.g. 42) -> code becomes groupid-42. */}
      <div className="mt-2 flex items-center gap-2">
        <input
          value={newSize}
          onChange={(e) => { setNewSize(e.target.value); setAddError(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } }}
          placeholder="Add size (e.g. 42)"
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
          <button onClick={() => { setRows(toRows(sizes)); setBaseline(rowsKey(toRows(sizes))); setSaveError(null); setSaveOk(false); setAddError(null); }} className="text-xs text-slate-500 hover:text-slate-700">
            Reset
          </button>
        )}
        {!dirty && !saving && !saveOk && <span className="text-xs text-slate-400">No unsaved changes</span>}
        {saveOk && !dirty && <span className="text-xs font-medium text-green-600">Saved.</span>}
        {saveError && <span className="text-xs text-red-600">{saveError}</span>}
      </div>
    </div>
  );
}
