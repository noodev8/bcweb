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

import { useMemo, useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useProductActions } from '@/components/ProductActions';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getNewAdditions,
  NewAdditionRow,
  getScratchpad,
  addScratchpadNote,
  deleteScratchpadNote,
  ScratchpadNote,
} from '@/lib/api';

// Fixed 30-day window, no lens toggle (owner decision, re-confirmed 2026-07-27 after a brief try at 60). The month is the unit the
// owner thinks in, so the screen shows a month — full stop. Yes, ticking the 21+ filter then leaves only a ~9-day slice; that is
// accepted (a heavy intake month fills it anyway, and unticking always shows the whole 30 days).
const DAYS = 30;
// "Settled in" threshold for the table filter: a line live this long has had a fair chance to sell. 14, not 21 (owner 2026-07-27) —
// inside a 30-day window, 21 left too thin a slice to be a useful list; a fortnight is enough of a chance to judge one.
const MATURE_DAYS = 14;

// Stable identities for "nothing loaded yet". A fresh [] each render would change the identity of everything derived from it
// (the sortedRows useMemo below), defeating the memo.
type SortKey = 'added' | 'sold' | 'profit' | 'stock';

const NO_ROWS: NewAdditionRow[] = [];
const NO_NOTES: ScratchpadNote[] = [];

