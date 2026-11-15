'use client';
/*
=======================================================================================================================================
Page: /amz/step-cards?step=<list>&when=<chip>[&at=<code>]  (STEP CARDS — a Stock ladder list's sizes, one card at a time; owner 2026-11-15)
=======================================================================================================================================
Opened from PRICE THESE (or a row) on a Stock ladder list (/analytics/slow-sizes/step — Overstocked, Unsold 90, Unsold 180, Clearance).
Everything is in components/AmzPriceCards (read its header), in step mode. Design: docs/stock-ladder.md.
=======================================================================================================================================
*/

import AmzPriceCards from '@/components/AmzPriceCards';

export default function AmzStepCardsPage() {
  return <AmzPriceCards mode="step" />;
}
