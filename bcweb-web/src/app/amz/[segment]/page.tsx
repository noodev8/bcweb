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

TWO CONTROLS, ONE TABLE (owner, 2026-09-23 — same layout as Shopify, shared via components/ListViewControls):
  - Winners | Losers | All. "All" means BOTH lists together (winners first, then losers), NOT every managed SKU. The old "All" view
    (every SKU incl. out of stock, from /amz-all) was dropped from this screen in the same change.
  - "Show pending review". Off (default) = only SKUs due now. On = also the PARKED SKUs (skumap.next_amz_price_review in the
    future), dimmed and with their review date shown.
Both lists are fetched ONCE with parked SKUs included (?parked=include) and filtered client-side, so every control shows a live count
and flipping them costs no request. View + pending are kept in the URL (?mode=, ?pending=1) so returning from a SKU's drill restores
them. The lists are the WHOLE qualifying sets; the server's safety cap (utils/listLimit.js) is flagged when it bites. A SKU already in
the upload basket shows a "queued" badge.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import ListViewControls, { ListView, parseListView, fmtReviewDate } from '@/components/ListViewControls';
import { getAmzWinners, getAmzLosers, markAmzReviewed, applyAmzPrice } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useScopedState } from '@/lib/useScopedState';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// Bulk price + review controls — kept identical to the Amazon drill's price-setter (owner: "exactly the same as the individual item").
// Nudge denominations = the engine's typical £0.30 / £0.50 / £1.00 steps; review chips = the drill's day set. Amber tone throughout.
const AMZ_NUDGES: Nudge[] = [
  { label: '−£1', delta: -1 }, { label: '−50p', delta: -0.5 }, { label: '−30p', delta: -0.3 },
  { label: '+30p', delta: 0.3 }, { label: '+50p', delta: 0.5 }, { label: '+£1', delta: 1 },
];
const AMZ_REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Stable "nothing ticked" identity for useScopedState (it requires a stable initial). Never mutated — every toggle builds a new Set.
const NO_SELECTION: Set<string> = new Set();
const AMZ_TONE: BulkTone = {
  chipOn: 'border-amber-600 bg-amber-600 text-white',
  applyBtn: 'bg-amber-600 hover:bg-amber-700',
  panel: 'border-amber-200',
};

// One row of either list, flattened so a single table can show both. units/u7 are null for a loser (always 0 by definition — see
// amz-losers.js — so they render as a dash rather than columns of zeroes). amz_sku/size/title feed the upload basket.
interface ListRow {
  kind: 'winner' | 'loser';
  code: string;
  amz_sku: string;
  size: string;
  title: string | null;
  units: number | null;
  u7: number | null;
  fba: number;
  price: number | null;
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
  const { logout } = useAuth();
  const { items, add } = useAmzBasket();

