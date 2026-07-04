'use client';
/*
=======================================================================================================================================
Page: /pricing/style/[groupid]  (Stage 2 drill-down + Stage 3 set price)
=======================================================================================================================================
Purpose: The decision screen for one style (see CLAUDE.md, drill-down + set price). Shows:
           - Header: current price, rrp, cost, stock, margin (now-cost and %).
           - Pricing timeline (units + pace/wk).
           - Collapsible size curve (default hidden).
           - The PriceSetter control below.
         On Apply -> POST /pricing-apply (W1); on "No change — just set review" -> POST /pricing-park (W2). On success we show the
         new price + review date and return to the segment's triage list (the style is now hidden there until the review date).
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import Timeline from '@/components/Timeline';
import SizeCurve from '@/components/SizeCurve';
import PriceSetter from '@/components/PriceSetter';
import { getDrill, applyPrice, parkStyle, DrillData } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

// useSearchParams (below) must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
export default function DrillPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <DrillContent />
    </Suspense>
  );
}

function DrillContent() {
  const router = useRouter();
  const params = useParams<{ groupid: string }>();
  const searchParams = useSearchParams();
  const groupid = decodeURIComponent(params.groupid);
  // Where we came from (the triage/losers list or find page), so a successful write returns to that exact list where the style is
  // now hidden (CLAUDE.md). Falls back to the segment picker for deep links.
  const backTo = searchParams.get('from') || '/pricing';
  const { logout } = useAuth();

  // Single back link to the exact list we came from (the list page itself carries its own "Segments" link, so we don't repeat it
  // here). Derive a readable label from the `from` path: segment + mode, "Search", or "Segments" for a deep-link with no origin.
  const backLabel = (() => {
    if (!backTo || backTo === '/pricing') return 'Segments';
    if (backTo.startsWith('/pricing/find')) return 'Search';
    const [path, qs = ''] = backTo.split('?');
    const seg = decodeURIComponent(path.replace('/pricing/', ''));
    const isLosers = /(^|&)mode=losers(&|$)/.test(qs);
    return `${seg} · ${isLosers ? 'Losers' : 'Winners'}`;
  })();

  const [data, setData] = useState<DrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await getDrill(groupid);
    if (res.success && res.data) {
      setData(res.data);
      setError(null);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load style');
    }
    setLoading(false);
  }, [groupid, logout]);

  useEffect(() => { load(); }, [load]);

  // Return after a successful write to the list we came from (style now hidden there until its review date).
  function goBackToList() {
    router.push(backTo);
  }

  async function handleApply(newPrice: number, reviewDays: number) {
    setApplying(true);
    setNotice(null);
    const res = await applyPrice(groupid, newPrice, reviewDays);
    setApplying(false);
    if (res.success && res.data) {
      const warn = res.data.warnings.length ? ` (flagged: ${res.data.warnings.join(', ')})` : '';
      setNotice({ kind: 'ok', text: `Applied £${res.data.new_price}. Next review ${res.data.next_review}.${warn} Returning to the list…` });
      setTimeout(goBackToList, 1200);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to apply price' });
    }
  }

  async function handlePark(reviewDays: number) {
    setApplying(true);
    setNotice(null);
    const res = await parkStyle(groupid, reviewDays);
    setApplying(false);
    if (res.success && res.data) {
      setNotice({ kind: 'ok', text: `Review set for ${res.data.next_review} (price unchanged). Returning to the list…` });
      setTimeout(goBackToList, 1200);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to set review' });
    }
  }

  return (
    <AppShell title={data?.header.title || groupid} backHref={backTo} backLabel={backLabel}>
      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {data && (
        <div className="space-y-6">
          {/* Header block */}
          <div className="grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-4 lg:grid-cols-6">
            <Stat label="Now" value={money(data.header.now)} strong />
            <Stat label="Cost" value={money(data.header.cost)} />
            <Stat label="RRP" value={money(data.header.rrp)} />
            <Stat label="Stock" value={data.header.stock.toString()} />
            <Stat label="Margin" value={money(data.header.margin)} />
            <Stat label="Margin %" value={data.header.margin_pct !== null ? `${data.header.margin_pct}%` : '—'} />
          </div>

          <div className="flex flex-wrap gap-2 text-xs text-slate-400">
            <span className="font-mono">{groupid}</span>
            {data.header.colour && <span>· {data.header.colour}</span>}
            {data.header.width && <span>· {data.header.width}</span>}
            {data.header.season && <span>· {data.header.season}</span>}
            {data.header.next_review && <span>· parked until {data.header.next_review}</span>}
          </div>

          {/* Timeline */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Pricing timeline</h2>
            <Timeline rows={data.timeline} />
          </section>

          {/* Size curve (collapsible) */}
          <SizeCurve sizes={data.sizes} />

          {/* Notice */}
          {notice && (
            <div className={'rounded-md px-3 py-2 text-sm ' + (notice.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
              {notice.text}
            </div>
          )}

          {/* Set-price control */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Set price &amp; review</h2>
            <PriceSetter
              header={data.header}
              applying={applying}
              onApply={handleApply}
              onPark={handlePark}
              onCancel={() => router.push(backTo)}
            />
          </section>
        </div>
      )}
    </AppShell>
  );
}

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={'mt-0.5 ' + (strong ? 'text-xl font-semibold text-slate-900' : 'text-base text-slate-700')}>{value}</div>
    </div>
  );
}
