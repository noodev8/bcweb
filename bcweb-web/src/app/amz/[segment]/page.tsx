'use client';
/*
=======================================================================================================================================
Page: /amz/[segment]  (Stage 1 — the segment's SKU lists)
=======================================================================================================================================
Purpose: The list view for a segment — the Amazon mirror of /pricing/[segment], but SKU-grain (Amazon prices per size).
  - WINNERS: in-stock SKUs that sold >= 2 units in the last 30 days AND averaged >= £2 net profit per unit — candidates to price UP /
             harvest. Best sellers first.
  - LOSERS:  FBA stock that sold NOTHING in the last 30 days — candidates to cut and get moving. Most FBA stock at risk first.
Because a groupid's sizes each have their own price, one colour can have fast sizes in WINNERS and dead sizes in LOSERS at the same time.

SEGMENT OR STATUS: the [segment] path param is the GROUP name; ?by=status (2026-09-24, owner: "Apply amazon pricing in reprice") makes
it a portfolio status (WINNERS / STEADY / NEW / HARVEST / LOSERS) — the Amazon SKUs of every style carrying it. A status is ONE UNSPLIT
LIST from GET /amz-status-list, not the Selling/Stuck pair, and OUT-OF-STOCK SKUs (0 FBA) ARE LISTED so their price can be set ahead of
stock arriving (owner). The view tabs are hidden and the mode pinned to 'all'; the Due switch, table, drill, bulk bar and upload basket
are unchanged. Only styles whose LEAD CHANNEL is Amazon or both are listed (server, 2026-09-25) — a Shopify-led winner is on the
Shopify list. WINNERS can carry the Winners dial (?bar=2500), shown in the crumb. `by` (and bar) ride along in the drill round-trip. (It replaced the Top earners grouping, removed the same day.) There is no
campaign grouping on Amazon (campaigns are Shopify only).

TWO CONTROLS, ONE TABLE (owner, 2026-09-23 — same layout as Shopify, shared via components/ListViewControls):
  - Selling | Stuck | Both (?mode=all) — on-screen names for WINNERS | LOSERS since 2026-09-23; code and URLs keep winners/losers.
    "Both" means the two lists together (winners first, then losers), NOT every managed SKU. The old "All" view
    (every SKU incl. out of stock, from /amz-all) was dropped from this screen in the same change.
  - "Due" switch. On (default) = only SKUs due now. Off = also the PARKED SKUs (skumap.next_amz_price_review in the future), dimmed.
    The Review column is always shown: a date for a parked SKU, "Due" otherwise.
Both lists are fetched ONCE with parked SKUs included (?parked=include) and filtered client-side, so every control shows a live count
and flipping them costs no request. View + pending are kept in the URL (?mode=, ?pending=1) so returning from a SKU's drill restores
them. The lists are the WHOLE qualifying sets; the server's safety cap (utils/listLimit.js) is flagged when it bites. A SKU already in
the upload basket shows a "queued" badge.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar, { AmzUploadButton } from '@/components/AmzBasketBar';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import ListViewControls, { ListView, parseListView, fmtReviewDate } from '@/components/ListViewControls';
import PricingCrumb from '@/components/PricingCrumb';
import { getAmzWinners, getAmzLosers, getAmzStatusList, markAmzReviewed, applyAmzPrice, PricingGroup, parseGroupBy } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useScopedState } from '@/lib/useScopedState';
import { useAmzBasket } from '@/contexts/AmzBasketContext';
import { barLabel } from '@/lib/portfolioStatusUi';

// Bulk price + review controls — kept identical to the Amazon drill's price-setter (owner: "exactly the same as the individual item").
// Nudge denominations = the engine's typical £0.30 / £0.50 / £1.00 steps; review chips = the drill's day set. Amber tone throughout.
const AMZ_NUDGES: Nudge[] = [
  { label: '−£1', delta: -1 }, { label: '−50p', delta: -0.5 }, { label: '−30p', delta: -0.3 },
  { label: '+30p', delta: 0.3 }, { label: '+50p', delta: 0.5 }, { label: '+£1', delta: 1 },
];
const AMZ_REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Stable "nothing ticked" identity for useScopedState (it requires a stable initial). Never mutated — every toggle builds a new Set.
const NO_SELECTION: Set<string> = new Set();
// Same look as Shopify's bulk bar (owner, 2026-09-24). The channel is still unmistakable once the bar opens: its banner carries the
// Amazon logo and "Apply queues a Seller Central upload — no live change" (components/BulkActionBar CHANNEL_BANNER).
const AMZ_TONE: BulkTone = {
  chipOn: 'border-brand-600 bg-brand-600 text-white',
  applyBtn: 'bg-emerald-600 hover:bg-emerald-700',
  panel: 'border-slate-200',
};

// One row of either list, flattened so a single table can show both. units/u7 are 0 for a loser (0 by definition — see amz-losers.js;
// shown as 0 since the tabs share one layout, owner 2026-09-23). amz_sku/size/title feed the upload basket.
interface ListRow {
  kind: 'winner' | 'loser';
  code: string;
  groupid: string;   // the STYLE — a status list says how many styles it covers, matching the Winners card it was opened from
  amz_sku: string;
  size: string;
  title: string | null;
  brand: string | null;
  units: number | null;
  u7: number | null;
  fba: number;
  price: number | null;
  rrp: number | null;       // the "Reset to RRP" target (skusummary.rrp; null = junk/blank -> skipped)
  next_review: string | null;
  parked: boolean;
}

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzSegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

function SegmentContent() {
  const router = useRouter();
  const params = useParams<{ segment: string }>();
  const searchParams = useSearchParams();
  const segment = decodeURIComponent(params.segment);
  // Only segment | status exist on Amazon; a stray ?by=campaign falls back to segment rather than asking the server for a campaign.
  const by = parseGroupBy(searchParams.get('by')) === 'status' ? 'status' : 'segment';
  const isStatus = by === 'status';
  // WINNERS read at a Winners-screen dial mark (?bar=2500): only the winners over it (server-validated). Status lists only.
  const barRaw = Number(searchParams.get('bar'));
  const bar = isStatus && barRaw > 0 ? barRaw : null;
  const group: PricingGroup = { by, name: segment };
  const { logout } = useAuth();
  const { items, add } = useAmzBasket();

  // A status list has no Selling / Stuck split, so its view is pinned to 'all' (= the one list) whatever the URL says.
  const [modeState, setMode] = useState<ListView>(parseListView(searchParams.get('mode')));
  const mode: ListView = isStatus ? 'all' : modeState;
  const [showPending, setShowPending] = useState(searchParams.get('pending') === '1');

  // Back target — threaded via ?from=/&back= so arriving from the Segments heatmap returns you there rather than to /amz (the Amazon
  // Pricing home). Absent params fall back to that home. Mirrors the Shopify segment page.
  const backHref = searchParams.get('from') || '/amz';
  const backLabel = searchParams.get('back') || 'Amazon Pricing';

  const [marking, setMarking] = useState(false);                         // a bulk write is in flight (disables the bar)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-SKU apply progress

  // Both lists in ONE query, parked SKUs included, so every count comes from one fetch. Kept as a single Promise.all (rather than two
  // useApiQuery calls) to preserve PARTIAL TOLERANCE: one list failing must still render the other, under one shared error line.
  const { data, error: loadError, busy: loading, refresh: loadLists } = useApiQuery(
    ['amz-lists', by, segment, bar],
    async () => {
      // A STATUS is one unsplit list (GET /amz-status-list — every SKU of the status's styles, 0 FBA included). Its rows go in
      // `winners` with `losers` empty, and the view is pinned to 'all' above, so the rest of the page works unchanged.
      if (isStatus) {
        const s = await getAmzStatusList(segment, bar);
        if (s.return_code === 'UNAUTHORIZED') return { success: false, return_code: 'UNAUTHORIZED', error: 'Session expired' };
        if (!(s.success && s.data)) return { success: false, return_code: s.return_code, error: s.error || 'Failed to load list' };
        const rows: ListRow[] = s.data.rows.map((r) => ({
          kind: 'winner', code: r.code, groupid: r.groupid, amz_sku: r.amz_sku, size: r.size, title: r.title, brand: r.brand, units: r.units, u7: r.u7,
          fba: r.fba, price: r.price, rrp: r.rrp, next_review: r.next_review, parked: r.parked,
        }));
        return {
          success: true,
          return_code: 'SUCCESS',
          data: { winners: rows, losers: [] as ListRow[], capped: s.data.truncated, partialError: null, outOfStock: s.data.outOfStock },
        };
      }
      const [w, l] = await Promise.all([
        getAmzWinners(group, undefined, undefined, true),
        getAmzLosers(group, undefined, undefined, true),
      ]);
      if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED') {
        return { success: false, return_code: 'UNAUTHORIZED', error: 'Session expired' };
      }
      let err: string | null = null;
      if (!(w.success && w.data)) err = err || w.error || 'Failed to load winners';
      if (!(l.success && l.data)) err = err || l.error || 'Failed to load losers';
      const winners: ListRow[] = w.success && w.data ? w.data.rows.map((r) => ({
        kind: 'winner', code: r.code, groupid: r.groupid, amz_sku: r.amz_sku, size: r.size, title: r.title, brand: r.brand, units: r.units, u7: r.u7,
        fba: r.fba, price: r.price, rrp: r.rrp, next_review: r.next_review, parked: r.parked,
      })) : [];
      const losers: ListRow[] = l.success && l.data ? l.data.rows.map((r) => ({
        kind: 'loser', code: r.code, groupid: r.groupid, amz_sku: r.amz_sku, size: r.size, title: r.title, brand: r.brand, units: 0, u7: 0,   // sold nothing in 30d — the Stuck rule
        fba: r.fba, price: r.price, rrp: r.rrp, next_review: r.next_review, parked: r.parked,
      })) : [];
      return {
        success: true,
        return_code: 'SUCCESS',
        data: {
          winners,
          losers,
          // The safety cap trimmed a list — the page must never let a capped list pass for the whole job.
          capped: !!(w.data?.truncated || l.data?.truncated),
          partialError: err,
          outOfStock: null as number | null,   // only a status list reports how many rows have no stock
        },
      };
    },
  );

  // Counts for the controls, and the rows for the table. Everything is derived from the one fetch.
  const view = useMemo(() => {
    const winners = data?.winners ?? [];
    const losers = data?.losers ?? [];
    const keep = (r: ListRow) => showPending || !r.parked;
    const w = winners.filter(keep);
    const l = losers.filter(keep);
    const inMode = mode === 'winners' ? winners : mode === 'losers' ? losers : [...winners, ...losers];
    const rows = mode === 'winners' ? w : mode === 'losers' ? l : [...w, ...l];
    return {
      rows,
      styleCount: new Set(rows.map((r) => r.groupid)).size,
      counts: { winners: w.length, losers: l.length, all: w.length + l.length },
      pendingCount: inMode.filter((r) => r.parked).length,
    };
  }, [data, mode, showPending]);

  // Bulk selection + last-run feedback belong to ONE view of ONE segment, so they're scoped and discarded during render on a switch —
  // no reset effect, and no frame showing the previous view's ticks.
  const scope = `${mode}|${showPending}|${by}|${segment}|${bar ?? ''}`;
  const [selected, setSelected] = useScopedState<Set<string>>(scope, NO_SELECTION);
  const [markError, setMarkError] = useScopedState<string | null>(scope, null);
  const [resultSummary, setResultSummary] = useScopedState<string | null>(scope, null);

  const error = markError ?? data?.partialError ?? loadError?.message ?? null;
  // The basket item's segment is display-only and the server rebuild fills the real one (amz-basket: sk.segment). On a status list the
  // page name isn't a segment, so leave it blank rather than label a SKU "WINNERS" until the next rebuild.
  const basketSegment = isStatus ? null : segment;

  function openSku(code: string) {
    // Carry the view (mode + pending) and the back-context (from/back) through the drill round-trip.
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Repricing')}` : '';
    const from = `/amz/${encodeURIComponent(segment)}?${isStatus ? 'by=status&' : ''}${bar ? `bar=${bar}&` : ''}mode=${mode}${showPending ? '&pending=1' : ''}${ctx}`;
    router.push(`/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(from)}`);
  }

  function toggle(code: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  }
  function toggleAll(codes: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) codes.forEach((c) => next.add(c)); else codes.forEach((c) => next.delete(c));
      return next;
    });
  }

  const selectedRows = () => view.rows.filter((r) => selected.has(r.code));

  // BULK PRICE MOVE — loop POST /amz-apply per ticked SKU (newPrice = its current price + delta), exactly like applying one at a time,
  // so each write hits the same server bounds and queues the upload basket. reviewDays rides along as an optional park (mirrors the drill).
  // Rows whose current price is unknown (junk VARCHAR -> null) are skipped; the server may also block a SKU below its floor — both are
  // reported in the summary, not surfaced as hard errors (owner: "ignore blocked/below-min for now").
  async function bulkApplyPrice(delta: number, reviewDays: number | null, note: string) {
    const targets = selectedRows();
    if (targets.length === 0 || Math.abs(delta) < 0.005) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, skipped = 0, aboveRrp = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (row.price === null) { skipped++; setProgress({ done: i + 1, total: targets.length }); continue; }
      const newPrice = Math.round((row.price + delta) * 100) / 100;
      const res = await applyAmzPrice(row.code, newPrice, note, reviewDays);
      if (res.success && res.data) {
        const d = res.data;
        // Queue into the upload basket for instant feedback (same shape the drill's apply uses; segment from the page).
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment: basketSegment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
        // Over-RRP is allowed (a deliberate harvest move, not an error) but worth counting — a blanket bump can tip a size past RRP without
        // the operator noticing. Surface it in the summary; the write itself is unaffected. Mirrors the drill's "Above RRP — allowed" flag.
        if (d.warnings.includes('ABOVE_RRP')) aboveRrp++;
        applied++;
      } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
      else { skipped++; }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Applied ${applied}${aboveRrp ? ` · ${aboveRrp} above RRP` : ''}${skipped ? ` · ${skipped} skipped` : ''} → basket`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK SET PRICE — write ONE absolute price to every ticked SKU. Same loop and the same per-row server bounds as the relative move
  // above; newPrice is simply the typed figure instead of the row's price plus a delta. The `row.price === null` skip is deliberately
  // absent: that guard exists only because a relative move can't be computed without a current price, which an absolute one doesn't need.
  async function bulkSetPrice(price: number, reviewDays: number | null, note: string) {
    const targets = selectedRows();
    if (targets.length === 0 || !(price > 0)) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, skipped = 0, aboveRrp = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const res = await applyAmzPrice(row.code, price, note, reviewDays);
      if (res.success && res.data) {
        const d = res.data;
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment: basketSegment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
        if (d.warnings.includes('ABOVE_RRP')) aboveRrp++;
        applied++;
      } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
      else { skipped++; }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Set ${applied} to £${price.toFixed(2)}${aboveRrp ? ` · ${aboveRrp} above RRP` : ''}${skipped ? ` · ${skipped} skipped` : ''} → basket`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK RESET TO RRP — the same /amz-apply loop, each SKU to its OWN RRP (skusummary, per style). Rows with no RRP, or already at
  // it, are skipped. A blank note becomes "Reset to RRP" so the price log says why. The server's floor still blocks per row.
  async function bulkResetToRrp(reviewDays: number | null, note: string) {
    const targets = selectedRows();
    if (targets.length === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, noRrp = 0, already = 0, skipped = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (row.rrp === null) noRrp++;
      else if (row.price !== null && Math.round(row.price * 100) === Math.round(row.rrp * 100)) already++;
      else {
        const res = await applyAmzPrice(row.code, Math.round(row.rrp * 100) / 100, note || 'Reset to RRP', reviewDays);
        if (res.success && res.data) {
          const d = res.data;
          add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment: basketSegment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
          applied++;
        } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
        else { skipped++; }
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Reset ${applied} to RRP${already ? ` · ${already} already at RRP` : ''}${noRrp ? ` · ${noRrp} no RRP` : ''}${skipped ? ` · ${skipped} skipped` : ''} → basket`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK REVIEW ONLY — park the ticked SKUs with no price change (batch POST /amz-review). On success clear the selection and refetch so
  // parked SKUs move to "pending review" (hidden unless that toggle is on).
  async function bulkSetReview(days: number) {
    if (selected.size === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    const res = await markAmzReviewed(Array.from(selected), days);
    setMarking(false);
    if (res.success) {
      const n = res.data ? res.data.updated : selected.size;
      setResultSummary(`Review set on ${n}`);
      setSelected(new Set());
      await loadLists();
    }
    else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setMarkError(res.error || 'Failed to set review');
  }

  const rows = view.rows;
  const ready = !loading && !error && !!data;

  return (
    <AppShell backHref={backHref} backLabel={backLabel} crumb={<PricingCrumb name={segment} channel="amazon" note={isStatus ? (bar ? `status · ${barLabel(bar)}` : 'status') : undefined} />} headerRight={<AmzUploadButton />}>
      <AmzBasketBar />

      <ListViewControls
        view={mode}
        onViewChange={setMode}
        counts={data ? view.counts : null}
        dueOnly={!showPending}
        onDueOnlyChange={(due) => setShowPending(!due)}
        showTabs={!isStatus}
        summary={data ? (
          // At the top, so it's seen without scrolling (owner, 2026-09-26): the STYLES in the table below as the header — as the
          // Repricing card counts them — and under it the items (sizes = table rows). Both follow the Due switch.
          <div className="text-sm text-slate-500">
            <p><span className="text-2xl font-semibold tabular-nums text-slate-900">{view.styleCount}</span> style{view.styleCount === 1 ? '' : 's'}</p>
            <p className="tabular-nums">{view.rows.length} item{view.rows.length === 1 ? '' : 's'} in list</p>
          </div>
        ) : null}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {ready && rows.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners' ? 'Nothing selling' : mode === 'losers' ? 'Nothing stuck' : 'Nothing'} due for review in this {isStatus ? 'status' : 'segment'} right now.
          {!showPending && view.pendingCount > 0 && <> {view.pendingCount} not due yet — switch off &ldquo;Due&rdquo; to see them.</>}
        </div>
      )}

      {/* Bulk edit control: apply a relative price move and/or set a review across the ticked SKUs. Same denominations and review chips
          as the drill; a price move loops POST /amz-apply per SKU (queuing the basket), review-only uses POST /amz-review. */}
      {ready && rows.length > 0 && (
        <BulkActionBar
          channel="amazon"
          count={selected.size}
          nudges={AMZ_NUDGES}
          reviewChips={AMZ_REVIEW_CHIPS}
          tone={AMZ_TONE}
          busy={marking}
          progress={progress}
          resultSummary={resultSummary}
          error={markError}
          onApplyPrice={bulkApplyPrice}
          onApplySetPrice={bulkSetPrice}
          onResetToRrp={bulkResetToRrp}
          onSetReview={bulkSetReview}
        />
      )}

      {ready && rows.length > 0 && (
        <>
          {/* No summary line above the table (mirrors Shopify, owner 2026-09-25) — the due count is at the top. A capped list must
              never pass for the whole job, so that warning stays. */}
          {data.capped && (
            <p className="mb-2 text-xs text-amber-700">List capped by the server — work through these, then reload for the rest.</p>
          )}
          <ListTable
            rows={rows}
            queued={items}
            onOpen={openSku}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        </>
      )}
    </AppShell>
  );
}

