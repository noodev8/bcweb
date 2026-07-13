'use client';
/*
=======================================================================================================================================
Page: /amz/[segment]  (Stage 1 — the segment's SKU lists)
=======================================================================================================================================
Purpose: The list view for a segment, with the same prominent WINNERS | LOSERS switch as Shopify — but SKU-grain (Amazon prices per size).
  - WINNERS: top in-stock SKUs by units sold in the last 30 days — candidates to price UP / harvest.
  - LOSERS:  dead (no Amazon sale in 14 days) / slow (cover >= 16 weeks) FBA stock — candidates to cut and get moving. Dead first, then
             most FBA stock at risk.
  - ALL:     every managed SKU in the segment, most-recently-changed first (browse/lookup).
Because a groupid's sizes each have their own price, one colour can have fast sizes in WINNERS and dead sizes in LOSERS at the same time.
All three lists are fetched up front (so each tab shows a live count) and cached; rows link to the per-SKU drill. The active mode is kept
in the URL (?mode=) so returning after an apply restores the same tab. A queued SKU (in the upload basket) shows a "queued" badge.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import ListModeSwitcher, { ListMode } from '@/components/ListModeSwitcher';
import { getAmzWinners, getAmzLosers, getAmzAll, markAmzReviewed, AmzWinnerRow, AmzLoserRow, AmzAllRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';
import { getActionedCount, bumpActionedCount } from '@/lib/sessionCounter';

// Park-period pills for the batch "mark reviewed" action. Amazon-native cadence (faster than the segment 1w–6m set): a reviewed-but-
// unchanged SKU comes back round within a couple of months. Value = days; matches the amz-apply default of 14 (2w).
const AMZ_REVIEW_CHIPS: { days: number; label: string }[] = [
  { days: 7, label: '1w' },
  { days: 14, label: '2w' },
  { days: 30, label: '1m' },
  { days: 60, label: '2m' },
];

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzSegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

// Present a big cover figure gently — exact weeks are directional only below a few sales.
function coverLabel(weeks: number | null): string {
  if (weeks === null) return '—';
  if (weeks >= 104) return '2+ yrs';
  if (weeks >= 52) return '1+ yr';
  return `${Math.round(weeks)} wk`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

function SegmentContent() {
  const router = useRouter();
  const params = useParams<{ segment: string }>();
  const searchParams = useSearchParams();
  const segment = decodeURIComponent(params.segment);
  const { logout } = useAuth();
  const { items } = useAmzBasket();

  const modeParam = searchParams.get('mode');
  const initialMode: ListMode = modeParam === 'losers' ? 'losers' : modeParam === 'all' ? 'all' : 'winners';
  const [mode, setMode] = useState<ListMode>(initialMode);

  // Back target — threaded via ?from=/&back= so arriving from the Segments module returns you to that segment's detail rather than to
  // /amz (the Amazon Pricing home). Absent params fall back to that home, labelled "Segments". Mirrors the Shopify segment page.
  const backHref = searchParams.get('from') || '/amz';
  const backLabel = searchParams.get('back') || 'Segments';

  const [winners, setWinners] = useState<AmzWinnerRow[] | null>(null);
  const [losers, setLosers] = useState<AmzLoserRow[] | null>(null);
  const [all, setAll] = useState<AmzAllRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Batch "mark reviewed" selection (WINNERS/LOSERS only) — the codes ticked for parking-without-pricing. Cleared on mode/segment change.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);
  const [markError, setMarkError] = useState<string | null>(null);

  // Session-only "actioned" count for this segment (bumped by the drill on a successful apply/park). Winners/Losers are live shortlists
  // that refill as you work, so this answers "am I getting anywhere". Re-read on segment change and after returning from the drill.
  const [actioned, setActioned] = useState(0);

  // Fetch all three lists so each tab can show a count. Re-callable so a mark-reviewed can refetch (parked SKUs drop out, queue refills).
  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [w, l, a] = await Promise.all([getAmzWinners(segment), getAmzLosers(segment), getAmzAll(segment)]);
    if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED' || a.return_code === 'UNAUTHORIZED') { logout(); return; }
    let err: string | null = null;
    if (w.success && w.data) setWinners(w.data.rows); else err = err || w.error || 'Failed to load winners';
    if (l.success && l.data) setLosers(l.data.rows); else err = err || l.error || 'Failed to load losers';
    if (a.success && a.data) setAll(a.data.rows); else err = err || a.error || 'Failed to load all SKUs';
    if (err) setError(err);
    setLoading(false);
  }, [segment, logout]);

  useEffect(() => { loadLists(); }, [loadLists]);
  // A different tab / segment is a different selection — never carry ticks across.
  useEffect(() => { setSelected(new Set()); setMarkError(null); }, [mode, segment]);
  // Read the session "actioned" count on mount / segment change — the drill bumps it, and returning here remounts this page so it refreshes.
  useEffect(() => { setActioned(getActionedCount(segment)); }, [segment]);

  function openSku(code: string) {
    // Carry the back-context (from/back) through the drill round-trip so returning keeps the right "back" target.
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Segments')}` : '';
    const from = `/amz/${encodeURIComponent(segment)}?mode=${mode}${ctx}`;
    router.push(`/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(from)}`);
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }
  function toggleAll(codes: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) codes.forEach((c) => next.add(c)); else codes.forEach((c) => next.delete(c));
      return next;
    });
  }

  // Park the ticked SKUs (spec §10.5B). On success clear the selection and refetch so parked SKUs drop off and the queue refills.
  async function markReviewed(days: number) {
    if (selected.size === 0) return;
    setMarking(true); setMarkError(null);
    const res = await markAmzReviewed(Array.from(selected), days);
    setMarking(false);
    if (res.success) {
      // Count the parked SKUs toward the session tally (soft "how many have I actioned"). Use the server's updated count, falling back to
      // the selection size. Update the displayed count in place — we stay on the list here, so there's no remount to re-read it.
      const n = res.data ? res.data.updated : selected.size;
      setActioned(bumpActionedCount(segment, n));
      setSelected(new Set());
      await loadLists();
    }
    else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setMarkError(res.error || 'Failed to mark reviewed');
  }

  const rows = mode === 'winners' ? winners : mode === 'losers' ? losers : all;
  const isEmpty = !loading && !error && rows !== null && rows.length === 0;
  const selectable = mode === 'winners' || mode === 'losers';

  return (
    <AppShell title={segment} backHref={backHref} backLabel={backLabel}>
      <AmzBasketBar />

      <ListModeSwitcher
        mode={mode}
        onChange={setMode}
        winnersCount={winners ? winners.length : null}
        losersCount={losers ? losers.length : null}
        allCount={all ? all.length : null}
        allDescription="every managed SKU in the segment — incl. out of stock, most-recently-changed first"
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {isEmpty && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners'
            ? 'No SKUs to harvest here right now (nothing in FBA stock with sales in the last 30 days).'
            : mode === 'losers'
              ? 'No losers here right now — nothing dead or overstocked in this segment.'
              : 'No managed Amazon SKUs in this segment.'}
        </div>
      )}

      {/* Batch mark-reviewed control (WINNERS/LOSERS): park the SKUs you looked at but left unchanged, so they leave the queue. */}
      {!loading && !error && selectable && rows && rows.length > 0 && (
        <MarkReviewedBar count={selected.size} busy={marking} error={markError} onMark={markReviewed} />
      )}

      {!loading && !error && mode === 'winners' && winners && winners.length > 0 && (
        <>
          {actioned > 0 && (
            <p className="mb-2 text-xs text-slate-400">
              {actioned} actioned this session — the list refills from the segment as you go, so it always shows the current top {winners.length}.
            </p>
          )}
          <WinnersTable rows={winners} queued={items} onOpen={openSku} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'losers' && losers && losers.length > 0 && (
        <>
          {actioned > 0 && (
            <p className="mb-2 text-xs text-slate-400">
              {actioned} actioned this session — parked SKUs drop off as you work, so the list refills from the segment.
            </p>
          )}
          <LosersTable rows={losers} queued={items} onOpen={openSku} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'all' && all && all.length > 0 && (
        <AllTable rows={all} queued={items} onOpen={openSku} />
      )}
    </AppShell>
  );
}

