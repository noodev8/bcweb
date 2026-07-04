'use client';
/*
=======================================================================================================================================
Page: /pricing  (Shopify Pricing module home)
=======================================================================================================================================
Purpose: Stage 0 — the segment picker (CLAUDE.md). Lists segments from GET /pricing-segments with a style count each; clicking one
         goes to its triage list. Also a "Find a product" entry for the direct-search path (CLAUDE.md -> /pricing/find).
=======================================================================================================================================
*/

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { MagnifyingGlassIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import { getSegments, Segment } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

export default function PricingHome() {
  const router = useRouter();
  const { logout } = useAuth();
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const res = await getSegments();
      if (res.success && res.data) {
        setSegments(res.data);
      } else {
        // An expired/invalid session -> back to login; anything else -> inline error (API-RULES: caller decides).
        if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
        setError(res.error || 'Failed to load segments');
      }
      setLoading(false);
    })();
  }, [logout]);

  return (
    <AppShell title="Shopify Pricing" backHref="/dashboard" backLabel="Dashboard">
      {/* Direct product search entry. */}
      <Link
        href="/pricing/find"
        className="mb-6 flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm hover:border-brand-500"
      >
        <MagnifyingGlassIcon className="h-5 w-5 text-slate-400" />
        <span className="font-medium text-slate-700">Find a product</span>
        <span className="text-slate-400">— search by product name or code</span>
      </Link>

      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Segments</h2>

      {loading && <p className="text-sm text-slate-400">Loading segments…</p>}
      {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {segments.map((s) => (
            <button
              key={s.segment}
              onClick={() => router.push(`/pricing/${encodeURIComponent(s.segment)}`)}
              className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-brand-500"
            >
              <span>
                <span className="block text-sm font-medium text-slate-800">{s.segment}</span>
                <span className="block text-xs text-slate-400">{s.styles} styles</span>
              </span>
              <ChevronRightIcon className="h-4 w-4 text-slate-300" />
            </button>
          ))}
        </div>
      )}
    </AppShell>
  );
}
