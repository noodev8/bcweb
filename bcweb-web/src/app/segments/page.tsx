'use client';
/*
=======================================================================================================================================
Page: /segments  (Segments module — the overview heatmap)
=======================================================================================================================================
Purpose: The front door of the review/attention layer (docs/segments-spec.md §3). A Segment × Area heatmap with a live importance
         gutter (revenue / GP). Each cell is a review clock coloured by due state; the eye lands on high-value-overdue first.
           - Rows sort by importance (revenue).
           - A Shopify cell deep-links into the existing pricing triage for that segment; other cells + the segment name open its detail.
Guarded by AppShell. Consumes GET /segments.
=======================================================================================================================================
*/

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSegmentsOverview, SegmentOverviewRow, SegmentAreaCell } from '@/lib/api';
import { dueTone, dueCellLabel, cellTitle, fmtMoney } from '@/lib/segmentUi';

// Stable "nothing loaded yet" identity, so derived memos aren't invalidated on every render.
const NO_ROWS: SegmentOverviewRow[] = [];

export default function SegmentsHeatmap() {
  const router = useRouter();

  // Single on-mount fetch. UNAUTHORIZED -> logout is handled inside useApiQuery, so it isn't repeated here (API-RULES:
  // the caller decides, and for this whole module the decision is the same one).
  const { data, error: loadError, isLoading: loading } = useApiQuery(
    ['segments-overview'],
    () => getSegmentsOverview(),
  );
  const rows: SegmentOverviewRow[] = data?.segments ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // Column headers = the area list (same order on every row; derive from the first).
  const areaNames = rows[0]?.areas.map((a) => a.area) ?? [];

  const visible = useMemo(() => [...rows].sort((a, b) => b.revenue30 - a.revenue30), [rows]);

  // A pricing cell drops into its work screen (Shopify triage / Amazon SKU lists); Housekeeping (and any manual area) opens the
  // segment detail, where it can be marked worked.
  function openCell(name: string, cell: SegmentAreaCell) {
    const a = cell.area.toLowerCase();
    // Deep-link into the pricing screens, but remember this segment's detail as the back target so "← <segment>" returns here (into the
    // Segments module) rather than to the pricing home. from = the detail path; back = the segment name (used as the back-link label).
    const detail = `/segments/${encodeURIComponent(name)}`;
    const ctx = `?from=${encodeURIComponent(detail)}&back=${encodeURIComponent(name)}`;
    if (a === 'shopify') router.push(`/pricing/${encodeURIComponent(name)}${ctx}`);
    else if (a === 'amazon') router.push(`/amz/${encodeURIComponent(name)}${ctx}`);
    else router.push(detail);
  }

  return (
    <AppShell title="Segments" backHref="/dashboard" backLabel="Dashboard">
      {loading && <p className="text-sm text-slate-400">Loading segments…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="mt-6 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">Segment</th>
                <th className="px-3 py-2.5 text-right font-medium">Rev 30d</th>
                <th className="px-3 py-2.5 text-right font-medium">GP</th>
                {areaNames.map((a) => (
                  <th key={a} className="px-3 py-2.5 text-center font-medium">{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.name} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/60">
                  <td className="px-4 py-2">
                    <button
                      onClick={() => router.push(`/segments/${encodeURIComponent(r.name)}`)}
                      className="font-medium text-slate-800 hover:text-brand-600 hover:underline"
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">{fmtMoney(r.revenue30)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.gpPct !== null ? `${r.gpPct}%` : '—'}</td>
                  {r.areas.map((cell) => (
                    <td key={cell.area} className="px-2 py-2 text-center">
                      <button
                        onClick={() => openCell(r.name, cell)}
                        title={cellTitle(cell)}
                        className={'inline-block w-full min-w-[68px] rounded-md border px-2 py-1.5 text-xs font-medium transition hover:brightness-95 ' + dueTone(cell.dueState)}
                      >
                        {dueCellLabel(cell)}
                      </button>
                    </td>
                  ))}
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={3 + areaNames.length} className="px-4 py-8 text-center text-sm text-slate-400">
                    No segments found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