// The batch mark-reviewed action bar: pick a park period, then park the currently-ticked SKUs. Disabled until at least one is ticked.
function MarkReviewedBar({ count, busy, error, onMark }: { count: number; busy: boolean; error: string | null; onMark: (days: number) => void }) {
  const [days, setDays] = useState(14);   // default 2w for the batch review-without-pricing (independent of the drill's per-apply review)
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-medium text-slate-700">
          {count > 0 ? `${count} selected` : 'Select SKUs to mark reviewed'}
        </span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-400">park for</span>
          {AMZ_REVIEW_CHIPS.map((c) => (
            <button
              key={c.days}
              onClick={() => setDays(c.days)}
              className={'rounded-full border px-2.5 py-1 text-xs ' + (days === c.days ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-white')}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={() => onMark(days)}
          disabled={busy || count === 0}
          className="ml-auto rounded-md bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          {busy ? 'Marking…' : `Mark ${count > 0 ? count + ' ' : ''}reviewed`}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-slate-400">
        For SKUs you reviewed but are leaving unchanged — they drop off this list and come back round after the park period. Applying a
        price already parks a SKU on its own.
      </p>
      {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
    </div>
  );
}

// A small "queued" pill for a SKU already in the upload basket (so you don't re-touch it mid-sitting).
function QueuedPill() {
  return <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">queued</span>;
}

type Queued = Record<string, unknown>;

function WinnersTable({ rows, queued, onOpen, selected, onToggle, onToggleAll }: {
  rows: AmzWinnerRow[]; queued: Queued; onOpen: (c: string) => void;
  selected: Set<string>; onToggle: (c: string) => void; onToggleAll: (codes: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.code));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.code), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">Units 30d</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.code) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.code)} onToggle={() => onToggle(r.code)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.units}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u7 || <span className="text-slate-300">0</span>}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.fba}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Row checkbox — stops the click bubbling to the row (which would open the drill instead of toggling selection).
function RowBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={onToggle}
      className="h-4 w-4 rounded border-slate-300"
      aria-label="Select SKU for mark-reviewed"
    />
  );
}
function SelectAllBox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300"
      aria-label="Select all SKUs"
    />
  );
}

function LosersTable({ rows, queued, onOpen, selected, onToggle, onToggleAll }: {
  rows: AmzLoserRow[]; queued: Queued; onOpen: (c: string) => void;
  selected: Set<string>; onToggle: (c: string) => void; onToggleAll: (codes: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.code));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.code), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">30d</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 90 days">90d</th>
            <th className="px-4 py-2 text-right font-medium" title="Weeks of cover at the 90-day pace">Cover</th>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.code) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.code)} onToggle={() => onToggle(r.code)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              {/* FBA stock is the ranking metric within each cluster — emphasised. */}
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.fba}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u30}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u90}</td>
              <td className="px-4 py-2 text-right">
                {r.is_dead
                  ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">no recent sales</span>
                  : <span className="tabular-nums text-slate-700">{coverLabel(r.cover_weeks)}</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllTable({ rows, queued, onOpen }: { rows: AmzAllRow[]; queued: Queued; onOpen: (c: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            <th className="px-4 py-2 font-medium">Changed</th>
            <th className="px-4 py-2 font-medium">Last sold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className={'px-4 py-2 text-right ' + (r.fba === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.fba}</td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDate(r.last_change)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{fmtDate(r.last_sold)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
