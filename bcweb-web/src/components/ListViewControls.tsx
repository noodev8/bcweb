'use client';
/*
=======================================================================================================================================
Component: ListViewControls
=======================================================================================================================================
Purpose: The two controls above a segment's pricing list, shared by Shopify (/pricing/[segment]) and Amazon (/amz/[segment]) so the
         two channels read the same way (owner, 2026-09-23):
           - Winners | Losers | All — WHICH list. "All" = winners and losers together, not the whole segment.
           - Show pending review    — WHETHER to include items whose review date is still in the future.
         Replaced ListModeSwitcher (two big panels + a separate "All styles" bar), which had no room for the second control.
=======================================================================================================================================
*/

import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, Squares2X2Icon } from '@heroicons/react/24/outline';

export type ListView = 'winners' | 'losers' | 'all';

export function parseListView(v: string | null): ListView {
  return v === 'losers' ? 'losers' : v === 'all' ? 'all' : 'winners';
}

export default function ListViewControls({ view, onViewChange, counts, showPending, onShowPendingChange, pendingCount }: {
  view: ListView;
  onViewChange: (v: ListView) => void;
  counts: { winners: number; losers: number; all: number } | null;   // null while loading
  showPending: boolean;
  onShowPendingChange: (v: boolean) => void;
  pendingCount: number | null;                                        // pending items in the current view; null while loading
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <ViewTabs view={view} onChange={onViewChange} counts={counts} />
      <PendingSwitch on={showPending} onChange={onShowPendingChange} count={pendingCount} />
    </div>
  );
}

// Colour follows the job: emerald = price up, amber = cut, slate = both.
const TABS: { key: ListView; label: string; hint: string; icon: typeof ArrowTrendingUpIcon; on: string; badge: string }[] = [
  { key: 'winners', label: 'Winners', hint: 'Fast sellers to price up', icon: ArrowTrendingUpIcon, on: 'text-emerald-700', badge: 'bg-emerald-100 text-emerald-700' },
  { key: 'losers', label: 'Losers', hint: 'Stuck stock to cut', icon: ArrowTrendingDownIcon, on: 'text-amber-700', badge: 'bg-amber-100 text-amber-700' },
  { key: 'all', label: 'All', hint: 'Winners and losers together', icon: Squares2X2Icon, on: 'text-slate-800', badge: 'bg-slate-200 text-slate-700' },
];

function ViewTabs({ view, onChange, counts }: {
  view: ListView; onChange: (v: ListView) => void; counts: { winners: number; losers: number; all: number } | null;
}) {
  return (
    <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/70 p-1">
      {TABS.map((t) => {
        const active = view === t.key;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            title={t.hint}
            aria-pressed={active}
            className={
              'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ' +
              (active ? 'bg-white shadow-sm ring-1 ring-slate-200 ' + t.on : 'text-slate-500 hover:text-slate-800')
            }
          >
            <Icon className="h-4 w-4" />
            {t.label}
            {counts && (
              <span className={'rounded-full px-2 py-0.5 text-xs tabular-nums ' + (active ? t.badge : 'bg-slate-200/70 text-slate-500')}>
                {counts[t.key]}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// The count is how many pending items the current view holds, so the switch says what it would add before you flip it.
function PendingSwitch({ on, onChange, count }: { on: boolean; onChange: (v: boolean) => void; count: number | null }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="inline-flex items-center gap-2.5 text-sm text-slate-600 hover:text-slate-800"
    >
      <span className={'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ' + (on ? 'bg-brand-600' : 'bg-slate-300')}>
        <span className={'inline-block h-4 w-4 rounded-full bg-white shadow transition ' + (on ? 'translate-x-[18px]' : 'translate-x-0.5')} />
      </span>
      Show pending review
      {count !== null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs tabular-nums text-slate-500">{count}</span>}
    </button>
  );
}

// Review date for a pending row (YYYY-MM-DD -> "8 Jul"). The year is dropped: a review date is always within a few months of today.
export function fmtReviewDate(iso: string | null): string {
  if (!iso) return '—';
  const [, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]}`;
}
