'use client';
/*
=======================================================================================================================================
Page: /amz/[segment]  (Stage 1 — the segment's SKU lists)
=======================================================================================================================================
Purpose: The list view for a segment, with the same prominent WINNERS | LOSERS switch as Shopify — but SKU-grain (Amazon prices per size).
  - WINNERS: top in-stock SKUs by units sold in the last 30 days — candidates to price UP / harvest.
  - LOSERS:  dead (no Amazon sale in 14 days) / slow (cover >= 16 weeks) FBA stock — candidates to cut and get moving. Dead first, then
             most FBA stock at risk.
  - ALL:     every managed SKU in the segment, most-recently-changed first (browse/lookup).
WINNERS/LOSERS are the WHOLE qualifying lists, not a top-10 shortlist (a fixed 10 told the operator nothing — it silently refilled as it
was cleared). The count on each tab is therefore the actual work in front of you and shrinks as you clear it; the server keeps a safety
cap (utils/listLimit.js, default 100) so a pathological segment can't flood the browser, and the caption says when it bit.
Because a groupid's sizes each have their own price, one colour can have fast sizes in WINNERS and dead sizes in LOSERS at the same time.
All three lists are fetched up front (so each tab shows a live count) and cached; rows link to the per-SKU drill. The active mode is kept
in the URL (?mode=) so returning after an apply restores the same tab. A queued SKU (in the upload basket) shows a "queued" badge.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import ListModeSwitcher, { ListMode } from '@/components/ListModeSwitcher';
import ListNote from '@/components/ListNote';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import { getAmzWinners, getAmzLosers, getAmzAll, markAmzReviewed, applyAmzPrice, AmzWinnerRow, AmzLoserRow, AmzAllRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// Bulk price + review controls — kept identical to the Amazon drill's price-setter (owner: "exactly the same as the individual item").
// Nudge denominations = the engine's typical £0.30 / £0.50 / £1.00 steps; review chips = the drill's day set. Amber tone throughout.
const AMZ_NUDGES: Nudge[] = [
  { label: '−£1', delta: -1 }, { label: '−50p', delta: -0.5 }, { label: '−30p', delta: -0.3 },
  { label: '+30p', delta: 0.3 }, { label: '+50p', delta: 0.5 }, { label: '+£1', delta: 1 },
];
const AMZ_REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];
const AMZ_TONE: BulkTone = {
  chipOn: 'border-amber-600 bg-amber-600 text-white',
  applyBtn: 'bg-amber-600 hover:bg-amber-700',
  panel: 'border-amber-200',
};

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzSegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
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

  const modeParam = searchParams.get('mode');
  const initialMode: ListMode = modeParam === 'losers' ? 'losers' : modeParam === 'all' ? 'all' : 'winners';
  const [mode, setMode] = useState<ListMode>(initialMode);

  // Back target — threaded via ?from=/&back= so arriving from the Segments module returns you to that segment's detail rather than to
  // /amz (the Amazon Pricing home). Absent params fall back to that home, labelled "Segments". Mirrors the Shopify segment page.
  const backHref = searchParams.get('from') || '/amz';
  const backLabel = searchParams.get('back') || 'Segments';

  const [winners, setWinners] = useState<AmzWinnerRow[] | null>(null);
  const [losers, setLosers] = useState<AmzLoserRow[] | null>(null);
  const [all, setAll] = useState<AmzAllRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection (WINNERS/LOSERS only) — the codes ticked for a bulk price move and/or review. Cleared on mode/segment change.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);                         // a bulk write is in flight (disables the bar)
  const [markError, setMarkError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-SKU apply progress
  const [resultSummary, setResultSummary] = useState<string | null>(null);                 // outcome line from the last bulk run

  // Pre-cap qualifying counts from the server. Normally these equal rows.length, but if the safety cap ever trims a list the tab count
  // and the caption must show the REAL size — a capped list must never look like the whole job.
  const [winnersTotal, setWinnersTotal] = useState<number | null>(null);
  const [losersTotal, setLosersTotal] = useState<number | null>(null);

  // Fetch all three lists so each tab can show a count. Re-callable so a mark-reviewed can refetch (parked SKUs drop out, queue refills).
  const loadLists = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [w, l, a] = await Promise.all([getAmzWinners(segment), getAmzLosers(segment), getAmzAll(segment)]);
    if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED' || a.return_code === 'UNAUTHORIZED') { logout(); return; }
    let err: string | null = null;
    if (w.success && w.data) { setWinners(w.data.rows); setWinnersTotal(w.data.total); } else err = err || w.error || 'Failed to load winners';
    if (l.success && l.data) { setLosers(l.data.rows); setLosersTotal(l.data.total); } else err = err || l.error || 'Failed to load losers';
    if (a.success && a.data) setAll(a.data.rows); else err = err || a.error || 'Failed to load all SKUs';
    if (err) setError(err);
    setLoading(false);
  }, [segment, logout]);

  useEffect(() => { loadLists(); }, [loadLists]);
  // A different tab / segment is a different selection — never carry ticks (or a stale result line) across.
  useEffect(() => { setSelected(new Set()); setMarkError(null); setResultSummary(null); }, [mode, segment]);

  function openSku(code: string) {
    // Carry the back-context (from/back) through the drill round-trip so returning keeps the right "back" target.
    const rawFrom = searchParams.get('from');
    const ctx = rawFrom ? `&from=${encodeURIComponent(rawFrom)}&back=${encodeURIComponent(searchParams.get('back') || 'Segments')}` : '';
    const from = `/amz/${encodeURIComponent(segment)}?mode=${mode}${ctx}`;
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

  const rows = mode === 'winners' ? winners : mode === 'losers' ? losers : all;

  // Lookup of the ticked rows (from the active list) — the bulk price loop needs each SKU's current price + the basket fields (amz_sku,
  // size, title) that the upload file is built from. Winners and Losers rows both carry these (amz-winners/amz-losers).
  const selectedRows = (): (AmzWinnerRow | AmzLoserRow)[] => {
    const list = (mode === 'winners' ? winners : mode === 'losers' ? losers : null) || [];
    return list.filter((r) => selected.has(r.code));
  };

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

  // BULK REVIEW ONLY — park the ticked SKUs with no price change (batch POST /amz-review). On success clear the selection and refetch so
  // parked SKUs drop off and the queue refills.
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

  const isEmpty = !loading && !error && rows !== null && rows.length === 0;
  const selectable = mode === 'winners' || mode === 'losers';

  return (
    <AppShell title={segment} backHref={backHref} backLabel={backLabel}>
      <AmzBasketBar />

      <ListModeSwitcher
        mode={mode}
        onChange={setMode}
        winnersCount={winnersTotal}
        losersCount={losersTotal}
        allCount={all ? all.length : null}
        allDescription="every managed SKU in the segment — incl. out of stock, most-recently-changed first"
      />

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {isEmpty && (
        <div className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-500">
          {mode === 'winners'
            ? 'No SKUs to harvest here right now (nothing in FBA stock with sales in the last 30 days).'
            : mode === 'losers'
              ? 'No losers here right now — nothing dead or overstocked in this segment.'
              : 'No managed Amazon SKUs in this segment.'}
        </div>
      )}

      {/* Bulk edit control (WINNERS/LOSERS): apply a relative price move and/or set a review across the ticked SKUs. Same denominations
          and review chips as the drill; a price move loops POST /amz-apply per SKU (queuing the basket), review-only uses POST /amz-review. */}
      {!loading && !error && selectable && rows && rows.length > 0 && (
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
          onSetReview={bulkSetReview}
        />
      )}

      {!loading && !error && mode === 'winners' && winners && winners.length > 0 && (
        <>
          <ListNote shown={winners.length} total={winnersTotal} noun="SKU" />
          <WinnersTable rows={winners} queued={items} onOpen={openSku} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'losers' && losers && losers.length > 0 && (
        <>
          <ListNote shown={losers.length} total={losersTotal} noun="SKU" />
          <LosersTable rows={losers} queued={items} onOpen={openSku} selected={selected} onToggle={toggle} onToggleAll={toggleAll} />
        </>
      )}
      {!loading && !error && mode === 'all' && all && all.length > 0 && (
        <AllTable rows={all} queued={items} onOpen={openSku} />
      )}
    </AppShell>
  );
}

