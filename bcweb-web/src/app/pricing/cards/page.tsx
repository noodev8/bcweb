'use client';
/*
=======================================================================================================================================
Page: /pricing/cards[?pending=1][&at=<groupid>][&from=<list url>]  (SHOPIFY PRICE CARDS — owner 2026-11-15, docs/shopify-cards/PLAN.md)
=======================================================================================================================================
Opened by the "Price cards" button on the Shopify pricing list (/pricing/all?by=all), which passes its Due switch (?pending=1 = Due off)
and its own URL (?from=) for Back. Everything is in components/ShopifyPriceCards (read its header).
=======================================================================================================================================
*/

import ShopifyPriceCards from '@/components/ShopifyPriceCards';

export default function ShopifyPriceCardsPage() {
  return <ShopifyPriceCards />;
}
