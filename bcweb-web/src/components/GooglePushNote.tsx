'use client';
/*
=======================================================================================================================================
Component: GooglePushNote
=======================================================================================================================================
Purpose: A tiny inline status shown next to a Save/Apply button, reporting what happened on Google Merchant Center. product-price and
         pricing-apply automatically re-push a LIVE product's price on save; this surfaces ONLY a FAILURE so a broken push isn't silent
         (the DB save still succeeded — this is only about the Google side).

         Renders nothing on success (the parent's plain "Saved."/"Applied." stands on its own) or when there's no result (product not
         live on Google / not configured). Unlike ShopifyPushNote, a Google failure is phrased as non-urgent: the nightly
         merchant_feed.py --upload cron is still an eventual fallback, so there's no "press save again" implication.
=======================================================================================================================================
*/

import { GooglePushResult } from '@/lib/api';

export default function GooglePushNote({ result }: { result?: GooglePushResult | null }) {
  // Nothing to show unless the product is live on Google AND the push failed. Success is silent (the parent already shows "Saved.").
  if (!result || result.pushed) return null;
  return (
    <span className="text-xs text-amber-600">
      · Saved, but not sent to Google Merchant{result.message ? `: ${result.message}` : ''} (tonight&apos;s feed run will still catch it)
    </span>
  );
}
