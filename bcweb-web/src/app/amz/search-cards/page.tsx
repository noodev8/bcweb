'use client';
/*
=======================================================================================================================================
Page: /amz/search-cards?q=<text>&mood=<mood>  (SEARCH CARDS — every size the Amazon Pricing search matches; owner 2026-11-13)
=======================================================================================================================================
Opened from the search card on Amazon Pricing (/amz). Nothing hidden: due, Buy Box moves, not due. Everything is in
components/AmzPriceCards (read its header), in search mode.
=======================================================================================================================================
*/

import AmzPriceCards from '@/components/AmzPriceCards';

export default function AmzSearchCardsPage() {
  return <AmzPriceCards mode="search" />;
}
