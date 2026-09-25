'use client';
/*
=======================================================================================================================================
Component: WinnersStrip  (the outcome line on Reports -> New)
=======================================================================================================================================
Purpose: Ties the production screen to the thing production is FOR. The panel above it counts what we made; this counts what the
         making has turned into — styles earning over the winner bar in the rolling 12 months — and is the way through to Repricing's
         Status tab (the Winners screen was folded into it, 2026-09-25).

         THE STORED TAG, NOT A LIVE COUNT (2026-09-25). This reads GET /portfolio-status — the stored WINNERS tag as of the last
         "Update now". It used to recompute live (GET /portfolio-winners, deleted styles included), so the two
         screens could show two different numbers; that route is gone. Shares Repricing's SWR key ('portfolio-status').

         "A year ago" and "joined this year" went with it (owner's call): the tags only started on 2026-09-24 and there is no history
         to compare against, and the status trend table was removed on 2026-09-25 — so they stay gone. Never from a live recompute.

NAVIGATION: the whole strip is the link, to Repricing (a top-level screen — no back arrow to carry).

DEGRADES TO A PLAIN LINK. If the figures fail or are still loading, the strip still renders and still navigates — the numbers are the
bonus, the way through is the point. Loads independently so the winner computation (~200ms) never holds up the list below.
=======================================================================================================================================
*/

import Link from 'next/link';
import { ChevronRightIcon, TrophyIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getPortfolioStatus } from '@/lib/api';

const WINNERS_HREF = '/segments';

export default function WinnersStrip() {
  const { data } = useApiQuery('portfolio-status', () => getPortfolioStatus());
  // Only once an Update has run — before that every count is 0, and "0 styles" would read as a fact rather than "not assessed yet".
  const tagged = data?.status.updatedAt ? data : null;
  const winners = tagged?.status.statuses.find((x) => x.status === 'WINNERS')?.count ?? 0;
  const bar = tagged?.bars[0];

  return (
    <Link
      href={WINNERS_HREF}
      className="mb-6 flex items-center gap-4 rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
    >
      <TrophyIcon className="h-5 w-5 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">Winners</div>
        {tagged && bar ? (
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-2xl font-bold leading-none tabular-nums text-slate-900">{winners}</span>
            <span className="text-sm text-slate-500">styles earning £{bar.toLocaleString('en-GB')}+ over 12 months</span>
          </div>
        ) : (
          <div className="mt-0.5 text-sm text-slate-500">The styles earning their keep over the last 12 months</div>
        )}
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-slate-300" />
    </Link>
  );
}
