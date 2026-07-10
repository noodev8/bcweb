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
Because a groupid's sizes each have their own price, one colour can have fast sizes in WINNERS and dead sizes in LOSERS at the same time.
All three lists are fetched up front (so each tab shows a live count) and cached; rows link to the per-SKU drill. The active mode is kept
in the URL (?mode=) so returning after an apply restores the same tab. A queued SKU (in the upload basket) shows a "queued" badge.
=======================================================================================================================================
*/

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import AppShell from '@/components/AppShell';
import AmzBasketBar from '@/components/AmzBasketBar';
import ListModeSwitcher, { ListMode } from '@/components/ListModeSwitcher';
import { getAmzWinners, getAmzLosers, getAmzAll, AmzWinnerRow, AmzLoserRow, AmzAllRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

// useSearchParams must sit inside a Suspense boundary for Next's build.
export default function AmzSegmentPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <SegmentContent />
    </Suspense>
  );
}

// Present a big cover figure gently — exact weeks are directional only below a few sales.
function coverLabel(weeks: number | null): string {
  if (weeks === null) return '—';
  if (weeks >= 104) return '2+ yrs';
  if (weeks >= 52) return '1+ yr';
  return `${Math.round(weeks)} wk`;
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
  const { items } = useAmzBasket();

  const modeParam = searchParams.get('mode');
  const initialMode: ListMode = modeParam === 'losers' ? 'losers' : modeParam === 'all' ? 'all' : 'winners';
  const [mode, setMode] = useState<ListMode>(initialMode);

  const [winners, setWinners] = useState<AmzWinnerRow[] | null>(null);
  const [losers, setLosers] = useState<AmzLoserRow[] | null>(null);
  const [all, setAll] = useState<AmzAllRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all three lists up front so each tab can show a count. Cached for the life of the page.
  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const [w, l, a] = await Promise.all([getAmzWinners(segment), getAmzLosers(segment), getAmzAll(segment)]);
      if (w.return_code === 'UNAUTHORIZED' || l.return_code === 'UNAUTHORIZED' || a.return_code === 'UNAUTHORIZED') { logout(); return; }
      if (w.success && w.data) setWinners(w.data.rows); else setError(w.error || 'Failed to load winners');
      if (l.success && l.data) setLosers(l.data.rows); else if (!error) setError(l.error || 'Failed to load losers');
      if (a.success && a.data) setAll(a.data.rows); else if (!error) setError(a.error || 'Failed to load all SKUs');
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  function openSku(code: string) {
    const from = `/amz/${encodeURIComponent(segment)}?mode=${mode}`;
    router.push(`/amz/sku/${encodeURIComponent(code)}?from=${encodeURIComponent(from)}`);
  }

  const rows = mode === 'winners' ? winners : mode === 'losers' ? losers : all;
  const isEmpty = !loading && !error && rows !== null && rows.length === 0;

  return (
    <AppShell title={segment} backHref="/amz" backLabel="Segments">
      <AmzBasketBar />

      <ListModeSwitcher
        mode={mode}
        onChange={setMode}
        winnersCount={winners ? winners.length : null}
        losersCount={losers ? losers.length : null}
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

      {!loading && !error && mode === 'winners' && winners && winners.length > 0 && (
        <WinnersTable rows={winners} queued={items} onOpen={openSku} />
      )}
      {!loading && !error && mode === 'losers' && losers && losers.length > 0 && (
        <LosersTable rows={losers} queued={items} onOpen={openSku} />
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

function WinnersTable({ rows, queued, onOpen }: { rows: AmzWinnerRow[]; queued: Queued; onOpen: (c: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
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
            <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer hover:bg-slate-50">
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

function LosersTable({ rows, queued, onOpen }: { rows: AmzLoserRow[]; queued: Queued; onOpen: (c: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2 font-medium">#</th>
            <th className="px-4 py-2 text-right font-medium" title="FBA sellable stock">FBA</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 30 days">30d</th>
            <th className="px-4 py-2 text-right font-medium" title="Units sold, last 90 days">90d</th>
            <th className="px-4 py-2 text-right font-medium" title="Weeks of cover at the 90-day pace">Cover</th>
            <th className="px-4 py-2 font-medium">SKU (size)</th>
            <th className="px-4 py-2 font-medium">Product</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.code} onClick={() => onOpen(r.code)} className="cursor-pointer hover:bg-slate-50">
              <td className="px-4 py-2 text-slate-400">{r.rank}</td>
              {/* FBA stock is the ranking metric within each cluster — emphasised. */}
              <td className="px-4 py-2 text-right font-semibold text-slate-800">{r.fba}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u30}</td>
              <td className="px-4 py-2 text-right text-slate-600">{r.u90}</td>
              <td className="px-4 py-2 text-right">
                {r.is_dead
                  ? <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">no recent sales</span>
                  : <span className="tabular-nums text-slate-700">{coverLabel(r.cover_weeks)}</span>}
              </td>
              <td className="whitespace-nowrap px-4 py-2 font-mono text-xs text-slate-600">
                {r.code}{!!queued[r.code] && <QueuedPill />}
              </td>
              <td className="px-4 py-2 text-slate-700">{r.title || <span className="text-slate-400">—</span>}</td>
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