// One table for every view — the Amazon twin of the Shopify ListTable, with the SAME columns in all three: Selling, Stuck and Both use
// the Selling layout so nothing moves when you flip tabs (owner, 2026-09-23). A Stuck SKU's Units 30d / 7d are 0 by definition, shown as 0 rather than hidden. A SKU already in the upload basket carries a
// "queued" pill so it isn't re-touched mid-sitting.
function ListTable({ rows, queued, onOpen, selected, onToggle, onToggleAll }: {
  rows: ListRow[]; queued: Record<string, unknown>;
  onOpen: (c: string) => void;
  selected: Set<string>; onToggle: (c: string) => void; onToggleAll: (codes: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.code));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-12" />{/* checkbox */}
          <col className="w-12" />{/* # */}
          <col className="w-24" />{/* Sold 30d */}
          <col className="w-14" />{/* 7d */}
          <col />{/* Code — takes the remaining width: it is the long identifier (owner, 2026-09-25) */}
          <col className="w-40" />{/* Brand — short; the product name is the Code cell's tooltip */}
          <col className="w-24" />{/* Price */}
          <col className="w-16" />{/* FBA */}
          <col className="w-24" />{/* Review */}
        </colgroup>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleAll(rows.map((r) => r.code), e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
                aria-label="Select all SKUs"
              />
            </th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">Sold</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>
            <th className="px-4 py-2 font-medium" title="Our code (skumap.code), not the Amazon SKU — size is the last two digits">Code</th>
            <th className="px-4 py-2 font-medium">Brand</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            <th className="px-4 py-2 font-medium">Review</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const isSel = selected.has(r.code);
            // A pending row is dimmed — it's listed for context, not because it needs doing today — but stays fully clickable.
            const tone = r.parked ? 'text-slate-400' : 'text-slate-700';
            return (
              <tr key={r.code} onClick={() => onOpen(r.code)} className={'cursor-pointer hover:bg-slate-50 ' + (isSel ? 'bg-brand-50' : '')}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(r.code)}
                    className="h-4 w-4 rounded border-slate-300"
                    aria-label="Select SKU for bulk edit"
                  />
                </td>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-semibold text-slate-800')}>{r.units ?? '—'}</td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.u7 ?? '—'}</td>
                {/* The product name is this cell's tooltip — only here, not the whole row (mirrors Shopify, owner 2026-09-25). */}
                <td className="truncate whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500" title={r.title ?? undefined}>
                  {r.code}
                  {!!queued[r.code] && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">queued</span>}
                </td>
                <td className={'truncate px-4 py-2 ' + tone}>{r.brand || <span className="text-slate-400">—</span>}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-medium text-slate-800')}>{money(r.price)}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + tone}>{r.fba}</td>
                <td className="whitespace-nowrap px-4 py-2">
                  {r.parked
                    ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{fmtReviewDate(r.next_review)}</span>
                    : <span className="text-xs text-slate-400">Due</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
