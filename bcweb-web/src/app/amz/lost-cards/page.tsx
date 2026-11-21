'use client';
/*
=======================================================================================================================================
Page: /amz/lost-cards?part=<cheaper|level|nobody>  (BUY BOX CARDS — where we don't have the Buy Box; owner 2026-11-21)
=======================================================================================================================================
Opened from the strip on Amazon Pricing (/amz): one part of "We don't have it" as price cards — exactly the sizes the strip counts
(server utils/amzBuyBox.js → lostPart). cheaper comes biggest price gap first. Everything is in components/AmzPriceCards (read its
header), in lost mode.
=======================================================================================================================================
*/

import AmzPriceCards from '@/components/AmzPriceCards';

export default function AmzLostCardsPage() {
  return <AmzPriceCards mode="lost" />;
}
