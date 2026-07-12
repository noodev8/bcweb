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
import Link from 'next/link';
import { CurrencyPoundIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import AmzPriceSetter from '@/components/AmzPriceSetter';
import AmzHistory from '@/components/AmzHistory';
import AmzSales from '@/components/AmzSales';
import PriceBands from '@/components/PriceBands';
import VelocityBars from '@/components/VelocityBars';
import { getAmzDrill, applyAmzPrice, AmzDrillData } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

export default function AmzDrillPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <DrillContent />
    </Suspense>
  );
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
    // Reached from outside the Amazon segment lists (e.g. an Analytics screen linked straight in) — a plain readable name, no mode.
    if (!backTo.startsWith('/amz/')) return prettyPathLabel(backTo);
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

          {/* Cross-module hop — this style's Shopify price screen (style-grain), backing here when done. */}
          {data.header.groupid && (
            <div className="flex justify-end">
              <Link
                href={`/pricing/style/${encodeURIComponent(data.header.groupid)}?from=${encodeURIComponent(`/amz/sku/${code}`)}`}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-slate-800"
              >
                <CurrencyPoundIcon className="h-4 w-4" /> Change this on Shopify →
              </Link>
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
            <VelocityBars weeks={data.weeks} />
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


