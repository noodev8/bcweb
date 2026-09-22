'use client';
/*
=======================================================================================================================================
Component: WinnersStrip  (the outcome line on Reports -> New)
=======================================================================================================================================
Purpose: Ties the production screen to the thing production is FOR. The panel above it counts what we made; this counts what the
         making has turned into — styles earning over the winner bar in the rolling 12 months — and is the way through to the Winners
         screen itself.

         Deliberately just the count and the year's joiners. The Winners screen owns the bar toggle, the brand split and the
         distribution; repeating any of that here would make two screens that disagree the moment one changes.

         NOT a causal claim. "Joined this year" means a style crossed the bar this year — it is usually an OLDER line that grew into
         it, not one of this year's builds. The copy says "joined", never "of the products we made", because the second would be
         false and would flatter the intake.

NAVIGATION: the whole strip is the link, and it carries ?from=/?back= so the Winners screen's own arrow comes back HERE rather than
dumping the reader on the Reports index a level up. Winners already honours those params (it is reached from several places), so this
is the existing convention, not a new one.

DEGRADES TO A PLAIN LINK. If the figures fail or are still loading, the strip still renders and still navigates — the numbers are the
bonus, the way through is the point. Loads independently so the winner computation (~200ms) never holds up the list below.
=======================================================================================================================================
*/

import Link from 'next/link';
import { ChevronRightIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getPortfolioWinners } from '@/lib/api';

// Back-link contract: Winners reads `from` (where the arrow goes) and `back` (what it reads). Encoded because `from` is a path.
const WINNERS_HREF = `/analytics/winners?from=${encodeURIComponent('/analytics/new-additions')}&back=${encodeURIComponent('New')}`;

export default function WinnersStrip() {
  const { data } = useApiQuery(['winners-strip'], () => getPortfolioWinners());
  const s = data?.summary ?? null;

  return (
    <Link
      href={WINNERS_HREF}
      className="mb-6 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <TrophyIcon className="h-5 w-5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Winners</div>
        {s ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-bold leading-none tabular-nums text-slate-900">{s.winnerCount}</span>
            <span className="text-sm text-slate-500">
              styles earning £{s.bar}+ over 12 months · {s.winnerCountPriorYear} a year ago
              {s.joinedThisYear > 0 && <> · {s.joinedThisYear} joined this year</>}
            </span>
          </div>
        ) : (
          <div className="mt-0.5 text-sm text-slate-500">The styles earning their keep over the last 12 months</div>
        )}
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-300" />
    </Link>
  );
}
