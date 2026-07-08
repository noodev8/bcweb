'use client';
/*
=======================================================================================================================================
Component: ShopifyPushNote
=======================================================================================================================================
Purpose: A tiny inline status shown next to a Save button after an edit, reporting what happened on Shopify. The edit routes
         (update / price / sizes / image) automatically re-push a LIVE product on save; this surfaces ONLY a FAILURE so a broken push
         isn't silent (the DB save still succeeded — this is only about the Shopify side).

         Renders nothing on success (the parent's plain "Saved." stands on its own) or when there's no result (product not live / Shopify
         off). Only when the save landed but Shopify rejected/couldn't be reached does it show an amber warning — so the user knows to
         retry (e.g. re-save, since the push is idempotent).
=======================================================================================================================================
*/

import { ShopifyPushResult } from '@/lib/api';

export default function ShopifyPushNote({ result }: { result?: ShopifyPushResult | null }) {
  // Nothing to show unless the product is live AND the push failed. Success is silent (the parent already shows "Saved.").
  if (!result || result.pushed) return null;
  return (
    <span className="text-xs text-amber-600">
      · Saved, but not sent to Shopify{result.message ? `: ${result.message}` : ''}
    </span>
  );
}
