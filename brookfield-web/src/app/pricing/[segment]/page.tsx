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

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import ListModeSwitcher, { ListMode } from '@/components/ListModeSwitcher';
import { getTriage, getLosers, TriageRow, LoserRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function SegmentPage() {
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

function SegmentContent() {
  const router = useRouter();
  const params = useParams<{ segment: string }>();
  const searchParams = useSearchParams();
  const segment = decodeURIComponent(params.segment);
  const { logout } = useAuth();

  const initialMode: ListMode = searchParams.get('mode') === 'losers' ? 'losers' : 'winners';
  const [mode, setMode] = useState<ListMode>(initialMode);

  const [winners, setWinners] = useState<TriageRow[] | null>(null);
  const [losers, setLosers] = useState<LoserRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch both lists up front so each tab can show a count. Cached for the life of the page.
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const [w, l] = await Promise.all([getTriage(segment), getLosers(segment)]);
      if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (w.success && w.data) setWinners(w.data.rows); else setError(w.error || 'Failed to load winners');
      if (l.success && l.data) setLosers(l.data.rows); else if (!error) setError(l.error || 'Failed to load losers');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  function openStyle(groupid: string) {
    const from = `/pricing/${encodeURIComponent(segment)}?mode=${mode}`;
    router.push(`/pricing/style/${encodeURIComponent(groupid)}?from=${encodeURIComponent(from)}`);
  }

  const rows = mode === 'winners' ? winners : losers;
  const isEmpty = !loading && !error && rows !== null && rows.length === 0;

  return (
    <AppShell title={segment} backHref="/pricing" backLabel="Segments">
      <ListModeSwitcher
        mode={mode}
        onChange={setMode}
        winnersCount={winners ? winners.length : null}
        losersCount={losers ? losers.length : null}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {isEmpty && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners'
            ? 'No styles to review here right now (nothing in stock with recent sales, or all parked).'
            : 'No losers here right now — nothing stuck in this segment (or all parked).'}
        </div>
      )}

      {!loading && !error && mode === 'winners' && winners && winners.length > 0 && (
        <WinnersTable rows={winners} onOpen={openStyle} />
      )}
      {!loading && !error && mode === 'losers' && losers && losers.length > 0 && (
        <LosersTable rows={losers} onOpen={openStyle} />
      )}
    </AppShell>
  );
}

function WinnersTable({ rows, onOpen }: { rows: TriageRow[]; onOpen: (g: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium">Units (30d)</th>
            <th className="px-4 py-2 font-medium">Code</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 font-semibold text-slate-800">{r.units}</td>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.stock}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LosersTable({ rows, onOpen }: { rows: LoserRow[]; onOpen: (g: string) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
            <th className="px-4 py-2 text-right font-medium">Sold 30d</th>
            <th className="px-4 py-2 text-right font-medium">Sold 90d</th>
            <th className="px-4 py-2 text-right font-medium">Cover</th>
            <th className="px-4 py-2 font-medium">Product</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              {/* Stock is the ranking metric — emphasised. */}
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.stock}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u30}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u90}</td>
              <td className="px-4 py-2 text-right">
                {r.is_dead
                  ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">no sales</span>
                  : <span className="tabular-nums text-slate-700">{coverLabel(r.cover_weeks)}</span>}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
