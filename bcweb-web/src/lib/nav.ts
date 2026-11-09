/*
=======================================================================================================================================
Helper: prettyPathLabel
=======================================================================================================================================
Purpose: Turn an arbitrary origin path into a readable back-link label, for when a screen was reached from OUTSIDE its own module (a
         cross-module jump carrying `?from=`). e.g. "/analytics/new-additions" -> "New Additions", "/amz/find?q=123" -> "Find". Used by
         the drill pages and the Find pages so their "← Back" reads sensibly instead of a raw path (or a wrong hardcoded default).
=======================================================================================================================================
*/
// Screens whose on-screen name no longer matches their route. /segments is Repricing in the nav, but reached from the dashboard's
// Winners card too — one screen, two names — so a link back to it just says Back (owner, 2026-09-26).
// /analytics/stock-sales is Slow on screen (2026-10-12; was Selling vs Sitting, before that Stock vs Sales); the route kept its old name.
// /analytics/slow-sizes is RANGE on screen (2026-11-06 — owner: "lose its 'slow movers' name"; Daily's Range figure opens it); its two
// lists are named by their box (?band=), so a back link says where it goes.
const RENAMED: Record<string, string> = {
  '/segments': 'Back', '/pricing/vs-amazon': 'Shopify vs Amazon', '/analytics/stock-sales': 'Slow movers', '/amz-loaded': 'AMZ loaded',
  '/ebay': 'eBay listings', '/analytics/slow-sizes': 'Range', '/analytics/deep-sizes': 'Deep sellers', '/prospects/size-gaps': 'Size gaps',
};

export function prettyPathLabel(p: string): string {
  const path = p.split('?')[0];
  if (RENAMED[path]) return RENAMED[path];
  if (path === '/analytics/slow-sizes/list') return /[?&]band=cl/.test(p) ? 'No sale 9 months+' : 'No sale 91 days – 9 months';
  // The per-style product page reads "Product" — the last segment of /product/<groupid> is a code, not a name.
  if (path.startsWith('/product/')) return 'Product';
  const seg = path.split('/').filter(Boolean).pop() || '';
  if (!seg) return 'Back';
  return seg.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