// A small "queued" pill for a SKU already in the upload basket (so you don't re-touch it mid-sitting).
function QueuedPill() {
  return <span className="ml-2 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">queued</span>;
}

type Queued = Record<string, unknown>;

function WinnersTable({ rows, queued, onOpen, selected, onToggle, onToggleAll }: {
  rows: AmzWinnerRow[]; queued: Queued; onOpen: (c: string) => void;
  selected: Set<string>; onToggle: (c: string) => void; onToggleAll: (codes: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.code));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.code), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">Units 30d</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.code) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.code)} onToggle={() => onToggle(r.code)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.units}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u7 || <span className="text-slate-300">0</span>}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.fba}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Row checkbox — stops the click bubbling to the row (which would open the drill instead of toggling selection).
function RowBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={onToggle}
      className="h-4 w-4 rounded border-slate-300"
      aria-label="Select SKU for mark-reviewed"
    />
  );
}
function SelectAllBox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 rounded border-slate-300"
      aria-label="Select all SKUs"
    />
  );
}

function LosersTable({ rows, queued, onOpen, selected, onToggle, onToggleAll }: {
  rows: AmzLoserRow[]; queued: Queued; onOpen: (c: string) => void;
  selected: Set<string>; onToggle: (c: string) => void; onToggleAll: (codes: string[], checked: boolean) => void;
}) {
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.code));
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2"><SelectAllBox checked={allChecked} onChange={(c) => onToggleAll(rows.map((r) => r.code), c)} /></th>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">Units 30d</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 7 days">7d</th>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.code) ? 'bg-brand-50' : '')}>
              <td className="px-4 py-2"><RowBox checked={selected.has(r.code)} onToggle={() => onToggle(r.code)} /></td>
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.u30}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u7 || <span className="text-slate-300">0</span>}</td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className="px-4 py-2 text-right text-slate-700">{r.fba}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AllTable({ rows, queued, onOpen }: { rows: AmzAllRow[]; queued: Queued; onOpen: (c: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
            <th className="px-4 py-2 text-right font-medium">Price</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            <th className="px-4 py-2 font-medium">Changed</th>
            <th className="px-4 py-2 font-medium">Last sold</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer hover:bg-slate-50">
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
              <td className="px-4 py-2 text-right font-medium text-slate-800">{money(r.price)}</td>
              <td className={'px-4 py-2 text-right ' + (r.fba === 0 ? 'text-slate-300' : 'text-slate-700')}>{r.fba}</td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtDate(r.last_change)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-slate-500">{fmtDate(r.last_sold)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
