'use client';
/*
=======================================================================================================================================
Page: /pricing/[segment]  (Stage 1 — the segment's lists)
=======================================================================================================================================
Purpose: The list view for a segment, with a prominent WINNERS | LOSERS switch (see CLAUDE.md).
  - WINNERS: top sellers in the last 30 days (in stock, not parked) — candidates to price UP / harvest.
  - LOSERS:  slowest-moving stock over 90 days — dead (no recent sales) first, then the biggest stuck piles — candidates to cut and
             get moving. Ranked by stock at risk.
Both lists are fetched up front (so each tab shows a live count) and cached; rows link to the same drill page. The active mode is kept
in the URL (?mode=) so returning after a write restores the same tab.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ListModeSwitcher, { ListMode } from '@/components/ListModeSwitcher';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import { getTriage, getLosers, getAll, applyPrice, parkStyleBulk, TriageRow, LoserRow, AllRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { getActionedCount, bumpActionedCount } from '@/lib/sessionCounter';

// Bulk price + review controls — kept identical to the Shopify drill's price-setter (owner: "exactly the same as the individual item").
// Nudge denominations = the drill's −£1/−50p/+50p/+£1/+£2 steps; review chips = the drill's day set. Shopify green tone throughout.
const SHP_NUDGES: Nudge[] = [
  { label: '−£1', delta: -1 }, { label: '−50p', delta: -0.5 },
  { label: '+50p', delta: 0.5 }, { label: '+£1', delta: 1 }, { label: '+£2', delta: 2 },
];
const SHP_REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];
const SHP_TONE: BulkTone = {
  chipOn: 'border-brand-600 bg-brand-600 text-white',
  applyBtn: 'bg-emerald-600 hover:bg-emerald-700',
  panel: 'border-slate-200',
};

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function SegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

// Compact date for the ALL table (YYYY-MM-DD -> "8 Jul 2026"). null-safe.
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}
function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}
// A YYYY-MM-DD is a future (still-parked) review when it sorts after today's YYYY-MM-DD (lexicographic works for this format).
function isFutureIso(iso: string | null): boolean {
  if (!iso) return false;
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return iso > today;
}

function SegmentContent() {
  const router = useRouter();
  const params = useParams<{ segment: string }>();
  const searchParams = useSearchParams();
  const segment = decodeURIComponent(params.segment);
  const { logout } = useAuth();

  const modeParam = searchParams.get('mode');
  const initialMode: ListMode = modeParam === 'losers' ? 'losers' : modeParam === 'all' ? 'all' : 'winners';
  const [mode, setMode] = useState<ListMode>(initialMode);

  // Where "← back" returns to. Threaded via ?from=/&back= so arriving from the Segments module returns you to that segment's detail —
  // not to /pricing (the Shopify Pricing home), which is a *different* list of segments and was the source of the "it took me to
  // Shopify Pricing" confusion. Absent params (i.e. you came from /pricing itself) fall back to that home, labelled "Segments".
  const backHref = searchParams.get('from') || '/pricing';
  const backLabel = searchParams.get('back') || 'Segments';

  const [winners, setWinners] = useState<TriageRow[] | null>(null);
  const [losers, setLosers] = useState<LoserRow[] | null>(null);
  const [all, setAll] = useState<AllRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Session-only "actioned" count for this segment (bumped by the drill page on a successful apply/park). Winners is a live top-10
  // that refills as you clear it, so this exists purely to make one sitting feel bounded — re-read on every mount, i.e. every time
  // you return here from the drill page.
  const [actioned, setActioned] = useState(0);

  // Bulk selection (WINNERS/LOSERS only) — the groupids ticked for a bulk price move and/or review. Cleared on mode/segment change.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);                        // a bulk write is in flight (disables the bar)
  const [markError, setMarkError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-style apply progress
  const [resultSummary, setResultSummary] = useState<string | null>(null);                 // outcome line from the last bulk run

  // Fetch all three lists so each tab can show a count. Re-callable so a bulk write can refetch (parked/changed styles drop out, list refills).
  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [w, l, a] = await Promise.all([getTriage(segment), getLosers(segment), getAll(segment)]);
    if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED' || a.return_code === 'UNAUTHORIZED') { logout(); return; }
    let err: string | null = null;
    if (w.success && w.data) setWinners(w.data.rows); else err = err || w.error || 'Failed to load winners';
    if (l.success && l.data) setLosers(l.data.rows); else err = err || l.error || 'Failed to load losers';
    if (a.success && a.data) setAll(a.data.rows); else err = err || a.error || 'Failed to load all styles';
    if (err) setError(err);
    setLoading(false);
  }, [segment, logout]);

  useEffect(() => { loadLists(); }, [loadLists]);
  // A different tab / segment is a different selection — never carry ticks (or a stale result line) across.
  useEffect(() => { setSelected(new Set()); setMarkError(null); setResultSummary(null); }, [mode, segment]);
  useEffect(() => { setActioned(getActionedCount(segment)); }, [segment]);

  function openStyle(groupid: string) {
    // Carry the back-context (from/back) into the return URL so it survives the drill round-trip (returning from a price apply keeps
    // pointing at the right "back" target rather than reverting to /pricing).
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Segments')}` : '';
    const from = `/pricing/${encodeURIComponent(segment)}?mode=${mode}${ctx}`;
    router.push(`/pricing/style/${encodeURIComponent(groupid)}?from=${encodeURIComponent(from)}`);
  }

  function toggle(groupid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
      return next;
    });
  }
  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((g) => next.add(g)); else ids.forEach((g) => next.delete(g));
      return next;
    });
  }

  // The ticked rows from the active list — the bulk price loop needs each style's current price to compute its per-row delta.
  const selectedRows = (): (TriageRow | LoserRow)[] => {
    const list = (mode === 'winners' ? winners : mode === 'losers' ? losers : null) || [];
    return list.filter((r) => selected.has(r.groupid));
  };

  // BULK PRICE MOVE — loop POST /pricing-apply (W1) per ticked style (newPrice = its current price + delta), exactly like applying one at
  // a time, so each write runs the same server bounds AND the live Shopify + Google pushes. reviewDays rides along as an optional park
  // (mirrors the drill). Styles with an unknown current price (junk VARCHAR -> null) are skipped; the server may also block one below cost
  // — both are reported in the summary, not surfaced as hard errors (owner: "ignore blocked/below-min for now").
  async function bulkApplyPrice(delta: number, reviewDays: number | null, note: string) {
    const targets = selectedRows();
    if (targets.length === 0 || Math.abs(delta) < 0.005) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, skipped = 0, pushIssues = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (row.price === null) { skipped++; setProgress({ done: i + 1, total: targets.length }); continue; }
      const newPrice = Math.round((row.price + delta) * 100) / 100;
      const res = await applyPrice(row.groupid, newPrice, reviewDays, note);
      if (res.success && res.data) {
        applied++;
        // The DB price is saved either way; a failed live push (Shopify hard, Google soft) is noted so the operator can re-check those.
        if ((res.data.shopify && res.data.shopify.pushed === false) || (res.data.google && res.data.google.pushed === false)) pushIssues++;
      } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
      else { skipped++; }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    if (applied > 0) setActioned(bumpActionedCount(segment, applied));
    setResultSummary(`Applied ${applied}${skipped ? ` · ${skipped} skipped` : ''}${pushIssues ? ` · ${pushIssues} push issue${pushIssues > 1 ? 's' : ''}` : ''}`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK REVIEW ONLY — park the ticked styles with no price change (batch POST /pricing-park-bulk, W2). On success clear + refetch so the
  // parked styles drop off the triage and it refills.
  async function bulkSetReview(days: number) {
    if (selected.size === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    const res = await parkStyleBulk(Array.from(selected), days);
    setMarking(false);
    if (res.success) {
      const n = res.data ? res.data.updated : selected.size;
      setActioned(bumpActionedCount(segment, n));
      setResultSummary(`Review set on ${n}`);
      setSelected(new Set());
      await loadLists();
    }
    else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setMarkError(res.error || 'Failed to set review');
  }

  const rows = mode === 'winners' ? winners : mode === 'losers' ? losers : all;
  const isEmpty = !loading && !error && rows !== null && rows.length === 0;
  const selectable = mode === 'winners' || mode === 'losers';

  return (
    <AppShell title={segment} backHref={backHref} backLabel={backLabel}>
      <ListModeSwitcher
        mode={mode}
        onChange={setMode}
        winnersCount={winners ? winners.length : null}
        losersCount={losers ? losers.length : null}
        allCount={all ? all.length : null}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {isEmpty && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners'
            ? 'No styles to review here right now (nothing in stock with recent sales, or all parked).'
            : mode === 'losers'
              ? 'No losers here right now — nothing stuck in this segment (or all parked).'
              : 'No styles in this segment.'}
        </div>
      )}

      {/* Bulk edit control (WINNERS/LOSERS): apply a relative price move and/or set a review across the ticked styles. Same denominations
          and review chips as the drill; a price move loops POST /pricing-apply (W1, live push per style), review-only uses /pricing-park-bulk. */}
      {!loading && !error && selectable && rows && rows.length > 0 && (
        <BulkActionBar
          channel="shopify"
          count={selected.size}
          nudges={SHP_NUDGES}
          reviewChips={SHP_REVIEW_CHIPS}
          tone={SHP_TONE}
          busy={marking}
          progress={progress}
          resultSummary={resultSummary}
          error={markError}
          onApplyPrice={bulkApplyPrice}
          onSetReview={bulkSetReview}
        />
      )}

      {!loading && !error && mode === 'winners' && winners && winners.length > 0 && (
        <>
          {actioned > 0 && (
            <p className="mb-2 text-xs text-slate-400">
              {actioned} actioned this session — the list refills from the segment as you go, so it always shows the current top {winners.length}.
            </p>
          )}
          <WinnersTable rows={winners} onOpen={openStyle} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'losers' && losers && losers.length > 0 && (
        <>
          {actioned > 0 && (
            <p className="mb-2 text-xs text-slate-400">
              {actioned} actioned this session — parked styles drop off as you work, so the list refills from the segment.
            </p>
          )}
          <LosersTable rows={losers} onOpen={openStyle} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'all' && all && all.length > 0 && (
        <AllTable rows={all} onOpen={openStyle} />
      )}
    </AppShell>
  );
}

