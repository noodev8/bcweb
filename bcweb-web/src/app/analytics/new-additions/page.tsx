'use client';
/*
=======================================================================================================================================
Page: /analytics/new-additions  (Analytics module — New Additions)
=======================================================================================================================================
Purpose: The catalogue-GROWTH pulse. How many Shopify styles were ADDED in the recent window (default: last 30 days), and how each new
         addition is doing — units sold, revenue and profit so far (lifetime ≈ since-add, as these are brand-new products). Loading it
         now and again tells the owner whether the month brought a lot of new product or a little, and whether the new lines sell.

         HERO number = count of new styles in the window (the thing being monitored). A small window toggle (30 / 60 / 90 days) lets the
         lens widen. Below, a table of the additions themselves, newest-created first.

Guarded by AppShell. Consumes GET /analytics-new-additions.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useProductActions } from '@/components/ProductActions';
import { useAuth } from '@/contexts/AuthContext';
import {
  getNewAdditions,
  NewAdditionRow,
  getScratchpad,
  addScratchpadNote,
  deleteScratchpadNote,
  ScratchpadNote,
} from '@/lib/api';

const DAYS = 30; // fixed window (owner decision — no lens toggle)

export default function NewAdditionsPage() {
  const { logout } = useAuth();
  const actions = useProductActions(); // row click -> cross-module "reprice this" chooser (Shopify / Amazon / copy)
  const [rows, setRows] = useState<NewAdditionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'added' | 'sold' | 'stock'>('added'); // which column the list is sorted by
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');            // direction; default desc (newest / most first)

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getNewAdditions(DAYS);
    if (res.success && res.data) {
      setRows(res.data.rows);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load New Additions');
    }
    setLoading(false);
  }, [logout]);

  useEffect(() => { load(); }, [load]);

  // Totals across the additions — a quick read of how much the new lines have contributed.
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  // All sorting is client-side on the already-loaded rows (no re-fetch). Compare on the active column, then flip for direction; ties
  // fall back to newest-added so the order is stable.
  const sortedRows = useMemo(() => {
    const cmp = (a: NewAdditionRow, b: NewAdditionRow) => {
      let c: number;
      if (sortBy === 'sold') c = a.units - b.units;
      else if (sortBy === 'stock') c = a.stock - b.stock;
      else c = (a.created || '').localeCompare(b.created || '');
      if (c === 0 && sortBy !== 'added') c = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? c : -c;
    };
    return [...rows].sort(cmp);
  }, [rows, sortBy, sortDir]);

  // Click a sortable header: same column flips direction; a new column switches to it, defaulting to descending (most / newest first).
  const toggleSort = (key: 'added' | 'sold' | 'stock') => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const caret = (key: 'added' | 'sold' | 'stock') =>
    sortBy === key ? <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  // Discounted = current live price sits below RRP (both must be readable numbers). Drives the amber highlight on the Price cell.
  const isDiscounted = (r: NewAdditionRow) => r.price !== null && r.rrp !== null && r.price < r.rrp;
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };
  // Whole days between the creation date and today — how long the line has been live.
  const daysLive = (d: string | null) => {
    if (!d) return null;
    const ms = Date.now() - new Date(d).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };
  return (
    <AppShell title="New Additions" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        Styles <strong>added in the last {DAYS} days</strong>, newest first — and how each new line has sold so far (all channels). A quick
        read on whether the month brought a lot of new product or a little.
      </p>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* HERO — how many new styles this window. Supporting sales totals demoted beside it. */}
          <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">New styles</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{rows.length}</span>
              </div>
            </div>
            <div className="flex gap-8 border-l border-slate-200 pl-8 text-sm">
              <Stat label="Units sold" value={String(totalUnits)} />
              <Stat label="Revenue" value={money(totalRevenue)} />
              <Stat label="Profit" value={money(totalProfit)} />
            </div>
          </div>

          {rows.length === 0 ? (
            <p className="text-sm text-slate-400">No styles were added in the last {DAYS} days.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-4 py-2.5 font-medium">
                      <button
                        onClick={() => toggleSort('added')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'added' ? 'text-slate-800' : ''}`}
                        title="Sort by date added"
                      >
                        Added {caret('added')}
                      </button>
                    </th>
                    <th className="px-4 py-2.5 font-medium">Product</th>
                    <th className="px-3 py-2.5 text-right font-medium">RRP</th>
                    <th className="px-3 py-2.5 text-right font-medium">Price</th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('sold')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'sold' ? 'text-slate-800' : ''}`}
                        title="Sort by units sold"
                      >
                        {caret('sold')} Sold
                      </button>
                    </th>
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('stock')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'stock' ? 'text-slate-800' : ''}`}
                        title="Sort by stock"
                      >
                        {caret('stock')} Stock
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.groupid}
                      onClick={(e) => actions.open(e, r.groupid, { title: r.title })}
                      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
                      title="Click to reprice or copy"
                    >
                      <td className="px-4 py-2 whitespace-nowrap text-slate-500">
                        {fmtDate(r.created)}
                        {daysLive(r.created) !== null && (
                          <span className="ml-2 text-xs text-slate-400">{daysLive(r.created)}d</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <div className="font-mono text-sm tracking-tight text-slate-900">{r.groupid}</div>
                        <div className="text-xs text-slate-400">{r.title || 'Untitled'}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.rrp)}</td>
                      <td
                        className={`px-3 py-2 text-right tabular-nums ${
                          isDiscounted(r) ? 'font-medium text-amber-600' : 'text-slate-700'
                        }`}
                        title={isDiscounted(r) ? 'Below RRP — discounted' : undefined}
                      >
                        {money(r.price)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.units}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{r.stock}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <Scratchpad onUnauthorized={logout} />
      {actions.node}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// Scratchpad — a free-form shared notepad for research-mode product notes. Loads independently of the New Additions report above (its
// own fetch/state), so a slow report never blocks jotting. Add + delete only (no edit): to change a note, delete and re-add.
// -------------------------------------------------------------------------------------------------------------------------------------
function Scratchpad({ onUnauthorized }: { onUnauthorized: () => void }) {
  const [notes, setNotes] = useState<ScratchpadNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null); // note just copied (brief "Copied" flash)

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getScratchpad();
    if (res.success && res.data) {
      setNotes(res.data);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setError(res.error || 'Failed to load scratchpad');
    }
    setLoading(false);
  }, [onUnauthorized]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setError(null);
    const res = await addScratchpadNote(body);
    if (res.success && res.data) {
      setNotes((n) => [res.data as ScratchpadNote, ...n]);
      setDraft('');
    } else {
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setError(res.error || 'Failed to save note');
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    // Optimistic — drop it immediately; restore on failure.
    const prev = notes;
    setNotes((n) => n.filter((x) => x.id !== id));
    const res = await deleteScratchpadNote(id);
    if (!res.success) {
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setNotes(prev);
      setError(res.error || 'Failed to delete note');
    }
  };

  // Copy a note's text to the clipboard (paste into a new note to tweak, or anywhere else). Brief "Copied" flash on that card.
  const copy = async (note: ScratchpadNote) => {
    try {
      await navigator.clipboard.writeText(note.body);
      setCopiedId(note.id);
      setTimeout(() => setCopiedId((c) => (c === note.id ? null : c)), 1200);
    } catch {
      /* clipboard unavailable — no-op */
    }
  };

  // Ctrl/Cmd+Enter to add — keeps a jotting flow fast without stealing the plain Enter (notes are often multi-line).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); add(); }
  };

  const fmtWhen = (iso: string | null) => {
    if (!iso) return '';
    const dt = new Date(iso);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}, ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };

  return (
    <section className="mt-10">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Scratchpad</h2>
      <p className="mt-1 mb-4 max-w-3xl text-sm text-slate-500">
        Loose notes for products you might order — jot them while researching, refer back when the stock arrives and you&apos;re setting
        it up. Shared with the team. No rules.
      </p>

      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && notes.length === 0 && (
        <p className="mb-4 text-sm text-slate-400">No notes yet — add the first one below.</p>
      )}

      {notes.length > 0 && (
        <ul className="mb-4 space-y-2">
          {notes.map((n) => (
            <li
              key={n.id}
              className="group flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
            >
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{n.body}</p>
                <p className="mt-1.5 text-xs text-slate-400">
                  {n.created_by || 'Someone'}
                  {n.created_at && <> · {fmtWhen(n.created_at)}</>}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  onClick={() => copy(n)}
                  title="Copy note text"
                  aria-label="Copy note text"
                  className="inline-flex items-center justify-center rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
                >
                  {copiedId === n.id ? <CheckIcon className="h-4 w-4 text-green-600" /> : <ClipboardDocumentIcon className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => remove(n.id)}
                  title="Delete note"
                  aria-label="Delete note"
                  className="rounded-md px-2 py-1 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Composer — set apart from the list by a divider + label + tinted well, so it reads as the input zone, not another saved note. */}
      <div className="mt-8 border-t border-slate-200 pt-6">
        <label htmlFor="scratch-new" className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-400">
          Add a note
        </label>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <textarea
            id="scratch-new"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder="e.g. Arizona Taupe suede — check EU availability, ~£55 landed? Ask supplier re: 36–42 run."
            className="w-full resize-y rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-400">Ctrl/⌘ + Enter to add</span>
            <button
              onClick={add}
              disabled={!draft.trim() || saving}
              className="rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Adding…' : 'Add note'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-700">{value}</div>
    </div>
  );
}
