'use client';
/*
=======================================================================================================================================
Page: /amz/due-cards  (DUE CARDS — the Not selling · due sizes, one card at a time; owner 2026-11-13)
=======================================================================================================================================
Opened from the "Not selling · due" tile on Amazon Pricing (/amz). Everything is in components/AmzPriceCards (read its header) — the
same cards as the search cards (/amz/search-cards), in due mode.
=======================================================================================================================================
*/

import AmzPriceCards from '@/components/AmzPriceCards';

export default function AmzDueCardsPage() {
  return <AmzPriceCards mode="due" />;
}
