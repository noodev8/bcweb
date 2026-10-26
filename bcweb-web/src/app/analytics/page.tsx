/*
=======================================================================================================================================
Page: /analytics — the Reports index, retired 2026-10-26
=======================================================================================================================================
It was a second grid of tiles (Sales, Birk Availability, Stock Position, New, Price Changes, Ad Efficiency, Ad Daily, Bclog, Winners,
Brands) — every one of them also on the dashboard, which now lists every screen ONCE (owner, 2026-10-26: "get rid of ... the repeat
dashboard from reports"; "i dont want duplicates"). The header's Reports tab went with it. The report screens keep their
/analytics/... routes; this one only redirects so an old link or bookmark still lands somewhere sensible.
=======================================================================================================================================
*/

import { redirect } from 'next/navigation';

export default function AnalyticsPage() {
  redirect('/dashboard');
}
