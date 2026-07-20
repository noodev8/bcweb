'use client';
/*
=======================================================================================================================================
Page: /pricing/style/[groupid]  (Stage 2 drill-down + Stage 3 set price)
=======================================================================================================================================
Purpose: The decision screen for one style (see CLAUDE.md, drill-down + set price).

         LAYOUT ORDER follows what the operator actually reads (owner, 2026-07-20 — after real use):
           1. The action — PriceSetter, or the MatchAmazonPanel when the style is on Amazon autopilot (it replaces the setter).
           2. Recent sales — OPEN BY DEFAULT. The single most-consulted report; the eye goes straight here, so it is up top and
              already expanded rather than a dropdown to hunt for.
           3. Price history — the other main report, high but collapsed (one click).
           4. "Supporting detail" — the evidence blocks the operator was skipping past (pricing timeline, velocity, units-by-price)
              plus the rarely-opened size curve, demoted below a divider so they are present but out of the main path.
           5. Match Amazon (enable card) — last, when matching is OFF: it is toggled sparingly, so it lives at the bottom as a
              settings-style control. When matching is ON it is NOT here — it is the prominent card at step 1.

         On Apply -> POST /pricing-apply (W1); on "No change — just set review" -> POST /pricing-park (W2). On success we show the
         new price + review date and return to the segment's triage list (the style is now hidden there until the review date).
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import Timeline from '@/components/Timeline';
import SizeCurve from '@/components/SizeCurve';
import PriceHistory from '@/components/PriceHistory';
import SalesList from '@/components/SalesList';
import PriceSetter from '@/components/PriceSetter';
import MatchAmazonPanel from '@/components/MatchAmazonPanel';
import PriceBands from '@/components/PriceBands';
import VelocityBars from '@/components/VelocityBars';
import { getDrill, applyPrice, parkStyle, DrillData } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
import { bumpActionedCount } from '@/lib/sessionCounter';

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
    // Reached from outside the pricing segment lists (e.g. an Analytics screen linked straight in) — a plain readable name, no mode.
    if (!backTo.startsWith('/pricing/')) return prettyPathLabel(backTo);
    const [path, qs = ''] = backTo.split('?');
    const seg = decodeURIComponent(path.replace('/pricing/', ''));
    const m = /(?:^|&)mode=(winners|losers|all)(?:&|$)/.exec(qs);
    const modeLabel = m && m[1] === 'losers' ? 'Losers' : m && m[1] === 'all' ? 'All' : 'Winners';
    return `${seg} · ${modeLabel}`;
  })();

  // Segment name (if we came from a segment list), used to key the session "actioned" counter — null for a deep-link/search/cross-
  // module origin (only a real /pricing/<segment> list carries a segment).
  const backSegment = (() => {
    if (!backTo.startsWith('/pricing/') || backTo.startsWith('/pricing/find')) return null;
    const [path] = backTo.split('?');
    return decodeURIComponent(path.replace('/pricing/', ''));
  })();

  const [data, setData] = useState<DrillData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Product image is purely for eyeballing what's being priced (same picture the stock/analytics screens show). Track a load failure
  // so a missing/dead filename falls back to a placeholder rather than a broken-image icon; reset it whenever the style changes.
  const [imgFailed, setImgFailed] = useState(false);
  useEffect(() => { setImgFailed(false); }, [groupid]);
  // Bumped after a successful write to remount the setter + the lazy reports so they pick up the fresh data (new current price, an
  // empty setter, and a re-fetch of the price-history/sales reports that now include the change).
  const [reloadKey, setReloadKey] = useState(0);

  // silent=true is used for the post-write in-place refresh: it updates the data without the full-page "Loading…" flash (the existing
  // content stays put while the fresh drill loads underneath).
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const res = await getDrill(groupid);
    if (res.success && res.data) {
      setData(res.data);
      setError(null);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load style');
    }
    if (!silent) setLoading(false);
  }, [groupid, logout]);

  useEffect(() => { load(); }, [load]);

  // Return after a successful write to the list we came from (style now hidden there until its review date).
  function goBackToList() {
    router.push(backTo);
  }

  async function handleApply(newPrice: number, reviewDays: number | null, note: string) {
    setApplying(true);
    setNotice(null);
    const res = await applyPrice(groupid, newPrice, reviewDays, note);
    setApplying(false);
    if (res.success && res.data) {
      const warn = res.data.warnings.length ? ` (flagged: ${res.data.warnings.join(', ')})` : '';
      // Review may be None now — phrase accordingly (null = the review date was left untouched).
      const reviewMsg = res.data.next_review ? ` Next review ${res.data.next_review}.` : ' No review set.';
      const push = res.data.shopify;
      // Live-product push failed: the DB price + review are saved, but the store didn't update. Keep the user here WITHOUT refreshing
      // (leave the setter as-is) so they can press Apply again — the push is idempotent, so re-applying safely retries it.
      if (push && push.pushed === false) {
        setNotice({ kind: 'err', text: `Saved £${res.data.new_price}.${reviewMsg}${warn} But it did NOT reach Shopify${push.message ? `: ${push.message}` : ''}. Press Apply again to retry.` });
        return;
      }
      // Google Merchant push, unlike Shopify, has a nightly fallback (merchant_feed.py --upload), so a failure here doesn't block the
      // flow — but the owner still wants it flagged if it happens (null = not live on Google, nothing to push — no note).
      const googlePush = res.data.google;
      if (googlePush && googlePush.pushed === false) {
        setNotice({ kind: 'err', text: `Saved £${res.data.new_price}.${reviewMsg}${warn} But it did NOT reach Google Merchant${googlePush.message ? `: ${googlePush.message}` : ''} (tonight's feed run will still catch it).` });
        return;
      }
      // Success on every channel that applied. Deliberately a single plain "Saved" — we don't spell out Shopify vs Google (both pushed
      // silently) so the operator isn't left wondering why only one channel is named. Errors above are the only per-channel callouts.
      setNotice({ kind: 'ok', text: `Saved £${res.data.new_price}.${reviewMsg}${warn}` });
      if (backSegment) bumpActionedCount(backSegment);
      await load(true);
      setReloadKey((k) => k + 1);
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
      setNotice({ kind: 'ok', text: `Review set for ${res.data.next_review} (price unchanged).` });
      if (backSegment) bumpActionedCount(backSegment);
      await load(true);
      setReloadKey((k) => k + 1);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setNotice({ kind: 'err', text: res.error || 'Failed to set review' });
    }
  }

  // Product thumbnail rendered flush-right of the page title (AppShell headerRight slot) — a small "what am I pricing?" anchor that
  // uses the title row's empty right side, so it never pushes the price setter down. Same image the stock/analytics screens use.
  const thumb = data && (data.header.imagename && !imgFailed ? (
    <div className="relative h-20 w-20 overflow-hidden rounded-md border border-slate-200 bg-white sm:h-24 sm:w-24">
      <Image
        src={`https://images.brookfieldcomfort.com/${data.header.imagename}`}
        alt={data.header.title || groupid}
        fill
        sizes="96px"
        onError={() => setImgFailed(true)}
        className="object-contain"
      />
    </div>
  ) : null);

  return (
    <AppShell title={data?.header.title || groupid} subtitle={groupid} subtitleCopy backHref={backTo} backLabel={backLabel} headerRight={thumb}>
      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {data && (
        <div className="space-y-6">
          {data.header.next_review && (
            <div className="text-xs text-slate-400">Parked until {data.header.next_review}</div>
          )}

          {/* Notice — on success it carries a prominent "Back to list" button so the user returns when ready (no auto-nav). */}
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

          {/* 1. The action — kept at the top so it is reachable without scrolling. When the style is on Amazon autopilot the
                 MatchAmazonPanel REPLACES the manual setter here (it is the active control for that style); otherwise the manual
                 PriceSetter sits here and the Match-Amazon ENABLE card drops to the very bottom (see step 5). */}
          <section>
            {data.header.match_amazon ? (
              <MatchAmazonPanel
                groupid={groupid}
                matchAmazon
                amazonLowest={data.header.amazon_lowest}
                currentPrice={data.header.now}
                applying={applying}
                onPark={handlePark}
                onChanged={async () => { await load(true); setReloadKey((k) => k + 1); }}
              />
            ) : (
              <PriceSetter
                key={reloadKey}
                header={data.header}
                sizes={data.sizes}
                applying={applying}
                onApply={handleApply}
                onPark={handlePark}
                onCancel={() => router.push(backTo)}
              />
            )}
          </section>

          {/* 2. Recent sales — the report the operator goes straight to. Open by default and up top. */}
          <SalesList key={`sales-${reloadKey}`} groupid={groupid} defaultOpen />

          {/* 3. Price history — the other main report, high but collapsed. */}
          <PriceHistory key={`hist-${reloadKey}`} groupid={groupid} />

          {/* 4. Supporting detail — the evidence blocks that were being skipped, demoted below a divider but still to hand. */}
          <div className="flex items-center gap-3 pt-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Supporting detail</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          {/* Timeline */}
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">Pricing timeline</h2>
            <Timeline rows={data.timeline} />
          </section>

          {/* Evidence — velocity trend + units-by-price resistance, shared with the Amazon drill (drill-evidence-spec §3, blocks 2-3). */}
          <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <VelocityBars weeks={data.weeks} />
            <PriceBands bands={data.bands} currentPrice={data.header.now} />
          </section>

          {/* Size curve (collapsible, rarely opened) */}
          <SizeCurve sizes={data.sizes} />

          {/* 5. Match Amazon enable card — only when matching is OFF (when ON it is the prominent card at step 1). Toggled sparingly,
                 so it lives at the bottom as a settings-style control rather than competing with the day-to-day reports above. */}
          {!data.header.match_amazon && (
            <MatchAmazonPanel
              groupid={groupid}
              matchAmazon={false}
              amazonLowest={data.header.amazon_lowest}
              currentPrice={data.header.now}
              applying={applying}
              onPark={handlePark}
              onChanged={async () => { await load(true); setReloadKey((k) => k + 1); }}
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
