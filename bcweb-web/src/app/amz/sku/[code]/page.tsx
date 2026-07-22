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
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import CopyButton from '@/components/CopyButton';
import AmzBasketBar from '@/components/AmzBasketBar';
import AmzPriceSetter from '@/components/AmzPriceSetter';
import AmzHistory from '@/components/AmzHistory';
import AmzSales from '@/components/AmzSales';
import PriceBands from '@/components/PriceBands';
import VelocityBars from '@/components/VelocityBars';
import { getAmzDrill, applyAmzPrice, markAmzReviewed, AmzDrillData } from '@/lib/api';
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
  // Product image is purely for eyeballing what's being priced (same picture the Shopify/stock screens show). Track a load failure so a
  // missing/dead filename simply shows nothing rather than a broken-image icon; reset it whenever the SKU changes.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [code]);

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

  async function handleApply(newPrice: number, note: string, reviewDays: number | null) {
    if (!data) return;
    setApplying(true);
    setNotice(null);
    const res = await applyAmzPrice(code, newPrice, note, reviewDays);
    setApplying(false);
    if (res.success && res.data) {
      const d = res.data;
      // Queue the change into the session upload basket (built into the one Seller Central file on download). The apply response carries
      // amz_sku + rrp; size/title/segment come from the loaded header.
      add({
        id: d.log_id,
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
      // Plain "Saved", mirroring the Shopify drill — plus the next review date (or "No review set"). The basket bar above owns the
      // "download the file" affordance, so we don't restate it on every apply.
      const reviewMsg = d.next_review ? ` Next review ${d.next_review}.` : ' No review set.';
      setNotice({ kind: 'ok', text: `Saved £${d.new_price.toFixed(2)}.${reviewMsg}${warn}` });
      await load(true);
      setReloadKey((k) => k + 1);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to apply price' });
    }
  }

  // Set a review date only, price unchanged (mirrors Shopify's W2 park). Parks this one SKU via the batch endpoint (codes:[code]); no
  // price change means nothing is queued to the upload basket. Reloads so the header reflects the new review date.
  async function handlePark(reviewDays: number) {
    setApplying(true);
    setNotice(null);
    const res = await markAmzReviewed([code], reviewDays);
    setApplying(false);
    if (res.success && res.data) {
      setNotice({ kind: 'ok', text: `Review set for ${res.data.nextReview} (price unchanged).` });
      await load(true);
      setReloadKey((k) => k + 1);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to set review' });
    }
  }

  const queuedPrice = items[code] ? items[code].new_price : null;
  const title = data?.header.title || code;

  // Product thumbnail rendered flush-right of the page title (AppShell headerRight slot) — a small "what am I pricing?" anchor that
  // uses the title row's empty right side, so it never pushes the price setter down. Same image the Shopify/stock screens use.
  const thumb = data && data.header.imagename && !imgFailed ? (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-slate-200 bg-white sm:h-24 sm:w-24">
      <Image
        src={`https://images.brookfieldcomfort.com/${data.header.imagename}`}
        alt={data.header.title || code}
        fill
        sizes="96px"
        onError={() => setImgFailed(true)}
        className="object-contain"
      />
    </div>
  ) : null;

  // Identity block rendered under the title (AppShell subtitleNode) — Group ID (the style) and Amazon SKU (the Seller Central listing
  // id) together, each LABELLED and one-click copyable. Keeping both here (rather than one in the subtitle and one orphaned in the body)
  // fills the header's left column beside the thumbnail, so the image is anchored to real content instead of floating over empty space.
  const identity = data && (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
      <span className="inline-flex items-center gap-1.5">
        <span className="text-slate-500">Group ID</span>
        <span className="font-mono font-semibold text-slate-800">{data.header.groupid}</span>
        <CopyButton value={data.header.groupid} label="Group ID" />
      </span>
      {data.header.amz_sku && (
        <span className="inline-flex items-center gap-1.5">
          <span className="text-slate-500">Amazon SKU</span>
          <span className="font-mono font-semibold text-slate-800">{data.header.amz_sku}</span>
          <CopyButton value={data.header.amz_sku} label="Amazon SKU" />
        </span>
      )}
    </div>
  );

  return (
    <AppShell title={title} subtitleNode={identity} backHref={backTo} backLabel={backLabel} headerRight={thumb}>
      {/* Read-only heads-up: this style's Shopify price auto-follows Amazon's lowest in-stock size. Reminds the operator that an Amazon
          price change here will pull Shopify down at the next amz-match sync (Amazon itself is priced normally below). Only when on. */}
      {data && data.header.match_amazon && (
        <div className="mb-5">
          <span
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
            title="This style's Shopify price is auto-matched to Amazon's cheapest in-stock size (synced twice daily)."
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> Shopify auto-matches Amazon
          </span>
        </div>
      )}

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

          {/* Set-price control — kept high so the action is reachable without scrolling past the evidence below. The card's own
              channel banner labels it, so no separate heading. */}
          <section>
            <AmzPriceSetter
              key={reloadKey}
              header={data.header}
              applying={applying}
              queuedPrice={queuedPrice}
              onApply={handleApply}
              onPark={handlePark}
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


