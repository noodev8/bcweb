'use client';
/*
=======================================================================================================================================
Page: /prospects — Prospects
=======================================================================================================================================
Purpose: The team's shared notepad for MINING NEW PRODUCTS on Amazon (owner, 2026-10-21). Research used to live on a notepad and in
         emails ("Rieker boots for women" → rank, price, sellers → write it down), so every day started from nothing. Here each find is
         one line that anyone logged in can add, rate, check again and talk about, then order (manually, outside BCWEB) or drop.

         Deliberately loose — "an extended Google Docs specific for us":
           - one line = one style: a name, an optional Amazon link/ASIN, an owner (who added it), a gut rating (Diamond / Good / Sketchy)
           - CHECKS: rank / price / sellers typed by hand each time someone looks (no scraping, no API — owner's call). Size is optional
             because rank differs by size on the same listing; the line shows the latest check per size, History shows them all (rank
             changes are read by eye — owner)
           - NOTES: a thread with names, about any size or anything
           - ARCHIVE (2026-10-26) — DELETE ASKS WHY: Ordered / Dropped (+ an optional reason, written as its last comment) moves the
             line to the Archive with its checks and comments, so colleagues can see a style was tested; "Delete for good" really
             deletes. One button on purpose — the team will press Delete (owner: "Archive might need training"). Kept 6 months, then removed for good by
             the server on the next add / archive (no cron). Pasting an archived ASIN again says "Tested before" and offers REOPEN —
             one line per style. The Active | Archive switch shows them; an archived line is read-only (Reopen or Delete).
           - A check or a note's delete is for good, as is Delete on an archived line.
         Two tools: "WE HAVE IT" on a line when one of its ASINs is one of our Amazon listings, and "Do we have it?" — a search of our own
         catalogue. Both are yes/no on purpose: there are NO links to the pricing or order screens (owner: this is mining for new; managing
         existing stock is another process, and the research must not drift into repricing).
         On the dashboard it is a tile in the Back Office card. One column: the toolbar (paste an Amazon URL | Add a find), then the list.
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import {
  ArrowPathIcon, ArrowTopRightOnSquareIcon, ChevronDownIcon, ChevronRightIcon, PlusIcon, TrashIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useUrlParam } from '@/lib/useUrlParam';
import { prettyPathLabel } from '@/lib/nav';
import {
  addProspectCheck, addProspectNote, archiveProspect, checkProspectAsin, deleteProspectItem, getProspects, reopenProspect, saveProspect,
  Prospect, ProspectOutcome, ProspectRating,
} from '@/lib/api';

const NO_ROWS: Prospect[] = [];
const STALE_DAYS = 7;   // a line nobody has checked for this long is flagged "check again"

const RATINGS: { key: ProspectRating; label: string; on: string }[] = [
  { key: 'diamond', label: '◆ Diamond', on: 'border-sky-300 bg-sky-100 text-sky-800' },
  { key: 'good', label: 'Good', on: 'border-emerald-300 bg-emerald-100 text-emerald-800' },
  { key: 'sketchy', label: 'Sketchy', on: 'border-amber-300 bg-amber-100 text-amber-800' },
];
const RATING_ORDER: Record<string, number> = { diamond: 0, good: 1, sketchy: 2 };

const OUTCOMES: { key: ProspectOutcome; label: string; on: string }[] = [
  { key: 'ordered', label: 'Ordered', on: 'border-emerald-300 bg-emerald-100 text-emerald-800' },
  { key: 'dropped', label: 'Dropped', on: 'border-slate-300 bg-slate-200 text-slate-700' },
];

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
// Rank / price / sellers are free text, shown as typed. A plain number gets a £ in front when it's a price.
const fmtMoney = (t: string) => (/^[0-9]+([.][0-9]+)?$/.test(t) ? `£${t}` : t);


// Most Amazon product links carry the product name before /dp/: amazon.co.uk/Rieker-Womens-Y3453-Ankle-Boots/dp/B0C1234567/...
// Pasting a link into an empty "What is it" fills it from that (owner, 2026-10-21: "I'm pasting the Amazon URL and then thinking of a
// title"). Nothing is fetched — it is only the text of the link. '' when the link has no name in it (a bare /dp/B0… link).
function nameFromAmazonUrl(url: string): string {
  const m = url.trim().match(/amazon\.[a-z.]+\/([^/?#]+)\/(?:dp|gp\/product)\//i);
  if (!m) return '';
  let slug = m[1];
  try { slug = decodeURIComponent(slug); } catch { /* a malformed %-escape: use it as it is */ }
  // A hyphen between two digits is part of a model number (Rieker "Z4263-24" = style + colour), so it stays; every other -, _ or +
  // is a word break.
  return slug.replace(/(?<![0-9])-|-(?![0-9])|[_+]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
}

