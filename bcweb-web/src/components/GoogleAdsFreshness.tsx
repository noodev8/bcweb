'use client';
/*
=======================================================================================================================================
Component: GoogleAdsFreshness
=======================================================================================================================================
Purpose: Say how old the Google Ads numbers on the screen are. Every figure Google supplies is only as current as the last import, so
         this line is the caveat on everything else on the page and is always visible.

WHERE THE DATA COMES FROM (since 2026-11-15)
The nightly sweep (scripts/google-ads-sweep.js, 04:30 UTC) reads the last 30 days from the Google Ads API — docs/google-ads-spec.md §8.
It replaced the upload panel this component used to be (GoogleAdsImport: download two Report editor CSVs, preview, commit). The
upload routes (/google-ads-import-preview, -commit) stay on the server, unused; a range is back-filled with the sweep's --from/--to.

So the newest day is normally YESTERDAY ("current"). Older than STALE_DAYS means the sweep has stopped — its reason is the
'Import (API) FAILED' row in Bclog (section Google Ads) — and the line turns amber to say so. Not red and not a banner: the screen still
works, the numbers just end earlier (every window is anchored to asOf, never to today).

NO GAPS SHOWN (Sep 2026): with ads switched off for days at a time Google reports no campaign rows for those days, and a gap badge
flagged intended behaviour as a hole. The gaps are still on the API response if this ever needs reinstating.
=======================================================================================================================================
*/

import { getGoogleAdsImportLast, GoogleAdsCoverage } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

// The sweep imports up to yesterday at 04:30 UTC, so 1 is normal and 2 is the early hours before it runs. 3 = a night was missed.
const STALE_DAYS = 3;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Built from the ISO string's own parts: new Date('2026-09-05') is parsed as UTC midnight and prints as 4 September west of London.
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

function Coverage({ title, c }: { title: string; c: GoogleAdsCoverage | null }) {
  const stale = c !== null && c.daysOld !== null && c.daysOld >= STALE_DAYS;
  let age = 'no data';
  if (c) {
    if (c.daysOld === null || c.daysOld <= 2) age = `to ${shortDate(c.to)} · current`;
    else age = `to ${shortDate(c.to)} · ${c.daysOld} days old`;
  }
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="font-medium text-slate-600">{title}</span>
      <span className={stale ? 'font-medium text-amber-700' : 'text-slate-500'}>{age}</span>
      {stale && <span className="text-amber-700">· the nightly Google Ads read has stopped — see Bclog</span>}
    </div>
  );
}

export default function GoogleAdsFreshness() {
  const lastQ = useApiQuery('google-ads-import-last', getGoogleAdsImportLast);
  return (
    <div className="space-y-0.5" title="Read from Google Ads every night (last 30 days)">
      <Coverage title="Product data" c={lastQ.data?.product ?? null} />
      <Coverage title="Campaign data" c={lastQ.data?.campaign ?? null} />
    </div>
  );
}
