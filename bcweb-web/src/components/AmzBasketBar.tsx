'use client';
/*
=======================================================================================================================================
Component: AmzBasketBar  (the Amazon upload basket, shown on every /amz page)
=======================================================================================================================================
Purpose: The persistent strip that surfaces the Amazon upload basket (AmzBasketContext). Amazon prices don't push live — they're recorded
         as you apply them, then downloaded as ONE Seller Central file. Rendered at the top of each /amz page's content (so it appears
         inside the shared AppShell chrome), it only shows when the basket is non-empty.

         The basket is now DURABLE + TEAM-WIDE: it's a view of the whole team's price changes in the last 12h (any operator), rebuilt from
         the audit log on load (AmzBasketContext → GET /amz-basket), so it survives a browser close / machine restart and whoever is at the
         desk can upload a colleague's pending change. No "clear" action: the upload is idempotent, so the file is just re-downloadable;
         the rolling window clears the list itself.
=======================================================================================================================================
*/

import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { useAmzBasket } from '@/contexts/AmzBasketContext';

export default function AmzBasketBar() {
  const { count, download } = useAmzBasket();
  if (count === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
      <span className="font-medium text-brand-900">
        {count} price change{count === 1 ? '' : 's'} ready to upload
      </span>
      <button
        type="button"
        onClick={download}
        className="inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
      >
        <ArrowDownTrayIcon className="h-4 w-4" /> Download upload file
      </button>
      <span className="text-xs text-brand-700/80">one file for Seller Central · saved as you go — download &amp; upload any time</span>
    </div>
  );
}
