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

import { Suspense, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import Image from 'next/image';
import AppShell from '@/components/AppShell';
import Timeline from '@/components/Timeline';
import SizeCurve from '@/components/SizeCurve';
import PriceHistory from '@/components/PriceHistory';
import SalesList from '@/components/SalesList';
import PriceSetter from '@/components/PriceSetter';
import MatchAmazonPanel from '@/components/MatchAmazonPanel';
import { AMZ_MATCH_UI } from '@/lib/features';
import PriceBands from '@/components/PriceBands';
import VelocityBars from '@/components/VelocityBars';
import { getDrill, applyPrice, parkStyle } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useScopedState } from '@/lib/useScopedState';

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
    if (!backTo || backTo === '/pricing') return 'Shopify Pricing';
    if (backTo.startsWith('/pricing/find')) return 'Search';
    // Reached from outside the pricing segment lists (e.g. an Analytics screen linked straight in) — a plain readable name, no mode.
    if (!backTo.startsWith('/pricing/')) return prettyPathLabel(backTo);
    const [path, qs = ''] = backTo.split('?');
    const seg = decodeURIComponent(path.replace('/pricing/', ''));
    const m = /(?:^|&)mode=(winners|losers|all)(?:&|$)/.exec(qs);
    const modeLabel = m && m[1] === 'losers' ? 'Stuck' : m && m[1] === 'all' ? 'Both' : 'Selling';
    return `${seg} · ${modeLabel}`;
  })();

  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  // Product image is purely for eyeballing what's being priced (same picture the stock/analytics screens show). Track a load failure
  // so a missing/dead filename falls back to a placeholder rather than a broken-image icon. SCOPED to the style, so changing style
  // clears it during render instead of via a reset effect.
  const [imgFailed, setImgFailed] = useScopedState<boolean>(groupid, false);
  // Bumped after a successful write to remount the setter + the lazy reports so they pick up the fresh data (new current price, an
  // empty setter, and a re-fetch of the price-history/sales reports that now include the change).
  const [reloadKey, setReloadKey] = useState(0);

  // `isLoading` (not `busy`) is the full-page "Loading…" gate, which reproduces the old load(silent) split for free: SWR reports
  // isLoading only when there is no cached data, so a post-write refresh() revalidates underneath the existing content with no flash --
  // exactly what silent=true was hand-rolling.
  const { data, error: loadError, isLoading: loading, refresh } = useApiQuery(
    ['shp-drill', groupid],
    () => getDrill(groupid),
  );
  const error = loadError?.message ?? null;

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
      // Google is decoupled — a periodic server sweep (scripts/google-price-sweep.js) pushes this change to Google Merchant later, so
      // there's nothing to report here (and no per-Google failure to surface). The plain "Saved" covers the DB + live Shopify push.
      setNotice({ kind: 'ok', text: `Saved £${res.data.new_price}.${reviewMsg}${warn}` });
      await refresh();
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
      await refresh();
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

  // THE IDENTITY LINE, WITH THE WAY INTO ADD / MODIFY ON IT (owner, 2026-09-16). The jump belongs beside the groupid rather than on
  // it: the code is the thing operators COPY — that is what the button next to it is for — so making the text itself a link would
  // take a click that used to start a text selection and navigate with it. A labelled pill says where it goes before you commit,
  // which matters on a screen you arrive at mid-job with a price half-typed. Same idiom Inventory's breakdown already uses.
  //
  // SAME TAB, AND IT THREADS THE WHOLE CHAIN BACK (owner: "I will go back and forth"). `from` carries this page's own url INCLUDING
  // its own ?from=, so Add / Modify returns to this style, and this style's back arrow still returns to the list it came from —
  // a Google Ads grid, with its filter, all the way at the end of it. `back` is the groupid, so the arrow over there names the
  // style rather than a path.
  const priceHref = `/pricing/style/${encodeURIComponent(groupid)}?from=${encodeURIComponent(backTo)}`;
  const addModifyHref =
    `/products?groupid=${encodeURIComponent(groupid)}` +
    `&from=${encodeURIComponent(priceHref)}&back=${encodeURIComponent(groupid)}`;

  return (
    <AppShell
      title={data?.header.title || groupid}
      // THE PRODUCT NAME IS THE WAY INTO ADD / MODIFY (owner, 2026-09-16). It started as a pill beside the groupid and that was one
      // more thing in a header that is already carrying a back arrow, a code, a copy button and a thumbnail — "an extra button and
      // noise". The title is the honest place for it: the heading names the product, and Add / Modify is where the product itself
      // is edited, so the link goes exactly where the words already point. The groupid keeps its copy button and stays plain text.
      titleHref={addModifyHref}
      titleTitle="Open this product in Add / Modify — title, attributes, sizes, images"
      subtitle={groupid}
      subtitleCopy
      backHref={backTo}
      backLabel={backLabel}
      headerRight={thumb}
    >
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

          {/* 1. The action — kept at the top so it is reachable without scrolling. The manual PriceSetter sits here.
                 The Amazon-match autopilot is RETIRED (AMZ_MATCH_UI, see lib/features.ts): with it off, a style still carrying the
                 old flag falls through to the manual setter rather than showing a card for a cron that no longer runs. */}
          <section>
            {AMZ_MATCH_UI && data.header.match_amazon ? (
              <MatchAmazonPanel
                groupid={groupid}
                matchAmazon
                amazonLowest={data.header.amazon_lowest}
                currentPrice={data.header.now}
                applying={applying}
                onPark={handlePark}
                onChanged={async () => { await refresh(); setReloadKey((k) => k + 1); }}
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

          {/* 5. Match Amazon enable card — RETIRED 2026-09-15, hidden behind AMZ_MATCH_UI (lib/features.ts). Kept, not deleted:
                 flipping that flag back on restores the whole autopilot control. Amazon's per-size prices now live in the size curve
                 above, as reference for a Shopify decision rather than a rule that drives it. */}
          {AMZ_MATCH_UI && !data.header.match_amazon && (
            <MatchAmazonPanel
              groupid={groupid}
              matchAmazon={false}
              amazonLowest={data.header.amazon_lowest}
              currentPrice={data.header.now}
              applying={applying}
              onPark={handlePark}
              onChanged={async () => { await refresh(); setReloadKey((k) => k + 1); }}
            />
          )}
        </div>
      )}
    </AppShell>
  );
}
