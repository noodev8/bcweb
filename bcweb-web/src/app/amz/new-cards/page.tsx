'use client';
/*
=======================================================================================================================================
Page: /amz/new-cards[?cut=a,b]&from=&back=  (NEW ADDITIONS' BUY BOX CARDS — owner 2026-11-22)
=======================================================================================================================================
Opened from the BUY BOX button on New Additions (/analytics/new-additions): the unsold new sizes at Amazon (live or on the way) as
price cards, less the styles soft-cut on that screen. Everything is in components/AmzPriceCards (read its header), in new mode.
=======================================================================================================================================
*/

import AmzPriceCards from '@/components/AmzPriceCards';

export default function AmzNewCardsPage() {
  return <AmzPriceCards mode="new" />;
}
