'use client';
/*
=======================================================================================================================================
Page: /prospects — Prospects
=======================================================================================================================================
Purpose: The team's shared notepad for MINING NEW PRODUCTS on Amazon (owner, 2026-10-21). Research used to live on a notepad and in
         emails ("Rieker boots for women" → rank, price, sellers → write it down), so every day started from nothing. Here each find is
         one line that anyone logged in can add, rate, check again and talk about, then order (manually, outside BCWEB) or delete.

         Deliberately loose — "an extended Google Docs specific for us":
           - one line = one style: a name, an optional Amazon link/ASIN, an owner (who added it), a gut rating (Diamond / Good / Sketchy)
           - CHECKS: rank / price / sellers typed by hand each time someone looks (no scraping, no API — owner's call). Size is optional
             because rank differs by size on the same listing; the line shows the latest check per size and how rank moved since the
             check before ("was 4,200 on 19 Oct")
           - NOTES: a thread with names, about any size or anything
           - DELETE IS FOR GOOD — a line, a check or a note. Nothing hangs around.
         Two tools: "WE HAVE IT" on a line when one of its ASINs is one of our Amazon listings, and "Do we have it?" — a search of our own
         catalogue. Both are yes/no on purpose: there are NO links to the pricing or order screens (owner: this is mining for new; managing
         existing stock is another process, and the research must not drift into repricing).
         On the dashboard it is a tile in the Back Office card. One column: the toolbar (Add a find | Do we have it?), then the list.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import { ArrowTopRightOnSquareIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useDebounced } from '@/lib/useDebounced';
import {
  addProspectCheck, addProspectNote, deleteProspectItem, findInCatalogue, getProspects, saveProspect,
  Prospect, ProspectCheck, ProspectRating,
} from '@/lib/api';

const NO_ROWS: Prospect[] = [];
const STALE_DAYS = 7;   // a line nobody has checked for this long is flagged "check again"

const RATINGS: { key: ProspectRating; label: string; on: string }[] = [
  { key: 'diamond', label: '◆ Diamond', on: 'border-sky-300 bg-sky-100 text-sky-800' },
  { key: 'good', label: 'Good', on: 'border-emerald-300 bg-emerald-100 text-emerald-800' },
  { key: 'sketchy', label: 'Sketchy', on: 'border-amber-300 bg-amber-100 text-amber-800' },
];
const RATING_ORDER: Record<string, number> = { diamond: 0, good: 1, sketchy: 2 };

type Sort = 'newest' | 'rating' | 'stale';

const inputCls = 'rounded-md border border-slate-300 px-2.5 py-1.5 text-sm focus:border-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500';
const smallBtn = 'rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50';
// Dark slate, like the All / Mine switch — not the brand purple (owner, 2026-10-21).
const primaryBtn = 'rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50';

const DAY = 86400000;
function daysAgo(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY);
}
function fmtWhen(iso: string): string {
  const d = daysAgo(iso);
  if (d <= 0) return 'today';
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' });
}
const fmtRank = (n: number) => n.toLocaleString('en-GB');
const fmtMoney = (n: number) => `£${n.toFixed(2)}`;

// The latest check of each size (no size = the listing as a whole), each with the check before it of the SAME size, so rank movement
// compares like with like. Ordered by most recent first.
function latestBySize(checks: ProspectCheck[]): { cur: ProspectCheck; prev: ProspectCheck | null }[] {
  const by = new Map<string, ProspectCheck[]>();
  for (const c of checks) {   // checks arrive oldest first
    const k = (c.size || '').toUpperCase();
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(c);
  }
  return [...by.values()]
    .map((list) => {
      const cur = list[list.length - 1];
      // The previous check that had a rank, so "was X" is always a rank the screen can compare against.
      const prev = [...list.slice(0, -1)].reverse().find((c) => c.rank !== null) || null;
      return { cur, prev };
    })
    .sort((a, b) => b.cur.checked_at.localeCompare(a.cur.checked_at));
}

function lastActivity(p: Prospect): string {
  const last = p.checks.length ? p.checks[p.checks.length - 1].checked_at : null;
  return last || p.created_at;
}

export default function ProspectsPage() {
  const { displayName } = useAuth();
  const q = useApiQuery('prospect-list', getProspects);
  const rows = q.data ?? NO_ROWS;

  const [adding, setAdding] = useState(false);
  const [mine, setMine] = useState(false);
  const [sort, setSort] = useState<Sort>('newest');
  const [filter, setFilter] = useState('');

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = rows.filter((p) =>
      (!mine || p.owner === displayName)
      && (!f || p.name.toLowerCase().includes(f) || (p.asin || '').toLowerCase().includes(f)
          || p.notes.some((n) => n.body.toLowerCase().includes(f)))
    );
    if (sort === 'rating') {
      list.sort((a, b) => (RATING_ORDER[a.rating ?? ''] ?? 3) - (RATING_ORDER[b.rating ?? ''] ?? 3) || b.created_at.localeCompare(a.created_at));
    } else if (sort === 'stale') {
      list.sort((a, b) => lastActivity(a).localeCompare(lastActivity(b)));   // longest since anyone looked, first
    }
    return list;   // 'newest' is the server's order
  }, [rows, mine, displayName, filter, sort]);

  const tabBtn = (on: boolean) =>
    'rounded-md px-3 py-1.5 text-sm font-medium transition ' + (on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100');

  return (
    <AppShell title="Prospects">
      {/* One column, top to bottom: the two things you DO (add a find, check if we have it), the add form, then the list with its
          controls on one line directly above it. (A side column for "Do we have it?" left the screen disjointed — owner, 2026-10-21.) */}
      <div className="max-w-5xl space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <button type="button" onClick={() => setAdding(true)} disabled={adding}
              className={`${primaryBtn} inline-flex items-center gap-1.5`}>
              <PlusIcon className="h-4 w-4" /> Add a find
            </button>
            <HaveItSearch />
          </div>
        </div>

        {adding && <ProspectForm onDone={() => { setAdding(false); q.refresh(); }} onCancel={() => setAdding(false)} />}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button type="button" onClick={() => setMine(false)} className={tabBtn(!mine)}>All · {rows.length}</button>
            <button type="button" onClick={() => setMine(true)} className={tabBtn(mine)}>
              Mine · {rows.filter((p) => p.owner === displayName).length}
            </button>
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${inputCls} bg-white`} aria-label="Sort">
            <option value="newest">Newest first</option>
            <option value="rating">Diamonds first</option>
            <option value="stale">Longest since checked</option>
          </select>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter the list…"
            className={`${inputCls} w-52`} />
        </div>

        {q.error ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-red-700">{q.error.message}</p>
        ) : q.isLoading ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
            {rows.length === 0 ? 'Nothing logged yet — "Add a find" to start.' : 'Nothing matches.'}
          </p>
        ) : (
          <div className="space-y-3">
            {shown.map((p) => <ProspectCard key={p.id} p={p} onChanged={() => q.refresh()} />)}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---- Add / edit a line ------------------------------------------------------------------------------------------------------------
// Adding can carry the first check too (rank / price / sellers seen right now), so logging a find is one form, not two.
function ProspectForm({ edit, onDone, onCancel }: { edit?: Prospect; onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState(edit?.name ?? '');
  const [amazon, setAmazon] = useState(edit?.asin ?? '');
  const [rating, setRating] = useState<ProspectRating | null>(edit?.rating ?? null);
  const [check, setCheck] = useState({ size: '', rank: '', price: '', sellers: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveProspect({ id: edit?.id, name, amazon, rating, check: edit ? undefined : check });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Failed to save'); return; }
    onDone();
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">
          What is it
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            placeholder="e.g. Rieker Y3453 ankle boot, black" className={`${inputCls} mt-1 block w-full`} />
        </label>
        <label className="text-xs font-medium text-slate-600">
          Amazon link or ASIN <span className="font-normal text-slate-400">(optional)</span>
          <input value={amazon} onChange={(e) => setAmazon(e.target.value)}
            placeholder="Paste the Amazon page address" className={`${inputCls} mt-1 block w-full`} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Rating</span>
        <RatingChips value={rating} onChange={setRating} />
      </div>
      {!edit && (
        <div className="mt-3">
          <div className="text-xs font-medium text-slate-600">What you see now <span className="font-normal text-slate-400">(optional)</span></div>
          <CheckFields value={check} onChange={setCheck} />
        </div>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={save} disabled={busy || !name.trim()} className={primaryBtn}>
          {busy ? 'Saving…' : edit ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
      </div>
    </div>
  );
}

function RatingChips({ value, onChange, disabled }: { value: ProspectRating | null; onChange: (r: ProspectRating | null) => void; disabled?: boolean }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RATINGS.map((r) => (
        <button
          key={r.key}
          type="button"
          disabled={disabled}
          onClick={() => onChange(value === r.key ? null : r.key)}   // click the chosen one again to clear it
          className={'rounded-full border px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-50 '
            + (value === r.key ? r.on : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

type CheckInput = { size: string; rank: string; price: string; sellers: string };
function CheckFields({ value, onChange }: { value: CheckInput; onChange: (v: CheckInput) => void }) {
  const field = (k: keyof CheckInput, label: string, w: string, mode: 'text' | 'numeric' | 'decimal') => (
    <label className="text-xs text-slate-500">
      {label}
      <input value={value[k]} inputMode={mode} onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        className={`${inputCls} mt-1 block ${w}`} />
    </label>
  );
  return (
    <div className="mt-1 flex flex-wrap gap-2">
      {field('rank', 'Rank', 'w-28', 'numeric')}
      {field('price', 'Price £', 'w-24', 'decimal')}
      {field('sellers', 'Sellers', 'w-20', 'numeric')}
      {field('size', 'Size (optional)', 'w-28', 'text')}
    </div>
  );
}

// ---- One line --------------------------------------------------------------------------------------------------------------------
function ProspectCard({ p, onChanged }: { p: Prospect; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [check, setCheck] = useState<CheckInput & { amazon: string }>({ size: '', rank: '', price: '', sellers: '', amazon: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = useMemo(() => latestBySize(p.checks), [p.checks]);
  const sinceLook = daysAgo(lastActivity(p));

  // Every write on a line goes through here: one at a time, show the error, refresh the list on success.
  async function run(fn: () => Promise<{ success: boolean; error?: string }>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.success) { setError(res.error || 'Failed'); return; }
    after?.();
    onChanged();
  }

  if (editing) {
    return <ProspectForm edit={p} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900">{p.name}</h3>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {p.asin && (
              <a href={`https://www.amazon.co.uk/dp/${p.asin}`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-mono text-sky-700 hover:underline">
                {p.asin} <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
              </a>
            )}
            <span>{p.owner} · added {fmtWhen(p.created_at)}</span>
            {sinceLook >= STALE_DAYS && <span className="text-amber-700">not checked for {sinceLook} days</span>}
          </div>
        </div>
        <HaveBadge p={p} />
      </div>

      <div className="mt-2">
        <RatingChips value={p.rating} disabled={busy}
          onChange={(r) => run(() => saveProspect({ id: p.id, name: p.name, amazon: p.asin ?? '', rating: r }))} />
      </div>

      {/* Latest check per size, with how rank moved since that size's check before. Lower rank = selling better. */}
      {latest.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {latest.map(({ cur, prev }) => (
            <li key={cur.id} className="flex flex-wrap items-baseline gap-x-2 text-slate-700">
              {cur.size && <span className="rounded bg-slate-100 px-1.5 text-xs font-medium text-slate-600">Size {cur.size}</span>}
              {cur.rank !== null && <span>Rank <span className="font-semibold tabular-nums">{fmtRank(cur.rank)}</span></span>}
              {cur.rank !== null && prev?.rank != null && prev.rank !== cur.rank && (
                <span className={`text-xs ${cur.rank < prev.rank ? 'text-emerald-700' : 'text-red-700'}`}>
                  {cur.rank < prev.rank ? '▲ better' : '▼ worse'} — was {fmtRank(prev.rank)} {fmtWhen(prev.checked_at)}
                </span>
              )}
              {cur.price !== null && <span>· {fmtMoney(cur.price)}</span>}
              {cur.sellers !== null && <span>· {cur.sellers} seller{cur.sellers === 1 ? '' : 's'}</span>}
              <span className="text-xs text-slate-400">{cur.checked_by}, {fmtWhen(cur.checked_at)}</span>
            </li>
          ))}
        </ul>
      )}

      {/* Notes thread */}
      {p.notes.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
          {p.notes.map((n) => (
            <li key={n.id} className="group text-sm text-slate-700">
              <span className="whitespace-pre-wrap">{n.body}</span>
              <span className="ml-2 text-xs text-slate-400">{n.created_by}, {fmtWhen(n.created_at)}</span>
              <button type="button" title="Delete this note" disabled={busy}
                onClick={() => run(() => deleteProspectItem('note', n.id))}
                className="ml-1 align-middle text-slate-300 opacity-0 hover:text-red-600 group-hover:opacity-100">
                <TrashIcon className="inline h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (note.trim()) run(() => addProspectNote(p.id, note), () => setNote('')); }}
      >
        <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000}
          placeholder="Add a note — sizes, price thoughts, anything" className={`${inputCls} min-w-0 flex-1`} />
        <button type="submit" disabled={busy || !note.trim()} className={smallBtn}>Add note</button>
      </form>

      {checking && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-600">What you see on Amazon now</div>
          <div className="flex flex-wrap items-end gap-2">
            <CheckFields value={check} onChange={(v) => setCheck({ ...check, ...v })} />
            <label className="text-xs text-slate-500">
              That size&apos;s ASIN (optional)
              <input value={check.amazon} onChange={(e) => setCheck({ ...check, amazon: e.target.value })}
                className={`${inputCls} mt-1 block w-36`} />
            </label>
          </div>
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || !(check.rank || check.price || check.sellers)} className={smallBtn}
              onClick={() => run(() => addProspectCheck({ prospect_id: p.id, ...check }), () => {
                setChecking(false);
                setCheck({ size: '', rank: '', price: '', sellers: '', amazon: '' });
              })}>
              Save check
            </button>
            <button type="button" onClick={() => setChecking(false)} className="px-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
          </div>
        </div>
      )}

      {history && p.checks.length > 0 && (
        <table className="mt-3 w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200 text-left text-slate-500">
              <th className="py-1 pr-3 font-medium">When</th>
              <th className="py-1 pr-3 font-medium">Size</th>
              <th className="py-1 pr-3 text-right font-medium">Rank</th>
              <th className="py-1 pr-3 text-right font-medium">Price</th>
              <th className="py-1 pr-3 text-right font-medium">Sellers</th>
              <th className="py-1 pr-3 font-medium">Who</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...p.checks].reverse().map((c) => (
              <tr key={c.id} className="border-b border-slate-100 text-slate-700 last:border-0">
                <td className="py-1 pr-3 whitespace-nowrap">{fmtWhen(c.checked_at)}</td>
                <td className="py-1 pr-3">{c.size || '—'}{c.asin && <span className="ml-1 font-mono text-slate-400">{c.asin}</span>}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.rank !== null ? fmtRank(c.rank) : ''}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.price !== null ? fmtMoney(c.price) : ''}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.sellers ?? ''}</td>
                <td className="py-1 pr-3">{c.checked_by}</td>
                <td className="py-1 text-right">
                  <button type="button" title="Delete this check" disabled={busy}
                    onClick={() => run(() => deleteProspectItem('check', c.id))} className="text-slate-300 hover:text-red-600">
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {!checking && <button type="button" onClick={() => setChecking(true)} className={smallBtn}>+ Check again</button>}
        {p.checks.length > 1 && (
          <button type="button" onClick={() => setHistory(!history)} className={smallBtn}>
            {history ? 'Hide history' : `History · ${p.checks.length}`}
          </button>
        )}
        <button type="button" onClick={() => setEditing(true)} className={smallBtn}>Edit</button>
        <span className="ml-auto">
          {confirmDelete ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="text-slate-600">Delete for good?</span>
              <button type="button" disabled={busy} onClick={() => run(() => deleteProspectItem('prospect', p.id))}
                className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50">Delete</button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-1 text-slate-500 hover:text-slate-700">Keep</button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600">
              <TrashIcon className="h-4 w-4" /> Delete
            </button>
          )}
        </span>
      </div>
    </article>
  );
}

