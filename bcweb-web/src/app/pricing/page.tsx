/*
=======================================================================================================================================
Page: /pricing  (Shopify Pricing module home)
=======================================================================================================================================
Since 2026-10-26 the home is ONE LIST of every in-stock Shopify style (plus every Repricing status style, 0-stock too) with the Due switch, not a segment picker (owner: "shouldn't go
off segments — just be a list of all, with a due and not due toggle"). This route only redirects to it: /pricing/all?by=all, the
usual list page (app/pricing/[segment]) reading GET /pricing-all-list. The old home's Find and Shopify vs Amazon entries sit top right
on that list. The segment picker is in git history; segments are still reached from Repricing.
=======================================================================================================================================
*/

import { redirect } from 'next/navigation';

export default function PricingHome() {
  redirect('/pricing/all?by=all');
}
