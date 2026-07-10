/*
=======================================================================================================================================
Layout: /amz  (Amazon Pricing module)
=======================================================================================================================================
Purpose: Wraps every page in the Amazon Pricing module (segment picker -> WINNERS|LOSERS lists -> SKU detail -> find) in the
         AmzBasketProvider. Because the provider sits here, above all /amz pages, the session upload basket survives client-side
         navigation between them — apply a price on one SKU's detail page, go back to the list, apply another, all into the same basket.
         See src/contexts/AmzBasketContext.tsx for why the basket is session-scoped and client-side.
=======================================================================================================================================
*/

import { AmzBasketProvider } from '@/contexts/AmzBasketContext';

export default function AmzLayout({ children }: { children: React.ReactNode }) {
  return <AmzBasketProvider>{children}</AmzBasketProvider>;
}
