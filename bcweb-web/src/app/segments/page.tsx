'use client';
/*
=======================================================================================================================================
Page: /segments  (Segments module — the overview heatmap)
=======================================================================================================================================
Purpose: The front door of the review/attention layer (docs/segments-spec.md §3). A Segment × Area heatmap with a live importance
         gutter (revenue / GP). Each cell is a review clock coloured by due state; the eye lands on high-value-overdue first.
           - Rows sort by importance (revenue).
           - A Shopify cell deep-links into the existing pricing triage for that segment; other cells + the segment name open its detail.

SEGMENT | CAMPAIGN (owner, 2026-09-23): this is really the pricing front door, and a Google campaign is just another way to slice the
same styles. The switch regroups the table by campaign bucket (skusummary.googlecampaign) via GET /pricing-campaigns, which returns the
same row shape. Campaign view is SHOPIFY ONLY (Google Shopping sells the Shopify site), has no Housekeeping (a per-segment manual
clock) and no detail page — a campaign's name and its Shopify cell both open its WINNERS / LOSERS list (/pricing/[name]?by=campaign).
pause + blank buckets are hidden server-side. The switch lives in the URL (?by=campaign) so "← Segments" from a list lands back here.
Guarded by AppShell. Consumes GET /segments or GET /pricing-campaigns.
=======================================================================================================================================
*/

import { Suspense, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSegmentsOverview, getCampaignsOverview, SegmentOverviewRow, SegmentAreaCell, PricingGroupBy } from '@/lib/api';
import { dueTone, dueCellLabel, cellTitle, fmtMoney } from '@/lib/segmentUi';

// Stable "nothing loaded yet" identity, so derived memos aren't invalidated on every render.
const NO_ROWS: SegmentOverviewRow[] = [];

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function SegmentsPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentsHeatmap />
    </Suspense>
  );
}

function SegmentsHeatmap() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Read straight from the URL (no state mirror): the switch writes the URL, so back/forward and "← Segments" all agree.
  const by: PricingGroupBy = searchParams.get('by') === 'campaign' ? 'campaign' : 'segment';
  const isCampaign = by === 'campaign';

  // One fetch per view, keyed by it. UNAUTHORIZED -> logout is handled inside useApiQuery, so it isn't repeated here (API-RULES:
  // the caller decides, and for this whole module the decision is the same one). Campaign rows come back in the segment row shape.
  const { data, error: loadError, isLoading: loading } = useApiQuery(
    ['segments-overview', by],
    async () => {
      if (!isCampaign) return getSegmentsOverview();
      const r = await getCampaignsOverview();
      return { ...r, data: r.data ? { days: r.data.days, segments: r.data.campaigns } : undefined };
    },
  );
  const rows: SegmentOverviewRow[] = data?.segments ?? NO_ROWS;
  const error = loadError?.message ?? null;

  // Column headers = the area list (same order on every row; derive from the first).
  const areaNames = rows[0]?.areas.map((a) => a.area) ?? [];

  const visible = useMemo(() => [...rows].sort((a, b) => b.revenue30 - a.revenue30), [rows]);

  // A pricing cell drops into its work screen (Shopify triage / Amazon SKU lists); Housekeeping (and any manual area) opens the
  // segment detail, where it can be marked worked.
  function setBy(next: PricingGroupBy) {
    router.replace(next === 'campaign' ? '/segments?by=campaign' : '/segments');
  }

  function openCell(name: string, cell: SegmentAreaCell) {
    const a = cell.area.toLowerCase();
    // Deep-link into the pricing screens with THIS screen as the back target, so "← Segments" returns to the heatmap rather than to
    // the pricing home (owner, 2026-09-23 — it used to return to the segment's detail page). from = path, incl. the Segment |
    // Campaign view; back = the back-link label.
    const detail = `/segments/${encodeURIComponent(name)}`;
    const ctx = `from=${encodeURIComponent(isCampaign ? '/segments?by=campaign' : '/segments')}&back=Segments`;
    if (a === 'shopify') router.push(`/pricing/${encodeURIComponent(name)}?${isCampaign ? 'by=campaign&' : ''}${ctx}`);
    else if (isCampaign) return;   // a campaign carries only a Shopify cell; nothing else to open
    else if (a === 'amazon') router.push(`/amz/${encodeURIComponent(name)}?${ctx}`);
    else router.push(detail);
  }

  return (
    <AppShell title="Segments" backHref="/dashboard" backLabel="Dashboard">
      <GroupSwitch by={by} onChange={setBy} />

      {loading && <p className="text-sm text-slate-400">Loading segments…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-4 py-2.5 font-medium">{isCampaign ? 'Campaign' : 'Segment'}</th>
                {/* Campaign revenue is Shopify-only (a campaign drives nothing else); segment revenue is all channels. */}
                <th className="px-3 py-2.5 text-right font-medium">{isCampaign ? 'Shopify rev 30d' : 'Rev 30d'}</th>
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
                      // A campaign has no detail page — its name opens its Shopify list, same as its one cell.
                      onClick={() => (isCampaign ? openCell(r.name, r.areas[0]) : router.push(`/segments/${encodeURIComponent(r.name)}`))}
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
                    {isCampaign ? 'No campaigns with live styles.' : 'No segments found.'}
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

// Segment | Campaign — which grouping the table (and the lists it opens) is sliced by. Same pill style as the list pages' Winners |
// Losers | Both tabs, without counts (owner: no counts beside toggles).
function GroupSwitch({ by, onChange }: { by: PricingGroupBy; onChange: (v: PricingGroupBy) => void }) {
  const opts: { key: PricingGroupBy; label: string; hint: string }[] = [
    { key: 'segment', label: 'Segment', hint: 'Group by segment — Shopify, Amazon and Housekeeping' },
    { key: 'campaign', label: 'Campaign', hint: 'Group by Google campaign — Shopify only' },
  ];
  return (
    <div className="mb-5 inline-flex rounded-xl border border-slate-200 bg-slate-100/70 p-1">
      {opts.map((o) => {
        const active = by === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            title={o.hint}
            aria-pressed={active}
            className={
              'rounded-lg px-4 py-2 text-sm font-medium transition ' +
              (active ? 'bg-white text-slate-800 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-800')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
