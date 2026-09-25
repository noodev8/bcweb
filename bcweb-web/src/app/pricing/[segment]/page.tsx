'use client';
/*
=======================================================================================================================================
Page: /pricing/[segment]  (Stage 1 — the segment's lists)
=======================================================================================================================================
Purpose: The list view for a segment (see CLAUDE.md for the two bars).
  - WINNERS: styles that sold >= 2 units in the last 30 days AND averaged >= £2 net profit per unit (in stock), best first — candidates
             to price UP / harvest.
  - LOSERS:  in-stock styles that sold NOTHING in the last 30 days — candidates to cut and get moving. Biggest stuck piles first.

TWO CONTROLS, ONE TABLE (owner, 2026-09-23):
  - Selling | Stuck | Both (?mode=all) — on-screen names for WINNERS | LOSERS since 2026-09-23; code and URLs keep winners/losers.
    "Both" means the two lists together (winners first, then losers), NOT the whole segment. The old "All styles"
    view (every style incl. out-of-stock, from /pricing-all) was dropped from this screen in the same change.
  - "Due" switch. On (default) = only styles due now — the classic lists. Off = also the PARKED styles (review date still in the
    future), dimmed. The Review column is always shown: a date for a parked style, "Due" otherwise.
Both lists are fetched ONCE with parked styles included (?parked=include) and every filter is applied client-side, so each control can
show a live count and flipping them costs no request. Mode + pending are kept in the URL (?mode=, ?pending=1) so returning from a
style's drill restores the same view.

SEGMENT OR CAMPAIGN (owner, 2026-09-23): the [segment] path param is the GROUP name; ?by=campaign makes it a Google campaign bucket
(skusummary.googlecampaign) instead of a segment. Same lists, same bars, same drill and writes — only the slice differs (the server
switches ?segment= for ?campaign=, see utils/pricingGroup.js). `by` rides along in every URL this page builds so it survives the drill.
?by=status (2026-09-24) — the stored portfolio status (path name WINNERS / STEADY / NEW / HARVEST / LOSERS). It replaced the
Top earners grouping (removed the same day). ONE UNSPLIT LIST, not the Selling/Stuck pair (owner: "I don't think there's much point in
splitting"): EVERY style with the status, from GET /pricing-status-list — OUT OF STOCK INCLUDED (stock 0), so prices can be set ahead
of stock arriving rather than left at an old clearance price (owner). The list's length therefore equals the Winners card. The view
tabs are hidden and the mode pinned to 'all'; the Due switch, table, drill and bulk bar are unchanged. Opened from Repricing's Status
tab or from a card on the Winners screen (back link = wherever it came from). From Winners it opens with Due OFF (?pending=1) so the
list is the card's whole number, and WINNERS carries the dial's ?bar= (e.g. 2500 -> only the winners over £2,500, on the revenue
stamped at the last Update), shown in the crumb and kept through the drill round-trip. Only styles whose LEAD CHANNEL is Shopify or
both are listed (server, 2026-09-25) — an Amazon-led winner is on the Amazon list, where the money is.

List size: these are the WHOLE qualifying lists, not a top-10 shortlist — the count IS the work in front of you, and it goes down as you
clear it. The server still caps each response (utils/listLimit.js, default 100) purely so a pathological segment can't flood the
browser; when that cap bites the page says so.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import ListViewControls, { ListView, parseListView, fmtReviewDate } from '@/components/ListViewControls';
import PricingCrumb from '@/components/PricingCrumb';
import { getTriage, getLosers, getStatusList, applyPrice, parkStyleBulk, PricingGroup, PricingGroupBy, parseGroupBy } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useScopedState } from '@/lib/useScopedState';
import { barLabel } from '@/lib/portfolioStatusUi';

// Bulk price + review controls — kept identical to the Shopify drill's price-setter (owner: "exactly the same as the individual item").
// Nudge denominations = the drill's −£1/−50p/+50p/+£1/+£2 steps; review chips = the drill's day set. Shopify green tone throughout.
const SHP_NUDGES: Nudge[] = [
  { label: '−£1', delta: -1 }, { label: '−50p', delta: -0.5 },
  { label: '+50p', delta: 0.5 }, { label: '+£1', delta: 1 }, { label: '+£2', delta: 2 },
];
const SHP_REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Stable "nothing ticked" identity for useScopedState (it requires a stable initial — see that module's header). Never mutated:
// every toggle builds a new Set from the previous one.
const NO_SELECTION: Set<string> = new Set();
const SHP_TONE: BulkTone = {
  chipOn: 'border-brand-600 bg-brand-600 text-white',
  applyBtn: 'bg-emerald-600 hover:bg-emerald-700',
  panel: 'border-slate-200',
};

// One row of either list, flattened so a single table can show both. units is 0 for a loser (0 by definition — see pricing-losers.js;
// shown as 0 since the tabs share one layout, owner 2026-09-23).
interface ListRow {
  kind: 'winner' | 'loser';
  groupid: string;
  title: string | null;
  units: number | null;
  stock: number;
  price: number | null;
  rrp: number | null;       // the "Reset to RRP" target (null = junk/blank on skusummary -> skipped)
  match_amazon: boolean;
  next_review: string | null;
  parked: boolean;
}

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function SegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

// Crumb note (after the name — components/PricingCrumb) + empty-state noun per grouping. A segment needs no subtitle — it is the default.
const GROUP_SUBTITLE: Record<PricingGroupBy, string | undefined> = {
  segment: undefined,
  campaign: 'Google campaign',
  status: 'status',
};
const GROUP_NOUN: Record<PricingGroupBy, string> = { segment: 'segment', campaign: 'campaign', status: 'status' };

function money(v: number | null): string {
  return v !== null ? `£${v.toFixed(2)}` : '—';
}

function SegmentContent() {
  const router = useRouter();
  const params = useParams<{ segment: string }>();
  const searchParams = useSearchParams();
  const segment = decodeURIComponent(params.segment);
  const by = parseGroupBy(searchParams.get('by'));
  const group: PricingGroup = { by, name: segment };
  const isStatus = by === 'status';
  // WINNERS read at a Winners-screen dial mark (?bar=2500): only the winners over it (server-validated). Status lists only.
  const barRaw = Number(searchParams.get('bar'));
  const bar = isStatus && barRaw > 0 ? barRaw : null;
  // carried in every URL this page builds (see header) — `bar` with it, so the drill round-trip keeps the same subset
  const byParam = (by === 'segment' ? '' : `by=${by}&`) + (bar ? `bar=${bar}&` : '');
  const { logout } = useAuth();

  // A status list has no Selling / Stuck split, so its view is pinned to 'all' (= the one list) whatever the URL says.
  const [modeState, setMode] = useState<ListView>(parseListView(searchParams.get('mode')));
  const mode: ListView = isStatus ? 'all' : modeState;
  const [showPending, setShowPending] = useState(searchParams.get('pending') === '1');

  // Where "← back" returns to. Threaded via ?from=/&back= so arriving from the Segments heatmap returns you there — not to /pricing
  // (the Shopify Pricing home), which is a different list of segments. Absent params (you came from /pricing itself) fall back to
  // that home.
  const backHref = searchParams.get('from') || '/pricing';
  const backLabel = searchParams.get('back') || 'Shopify Pricing';

  const [marking, setMarking] = useState(false);                        // a bulk write is in flight (disables the bar)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-style apply progress

  // Both lists in ONE query, parked styles included, so every count on the page comes from one fetch. The two calls stay a single
  // Promise.all rather than two useApiQuery calls because PARTIAL TOLERANCE matters: if one list fails the other must still render,
  // under one shared error line.
  const { data, error: loadError, busy: loading, refresh: loadLists } = useApiQuery(
    ['pricing-lists', group.by, segment, bar],
    async () => {
      // A STATUS is one unsplit list (GET /pricing-status-list — every in-stock style with the status, not the two bars). Its rows
      // go in `winners` with `losers` empty, and the view is pinned to 'all' below, so the rest of the page works unchanged.
      if (isStatus) {
        const s = await getStatusList(segment, bar);
        if (s.return_code === 'UNAUTHORIZED') return { success: false, return_code: 'UNAUTHORIZED', error: 'Session expired' };
        if (!(s.success && s.data)) return { success: false, return_code: s.return_code, error: s.error || 'Failed to load list' };
        const rows: ListRow[] = s.data.rows.map((r) => ({
          kind: 'winner', groupid: r.groupid, title: r.title, units: r.u30, stock: r.stock, price: r.price, rrp: r.rrp,
          match_amazon: r.match_amazon, next_review: r.next_review, parked: r.parked,
        }));
        return {
          success: true,
          return_code: 'SUCCESS',
          data: { winners: rows, losers: [] as ListRow[], capped: s.data.truncated, partialError: null, outOfStock: s.data.outOfStock },
        };
      }
      const [w, l] = await Promise.all([
        getTriage(group, undefined, undefined, true),
        getLosers(group, undefined, undefined, true),
      ]);
      if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED') {
        return { success: false, return_code: 'UNAUTHORIZED', error: 'Session expired' };
      }
      let err: string | null = null;
      if (!(w.success && w.data)) err = err || w.error || 'Failed to load winners';
      if (!(l.success && l.data)) err = err || l.error || 'Failed to load losers';
      const winners: ListRow[] = w.success && w.data ? w.data.rows.map((r) => ({
        kind: 'winner', groupid: r.groupid, title: r.title, units: r.units, stock: r.stock, price: r.price, rrp: r.rrp,
        match_amazon: r.match_amazon, next_review: r.next_review, parked: r.parked,
      })) : [];
      const losers: ListRow[] = l.success && l.data ? l.data.rows.map((r) => ({
        kind: 'loser', groupid: r.groupid, title: r.title, units: 0, stock: r.stock, price: r.price, rrp: r.rrp,   // units 0: sold nothing in 30d — the Stuck rule
        match_amazon: r.match_amazon, next_review: r.next_review, parked: r.parked,
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
    return {
      rows: mode === 'winners' ? w : mode === 'losers' ? l : [...w, ...l],
      counts: { winners: w.length, losers: l.length, all: w.length + l.length },
      pendingCount: inMode.filter((r) => r.parked).length,
    };
  }, [data, mode, showPending]);

  // Bulk selection + the last run's feedback belong to ONE view of ONE segment. Scoping them means switching view or segment discards
  // them during render — no reset effect, and no frame where the previous view's ticks are still visible.
  const scope = `${mode}|${showPending}|${group.by}|${segment}|${bar ?? ''}`;
  const [selected, setSelected] = useScopedState<Set<string>>(scope, NO_SELECTION);
  const [markError, setMarkError] = useScopedState<string | null>(scope, null);
  const [resultSummary, setResultSummary] = useScopedState<string | null>(scope, null);

  // A failed bulk write must not blank a list that loaded fine, so the two error sources stay distinct and are merged only for display.
  const error = markError ?? data?.partialError ?? loadError?.message ?? null;

  function openStyle(groupid: string) {
    // Carry the view (mode + pending) and the back-context (from/back) into the return URL, so coming back from the drill lands on the
    // same view with the same "← back" target.
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Repricing')}` : '';
    const from = `/pricing/${encodeURIComponent(segment)}?${byParam}mode=${mode}${showPending ? '&pending=1' : ''}${ctx}`;
    router.push(`/pricing/style/${encodeURIComponent(groupid)}?from=${encodeURIComponent(from)}`);
  }

  function toggle(groupid: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupid)) next.delete(groupid); else next.add(groupid);
      return next;
    });
  }
  function toggleAll(ids: string[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) ids.forEach((g) => next.add(g)); else ids.forEach((g) => next.delete(g));
      return next;
    });
  }

  // BULK PRICE MOVE — loop POST /pricing-apply (W1) per ticked style (newPrice = its current price + delta), exactly like applying one at
  // a time, so each write runs the same server bounds AND the live Shopify push. reviewDays rides along as an optional park (mirrors the
  // drill). Styles with an unknown current price (junk VARCHAR -> null) are skipped; the server may also block one below cost — both are
  // reported in the summary, not surfaced as hard errors (owner: "ignore blocked/below-min for now").
  async function bulkApplyPrice(delta: number, reviewDays: number | null, note: string) {
    const targets = view.rows.filter((r) => selected.has(r.groupid));
    if (targets.length === 0 || Math.abs(delta) < 0.005) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, skipped = 0, pushIssues = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (row.price === null) { skipped++; setProgress({ done: i + 1, total: targets.length }); continue; }
      const newPrice = Math.round((row.price + delta) * 100) / 100;
      const res = await applyPrice(row.groupid, newPrice, reviewDays, note);
      if (res.success && res.data) {
        applied++;
        if (res.data.shopify && res.data.shopify.pushed === false) pushIssues++;   // Google is decoupled (server sweep) — only Shopify can fail here
      } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
      else { skipped++; }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Applied ${applied}${skipped ? ` · ${skipped} skipped` : ''}${pushIssues ? ` · ${pushIssues} push issue${pushIssues > 1 ? 's' : ''}` : ''}`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK RESET TO RRP — the same W1 loop, each style to its OWN RRP. Rows with no RRP, or already at it, are skipped (a no-change
  // apply would still write a log row and a push). A blank note becomes "Reset to RRP" so the price log says why.
  async function bulkResetToRrp(reviewDays: number | null, note: string) {
    const targets = view.rows.filter((r) => selected.has(r.groupid));
    if (targets.length === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, noRrp = 0, already = 0, skipped = 0, pushIssues = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      if (row.rrp === null) noRrp++;
      else if (row.price !== null && Math.round(row.price * 100) === Math.round(row.rrp * 100)) already++;
      else {
        const res = await applyPrice(row.groupid, Math.round(row.rrp * 100) / 100, reviewDays, note || 'Reset to RRP');
        if (res.success && res.data) {
          applied++;
          if (res.data.shopify && res.data.shopify.pushed === false) pushIssues++;
        } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
        else { skipped++; }
      }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Reset ${applied} to RRP${already ? ` · ${already} already at RRP` : ''}${noRrp ? ` · ${noRrp} no RRP` : ''}${skipped ? ` · ${skipped} skipped` : ''}${pushIssues ? ` · ${pushIssues} push issue${pushIssues > 1 ? 's' : ''}` : ''}`);
    setSelected(new Set());
    await loadLists();
  }

  // BULK REVIEW ONLY — park the ticked styles with no price change (batch POST /pricing-park-bulk, W2). On success clear + refetch so
  // parked styles move to "pending review" (hidden unless that toggle is on).
  async function bulkSetReview(days: number) {
    if (selected.size === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    const res = await parkStyleBulk(Array.from(selected), days);
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
    <AppShell backHref={backHref} backLabel={backLabel} crumb={<PricingCrumb name={segment} channel="shopify" note={bar ? `status · ${barLabel(bar)}` : GROUP_SUBTITLE[by]} />}>
      <ListViewControls
        view={mode}
        onViewChange={setMode}
        counts={data ? view.counts : null}
        dueOnly={!showPending}
        onDueOnlyChange={(due) => setShowPending(!due)}
        showTabs={!isStatus}
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {ready && rows.length === 0 && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners' ? 'Nothing selling' : mode === 'losers' ? 'Nothing stuck' : 'Nothing'} due for review in this {GROUP_NOUN[by]} right now.
          {!showPending && view.pendingCount > 0 && <> {view.pendingCount} not due yet — switch off &ldquo;Due&rdquo; to see them.</>}
        </div>
      )}

      {/* Bulk edit control: apply a relative price move and/or set a review across the ticked styles. Same denominations and review chips
          as the drill; a price move loops POST /pricing-apply (W1, live push per style), review-only uses /pricing-park-bulk. */}
      {ready && rows.length > 0 && (
        <BulkActionBar
          channel="shopify"
          count={selected.size}
          nudges={SHP_NUDGES}
          reviewChips={SHP_REVIEW_CHIPS}
          tone={SHP_TONE}
          busy={marking}
          progress={progress}
          resultSummary={resultSummary}
          error={markError}
          onApplyPrice={bulkApplyPrice}
          onResetToRrp={bulkResetToRrp}
          onSetReview={bulkSetReview}
        />
      )}

      {ready && rows.length > 0 && (
        <>
          <p className="mb-2 text-xs text-slate-400">
            {dueCount} style{dueCount === 1 ? '' : 's'} due for review
            {showPending && <> · {rows.length - dueCount} pending</>}
            {data.capped && <> — list capped by the server; work through these, then reload for the rest.</>}
            {/* A status list includes out-of-stock styles (stock 0) so they can be priced ahead of arrival — say how many. */}
            {!!data.outOfStock && <> · {data.outOfStock} out of stock</>}
          </p>
          <ListTable
            rows={rows}
            onOpen={openStyle}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
          />
        </>
      )}
    </AppShell>
  );
}

