'use client';
/*
=======================================================================================================================================
Page: /analytics/price-changes  (Analytics module — Price Changes)
=======================================================================================================================================
Purpose: The "did our repricing take effect?" report, over a TIME WINDOW (default 30 days) and in two layers:

           1. SUMMARY — how much repricing happened in the window, split up/down, by channel, and BY OPERATOR. This is the staff-progress
              read: 30 days holds ~1,500 changes (a bulk move logs one row per style), so a raw list of them is a dump, not a monitor. The
              headline number is the window's total; the per-operator cards are the breakdown AND the filter control — click one to drill.
           2. DETAIL — the newest 50 changes matching the current filters, each showing BEFORE -> AFTER, who changed it, when, and how many
              units have sold SINCE. Labelled "newest 50 of N" so the table is never mistaken for the whole window.

         Why a window rather than "latest 50": a price move needs time to show sales. Bounding by DAYS keeps the older moves in view — the
         ones that have actually had a chance to sell — instead of letting today's activity push them off the list.

         Filters: WINDOW (7/30/90d), CHANNEL (All / Shopify / Amazon — the per-row logo chip carries the same identity) and USER. Channel
         and window re-cut the summary; the user filter narrows only the table, so the operator breakdown stays whole while you drill.

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
import { getPriceChanges, PriceChangeRow, PriceChangeSummary, PriceChangeUserStat } from '@/lib/api';

const LIMIT = 50;          // detail rows — the readable slice of the window, not the window itself
const DEFAULT_DAYS = 30;   // the monitoring period the owner works to

type ChannelFilter = 'all' | 'shp' | 'amz';

const CHANNEL_TABS: { key: ChannelFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'shp', label: 'Shopify' },
  { key: 'amz', label: 'Amazon' },
];

const WINDOW_TABS: { days: number; label: string }[] = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

const EMPTY_SUMMARY: PriceChangeSummary = { total: 0, up: 0, down: 0, flat: 0, shp: 0, amz: 0, byUser: [] };

export default function PriceChangesPage() {
  const { logout } = useAuth();
  const actions = useProductActions(); // row click -> cross-module "reprice this" chooser (Shopify / Amazon / copy)

  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [user, setUser] = useState<string>(''); // '' = all users
  const [rows, setRows] = useState<PriceChangeRow[]>([]);
  const [summary, setSummary] = useState<PriceChangeSummary>(EMPTY_SUMMARY);
  const [total, setTotal] = useState(0);        // matches for the CURRENT filters (incl. user), pre-limit
  const [users, setUsers] = useState<string[]>([]); // dropdown options (stable across channel/window switches)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getPriceChanges(channel, user || null, days, LIMIT);
    if (res.success && res.data) {
      setRows(res.data.rows);
      setSummary(res.data.summary);
      setTotal(res.data.total);
      setUsers(res.data.users);
    } else {
      if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
      setError(res.error || 'Failed to load Price Changes');
    }
    setLoading(false);
  }, [channel, days, user, logout]);

  useEffect(() => { load(); }, [load]);

  const money = (v: number | null) => (v === null ? '—' : `£${v.toFixed(2)}`);
  const n = (v: number) => v.toLocaleString('en-GB');

  // "13 Jul, 00:55" (Europe/London wall clock via the browser). null -> "—".
  const fmtWhen = (iso: string | null) => {
    if (!iso) return '—';
    const dt = new Date(iso);
    return `${dt.getDate()} ${dt.toLocaleString('en-GB', { month: 'short' })}, ${dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`;
  };
  // "today" for a same-day change, else "Nd ago".
  const fmtAge = (d: number | null) => (d === null ? '' : d <= 0 ? 'today' : `${d}d ago`);

  // Clicking an operator card toggles the user filter (click the active one to clear it).
  const toggleUser = (u: string | null) => setUser((cur) => (u && cur !== u ? u : ''));

  const windowLabel = WINDOW_TABS.find((w) => w.days === days)?.label ?? `${days} days`;

  return (
    <AppShell title="Price Changes" backHref="/analytics" backLabel="Analytics">
      <p className="mb-5 max-w-3xl text-sm text-slate-500">
        Repricing activity over the last <strong>{windowLabel}</strong> — how much was moved, in which direction, and by whom. Below the
        summary, the newest changes in detail: <strong>before → after</strong> and how many units have sold <strong>since the change</strong>.
      </p>

      {/* Filters: window + channel segmented controls, then the user dropdown. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Segmented
          options={WINDOW_TABS.map((w) => ({ key: String(w.days), label: w.label }))}
          value={String(days)}
          onChange={(k) => setDays(Number(k))}
        />
        <Segmented
          options={CHANNEL_TABS.map((t) => ({ key: t.key, label: t.label }))}
          value={channel}
          onChange={(k) => setChannel(k as ChannelFilter)}
        />

        <select
          value={user}
          onChange={(e) => setUser(e.target.value)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
          title="Filter the detail list by who made the change"
        >
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u} value={u}>{u}</option>
          ))}
        </select>
      </div>

      {error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading && <p className="text-sm text-slate-400">Loading…</p>}

      {!loading && !error && (
        <>
          {/* ---- SUMMARY: the report. Covers the whole window (the user filter deliberately doesn't cut it). ---- */}
          <SummaryPanel
            summary={summary}
            windowLabel={windowLabel}
            channel={channel}
            activeUser={user}
            onPickUser={toggleUser}
            n={n}
          />

          {/* ---- DETAIL: the newest slice, explicitly labelled as a slice. ---- */}
          <div className="mb-2 mt-7 flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Latest changes</h2>
            <span className="text-xs text-slate-400">
              {total === 0
                ? 'nothing matches these filters'
                : total > rows.length
                  ? `newest ${rows.length} of ${n(total)}${user ? ` by ${user}` : ''}`
                  : `all ${n(total)}${user ? ` by ${user}` : ''}`}
            </span>
          </div>

          {rows.length === 0 ? (
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
          )}
        </>
      )}

      {actions.node}
    </AppShell>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// A compact segmented control — shared shape for the window and channel switches so the filter bar reads as one row of controls.
