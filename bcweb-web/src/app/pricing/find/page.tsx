'use client';
/*
=======================================================================================================================================
Page: /pricing/find  (direct product search)
=======================================================================================================================================
Purpose: Search box matching groupid or title via GET /pricing-find?term= (CLAUDE.md). Pick a result -> its drill page. Lets the user
         jump straight to a style without going through segment -> triage. Accepts `?q=<term>` to pre-fill and auto-run the search, so
         another module (e.g. Analytics' "reprice this" chooser) can hand a groupid straight in — no pasting.
=======================================================================================================================================
*/

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { findProducts, FindRow } from '@/lib/api';
import { prettyPathLabel } from '@/lib/nav';
import { useAuth } from '@/contexts/AuthContext';

// useSearchParams must sit inside a Suspense boundary for Next's build (App Router). Thin wrapper does that.
export default function FindPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <FindContent />
    </Suspense>
  );
}

function FindContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') || '';
  // Origin we were handed in from (a cross-module jump) — used for the back breadcrumb so it returns there, not to the segment picker.
  const from = searchParams.get('from') || '';
  const backHref = from || '/pricing';
  const backLabel = from ? prettyPathLabel(from) : 'Segments';
  const { logout } = useAuth();
  // Search field is forced UPPERCASE (owner) — groupids/codes are uppercase, and the server matches with ILIKE so a title term still
  // matches case-insensitively. Uppercasing the value (not just CSS) keeps the displayed and submitted term consistent.
  const [term, setTerm] = useState(initialQ.toUpperCase());
  const [results, setResults] = useState<FindRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSearch = useCallback(async (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    setLoading(true);
    setError(null);
    const res = await findProducts(t);
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

  // Arrived with ?q= (e.g. from a cross-module jump) — run that search once on mount.
  useEffect(() => { if (initialQ) runSearch(initialQ); }, [initialQ, runSearch]);

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    runSearch(term);
  }

  // This search as it currently stands (query + origin) — handed to the drill as its `from` so back returns to the populated list,
  // whose own breadcrumb still points back to wherever we started.
  const selfUrl = `/pricing/find?q=${encodeURIComponent(term)}${from ? `&from=${encodeURIComponent(from)}` : ''}`;

  return (
    <AppShell title="Find a product" backHref={backHref} backLabel={backLabel}>
      <form onSubmit={onSearch} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value.toUpperCase())}
            autoFocus
            placeholder="Product name or code (e.g. ARIZONA, 1019051)"
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

      {results.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Code</th>
                <th className="px-4 py-2 font-medium">Product</th>
                <th className="px-4 py-2 font-medium">Segment</th>
                <th className="px-4 py-2 text-right font-medium">Price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((r) => (
                <tr
                  key={r.groupid}
                  onClick={() => router.push(`/pricing/style/${encodeURIComponent(r.groupid)}?from=${encodeURIComponent(selfUrl)}`)}
                  className="cursor-pointer hover:bg-slate-50"
                >
                  <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.groupid}</td>
                  <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
                  <td className="px-4 py-2 text-slate-500">{r.segment || '—'}</td>
                  <td className="px-4 py-2 text-right text-slate-700">{r.now !== null ? `£${r.now.toFixed(2)}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