// The ASIN out of a product link (the 10 characters after /dp/ or /gp/product/); null when it isn't such a link — a bare ASIN being
// typed stays as typed. The server parses it again (utils/prospect.js → parseAsin), so this is only to tidy the box.
function asinFromAmazonUrl(v: string): string | null {
  const m = v.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Za-z0-9]{10})(?=[/?#]|$)/i);
  return m ? m[1].toUpperCase() : null;
}

// Opens the product's Amazon page in a new tab — the ASIN is all the link needs (amazon.co.uk/dp/<ASIN>).
function AmazonLink({ asin, label }: { asin: string; label: string }) {
  return (
    <a href={`https://www.amazon.co.uk/dp/${asin}`} target="_blank" rel="noopener noreferrer"
      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
      {label} <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
    </a>
  );
}

function lastActivity(p: Prospect): string {
  const last = p.checks.length ? p.checks[p.checks.length - 1].checked_at : null;
  return last || p.created_at;
}

export default function ProspectsPage() {
  const { displayName } = useAuth();
  // Reached with ?from=/<path> — a back link to it. A dashboard tile's ?from=<group> is AppShell's own business.
  const fromParam = useUrlParam('from');
  const backHref = fromParam && fromParam.startsWith('/') ? fromParam : undefined;
  const q = useApiQuery('prospect-list', getProspects);
  const rows = q.data ?? NO_ROWS;

  // The add form, open or not. seed = the Amazon link it was opened with (from the toolbar box); key remounts it for a new paste.
  const [adding, setAdding] = useState<{ seed: string; key: number } | null>(null);
  const [paste, setPaste] = useState('');
  // The one find open for editing; the rest are narrow rows (owner, 2026-10-21: "Only edit one at a time").
  const [openId, setOpenId] = useState<number | null>(null);
  const [mine, setMine] = useState(false);
  const [archive, setArchive] = useState(false);   // the Active | Archive switch
  const [sort, setSort] = useState<Sort>('newest');
  const [filter, setFilter] = useState('');
  // CUT (owner, 2026-10-22) — × takes a line off the screen for this visit only: nothing saved, no undo, no count. Refresh (or
  // reopening the page) brings the WHOLE list back. Not a delete — that is the open card's Delete, and it is for good.
  const [cut, setCut] = useState<Set<number>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);
  async function onRefresh() {
    setRefreshing(true);
    await q.refresh();
    setCut(new Set());
    setRefreshing(false);
  }

  const activeCount = rows.filter((p) => !p.archived_at).length;
  const inView = useMemo(() => rows.filter((p) => !!p.archived_at === archive), [rows, archive]);

  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const list = inView.filter((p) =>
      !cut.has(p.id)
      && (!mine || p.owner === displayName)
      && (!f || p.name.toLowerCase().includes(f) || (p.asin || '').toLowerCase().includes(f)
          || p.notes.some((n) => n.body.toLowerCase().includes(f)))
    );
    if (archive) {
      list.sort((a, b) => b.archived_at!.localeCompare(a.archived_at!));   // most recently decided first; the sort menu is hidden
    } else if (sort === 'rating') {
      list.sort((a, b) => (RATING_ORDER[a.rating ?? ''] ?? 3) - (RATING_ORDER[b.rating ?? ''] ?? 3) || b.created_at.localeCompare(a.created_at));
    } else if (sort === 'stale') {
      list.sort((a, b) => lastActivity(a).localeCompare(lastActivity(b)));   // longest since anyone looked, first
    }
    return list;   // 'newest' is the server's order
  }, [inView, archive, mine, displayName, filter, sort, cut]);

  // Reopen from the add form's "Tested before" warning: the line is back on the list, open, ready for a new check.
  function onReopened(id: number) {
    setAdding(null);
    setArchive(false);
    setOpenId(id);
    q.refresh();
  }

  const tabBtn = (on: boolean) =>
    'rounded-md px-3 py-1.5 text-sm font-medium transition ' + (on ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100');

  return (
    <AppShell title="Prospects" backHref={backHref} backLabel={backHref ? prettyPathLabel(backHref) : undefined}>
      {/* One column, top to bottom: the toolbar (paste an Amazon link, or Add a find by hand), the add form, then the list with its
          controls on one line directly above it. Pasting a link opens the form filled in — the quick way to log a find (owner,
          2026-10-21: "Replace do we have it with Amazon URL so I can quickly add it. If a duplicate I will then know"). */}
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <label className="flex min-w-0 flex-1 basis-80 items-center gap-3">
              <span className="shrink-0 text-sm font-semibold text-slate-900">Amazon URL</span>
              <input value={paste} placeholder="Paste a product link to add it"
                onChange={(e) => {
                  const v = e.target.value;
                  // A product link (or a bare ASIN) opens the form with it; anything else stays in the box while being typed.
                  if (asinFromAmazonUrl(v) || /^[A-Za-z0-9]{10}$/.test(v.trim())) {
                    setAdding({ seed: v.trim(), key: Date.now() });
                    setOpenId(null);   // one thing open at a time
                    setPaste('');
                  } else {
                    setPaste(v);
                  }
                }}
                className={`${inputCls} min-w-0 flex-1`} />
            </label>
            <button type="button" onClick={() => { setAdding({ seed: '', key: Date.now() }); setOpenId(null); }} disabled={!!adding}
              className={`${primaryBtn} inline-flex shrink-0 items-center gap-1.5`}>
              <PlusIcon className="h-4 w-4" /> Add a find
            </button>
          </div>
        </div>

        {adding && (
          <ProspectForm key={adding.key} seed={adding.seed}
            onDone={() => { setAdding(null); q.refresh(); }} onCancel={() => setAdding(null)} onReopened={onReopened} />
        )}

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button type="button" onClick={() => { setArchive(false); setOpenId(null); }} className={tabBtn(!archive)}>
              Active · {activeCount}
            </button>
            <button type="button" onClick={() => { setArchive(true); setOpenId(null); }} className={tabBtn(archive)}
              title="Decided lines (Ordered / Dropped), kept 6 months">
              Archive · {rows.length - activeCount}
            </button>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
            <button type="button" onClick={() => setMine(false)} className={tabBtn(!mine)}>All · {inView.length}</button>
            <button type="button" onClick={() => setMine(true)} className={tabBtn(mine)}>
              Mine · {inView.filter((p) => p.owner === displayName).length}
            </button>
          </div>
          {!archive && (
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={`${inputCls} bg-white`} aria-label="Sort">
              <option value="newest">Newest first</option>
              <option value="rating">Diamonds first</option>
              <option value="stale">Longest since checked</option>
            </select>
          )}
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter the list…"
            className={`${inputCls} w-52`} />
          <button type="button" onClick={onRefresh} disabled={refreshing} title="Bring back every line cut with ×"
            className={`${smallBtn} inline-flex items-center gap-1.5 py-1.5 text-sm`}>
            <ArrowPathIcon className={'h-4 w-4 ' + (refreshing ? 'animate-spin' : '')} /> Refresh
          </button>
        </div>

        {q.error ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-red-700">{q.error.message}</p>
        ) : q.isLoading ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-400">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="rounded-lg border border-slate-200 bg-white px-5 py-4 text-sm text-slate-500">
            {inView.length > 0 ? 'Nothing matches.'
              : archive ? 'Nothing archived in the last 6 months.'
              : 'Nothing logged yet — "Add a find" to start.'}
          </p>
        ) : (
          <div className="divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {shown.map((p) => (p.id === openId
              ? <ProspectCard key={p.id} p={p} onChanged={() => q.refresh()} onClose={() => setOpenId(null)} />
              : <ProspectRow key={p.id} p={p} onOpen={() => setOpenId(p.id)} onCut={() => setCut((prev) => new Set(prev).add(p.id))} />))}
          </div>
        )}
      </div>
    </AppShell>
  );
}

