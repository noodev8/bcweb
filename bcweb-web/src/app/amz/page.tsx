/*
=======================================================================================================================================
Page: /amz  (Amazon Pricing module home)
=======================================================================================================================================
Since 2026-10-26 the home is ONE LIST of every in-stock FBA SKU (plus every Repricing status SKU, 0-stock too) with the Due switch, not a segment picker (owner: "shouldn't go off
segments — just be a list of all, with a due and not due toggle"). This route only redirects to it: /amz/all?by=all, the usual list
page (app/amz/[segment]) reading GET /amz-all-list, with the upload basket bar and Find top right. The segment picker is in git
history; segments are still reached from Repricing.
=======================================================================================================================================
*/

import { redirect } from 'next/navigation';

export default function AmzHome() {
  redirect('/amz/all?by=all');
}
