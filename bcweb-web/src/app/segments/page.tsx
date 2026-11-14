'use client';
/*
=======================================================================================================================================
Page: /segments  (PORTFOLIO on screen since 2026-11-13; was "Repricing" 2026-09-23 – 2026-11-13; route unchanged)
=======================================================================================================================================
Purpose: The portfolio statuses — WINNERS | STEADY | NEW | LOSERS per channel, the Stock now card, winners by brand and the 12-month
         revenue box (components/StatusTiles). Each status tile still opens its pricing list.

A FINANCE SCREEN, NOT A PRICING ONE (owner, 2026-11-13: "It is more like a finance screen. Just make it a finance screen and remove the
repricing parts (Segment, campaign)"). So:
  - its header tab is gone, and its dashboard tile moved from Pricing to Admin, beside Finance;
  - the SEGMENT and CAMPAIGN tabs (the review-clock heatmaps, 2026-09-23) were removed, with the segment detail page (/segments/[name])
    and lib/segmentUi. The server routes (/segments, /segment, /segment-work, /segment-rename, /pricing-campaigns) remain, unused;
    the pricing list pages still accept ?by=segment / ?by=campaign. An old ?by= bookmark just lands here.
Guarded by AppShell. Consumes GET /pricing-status-overview (via StatusTiles).
=======================================================================================================================================
*/

import { Suspense } from 'react';
import AppShell from '@/components/AppShell';
import StatusTiles from '@/components/StatusTiles';

// StatusTiles reads ?bar= (useSearchParams), which must sit inside a Suspense boundary for Next's build.
export default function PortfolioPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-slate-400">Loading…</div>}>
      <AppShell title="Portfolio">
        <StatusTiles />
      </AppShell>
    </Suspense>
  );
}