// Shared, FIXED column geometry for the WINNERS and LOSERS tables (owner: they must line up when you switch tabs). Without table-fixed
// each table auto-sizes its columns to its own content — two-digit unit counts vs one-digit made the headers/Code wrap differently and
// the columns drift between tabs. A fixed colgroup + matching widths pins both tables to the same layout regardless of the data.
const ListCols = () => (
  <colgroup>
    <col className="w-12" />{/* checkbox */}
    <col className="w-12" />{/* # */}
    <col className="w-24" />{/* Units (30d) */}
    <col className="w-40" />{/* Code */}
    <col />{/* Product — takes the remaining width */}
    <col className="w-28" />{/* Price */}
    <col className="w-20" />{/* Stock */}
  </colgroup>
);

function WinnersTable({ rows, onOpen, selected, onToggle, onToggleAll }: {
  rows: TriageRow[]; onOpen: (g: string) => void;
  selected: Set<string>; onToggle: (g: string) => void; onToggleAll: (ids: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.groupid));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed text-sm">
        <ListCols />
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.groupid), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Units (30d)</th>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.groupid) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.groupid)} onToggle={() => onToggle(r.groupid)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{r.units}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
              <td className="truncate px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.stock}</td>
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
      aria-label="Select style for bulk edit"
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
      aria-label="Select all styles"
    />
  );
}

