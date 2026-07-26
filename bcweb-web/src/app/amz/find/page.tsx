'use client';
/*
=======================================================================================================================================
Page: /amz/find  (direct SKU search)
=======================================================================================================================================
Purpose: Search matching product name, group id, Amazon Seller SKU or code via GET /amz-find (mirror of Shopify /pricing/find). Pick a
         result -> that SKU's drill. Lets the operator jump straight to a size without going through segment -> list. SKU-grain, so a group
         id match returns each of its sizes as a separate row. Accepts `?q=<term>` to pre-fill and auto-run the search, so a cross-module
         jump (e.g. Analytics' "reprice this" chooser, which only knows the groupid) lands here with the sizes already listed to pick from.

         CONTAINS / DOES NOT CONTAIN (2026-07-25). One box could only ever widen, but the set an operator wants is often a subtraction:
         "Rieker, but not the womens ones". That can't be done through segments — a style sits in exactly ONE segment, so the scheme
         expresses a single cut of the catalogue (currently seasonal), and mens Rieker is 5 styles spread across RIEKER-WIN and RIEKER-SUM.
         Gender lives only in the title, so a whole-word exclusion here is the only way to make that cut. This screen is already the
         cross-segment escape hatch, which is why it gets the capability and the segment LISTS deliberately don't: search is a lens over
         segments, not a rival to them — hence results keep showing each row's home Segment, and a search is never saved or named.

         COUNT + TRUNCATION WARNING. The route used to cap at 50 silently, so RIEKER showed 50 of 121 looking complete — above a select-all
         and a bulk price bar. Every search now states "N of TOTAL", and a capped result gets an amber warning that selecting all reaches
         only the rows shown. Steps also round-trip through the URL, so the drill's "← Search" returns to the narrowed list.
=======================================================================================================================================
*/

import { Suspense, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon, ArrowPathIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import { findAmzSkus, applyAmzPrice, markAmzReviewed, AmzFindRow, AmzFindStep } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
import { useScopedState } from '@/lib/useScopedState';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// Bulk price + review controls — identical set to the Amazon segment lists' bulk bar (same denominations, review chips, amber tone), so
// the Find screen bulk-edits a search result (e.g. a groupid's sizes) exactly like the Winners/Losers lists do.
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

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
export default function AmzFindPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AmzFindContent />
    </Suspense>
  );
}

// Stable identities for "nothing yet" — these feed memos and a scoped-state initial, both of which need a fixed reference.
const NO_RESULTS: AmzFindRow[] = [];
const NO_SELECTION: Set<string> = new Set();

function AmzFindContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  // Where we were handed in from (e.g. an Analytics screen that jumped here by groupid). Used for the back breadcrumb so a
  // "not on Amazon" jump returns to that origin, not the segment picker. Falls back to /amz for a plain visit.
  const from = searchParams.get('from') || '';
  const backHref = from || '/amz';
  const backLabel = from ? prettyPathLabel(from) : 'Segments';
  const { logout } = useAuth();
  const { add } = useAmzBasket();
  // Search boxes are forced UPPERCASE (owner) — group ids / SKU codes are uppercase, and the server matches case-insensitively so a title
  // term still finds its product. Two boxes rather than one: a single box can only ever WIDEN, and the set an operator actually wants is
  // often a subtraction ("Rieker, but not the womens ones") that segments can't express — a style lives in exactly one segment, so a
  // cross-cutting cut has no home in the segment scheme and has to be made here. Same Contains / Does-not-contain vocabulary as Inventory
  // and Analytics Sales, deliberately NOT a shared component (owner, 2026-07-25) so the screens can diverge without breaking each other.
  const [contains, setContains] = useState('');
  const [notContains, setNotContains] = useState('');
  const containsRef = useRef<HTMLInputElement>(null);

  // Steps restore from the URL so the drill's "← Search" returns to the NARROWED list, not just the opening term. `?q=` is the legacy
  // single-term form every cross-module deep link uses (Analytics "reprice this", the Sales row-click) — it becomes the first Contains.
  const initialSteps = useMemo<AmzFindStep[]>(() => {
    const has = searchParams.getAll('has');
    const not = searchParams.getAll('not');
    const out: AmzFindStep[] = [];
    if (has.length > 0 || not.length > 0) {
      has.forEach((t) => out.push({ op: 'has', term: t.toUpperCase() }));
      not.forEach((t) => out.push({ op: 'not', term: t.toUpperCase() }));
    } else if (initialQ) {
      out.push({ op: 'has', term: initialQ.toUpperCase() });
    }
    return out;
  }, [searchParams, initialQ]);

  // Seeded from ?q= / ?has= so a cross-module arrival searches on the FIRST render (the key is already non-null) — no mount effect.
  const [steps, setSteps] = useState<AmzFindStep[]>(initialSteps);

  // No steps => null key => no request and no results, which is what Reset used to achieve by clearing five pieces of state by hand.
  const { data, error: searchError, busy: loading } = useApiQuery(
    steps.length > 0 ? ['amz-find', steps] : null,
    () => findAmzSkus(steps),
  );
  const results: AmzFindRow[] = data?.rows ?? NO_RESULTS;
  const total = data?.total ?? 0;                 // TRUE match count, uncapped
  const truncated = data?.truncated ?? false;
  const searched = steps.length > 0;
  // Client-side validation hints ("search for something first") are NOT fetch errors — they must show without a request having failed,
  // and must clear on the next Find/Reset. Kept separate and merged only for display.
  const [hint, setHint] = useState<string | null>(null);
  const error = hint ?? searchError?.message ?? null;

  // Bulk selection — the codes ticked for a bulk price move and/or review. Cleared whenever a fresh search runs.
  // A changed result set is a NEW selection, so the ticks are SCOPED to the exact step list. This matters beyond tidiness: a tick that
  // survived a narrowing would still be applied by the bulk bar even though its row is no longer on screen. Scoping makes that
  // impossible by construction rather than relying on a reset firing first.
  const stepScope = JSON.stringify(steps);
  const [selected, setSelected] = useScopedState<Set<string>>(stepScope, NO_SELECTION);
  const [marking, setMarking] = useState(false);                          // a bulk write is in flight (disables the bar)
  const [markError, setMarkError] = useScopedState<string | null>(stepScope, null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-SKU apply progress
  const [resultSummary, setResultSummary] = useScopedState<string | null>(stepScope, null);  // outcome line from the last bulk run

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

  // BULK PRICE MOVE — loop POST /amz-apply per ticked SKU (newPrice = its current price + delta), exactly like the segment lists, so each
  // write hits the same server bounds and queues the upload basket. Each row carries its own segment/size/title, so the basket item is
  // built straight from the row + apply response. Rows with an unknown current price (junk VARCHAR -> null) are skipped and reported.
  async function bulkApplyPrice(delta: number, reviewDays: number | null, note: string) {
    const targets = results.filter((r) => selected.has(r.code));
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
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment: row.segment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
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
  }

  // BULK SET PRICE — write ONE absolute price to every ticked SKU. Same per-row loop and the same server bounds as the relative move
  // (each write is its own POST /amz-apply, so below-cost is still blocked and above-RRP still flagged per SKU); the only difference is
  // that newPrice is the typed figure rather than the row's price plus a delta. Note the row.price === null skip is NOT needed here —
  // that guard exists because a relative move can't be computed without a current price, whereas an absolute one can.
  async function bulkSetPrice(price: number, reviewDays: number | null, note: string) {
    const targets = results.filter((r) => selected.has(r.code));
    if (targets.length === 0 || !(price > 0)) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    setProgress({ done: 0, total: targets.length });
    let applied = 0, skipped = 0, aboveRrp = 0;
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const res = await applyAmzPrice(row.code, price, note, reviewDays);
      if (res.success && res.data) {
        const d = res.data;
        add({ id: d.log_id, code: d.code, amz_sku: d.amz_sku, size: row.size, title: row.title, segment: row.segment, old_price: d.old_price, new_price: d.new_price, rrp: d.rrp });
        if (d.warnings.includes('ABOVE_RRP')) aboveRrp++;
        applied++;
      } else if (res.return_code === 'UNAUTHORIZED') { setMarking(false); setProgress(null); logout(); return; }
      else { skipped++; }
      setProgress({ done: i + 1, total: targets.length });
    }
    setProgress(null); setMarking(false);
    setResultSummary(`Set ${applied} to £${price.toFixed(2)}${aboveRrp ? ` · ${aboveRrp} above RRP` : ''}${skipped ? ` · ${skipped} skipped` : ''} → basket`);
    setSelected(new Set());
  }

  // BULK REVIEW ONLY — park the ticked SKUs with no price change (batch POST /amz-review). Clears the selection on success.
  async function bulkSetReview(days: number) {
    if (selected.size === 0) return;
    setMarking(true); setMarkError(null); setResultSummary(null);
    const res = await markAmzReviewed(Array.from(selected), days);
    setMarking(false);
    if (res.success) {
      const n = res.data ? res.data.updated : selected.size;
      setResultSummary(`Review set on ${n}`);
      setSelected(new Set());
    }
    else if (res.return_code === 'UNAUTHORIZED') { logout(); }
    else setMarkError(res.error || 'Failed to set review');
  }

  // FIND — commit the boxes as steps, then clear them. Each Find narrows what the last one found.
  function onFind(e: React.FormEvent) {
    e.preventDefault();
    const c = contains.trim();
    const n = notContains.trim();
    if (!c && !n) return;
    // A Does-not-contain on its own would mean "every SKU except…" — the server rejects it, so guide rather than fire a doomed request.
    if (!c && steps.every((s) => s.op !== 'has')) {
      setHint('Search for something first, then exclude from it.');
      return;
    }
    const next: AmzFindStep[] = [];
    if (c) next.push({ op: 'has', term: c });
    if (n) next.push({ op: 'not', term: n });
    setSteps((prev) => [...prev, ...next]);
    setContains('');
    setNotContains('');
    setHint(null);
    containsRef.current?.focus();
  }

  function onReset() {
    setSteps([]);
    setContains('');
    setNotContains('');
    setHint(null);
    containsRef.current?.focus();
  }

  // This search as it currently stands (every step + origin) — handed to the SKU drill as its `from`, so "← Search" from the drill
  // returns to this NARROWED list (not an empty box, and not just the opening term), and this list's own breadcrumb still points back
  // to wherever we started.
  const selfUrl = useMemo(() => {
    const qs = steps.map((s) => `${s.op === 'has' ? 'has' : 'not'}=${encodeURIComponent(s.term)}`);
    if (from) qs.push(`from=${encodeURIComponent(from)}`);
    return `/amz/find?${qs.join('&')}`;
  }, [steps, from]);

  return (
    <AppShell title="Find a SKU" backHref={backHref} backLabel={backLabel}>
      <AmzBasketBar />

      <form onSubmit={onFind} className="mb-5 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Contains</label>
            <div className="relative">
              <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
              <input
                ref={containsRef}
                value={contains}
                onChange={(e) => setContains(e.target.value.toUpperCase())}
                autoFocus
                placeholder="Product name, group id or SKU code (e.g. RIEKER, 17659-23)"
                className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="min-w-[180px] flex-1">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Does not contain</label>
            <input
              value={notContains}
              onChange={(e) => setNotContains(e.target.value.toUpperCase())}
              placeholder="e.g. WOMENS"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Find
          </button>
          <button
            type="button"
            onClick={onReset}
            title="Clear the search and start again"
            className="flex items-center gap-1.5 rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            <ArrowPathIcon className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Reset
          </button>
        </div>

        {/* Applied steps — the record of how this set was narrowed. Contains brand-tinted, Does-not-contain struck through. */}
        {steps.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5 border-t border-slate-100 pt-3 text-sm">
            {steps.map((s, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-slate-300">›</span>}
                <span
                  className={
                    s.op === 'has'
                      ? 'rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700'
                      : 'rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-500 line-through decoration-slate-400'
                  }
                >
                  {s.op === 'not' && <span className="mr-0.5 no-underline">¬</span>}
                  {s.term}
                </span>
              </span>
            ))}
          </div>
        )}
      </form>

      {loading && <p className="text-sm text-slate-400">Searching…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="text-sm text-slate-400">No matches.</p>
      )}

      {/* Match count, always shown once searched. The count used to be absent entirely and the route silently capped at 50 — so a broad
          term (RIEKER matches 121 SKUs) returned a partial list that LOOKED complete, directly above a select-all and a bulk price bar.
          Stating "N of TOTAL" on every search is what makes the cap visible at all. */}
      {searched && !loading && !error && results.length > 0 && (
        <p className="mb-2 text-xs text-slate-500">
          Showing <span className="font-semibold text-slate-700">{results.length}</span>
          {truncated ? <> of <span className="font-semibold text-slate-700">{total}</span> matching SKUs</> : <> matching {results.length === 1 ? 'SKU' : 'SKUs'}</>}
        </p>
      )}

      {/* TRUNCATION WARNING — the sharp edge on this screen. Select-all ticks only what was RETURNED, so on a capped result an operator
          could bulk-apply believing they had covered the whole match. Say so in the operator's terms, right above the bulk bar. */}
      {truncated && !loading && (
        <div className="mb-3 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <ExclamationTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <span>
            <strong>{total - results.length}</strong> more {total - results.length === 1 ? 'SKU matches' : 'SKUs match'} than are listed.
            Selecting all only picks the <strong>{results.length}</strong> shown, so a bulk price move would miss the rest — add another
            term to narrow the search until everything fits.
          </span>
        </div>
      )}

      {/* Bulk edit control — tick some result rows (e.g. all of a groupid's sizes) and apply one relative price move and/or a review across
          them, exactly like the Winners/Losers lists. A price move loops POST /amz-apply per SKU (queuing the upload basket). */}
      {results.length > 0 && (
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

      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                {/* Scope is spelled out rather than the box being disabled on a truncated result: disabling would block the common,
                    perfectly safe case. The risk here is misunderstanding what "all" covers, so name it. */}
                <th className="px-4 py-2" title={`Select the ${results.length} SKUs shown${truncated ? ` (not all ${total} matches)` : ''}`}>
                  <SelectAllBox
                    checked={results.length > 0 && results.every((r) => selected.has(r.code))}
                    onChange={(c) => toggleAll(results.map((r) => r.code), c)}
                  />
                </th>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Segment</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
                <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => (
                <tr
                  key={r.code}
                  onClick={() => router.push(`/amz/sku/${encodeURIComponent(r.code)}?from=${encodeURIComponent(selfUrl)}`)}
                  className={'cursor-pointer hover:bg-slate-50 ' + (selected.has(r.code) ? 'bg-brand-50' : '')}
                >
                  <td className="px-4 py-2"><RowBox checked={selected.has(r.code)} onToggle={() => toggle(r.code)} /></td>
                  <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">{r.code}</td>
                  <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2 text-slate-500">{r.segment || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{r.price !== null ? `£${r.price.toFixed(2)}` : '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{r.fba}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}

// Row checkbox — stops the click bubbling to the row (which would open the drill instead of toggling selection). Mirrors the segment lists.
function RowBox({ checked, onToggle }: { checked: boolean; onToggle: () => void }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      onChange={onToggle}
      className="h-4 w-4 rounded border-slate-300"
      aria-label="Select SKU for bulk edit"
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
