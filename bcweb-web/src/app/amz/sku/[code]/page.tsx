'use client';
/*
=======================================================================================================================================
Page: /amz/sku/[code]  (Stage 2 drill-down + Stage 3 set price)
=======================================================================================================================================
Purpose: The decision screen for one Amazon SKU (one size), mirroring the Shopify /pricing/style/[groupid] drill. Shows:
           - Header: current price, cost, FBA fee, RRP, floor, net margin, FBA live/inbound stock.
           - The AmzPriceSetter control (price + nudges + note → Apply).
           - Evidence: 6-week velocity + units-by-price bands (the resistance guardrail).
           - Collapsible, lazy Price history + Recent sales.
         On Apply -> POST /amz-apply (writes the amz_price_log audit row) AND queues the change into the session upload basket. There is
         NO live push and NO review/park (Amazon differences): the price reaches Amazon only when the operator downloads + uploads the
         basket file. After a successful apply the drill refreshes in place and the change shows as "queued".
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import AmzPriceSetter from '@/components/AmzPriceSetter';
import AmzHistory from '@/components/AmzHistory';
import AmzSales from '@/components/AmzSales';
import PriceBands from '@/components/PriceBands';
import { getAmzDrill, applyAmzPrice, AmzDrillData } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

export default function AmzDrillPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <DrillContent />
    </Suspense>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtShort(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}
function DrillContent() {
  const router = useRouter();
  const params = useParams<{ code: string }>();
  const searchParams = useSearchParams();
  const code = decodeURIComponent(params.code);
  // Where we came from (a segment list or the find page), so a successful apply returns to that exact list. Falls back to the picker.
  const backTo = searchParams.get('from') || '/amz';
  const { logout } = useAuth();
  const { items, add } = useAmzBasket();

  // Readable back label from the `from` path: "SEGMENT · Winners/Losers/All", "Search", or "Segments" for a deep link.
  const backLabel = (() => {
    if (!backTo || backTo === '/amz') return 'Segments';
    if (backTo.startsWith('/amz/find')) return 'Search';
    const [path, qs = ''] = backTo.split('?');
    const seg = decodeURIComponent(path.replace('/amz/', ''));
    const m = /(?:^|&)mode=(winners|losers|all)(?:&|$)/.exec(qs);
    const modeLabel = m && m[1] === 'losers' ? 'Losers' : m && m[1] === 'all' ? 'All' : 'Winners';
    return `${seg} · ${modeLabel}`;
  })();

  const [data, setData] = useState<AmzDrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Bumped after a successful write so the setter remounts (empty) and the lazy reports re-fetch with the fresh change.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await getAmzDrill(code);
    if (res.success && res.data) {
      setData(res.data);
      setError(null);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load SKU');
    }
    if (!silent) setLoading(false);
  }, [code, logout]);

  useEffect(() => { load(); }, [load]);

  function goBackToList() {
    router.push(backTo);
  }

  async function handleApply(newPrice: number, note: string) {
    if (!data) return;
    setApplying(true);
    setNotice(null);
    const res = await applyAmzPrice(code, newPrice, note);
    setApplying(false);
    if (res.success && res.data) {
      const d = res.data;
      // Queue the change into the session upload basket (built into the one Seller Central file on download). The apply response carries
      // amz_sku + rrp; size/title/segment come from the loaded header.
      add({
        code: d.code,
        amz_sku: d.amz_sku,
        size: data.header.size,
        title: data.header.title,
        segment: data.header.segment,
        old_price: d.old_price,
        new_price: d.new_price,
        rrp: d.rrp,
      });
      const warn = d.warnings.includes('ABOVE_RRP') ? ' (above RRP — check)' : '';
      setNotice({ kind: 'ok', text: `Queued £${d.new_price.toFixed(2)} for upload.${warn} Download the file from the basket when you're done.` });
      await load(true);
      setReloadKey((k) => k + 1);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to apply price' });
    }
  }

  const queuedPrice = items[code] ? items[code].new_price : null;
  const title = data?.header.title || code;

  return (
    <AppShell title={title} subtitle={code} subtitleCopy backHref={backTo} backLabel={backLabel}>
      <AmzBasketBar />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {data && (
        <div className="space-y-6">
          {/* Notice — on success carries a "Back to list" button so the user returns when ready (no auto-nav). */}
          {notice && (
            <div className={'flex flex-wrap items-center justify-between gap-3 rounded-md px-3 py-2 text-sm ' + (notice.kind === 'ok' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
              <span>{notice.text}</span>
              {notice.kind === 'ok' && (
                <button
                  onClick={goBackToList}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700"
                >
                  ← Back to {backLabel}
                </button>
              )}
            </div>
          )}

          {/* Set-price control — kept high so the action is reachable without scrolling past the evidence below. */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Set price</h2>
            <AmzPriceSetter
              key={reloadKey}
              header={data.header}
              applying={applying}
              queuedPrice={queuedPrice}
              onApply={handleApply}
              onCancel={() => router.push(backTo)}
            />
          </section>

          {/* Evidence — the read-only case for a decision: velocity trend + price-band resistance. */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Velocity weeks={data.weeks} />
            <PriceBands bands={data.bands} currentPrice={data.header.price} />
          </section>

          {/* Reference reports (collapsible, lazy). Keyed on reloadKey so an apply remounts them (collapsed) to re-fetch with the change. */}
          <AmzSales key={`sales-${reloadKey}`} code={code} />
          <AmzHistory key={`hist-${reloadKey}`} code={code} />
        </div>
      )}
    </AppShell>
  );
}

// 6-week velocity — the trend. A halving week over week is the act-now signal. (Returns are intentionally not shown — noise for pricing.)
function Velocity({ weeks }: { weeks: AmzDrillData['weeks'] }) {
  const maxWeek = Math.max(1, ...weeks.map((w) => w.units));
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Velocity — 6 weeks</h3>
      <div className="flex items-end gap-1.5" style={{ height: 72 }}>
        {weeks.map((w) => (
          <div key={w.week_start} className="flex flex-1 flex-col items-center justify-end" title={`${w.units} sold · avg ${w.avg_price !== null ? '£' + w.avg_price.toFixed(2) : '—'}`}>
            <span className="mb-0.5 text-[10px] font-medium text-slate-600">{w.units}</span>
            <div className="w-full rounded-t bg-emerald-400" style={{ height: Math.round((w.units / maxWeek) * 48) }} />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5">
        {weeks.map((w) => (
          <span key={w.week_start} className="flex-1 text-center text-[10px] text-slate-400">{fmtShort(w.week_start)}</span>
        ))}
      </div>
    </div>
  );
}