export default function NewAdditionsPage() {
  const { logout } = useAuth();
  const actions = useProductActions(); // row click -> cross-module "reprice this" chooser (Shopify / Amazon / copy)
  const [sortBy, setSortBy] = useState<SortKey>('added');                    // which column the list is sorted by
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');            // direction; default desc (newest / most first)
  const [matureOnly, setMatureOnly] = useState(false);                       // hide lines too new to judge (see MATURE_DAYS)
  const [showAbout, setShowAbout] = useState(false);                         // the "what is this screen" blurb — off by default

  // "Now" is captured HERE, inside the fetcher, not during render. Date.now() is impure, so reading it while rendering makes the
  // output depend on when React happens to re-render (react-hooks/purity). Capturing it alongside the rows also reads better: the
  // ages shown are "as at the time we loaded the list", which is what the numbers next to each row actually mean.
  const { data, error: loadError, busy: loading } = useApiQuery(
    ['new-additions', DAYS],
    async () => {
      const res = await getNewAdditions(DAYS);
      if (res.success && res.data) {
        return { success: true, data: { rows: res.data.rows, loadedAt: Date.now() }, return_code: 'SUCCESS' };
      }
      return { success: false, error: res.error || 'Failed to load New Additions', return_code: res.return_code };
    },
  );
  const rows: NewAdditionRow[] = data?.rows ?? NO_ROWS;
  const loadedAt = data?.loadedAt ?? null;
  const error = loadError?.message ?? null;

  // Whole days between the creation date and when the list was loaded — how long the line has been live. Uses the `loadedAt`
  // snapshot rather than Date.now() so this stays a pure function of state (see the note on loadedAt above).
  const daysLive = (d: string | null) => {
    if (!d || loadedAt === null) return null;
    const ms = loadedAt - new Date(d).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  };

  // The maturity lens (owner): a style added three days ago selling nothing tells you nothing — it hasn't had a chance yet. With the
  // toggle on, only lines live MATURE_DAYS+ survive.
  //
  // It filters the TABLE ONLY — the hero strip above stays the whole 30-day month, always (owner 2026-07-27). The hero is the month's
  // fixed picture: "we added N styles and they've done £X". A number that moves when you tick a checkbox isn't a monthly stat any
  // more, and you can't compare it with the last time you looked. The filter is a lens on the working list, not a redefinition of
  // the month. Client-side on the already-loaded window — no re-fetch, and flipping it back is instant.
  const visibleRows = useMemo(() => {
    if (!matureOnly) return rows;
    if (loadedAt === null) return rows;
    const cutoff = loadedAt - MATURE_DAYS * 86400000;
    return rows.filter((r) => r.created !== null && new Date(r.created).getTime() <= cutoff);
  }, [rows, matureOnly, loadedAt]);
  const hiddenCount = rows.length - visibleRows.length;

  // Totals across the additions — how much the month's new lines have contributed. Always the FULL window (see above): these are the
  // 30-day stats, and the filter must not move them.
  const totalUnits = rows.reduce((s, r) => s + r.units, 0);
  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalProfit = rows.reduce((s, r) => s + r.profit, 0);

  // All sorting is client-side on the already-loaded rows (no re-fetch). Compare on the active column, then flip for direction; ties
  // fall back to newest-added so the order is stable.
  const sortedRows = useMemo(() => {
    const cmp = (a: NewAdditionRow, b: NewAdditionRow) => {
      let c: number;
      if (sortBy === 'sold') c = a.units - b.units;
      // Never-sold rows have no latest profit; they sort to the bottom in the default (desc) view rather than pretending to be £0.
      else if (sortBy === 'profit') c = (a.lastProfit ?? -Infinity) - (b.lastProfit ?? -Infinity);
      else if (sortBy === 'stock') c = a.stock - b.stock;
      else c = (a.created || '').localeCompare(b.created || '');
      if (c === 0 && sortBy !== 'added') c = (a.created || '').localeCompare(b.created || '');
      return sortDir === 'asc' ? c : -c;
    };
    return [...visibleRows].sort(cmp);
  }, [visibleRows, sortBy, sortDir]);

  // Click a sortable header: same column flips direction; a new column switches to it, defaulting to descending (most / newest first).
  const toggleSort = (key: SortKey) => {
    if (sortBy === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortBy(key); setSortDir('desc'); }
  };
  const caret = (key: SortKey) =>
    sortBy === key ? <span className="text-[10px]">{sortDir === 'asc' ? '▲' : '▼'}</span> : null;

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  // Discounted = current live price sits below RRP (both must be readable numbers). Drives the amber highlight on the Price cell.
  const isDiscounted = (r: NewAdditionRow) => r.price !== null && r.rrp !== null && r.price < r.rrp;
  const fmtDate = (d: string | null) => {
    if (!d) return '—';
    const dt = new Date(d);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}`;
  };
  return (
    <AppShell
      title="New Additions"
      backHref="/analytics"
      backLabel="Analytics"
      /* The blurb explains the screen once; after that it is just text in the way (owner 2026-07-27). It lives behind this
         header-row toggle, which costs no vertical space at all. */
      headerRight={
        <button
          type="button"
          onClick={() => setShowAbout((v) => !v)}
          aria-expanded={showAbout}
          title={showAbout ? 'Hide what this screen shows' : 'What does this screen show?'}
          className={
            'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm transition ' +
            (showAbout
              ? 'border-slate-300 bg-slate-100 text-slate-700'
              : 'border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700')
          }
        >
          <InformationCircleIcon className="h-4 w-4" /> About
        </button>
      }
    >
      {showAbout && (
        <p className="mb-5 max-w-3xl rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Styles <strong>added in the last {DAYS} days</strong>, newest first — and how each new line has sold so far (all channels). A quick
          read on whether the month brought a lot of new product or a little. Tick <strong>{MATURE_DAYS}+ days live only</strong> to drop
          the lines from the list that are still too new to judge — the totals above always cover the full {DAYS} days.
        </p>
      )}

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* HERO — how many new styles this window. Supporting sales totals demoted beside it. */}
          <div className="mb-6 flex flex-wrap items-end gap-x-10 gap-y-3 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <div>
              {/* The window is spelled out under the number, not just in the (now hidden) blurb — the money beside it is easy to read
                  as "this month" out of habit, so the 60 has to be impossible to miss. */}
              <div className="text-xs font-medium uppercase tracking-wide text-slate-400">New styles</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{rows.length}</span>
              </div>
              <div className="mt-1.5 text-sm text-slate-500">
                added in the last <strong className="font-semibold text-slate-700">{DAYS} days</strong>
              </div>
            </div>
            {/* Sales are LIFETIME per style (≈ since it was added, as these are new lines) — NOT a 30/60-day sales window. Labelled
                "since added" so the figures can't be misread as a trailing month. */}
            <div className="flex gap-8 border-l border-slate-200 pl-8 text-sm">
              <Stat label="Units sold" value={String(totalUnits)} sub="since added" />
              <Stat label="Revenue" value={money(totalRevenue)} sub="since added" />
              <Stat label="Profit" value={money(totalProfit)} sub="since added" />
            </div>
          </div>

          {/* Table controls. The filter sits HERE, not in the hero — it changes the list below it and nothing above it, and being next
              to the row count makes that obvious at a glance. */}
          {rows.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
              <span className="text-slate-500">
                {matureOnly
                  ? <>Showing <strong className="font-semibold text-slate-700">{visibleRows.length}</strong> of {rows.length}</>
                  : <>All <strong className="font-semibold text-slate-700">{rows.length}</strong>, newest first</>}
              </span>
              <label className="flex cursor-pointer select-none items-center gap-2 text-slate-600"
                     title={`Hide styles added less than ${MATURE_DAYS} days ago — too new to judge. The totals above stay the full ${DAYS} days.`}>
                <input
                  type="checkbox"
                  checked={matureOnly}
                  onChange={(e) => setMatureOnly(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400"
                />
                <span>
                  {MATURE_DAYS}+ days live only
                  {matureOnly && hiddenCount > 0 && (
                    <span className="ml-1.5 text-xs text-slate-400">({hiddenCount} too new)</span>
                  )}
                </span>
              </label>
            </div>
          )}

          {visibleRows.length === 0 ? (
            <p className="text-sm text-slate-400">
              {matureOnly && rows.length > 0
                ? `Every style added in the last ${DAYS} days is under ${MATURE_DAYS} days live — untick the filter to see them.`
                : `No styles were added in the last ${DAYS} days.`}
            </p>
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
                        title="Sort by units sold — units since the style was added, not a 30-day window"
                      >
                        {caret('sold')} Sold
                      </button>
                    </th>
                    {/* Latest sale's profit — deliberately NOT the lifetime total (which blends the launch price with later
                        discounting). This is what the style made last time it sold, i.e. at the price it is on now. */}
                    <th className="px-3 py-2.5 text-right font-medium">
                      <button
                        onClick={() => toggleSort('profit')}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-slate-700 ${sortBy === 'profit' ? 'text-slate-800' : ''}`}
                        title="Sort by profit on the most recent sale"
                      >
                        {caret('profit')} Profit
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
                      <td
                        className={
                          'px-3 py-2 text-right tabular-nums ' +
                          (r.lastProfit === null ? 'text-slate-300' : r.lastProfit < 0 ? 'font-medium text-rose-600' : 'font-medium text-slate-800')
                        }
                        title={r.lastSold ? `Profit on the latest sale — ${fmtDate(r.lastSold)}` : 'Not sold yet'}
                      >
                        {money(r.lastProfit)}
                      </td>
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
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null); // note just copied (brief "Copied" flash)
  // Errors raised by add/delete. Separate from the query's own error so a failed save doesn't blank the list of existing notes.
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: notesData, error: loadError, busy: loading, mutate } = useApiQuery(
    ['scratchpad'],
    () => getScratchpad(),
  );
  const notes: ScratchpadNote[] = notesData ?? NO_NOTES;
  const error = actionError ?? loadError?.message ?? null;

  const add = async () => {
    const body = draft.trim();
    if (!body || saving) return;
    setSaving(true);
    setActionError(null);
    const res = await addScratchpadNote(body);
    if (res.success && res.data) {
      // Write the new note straight into the cache (revalidate: false) — the POST already returned the saved row, so a refetch
      // would only cost a round trip to learn what we already know.
      const saved = res.data as ScratchpadNote;
      await mutate((n) => [saved, ...(n ?? NO_NOTES)], { revalidate: false });
      setDraft('');
    } else {
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setActionError(res.error || 'Failed to save note');
    }
    setSaving(false);
  };

  const remove = async (id: number) => {
    // Optimistic — drop it from the cache immediately; SWR rolls back automatically if the delete throws.
    const prev = notes;
    await mutate((n) => (n ?? NO_NOTES).filter((x) => x.id !== id), { revalidate: false });
    const res = await deleteScratchpadNote(id);
    if (!res.success) {
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      await mutate(prev, { revalidate: false });
      setActionError(res.error || 'Failed to delete note');
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

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-slate-700">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
