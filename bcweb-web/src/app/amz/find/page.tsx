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
import { findAmzSkus, AmzFindRow } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';

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
  const [term, setTerm] = useState(initialQ);
  const [results, setResults] = useState<AmzFindRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
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
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
            placeholder="Product name, group id or SKU code (e.g. IVES, FLE030-IVES-STONE-06)"
            className="w-full rounded-md border border-slate-300 py-2 pl-10 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
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

      {results.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">SKU (size)</th>
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
                  className="cursor-pointer hover:bg-slate-50"
                >
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