function AllTable({ rows, onOpen }: { rows: AllRow[]; onOpen: (g: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
            <th className="px-4 py-2 font-medium">Changed</th>
            <th className="px-4 py-2 font-medium">Review</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className={'px-4 py-2 text-right ' + (r.stock === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.stock}</td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDate(r.last_change)}</td>
              {/* Review date only (no jargon). A future date (review still active → held out of the Winners/Losers lists) is amber
                  so it stands out; a past/absent one is muted. */}
              <td className="whitespace-nowrap px-4 py-2">
                {r.next_review
                  ? <span className={isFutureIso(r.next_review) ? 'font-medium text-amber-700' : 'text-slate-400'}>{fmtDate(r.next_review)}</span>
                  : <span className="text-slate-400">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LosersTable({ rows, onOpen, selected, onToggle, onToggleAll }: {
  rows: LoserRow[]; onOpen: (g: string) => void;
  selected: Set<string>; onToggle: (g: string) => void; onToggleAll: (ids: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.groupid));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      {/* Columns AND their fixed widths are kept identical to WinnersTable (owner: "use the Winners columns for LOSERS" + they must
          line up when switching tabs). LoserRow.u30 is the 30-day units figure that maps onto the shared "Units (30d)" column. */}
      <table className="w-full table-fixed text-sm">
        <ListCols />
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.groupid), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Units (30d)</th>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.groupid) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.groupid)} onToggle={() => onToggle(r.groupid)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{r.u30}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
              <td className="truncate px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
