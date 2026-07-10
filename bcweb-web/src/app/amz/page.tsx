'use client';
/*
=======================================================================================================================================
Page: /amz  (Amazon Pricing module home)
=======================================================================================================================================
Purpose: Stage 0 — the segment picker, mirroring the Shopify /pricing home. Lists the managed Amazon segments (those with live amzfeed
         SKUs) from GET /amz-segments with a SKU count each; clicking one goes to its WINNERS | LOSERS lists. Also a "Find a SKU" entry
         for the direct-search path (/amz/find). The upload basket bar (AmzBasketBar) sits above it so a mid-sitting queue is always
         visible/downloadable from here too.
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlassIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import { getAmzSegments, AmzSegment } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function AmzHome() {
  const router = useRouter();
  const { logout } = useAuth();
  const [segments, setSegments] = useState<AmzSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await getAmzSegments();
      if (res.success && res.data) {
        setSegments(res.data);
      } else {
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load segments');
      }
      setLoading(false);
    })();
  }, [logout]);

  return (
    <AppShell title="Amazon Pricing" backHref="/dashboard" backLabel="Dashboard">
      <AmzBasketBar />

      {/* Direct SKU search entry. */}
      <Link
        href="/amz/find"
        className="mb-6 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm hover:border-brand-500"
      >
        <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
        <span className="font-medium text-slate-700">Find a SKU</span>
        <span className="text-slate-400">— search by product name, group id or SKU code</span>
      </Link>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Segments</h2>

      {loading && <p className="text-sm text-slate-400">Loading segments…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => (
            <button
              key={s.segment}
              onClick={() => router.push(`/amz/${encodeURIComponent(s.segment)}`)}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-brand-500"
            >
              <span>
                <span className="block text-sm font-medium text-slate-800">{s.segment}</span>
                <span className="block text-xs text-slate-400">{s.skus} SKUs</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