// "Do we already have it?" for a line: only an ASIN can answer it for sure, so with no ASIN the badge says so instead of guessing.
function HaveBadge({ p }: { p: Prospect }) {
  if (p.have) {
    return (
      <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800" title={`On our Amazon listings as ${p.have.groupid}`}>
        WE HAVE IT
      </span>
    );
  }
  const anyAsin = p.asin || p.checks.some((c) => c.asin);
  if (!anyAsin) {
    return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500" title="Add the Amazon link to check it against our listings">no ASIN</span>;
  }
  return <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800" title="None of its ASINs is one of our Amazon listings">NEW TO US</span>;
}

// ---- Do we have it? — search our own catalogue --------------------------------------------------------------------------------------
function HaveItSearch() {
  const [term, setTerm] = useState('');
  const debounced = useDebounced(term.trim(), 350);
  const q = useApiQuery(debounced.length >= 2 ? ['prospect-have', debounced] : null, () => findInCatalogue(debounced));

  return (
    <div className="min-w-0 flex-1 basis-80">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-sm font-semibold text-slate-900">Do we have it?</span>
        <div className="relative min-w-0 flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="Search our catalogue — model number, brand or name"
            className={`${inputCls} w-full pl-8`} />
        </div>
      </div>
      {debounced.length >= 2 && (
        <div className="mt-3 border-t border-slate-100 pt-3 text-sm">
          {q.error ? (
            <p className="text-red-700">{q.error.message}</p>
          ) : !q.data ? (
            <p className="text-slate-400">Searching…</p>
          ) : q.data.results.length === 0 ? (
            <p className="font-medium text-emerald-700">Nothing — we don&apos;t have it.</p>
          ) : (
            <>
              <ul className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {q.data.results.map((r) => (
                  <li key={r.groupid} className="leading-tight">
                    <div className="text-slate-800">{r.title || r.groupid}</div>
                    <div className="text-xs text-slate-500">
                      <span className="font-mono">{r.groupid}</span>
                      {' · '}
                      {r.in_stock ? <span className="text-amber-700">in stock</span> : <span>none in stock</span>}
                    </div>
                  </li>
                ))}
              </ul>
              {q.data.truncated && <p className="mt-2 text-xs text-slate-400">More than 25 — add another word.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