// -------------------------------------------------------------------------------------------------------------------------------------
function Segmented({
  options, value, onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          aria-pressed={value === o.key}
          className={
            'rounded-md px-3.5 py-1.5 text-sm font-medium transition ' +
            (value === o.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// -------------------------------------------------------------------------------------------------------------------------------------
// SUMMARY PANEL — the report layer. HERO = total changes in the window (the tracked metric); everything else is supporting detail below a
// divider: the up/down split, the channel split, then one card per operator. Operator cards are the drill-down control — clicking one sets
// the user filter on the detail table (clicking the active one clears it). The panel itself never narrows to a user, so the breakdown
// stays whole while you read one operator's rows.
// -------------------------------------------------------------------------------------------------------------------------------------
function SummaryPanel({
  summary, windowLabel, channel, activeUser, onPickUser, n,
}: {
  summary: PriceChangeSummary;
  windowLabel: string;
  channel: ChannelFilter;
  activeUser: string;
  onPickUser: (u: string | null) => void;
  n: (v: number) => string;
}) {
  const channelWord = channel === 'shp' ? 'Shopify ' : channel === 'amz' ? 'Amazon ' : '';
  const pct = (v: number) => (summary.total > 0 ? Math.round((v / summary.total) * 100) : 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
        {channelWord}price changes · last {windowLabel}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-3">
        <span className="text-6xl font-bold leading-none tabular-nums text-brand-600">{n(summary.total)}</span>
        {summary.total > 0 && (
          <>
            <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium tabular-nums text-green-700">
              ▲ {n(summary.up)} up
            </span>
            <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium tabular-nums text-red-600">
              ▼ {n(summary.down)} down
            </span>
            {summary.flat > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium tabular-nums text-slate-500">
                → {n(summary.flat)} level
              </span>
            )}
          </>
        )}
      </div>

      {summary.total === 0 ? (
        <p className="mt-4 text-sm text-slate-400">No price changes in this window.</p>
      ) : (
        <div className="mt-5 border-t border-slate-200 pt-4">
          {/* Direction bar — the up/down balance of the window at a glance. */}
          <div className="mb-3 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="bg-green-500" style={{ width: `${pct(summary.up)}%` }} title={`${summary.up} raised`} />
            <div className="bg-red-400" style={{ width: `${pct(summary.down)}%` }} title={`${summary.down} cut`} />
          </div>

          {/* Channel split — only meaningful when both channels are in scope. */}
          {channel === 'all' && (
            <div className="mb-4 flex gap-4 text-xs text-slate-500">
              <span>Shopify <strong className="tabular-nums text-slate-700">{n(summary.shp)}</strong></span>
              <span>Amazon <strong className="tabular-nums text-slate-700">{n(summary.amz)}</strong></span>
            </div>
          )}

          {/* By operator — the staff-progress read, and the filter control for the table below. */}
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">By user</div>
          <div className="flex flex-wrap gap-2">
            {summary.byUser.map((u) => (
              <UserCard key={u.user ?? '__none'} u={u} active={!!u.user && u.user === activeUser} onPick={onPickUser} n={n} />
            ))}
          </div>
          {activeUser && (
            <button
              type="button"
              onClick={() => onPickUser(null)}
              className="mt-3 text-xs font-medium text-brand-600 hover:underline"
            >
              Clear user filter
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// One operator's window at a glance — total, then the up/down split beneath. Clickable when attributed; the unattributed bucket (legacy
// rows with no changed_by) is shown for completeness but can't be filtered to, since there's no name to match on.
function UserCard({
  u, active, onPick, n,
}: {
  u: PriceChangeUserStat;
  active: boolean;
  onPick: (u: string | null) => void;
  n: (v: number) => string;
}) {
  const label = u.user ?? 'Unattributed';
  const base = 'rounded-lg border px-3 py-2 text-left transition ';
  const look = active
    ? 'border-brand-400 bg-brand-50 ring-1 ring-brand-400'
    : u.user
      ? 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
      : 'border-slate-200 bg-slate-50/60';

  const body = (
    <>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-800">{n(u.total)}</span>
        <span className="text-xs tabular-nums text-slate-400">
          <span className="text-green-600">▲{n(u.up)}</span> <span className="text-red-500">▼{n(u.down)}</span>
        </span>
      </div>
    </>
  );

  if (!u.user) return <div className={base + look}>{body}</div>;

  return (
    <button
      type="button"
      onClick={() => onPick(u.user)}
      aria-pressed={active}
      className={base + look}
      title={active ? 'Click to clear the user filter' : `Show only ${label}'s changes below`}
    >
      {body}
    </button>
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