  const [mode, setMode] = useState<ListView>(parseListView(searchParams.get('mode')));
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
    ['amz-lists', segment],
    async () => {
      const [w, l] = await Promise.all([
        getAmzWinners(segment, undefined, undefined, true),
        getAmzLosers(segment, undefined, undefined, true),
      ]);
      if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED') {
        return { success: false, return_code: 'UNAUTHORIZED', error: 'Session expired' };
      }
      let err: string | null = null;
      if (!(w.success && w.data)) err = err || w.error || 'Failed to load winners';
      if (!(l.success && l.data)) err = err || l.error || 'Failed to load losers';
      const winners: ListRow[] = w.success && w.data ? w.data.rows.map((r) => ({
        kind: 'winner', code: r.code, amz_sku: r.amz_sku, size: r.size, title: r.title, units: r.units, u7: r.u7,
        fba: r.fba, price: r.price, next_review: r.next_review, parked: r.parked,
      })) : [];
      const losers: ListRow[] = l.success && l.data ? l.data.rows.map((r) => ({
        kind: 'loser', code: r.code, amz_sku: r.amz_sku, size: r.size, title: r.title, units: null, u7: null,
        fba: r.fba, price: r.price, next_review: r.next_review, parked: r.parked,
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
    return {
      rows: mode === 'winners' ? w : mode === 'losers' ? l : [...w, ...l],
      counts: { winners: w.length, losers: l.length, all: w.length + l.length },
      pendingCount: inMode.filter((r) => r.parked).length,
    };
  }, [data, mode, showPending]);

  // Bulk selection + last-run feedback belong to ONE view of ONE segment, so they're scoped and discarded during render on a switch —
  // no reset effect, and no frame showing the previous view's ticks.
  const scope = `${mode}|${showPending}|${segment}`;
  const [selected, setSelected] = useScopedState<Set<string>>(scope, NO_SELECTION);
  const [markError, setMarkError] = useScopedState<string | null>(scope, null);
  const [resultSummary, setResultSummary] = useScopedState<string | null>(scope, null);

  const error = markError ?? data?.partialError ?? loadError?.message ?? null;

  function openSku(code: string) {
    // Carry the view (mode + pending) and the back-context (from/back) through the drill round-trip.
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Segments')}` : '';
    const from = `/amz/${encodeURIComponent(segment)}?mode=${mode}${showPending ? '&pending=1' : ''}${ctx}`;
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
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
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
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
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
  const dueCount = rows.filter((r) => !r.parked).length;

  return (
    <AppShell title={segment} backHref={backHref} backLabel={backLabel}>
      <AmzBasketBar />

      <ListViewControls
        view={mode}
        onViewChange={setMode}
        counts={data ? view.counts : null}
        showPending={showPending}
        onShowPendingChange={setShowPending}
        pendingCount={data ? view.pendingCount : null}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {ready && rows.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners' ? 'No winners' : mode === 'losers' ? 'No losers' : 'Nothing'} due for review in this segment right now.
          {!showPending && view.pendingCount > 0 && <> {view.pendingCount} pending review — switch on &ldquo;Show pending review&rdquo; to see them.</>}
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
          onSetReview={bulkSetReview}
        />
      )}

      {ready && rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {dueCount} SKU{dueCount === 1 ? '' : 's'} due for review
            {showPending && <> · {rows.length - dueCount} pending</>}
            {data.capped && <> — list capped by the server; work through these, then reload for the rest.</>}
          </p>
          <ListTable
            rows={rows}
            queued={items}
            showKind={mode === 'all'}
            showUnits={mode !== 'losers'}
            showReview={showPending}
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

// One table for every view — the Amazon twin of the Shopify ListTable. Columns appear only where they carry information: Type only in
// All, Units 30d / 7d only where winners are present (a loser's are 0 by definition), Review only with pending shown. A SKU already in
// the upload basket carries a "queued" pill so it isn't re-touched mid-sitting.
function ListTable({ rows, queued, showKind, showUnits, showReview, onOpen, selected, onToggle, onToggleAll }: {
  rows: ListRow[]; queued: Record<string, unknown>; showKind: boolean; showUnits: boolean; showReview: boolean;
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
          {showKind && <col className="w-24" />}
          {showUnits && <col className="w-24" />}
          {showUnits && <col className="w-14" />}
          <col className="w-52" />{/* SKU (size) */}
          <col />{/* Product — takes the remaining width */}
          <col className="w-24" />{/* Price */}
          <col className="w-16" />{/* FBA */}
          {showReview && <col className="w-24" />}
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
            {showKind && <th className="px-4 py-2 font-medium">Type</th>}
            {showUnits && <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">Units 30d</th>}
            {showUnits && <th className="px-4 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>}
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            {showReview && <th className="px-4 py-2 font-medium">Review</th>}
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
                {showKind && (
                  <td className="px-4 py-2">
                    <span className={'rounded px-1.5 py-0.5 text-xs font-medium ' + (r.kind === 'winner' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700')}>
                      {r.kind === 'winner' ? 'Winner' : 'Loser'}
                    </span>
                  </td>
                )}
                {showUnits && (
                  <td className={'px-4 py-2 text-right tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-semibold text-slate-800')}>{r.units ?? '—'}</td>
                )}
                {showUnits && (
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{r.u7 ?? '—'}</td>
                )}
                <td className="truncate whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">
                  {r.code}
                  {!!queued[r.code] && <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">queued</span>}
                </td>
                <td className={'truncate px-4 py-2 ' + tone}>{r.title || <span className="text-slate-400">—</span>}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-medium text-slate-800')}>{money(r.price)}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + tone}>{r.fba}</td>
                {showReview && (
                  <td className="whitespace-nowrap px-4 py-2">
                    {r.parked
                      ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{fmtReviewDate(r.next_review)}</span>
                      : <span className="text-xs text-slate-400">Due</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