// One table for every view with the SAME columns in all three — Selling, Stuck and Both use the Selling layout so nothing moves when
// you flip tabs (owner, 2026-09-23). A Stuck style's Units 30d is 0 by definition, shown as 0 rather than hidden. table-fixed + a
// colgroup pins the widths.
function ListTable({ rows, onOpen, selected, onToggle, onToggleAll }: {
  rows: ListRow[];
  onOpen: (g: string) => void;
  selected: Set<string>; onToggle: (g: string) => void; onToggleAll: (ids: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.groupid));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full table-fixed text-sm">
        <colgroup>
          <col className="w-12" />{/* checkbox */}
          <col className="w-12" />{/* # */}
          <col className="w-24" />{/* Units 30d */}
          <col className="w-40" />{/* Groupid */}
          <col />{/* Product — takes the remaining width */}
          <col className="w-24" />{/* Price */}
          <col className="w-20" />{/* Stock */}
          <col className="w-24" />{/* Review */}
        </colgroup>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">
              <input
                type="checkbox"
                checked={allChecked}
                onChange={(e) => onToggleAll(rows.map((r) => r.groupid), e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
                aria-label="Select all styles"
              />
            </th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 font-medium" title="Units sold, last 30 days">Units</th>
            <th className="px-4 py-2 font-medium">Groupid</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium">Stock</th>
            <th className="px-4 py-2 font-medium">Review</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => {
            const isSel = selected.has(r.groupid);
            // A pending row is dimmed — it's listed for context, not because it needs doing today — but stays fully clickable.
            const tone = r.parked ? 'text-slate-400' : 'text-slate-700';
            return (
              <tr key={r.groupid} onClick={() => onOpen(r.groupid)} className={'cursor-pointer hover:bg-slate-50 ' + (isSel ? 'bg-brand-50' : '')}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={isSel}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => onToggle(r.groupid)}
                    className="h-4 w-4 rounded border-slate-300"
                    aria-label="Select style for bulk edit"
                  />
                </td>
                <td className="px-4 py-2 text-slate-400">{i + 1}</td>
                <td className={'px-4 py-2 tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-semibold text-slate-800')}>{r.units ?? '—'}</td>
                <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-500">{r.groupid}</td>
                <td className={'truncate px-4 py-2 ' + tone}>
                  {r.title || <span className="text-slate-400">—</span>}
                  {/* Amazon-match badge: the autopilot is retired (CLAUDE.md) but the badge stays for when it is revived. */}
                  {r.match_amazon && (
                    <span className="ml-2 inline-flex items-center rounded bg-emerald-50 px-1.5 py-0.5 align-middle text-[10px] font-medium text-emerald-700" title="Auto-matched to Amazon lowest — review only (manual price locked)">
                      Amazon-matched
                    </span>
                  )}
                </td>
                <td className={'px-4 py-2 text-right tabular-nums ' + (r.parked ? 'text-slate-400' : 'font-medium text-slate-800')}>{money(r.price)}</td>
                <td className={'px-4 py-2 text-right tabular-nums ' + tone}>{r.stock}</td>
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
