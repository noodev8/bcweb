'use client';
/*
=======================================================================================================================================
Page: /analytics/price-changes  (Analytics module — Price Changes)
=======================================================================================================================================
Purpose: The "did our repricing take effect?" ledger. The most recent price changes across BOTH channels — each showing the BEFORE ->
         AFTER price, who changed it, when, and how many units have sold SINCE the change — so the owner can eyeball whether recent moves
         are actually moving stock.

         Two filters: CHANNEL (All / Shopify / Amazon — a compact segmented control; the per-row logo chip carries the same identity so a
         Shopify row is never mistaken for Amazon) and USER (who made the change — the hook for future per-user monitoring; `changed_by`
         is already logged server-side). The limit is per selected channel (switch to Amazon -> the latest 50 Amazon changes).

         Row click reuses the cross-module ProductActions chooser (Change Shopify price / Change Amazon price / Copy). Amazon rows carry
         their exact SKU `code`, so the Amazon action deep-links straight to that size's drill.

Guarded by AppShell. Consumes GET /analytics-change-impact.
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';
import AppShell from '@/components/AppShell';
import ChannelBadge from '@/components/ChannelBadge';
import { useProductActions } from '@/components/ProductActions';
import { useAuth } from '@/contexts/AuthContext';
import { getPriceChanges, PriceChangeRow } from '@/lib/api';

const LIMIT = 50; // latest N changes (per selected channel) — "possibly 50" (owner)

type ChannelFilter = 'all' | 'shp' | 'amz';

const CHANNEL_TABS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
];

export default function PriceChangesPage() {
  const { logout } = useAuth();
  const actions = useProductActions(); // row click -> cross-module "reprice this" chooser (Shopify / Amazon / copy)

  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [user, setUser] = useState<string>(''); // '' = all users
  const [rows, setRows] = useState<PriceChangeRow[]>([]);
  const [users, setUsers] = useState<string[]>([]); // dropdown options (stable across channel switches)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getPriceChanges(channel, user || null, LIMIT);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setUsers(res.data.users);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Price Changes');
    }
    setLoading(false);
  }, [channel, user, logout]);

  useEffect(() => { load(); }, [load]);

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);

  // "13 Jul, 00:55" (Europe/London wall clock via the browser). null -> "—".
  const fmtWhen = (iso: string | null) => {
    if (!iso) return '—';
    const dt = new Date(iso);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}, ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };
  // "today" for a same-day change, else "Nd ago".
  const fmtAge = (d: number | null) => (d === null ? '' : d <= 0 ? 'today' : `${d}d ago`);

  return (
    <AppShell title="Price Changes" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        The latest price moves across both channels — <strong>before → after</strong>, who changed it, and how many units have sold
        <strong> since the change</strong>. A quick read on whether recent repricing is taking effect.
      </p>

      {/* Filters: channel segmented control + user dropdown. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
          {CHANNEL_TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setChannel(t.key)}
              aria-pressed={channel === t.key}
              className={
                'rounded-md px-3.5 py-1.5 text-sm font-medium transition ' +
                (channel === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
              }
            >
              {t.label}
            </button>
          ))}
        </div>

        <select
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          title="Filter by who made the change"
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>

        {!loading && !error && (
          <span className="text-xs text-slate-400">
            {rows.length === 0 ? 'No changes' : `Showing ${rows.length} most recent`}
          </span>
        )}
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        rows.length === 0 ? (
          <p className="text-sm text-slate-400">No price changes match this filter.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_theme(colors.slate.200)]">
                <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Channel</th>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">Before → After</th>
                  <th className="px-3 py-2.5 text-right font-medium">Sold since</th>
                  <th className="px-4 py-2.5 font-medium">By</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <ChangeRow key={`${r.channel}-${r.amzCode || r.groupid}-${r.changedAt}-${i}`} r={r} actions={actions}
                             money={money} fmtWhen={fmtWhen} fmtAge={fmtAge} />
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {actions.node}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// One change row. Clickable -> the cross-module reprice/copy chooser. Amazon rows pass their exact SKU code so the Amazon action
// deep-links straight to that size's drill; the copy/Shopify actions use the resolved groupid.
// -------------------------------------------------------------------------------------------------------------------------------------
function ChangeRow({
  r, actions, money, fmtWhen, fmtAge,
}: {
  r: PriceChangeRow;
  actions: ReturnType<typeof useProductActions>;
  money: (v: number | null) => string;
  fmtWhen: (iso: string | null) => string;
  fmtAge: (d: number | null) => string;
}) {
  // Direction of the move (drives the arrow + colour). Neutral to channel — the logo chip carries channel identity.
  const dir =
    r.oldPrice === null || r.newPrice === null ? 'flat'
    : r.newPrice > r.oldPrice ? 'up'
    : r.newPrice < r.oldPrice ? 'down'
    : 'flat';
  const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '→';
  const arrowClass = dir === 'up' ? 'text-emerald-600' : dir === 'down' ? 'text-rose-600' : 'text-slate-400';

  // The chooser needs a style key; every Amazon code currently resolves to a groupid, but fall back to the code so copy still works.
  const actionKey = r.groupid || r.amzCode || '';

  return (
    <tr
      onClick={(e) => actions.open(e, actionKey, { title: r.title, amzCode: r.amzCode })}
      className="cursor-pointer border-b border-slate-100 last:border-0 hover:bg-slate-50/60"
      title="Click to reprice or copy"
    >
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-500">
        {fmtWhen(r.changedAt)}
        <span className="ml-2 text-xs text-slate-400">{fmtAge(r.daysSince)}</span>
      </td>
      <td className="px-4 py-2.5">
        <ChannelBadge channel={r.channel === 'AMZ' ? 'amazon' : 'shopify'} />
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm tracking-tight text-slate-900">{r.groupid || r.amzCode || '—'}</span>
          {r.size && (
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{r.size}</span>
          )}
        </div>
        <div className="text-xs text-slate-400">{r.title || 'Untitled'}</div>
        {r.note && <div className="mt-0.5 text-xs italic text-slate-400">“{r.note}”</div>}
      </td>
      <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">
        <span className="text-slate-500">{money(r.oldPrice)}</span>
        <span className={'mx-1.5 ' + arrowClass}>{arrow}</span>
        <span className="font-medium text-slate-800">{money(r.newPrice)}</span>
      </td>
      <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">{r.unitsSince}</td>
      <td className="px-4 py-2.5 whitespace-nowrap text-slate-600">{r.changedBy || '—'}</td>
    </tr>
  );
}
