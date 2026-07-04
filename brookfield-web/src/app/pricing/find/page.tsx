'use client';
/*
=======================================================================================================================================
Page: /pricing/find  (direct product search)
=======================================================================================================================================
Purpose: Search box matching groupid or title via GET /pricing-find?term= (CLAUDE.md). Pick a result -> its drill page. Lets the user
         jump straight to a style without going through segment -> triage.
=======================================================================================================================================
*/

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { findProducts, FindRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function FindPage() {
  const router = useRouter();
  const { logout } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<FindRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setLoading(true);
    setError(null);
    const res = await findProducts(term.trim());
    if (res.success && res.data) {
      setResults(res.data);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Search failed');
      setResults([]);
    }
    setSearched(true);
    setLoading(false);
  }

  return (
    <AppShell title="Find a product" backHref="/pricing" backLabel="Segments">
      <form onSubmit={onSearch} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-2.5 h-5 w-5 text-slate-400" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            autoFocus
            placeholder="Product name or code (e.g. Arizona, 1019051)"
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
                  onClick={() => router.push(`/pricing/style/${encodeURIComponent(r.groupid)}?from=${encodeURIComponent('/pricing/find')}`)}
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
