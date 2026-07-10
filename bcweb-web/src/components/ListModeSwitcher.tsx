'use client';
/*
=======================================================================================================================================
Component: ListModeSwitcher
=======================================================================================================================================
Purpose: The prominent WINNERS | LOSERS mode switch on the segment list page. This isn't a minor toggle — it flips between two
         opposite jobs: harvest fast sellers (price UP) vs unstick slow/dead stock (price DOWN). So it's a big, full-width, two-panel
         segmented control with an icon + one-line descriptor per mode, colour-coded (winners = emerald, losers = amber), with the
         active panel clearly raised. Optional counts show how many styles each list currently holds.
=======================================================================================================================================
*/

import { ArrowTrendingUpIcon, ArrowTrendingDownIcon, ListBulletIcon } from '@heroicons/react/24/outline';

export type ListMode = 'winners' | 'losers' | 'all';

interface ListModeSwitcherProps {
  mode: ListMode;
  onChange: (mode: ListMode) => void;
  winnersCount?: number | null;
  losersCount?: number | null;
  allCount?: number | null;
  // Descriptor beside the "All styles" button. Defaults to the Shopify wording; the Amazon module passes its own (no "parked" concept).
  allDescription?: string;
}

export default function ListModeSwitcher({
  mode, onChange, winnersCount, losersCount, allCount,
  allDescription = 'the whole segment — incl. parked & out of stock, most-recently-changed first',
}: ListModeSwitcherProps) {
  return (
    <div className="mb-6 space-y-3">
      {/* The two OPPOSITE jobs — the primary decision (CLAUDE.md). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ModePanel
          active={mode === 'winners'}
          onClick={() => onChange('winners')}
          icon={<ArrowTrendingUpIcon className="h-6 w-6" />}
          title="Winners"
          subtitle="Fast sellers to price up (harvest)"
          count={winnersCount}
          activeClasses="border-emerald-500 bg-emerald-50 text-emerald-900 ring-1 ring-emerald-500"
          activeAccent="text-emerald-600"
        />
        <ModePanel
          active={mode === 'losers'}
          onClick={() => onChange('losers')}
          icon={<ArrowTrendingDownIcon className="h-6 w-6" />}
          title="Losers"
          subtitle="Stuck stock to cut & get moving"
          count={losersCount}
          activeClasses="border-amber-500 bg-amber-50 text-amber-900 ring-1 ring-amber-500"
          activeAccent="text-amber-600"
        />
      </div>

      {/* ALL — a secondary browse/lookup view of the whole segment. Deliberately slimmer/neutral so it doesn't compete with the two
          job panels above. Useful for finding a style again (e.g. one you just changed — this list is ordered most-recently-changed first). */}
      <button
        type="button"
        onClick={() => onChange('all')}
        aria-pressed={mode === 'all'}
        className={
          'flex w-full items-center gap-3 rounded-lg border px-4 py-2.5 text-left text-sm transition ' +
          (mode === 'all'
            ? 'border-slate-400 bg-slate-100 text-slate-900 ring-1 ring-slate-400'
            : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50')
        }
      >
        <ListBulletIcon className={'h-5 w-5 shrink-0 ' + (mode === 'all' ? 'text-slate-600' : 'text-slate-400')} />
        <span className="font-medium">All styles</span>
        {allCount !== null && allCount !== undefined && (
          <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (mode === 'all' ? 'bg-white text-slate-600' : 'bg-slate-100 text-slate-500')}>
            {allCount}
          </span>
        )}
        <span className={'ml-1 truncate text-xs ' + (mode === 'all' ? 'text-slate-500' : 'text-slate-400')}>
          {allDescription}
        </span>
      </button>
    </div>
  );
}

function ModePanel({
  active, onClick, icon, title, subtitle, count, activeClasses, activeAccent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  count?: number | null;
  activeClasses: string;
  activeAccent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'flex items-center gap-4 rounded-xl border px-5 py-4 text-left transition ' +
        (active ? activeClasses + ' shadow-sm' : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50')
      }
    >
      <span className={'flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ' + (active ? 'bg-white/70 ' + activeAccent : 'bg-slate-100 text-slate-400')}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={'text-lg font-semibold ' + (active ? '' : 'text-slate-700')}>{title}</span>
          {count !== null && count !== undefined && (
            <span className={'rounded-full px-2 py-0.5 text-xs font-medium ' + (active ? 'bg-white/70 ' + activeAccent : 'bg-slate-100 text-slate-500')}>
              {count}
            </span>
          )}
        </span>
        <span className={'block text-sm ' + (active ? 'opacity-80' : 'text-slate-400')}>{subtitle}</span>
      </span>
    </button>
  );
}
