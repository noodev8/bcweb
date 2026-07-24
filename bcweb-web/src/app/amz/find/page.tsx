'use client';
/*
=======================================================================================================================================
Page: /amz/find  (direct SKU search)
=======================================================================================================================================
Purpose: Search box matching product name, group id or SKU code via GET /amz-find?term= (mirror of Shopify /pricing/find). Pick a result
         -> that SKU's drill. Lets the operator jump straight to a size without going through segment -> list. SKU-grain, so a group id
         match returns each of its sizes as a separate row. Accepts `?q=<term>` to pre-fill and auto-run the search, so a cross-module
         jump (e.g. Analytics' "reprice this" chooser, which only knows the groupid) lands here with the sizes already listed to pick from.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import BulkActionBar, { Nudge, BulkTone } from '@/components/BulkActionBar';
import { findAmzSkus, applyAmzPrice, markAmzReviewed, AmzFindRow } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';
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
  // Search field is forced UPPERCASE (owner) — group ids / SKU codes are uppercase, and the server matches case-insensitively so a title
  // term still finds its product. Mirrors the Shopify /pricing/find box.
  const [term, setTerm] = useState(initialQ.toUpperCase());
  const [results, setResults] = useState<AmzFindRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Bulk selection — the codes ticked for a bulk price move and/or review. Cleared whenever a fresh search runs.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);                          // a bulk write is in flight (disables the bar)
  const [markError, setMarkError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);  // live per-SKU apply progress
  const [resultSummary, setResultSummary] = useState<string | null>(null);                 // outcome line from the last bulk run

  const runSearch = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    setSelected(new Set()); setMarkError(null); setResultSummary(null);   // a new result set is a new selection — never carry ticks over
    const res = await findAmzSkus(t);
    if (res.success && res.data) {
      setResults(res.data);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Search failed');
      setResults([]);
    }
    setSearched(true);
    setLoading(false);
  }, [logout]);

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

  // Arrived with ?q= (e.g. from a cross-module jump by groupid) — run that search once on mount.
  useEffect(() => { if (initialQ) runSearch(initialQ); }, [initialQ, runSearch]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(term);
  }

  // This search as it currently stands (query + origin) — handed to the SKU drill as its `from`, so "← Search" from the drill returns
  // to this populated list (not an empty box), and this list's own breadcrumb still points back to wherever we started.
  const selfUrl = `/amz/find?q=${encodeURIComponent(term)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;

  return (
    <AppShell title="Find a SKU" backHref={backHref} backLabel={backLabel}>
      <AmzBasketBar />

      <form onSubmit={onSearch} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Product name, group id or SKU code (e.g. IVES, FLE030-IVES-STONE-06)"
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm uppercase placeholder:normal-case focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
        </div>
        <button type="submit" className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
          Search
        </button>
      </form>

      {loading && <p className="text-sm text-slate-400">Searching…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {searched && !loading && !error && results.length === 0 && (
        <p className="text-sm text-slate-400">No matches.</p>
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
          onSetReview={bulkSetReview}
        />
      )}

      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">
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
