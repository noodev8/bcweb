/*
=======================================================================================================================================
Page: /daily — retired 2026-10-26
=======================================================================================================================================
Daily is now the hero of the dashboard itself (owner: "i want daily to be the main thing so its clear what to work on ... i dont want
duplicates"), with the four jobs and how much each has waiting — app/dashboard/page.tsx → Daily. This route only redirects there so an
old link or bookmark still lands somewhere sensible.
=======================================================================================================================================
*/

import { redirect } from 'next/navigation';

export default function DailyPage() {
  redirect('/dashboard');
}