// ---- Add / edit a line ------------------------------------------------------------------------------------------------------------
// Adding can carry the first check too (rank / price / sellers seen right now), so logging a find is one form, not two.
function ProspectForm({ edit, seed, onDone, onCancel, onReopened }: {
  edit?: Prospect; seed?: string; onDone: () => void; onCancel: () => void; onReopened?: (id: number) => void;
}) {
  // seed = a link pasted in the toolbar: the form opens with its name and ASIN already in.
  const [name, setName] = useState(edit?.name ?? (seed ? nameFromAmazonUrl(seed) : ''));
  const [amazon, setAmazon] = useState(edit?.asin ?? (seed ? asinFromAmazonUrl(seed) ?? seed.toUpperCase() : ''));
  const [rating, setRating] = useState<ProspectRating | null>(edit?.rating ?? null);
  const [comment, setComment] = useState('');
  const [rrp, setRrp] = useState(edit?.rrp ?? '');
  const [cost, setCost] = useState(edit?.cost ?? '');
  const [check, setCheck] = useState({ size: '', rank: '', price: '', sellers: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A pasted link: take the name from it (if none yet), then keep only the ASIN in the box — the rest of the link is noise.
  function pasteAmazon(v: string) {
    if (!name.trim()) setName(nameFromAmazonUrl(v));
    setAmazon(asinFromAmazonUrl(v) ?? v);
  }

  // Duplicate? Asked as soon as the box holds an ASIN, so you know before saving: already on this list, or one of our Amazon listings.
  const asinNow = /^[A-Za-z0-9]{10}$/.test(amazon.trim()) ? amazon.trim().toUpperCase() : null;
  const dup = useApiQuery(asinNow ? ['prospect-asin-check', asinNow, edit?.id ?? 0] : null, () => checkProspectAsin(asinNow!, edit?.id));

  const tested = asinNow && dup.data?.listed?.archived_at ? dup.data.listed : null;   // in the Archive: tested before

  async function reopen(id: number) {
    setBusy(true);
    setError(null);
    const res = await reopenProspect(id);
    setBusy(false);
    if (!res.success) { setError(res.error || 'Failed to reopen'); return; }
    onReopened?.(id);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await saveProspect({ id: edit?.id, name, amazon, rating, rrp, cost, ...(edit ? {} : { check, comment }) });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Failed to save'); return; }
    onDone();
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
      {/* The card spans the page; its fields stop at max-w-4xl so the boxes stay a typing width on a wide screen (2026-10-22). */}
      <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-slate-600">
          Amazon link or ASIN <span className="font-normal text-slate-400">(optional)</span>
          <span className="mt-1 flex gap-2">
            <input autoFocus={!seed} value={amazon} onChange={(e) => pasteAmazon(e.target.value)}
              placeholder="Paste the Amazon page address" className={`${inputCls} block min-w-0 flex-1`} />
            {/^[A-Za-z0-9]{10}$/.test(amazon.trim()) && <AmazonLink asin={amazon.trim().toUpperCase()} label="Open" />}
          </span>
        </label>
        <label className="text-xs font-medium text-slate-600">
          What is it
          <input autoFocus={!!seed} value={name} onChange={(e) => setName(e.target.value)} maxLength={200}
            placeholder="e.g. Rieker Y3453 ankle boot, black" className={`${inputCls} mt-1 block w-full`} />
        </label>
      </div>
      {/* Tested before (2026-10-26): the ASIN is on an archived line — its outcome and archive comment, and Reopen instead of a
          second line for the same style. */}
      {tested && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-sky-300 bg-sky-50 px-3 py-2 text-sm text-sky-900">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">TESTED BEFORE</span> — &ldquo;{tested.name}&rdquo;, archived by {tested.archived_by}{' '}
            {fmtWhen(tested.archived_at!)}: <span className="font-medium">{tested.last_note || OUTCOMES.find((o) => o.key === tested.outcome)?.label}</span>
          </span>
          {onReopened && (
            <button type="button" disabled={busy} onClick={() => reopen(tested.id)} className={smallBtn}>Reopen it</button>
          )}
        </div>
      )}
      {asinNow && dup.data && ((dup.data.listed && !tested) || dup.data.have) && (
        <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-semibold">DUPLICATE</span>
          {dup.data.listed && !tested && <> — already on this list: &ldquo;{dup.data.listed.name}&rdquo;, added by {dup.data.listed.owner}</>}
          {dup.data.have && <> — we already have it on Amazon as <span className="font-mono">{dup.data.have.groupid}</span></>}
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-slate-600">Rating</span>
        <RatingChips value={rating} onChange={setRating} />
      </div>
      {/* RRP sits with what you see on Amazon (owner: "saves putting it as the notes"). It belongs to the find, not to a check, so on
          an edit — where there are no check fields — it is on its own. */}
      <div className="mt-3">
        <div className="text-xs font-medium text-slate-600">
          {edit ? 'RRP and cost' : <>What you see now <span className="font-normal text-slate-400">(optional)</span></>}
        </div>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          {!edit && <CheckFields value={check} onChange={setCheck} />}
          <label className="text-xs text-slate-500">
            RRP £
            <input value={rrp} onChange={(e) => setRrp(e.target.value)} maxLength={30} className={`${inputCls} mt-1 block w-24`} />
          </label>
          {/* COST (2026-10-27) — what a pair would cost us; with the Amazon price it gives the line's return on cost. */}
          <label className="text-xs text-slate-500" title="What one pair would cost us — with the Amazon price it gives the return on cost">
            Cost £
            <input value={cost} onChange={(e) => setCost(e.target.value)} maxLength={30} className={`${inputCls} mt-1 block w-24`} />
          </label>
        </div>
      </div>
      {!edit && (
        <label className="mt-3 block max-w-4xl text-xs font-medium text-slate-600">
          Comment <span className="font-normal text-slate-400">(optional)</span>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={10000}
            placeholder="Anything — sizes, why it looks good, what to order…" className={`${inputCls} mt-1 block w-full`} />
        </label>
      )}
      {error && <p className="mt-3 text-sm text-red-700">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={save} disabled={busy || !name.trim()} className={primaryBtn}>
          {busy ? 'Saving…' : 'Save'}
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
  // All free text (owner: "Rank is 58k for example") — whatever is typed is kept.
  const field = (k: keyof CheckInput, label: string, w: string) => (
    <label className="text-xs text-slate-500">
      {label}
      <input value={value[k]} onChange={(e) => onChange({ ...value, [k]: e.target.value })}
        className={`${inputCls} mt-1 block ${w}`} />
    </label>
  );
  return (
    <div className="flex flex-wrap gap-2">
      {field('rank', 'Rank', 'w-28')}
      {field('price', 'Price £', 'w-24')}
    </div>
  );
}

// ---- One line --------------------------------------------------------------------------------------------------------------------
// ---- One find, closed: a single narrow row. Click it to open it (which closes any other). ------------------------------------------
function ProspectRow({ p, onOpen, onCut }: { p: Prospect; onOpen: () => void; onCut: () => void }) {
  const latest = p.checks.length ? p.checks[p.checks.length - 1] : null;
  const rating = RATINGS.find((r) => r.key === p.rating);
  const sinceLook = daysAgo(lastActivity(p));
  const outcome = OUTCOMES.find((o) => o.key === p.outcome);   // archived lines only
  // The row is a button (opens the card), so × sits beside it rather than inside — a button can't hold another button.
  return (
    <div className="flex items-center hover:bg-slate-50">
    <button type="button" onClick={onOpen}
      className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 text-left text-sm">
      <ChevronRightIcon className="h-4 w-4 shrink-0 text-slate-400" />
      <span className="w-20 shrink-0">
        {rating && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${rating.on}`}>{rating.label}</span>}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
      {p.have && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">DUPLICATE</span>}
      <span className="hidden w-24 shrink-0 tabular-nums text-slate-700 sm:block">{latest?.rank ? `Rank ${latest.rank}` : ''}</span>
      <span className="hidden w-16 shrink-0 text-right tabular-nums text-slate-700 sm:block">{latest?.price ? fmtMoney(latest.price) : ''}</span>
      <span className="hidden w-24 shrink-0 text-right tabular-nums text-slate-500 md:block">{p.rrp ? `RRP ${fmtMoney(p.rrp)}` : ''}</span>
      {/* RETURN ON COST (2026-10-27) — the one figure for "is this a good use of cash?". Blank until a cost and a price are typed. */}
      <span className="hidden w-24 shrink-0 text-right tabular-nums font-medium text-slate-800 sm:block"
        title={p.return_on_cost ? `Keeps £${p.return_on_cost.profit.toFixed(2)} a pair on Amazon at £${p.return_on_cost.price.toFixed(2)}, cost £${p.return_on_cost.cost.toFixed(2)}` : 'Type a cost and a price to see the return on cost'}>
        {p.return_on_cost ? `${p.return_on_cost.on_cost_pct.toFixed(0)}% on cost` : ''}
      </span>
      <span className="hidden w-8 shrink-0 text-right text-xs text-slate-400 md:block" title="Comments">{p.notes.length ? `💬${p.notes.length}` : ''}</span>
      {p.archived_at ? (
        // Archived: the decision, who made it and when — not "since checked", which no longer matters.
        <>
          {outcome && <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${outcome.on}`}>{outcome.label}</span>}
          <span className="w-28 shrink-0 text-right text-xs text-slate-400" title={`Archived by ${p.archived_by}`}>
            {p.archived_by} · {fmtWhen(p.archived_at)}
          </span>
        </>
      ) : (
        <span className={`w-28 shrink-0 text-right text-xs ${sinceLook >= STALE_DAYS ? 'text-amber-700' : 'text-slate-400'}`}
          title={sinceLook >= STALE_DAYS ? `Not checked for ${sinceLook} days` : undefined}>
          {p.owner} · {fmtWhen(lastActivity(p))}
        </span>
      )}
    </button>
    <button type="button" onClick={onCut} title="Cut from the list — Refresh brings it back" aria-label={`Cut ${p.name}`}
      className="mx-2 shrink-0 rounded p-0.5 text-slate-300 hover:bg-slate-200 hover:text-slate-700">
      <XMarkIcon className="h-4 w-4" />
    </button>
    </div>
  );
}

// ---- One find, open: everything, editable. An ARCHIVED find opens read-only — its checks and comments, Reopen or Delete. ------------
function ProspectCard({ p, onChanged, onClose }: { p: Prospect; onChanged: () => void; onClose: () => void }) {
  const [editing, setEditing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [history, setHistory] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Delete on an active line asks why: Ordered / Dropped archive it (the optional reason is written as its last comment by the
  // server), 'delete' deletes it for good.
  const [deciding, setDeciding] = useState(false);
  const [outcome, setOutcome] = useState<ProspectOutcome | 'delete' | null>(null);
  const [reason, setReason] = useState('');
  const [check, setCheck] = useState<CheckInput & { amazon: string }>({ size: '', rank: '', price: '', sellers: '', amazon: '' });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const latest = p.checks.length ? p.checks[p.checks.length - 1] : null;   // checks arrive oldest first
  const sinceLook = daysAgo(lastActivity(p));
  const archived = !!p.archived_at;
  const archivedAs = OUTCOMES.find((o) => o.key === p.outcome);

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
    <article className="bg-slate-50/70 p-4 ring-1 ring-inset ring-slate-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <button type="button" onClick={onClose} title="Close" className="flex items-center gap-1.5 text-left font-semibold text-slate-900 hover:text-slate-600">
            <ChevronDownIcon className="h-4 w-4 shrink-0 text-slate-400" />
            {p.name}
          </button>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
            {p.asin && <span className="font-mono">{p.asin}</span>}
            {p.rrp && <span className="font-medium text-slate-700">RRP {fmtMoney(p.rrp)}</span>}
            {p.cost && <span className="font-medium text-slate-700">Cost {fmtMoney(p.cost)}</span>}
            {p.return_on_cost && (
              <span className="rounded bg-white px-1.5 py-0.5 font-semibold text-slate-800 ring-1 ring-slate-200"
                title="What a pair keeps on Amazon at the latest price — after VAT, 15% referral, FBA, courier and wages, ÷1.2 for returns — over the cost">
                Keeps £{p.return_on_cost.profit.toFixed(2)} a pair · {p.return_on_cost.on_cost_pct.toFixed(0)}% on cost
              </span>
            )}
            <span>{p.owner} · added {fmtWhen(p.created_at)}</span>
            {archived ? (
              <span className="inline-flex items-center gap-1.5">
                {archivedAs && <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${archivedAs.on}`}>{archivedAs.label}</span>}
                archived by {p.archived_by} {fmtWhen(p.archived_at!)}
              </span>
            ) : sinceLook >= STALE_DAYS && <span className="text-amber-700">not checked for {sinceLook} days</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {p.asin && <AmazonLink asin={p.asin} label="Open on Amazon" />}
          <HaveBadge p={p} />
        </div>
      </div>

      <div className="mt-2">
        <RatingChips value={p.rating} disabled={busy || archived}
          onChange={(r) => run(() => saveProspect({ id: p.id, name: p.name, amazon: p.asin ?? '', rating: r }))} />
      </div>

      {/* The latest check — earlier ones are in History. Sellers and size are hidden for now (owner, 2026-10-21); the columns stay. */}
      {latest && (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2 text-sm text-slate-700">
          {latest.rank !== null && <span>Rank <span className="font-semibold tabular-nums">{latest.rank}</span></span>}
          {latest.price !== null && <span>{latest.rank !== null && '· '}{fmtMoney(latest.price)}</span>}
          <span className="text-xs text-slate-400">{latest.checked_by}, {fmtWhen(latest.checked_at)}</span>
        </div>
      )}

      {/* Comments — the line's one place for writing (owner, 2026-10-21: "Should we just have comments?"), each with who and when */}
      {p.notes.length > 0 && (
        <ul className="mt-3 space-y-1.5 border-l-2 border-slate-100 pl-3">
          {p.notes.map((n) => (
            <li key={n.id} className="group text-sm text-slate-700">
              <span className="whitespace-pre-wrap">{n.body}</span>
              <span className="ml-2 text-xs text-slate-400">{n.created_by}, {fmtWhen(n.created_at)}</span>
              {!archived && (
                <button type="button" title="Delete this comment" disabled={busy}
                  onClick={() => run(() => deleteProspectItem('note', n.id))}
                  className="ml-1 align-middle text-slate-300 opacity-0 hover:text-red-600 group-hover:opacity-100">
                  <TrashIcon className="inline h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!archived && <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => { e.preventDefault(); if (note.trim()) run(() => addProspectNote(p.id, note), () => setNote('')); }}
      >
        {/* Multi-line, any length: Enter is a new line, the button posts it. */}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={10000}
          rows={Math.min(10, Math.max(2, note.split('\n').length))}
          placeholder="Add a comment — sizes, price thoughts, anything" className={`${inputCls} min-w-0 flex-1`} />
        <button type="submit" disabled={busy || !note.trim()} className={`${smallBtn} self-end`}>Comment</button>
      </form>}

      {checking && (
        <div className="mt-3 rounded-md bg-slate-50 p-3">
          <div className="text-xs font-medium text-slate-600">What you see on Amazon now</div>
          <div className="flex flex-wrap items-end gap-2">
            <CheckFields value={check} onChange={(v) => setCheck({ ...check, ...v })} />
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
              <th className="py-1 pr-3 text-right font-medium">Rank</th>
              <th className="py-1 pr-3 text-right font-medium">Price</th>
              <th className="py-1 pr-3 font-medium">Who</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {[...p.checks].reverse().map((c) => (
              <tr key={c.id} className="border-b border-slate-100 text-slate-700 last:border-0">
                <td className="py-1 pr-3 whitespace-nowrap">{fmtWhen(c.checked_at)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.rank ?? ''}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{c.price !== null ? fmtMoney(c.price) : ''}</td>
                <td className="py-1 pr-3">{c.checked_by}</td>
                <td className="py-1 text-right">
                  {!archived && (
                    <button type="button" title="Delete this check" disabled={busy}
                      onClick={() => run(() => deleteProspectItem('check', c.id))} className="text-slate-300 hover:text-red-600">
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* DELETE ASKS WHY (owner, 2026-10-26: "Archive might need training. They will press delete") — the team's one button off the
          list. Ordered / Dropped ARCHIVE the line (kept 6 months, so a colleague who finds the style again knows it was tested); only
          "Delete for good" really deletes. There is no separate Archive button on purpose. */}
      {deciding && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-600">Why is it going?</span>
            {OUTCOMES.map((o) => (
              <button key={o.key} type="button" onClick={() => setOutcome(o.key)}
                className={'rounded-full border px-2.5 py-0.5 text-xs font-medium transition '
                  + (outcome === o.key ? o.on : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
                {o.label}
              </button>
            ))}
            <button type="button" onClick={() => setOutcome('delete')}
              className={'rounded-full border px-2.5 py-0.5 text-xs font-medium transition '
                + (outcome === 'delete' ? 'border-red-300 bg-red-100 text-red-800' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50')}>
              Delete for good
            </button>
          </div>
          {outcome && outcome !== 'delete' && (
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000}
              placeholder="Why? (optional) — e.g. rank too low, too many sellers"
              className={`${inputCls} mt-2 block w-full max-w-2xl`} />
          )}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {outcome === 'delete' ? (
              <button type="button" disabled={busy} onClick={() => run(() => deleteProspectItem('prospect', p.id))}
                className="rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                Delete for good
              </button>
            ) : (
              <button type="button" disabled={busy || !outcome} className={smallBtn}
                onClick={() => run(() => archiveProspect(p.id, outcome as ProspectOutcome, reason), onClose)}>
                Move to Archive
              </button>
            )}
            <button type="button" onClick={() => { setDeciding(false); setOutcome(null); }}
              className="px-2 text-xs text-slate-500 hover:text-slate-700">Cancel</button>
            <span className="text-xs text-slate-400">
              {outcome === 'delete' ? 'Gone with its checks and comments — nothing kept.'
                : 'Kept in the Archive for 6 months with its checks and comments, then removed.'}
            </span>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {!archived && !checking && <button type="button" onClick={() => setChecking(true)} className={smallBtn}>+ Check rank again</button>}
        {p.checks.length > 1 && (
          <button type="button" onClick={() => setHistory(!history)} className={smallBtn}>
            {history ? 'Hide history' : `History · ${p.checks.length}`}
          </button>
        )}
        {!archived && <button type="button" onClick={() => setEditing(true)} className={smallBtn}>Edit</button>}
        {archived && (
          // Reopen: back on the list with everything it had; archiving it again starts a new 6 months.
          <button type="button" disabled={busy} onClick={() => run(() => reopenProspect(p.id), onClose)} className={smallBtn}>
            Reopen
          </button>
        )}
        <span className="ml-auto">
          {!archived ? (
            // An active line: Delete opens "Why is it going?" above.
            !deciding && (
              <button type="button" onClick={() => setDeciding(true)}
                className="inline-flex items-center gap-1 text-xs text-slate-400 hover:text-red-600">
                <TrashIcon className="h-4 w-4" /> Delete
              </button>
            )
          ) : confirmDelete ? (
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

// Shown ONLY when we already have it — one of our Amazon listings carries an ASIN on this line. Every find is meant to be new, so new
// says nothing (owner, 2026-10-21: "Do we need NEW TO US? They should all be. Maybe just show if DUPLICATE").
function HaveBadge({ p }: { p: Prospect }) {
  if (!p.have) return null;
  return (
    <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800" title={`We already have this on Amazon as ${p.have.groupid}`}>
      DUPLICATE
    </span>
  );
}
