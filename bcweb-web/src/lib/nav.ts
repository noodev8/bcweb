/*
=======================================================================================================================================
Helper: prettyPathLabel
=======================================================================================================================================
Purpose: Turn an arbitrary origin path into a readable back-link label, for when a screen was reached from OUTSIDE its own module (a
         cross-module jump carrying `?from=`). e.g. "/analytics/new-additions" -> "New Additions", "/amz/find?q=123" -> "Find". Used by
         the drill pages and the Find pages so their "← Back" reads sensibly instead of a raw path (or a wrong hardcoded default).
=======================================================================================================================================
*/
export function prettyPathLabel(p: string): string {
  const seg = p.split('?')[0].split('/').filter(Boolean).pop() || '';
  if (!seg) return 'Back';
  return seg.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
