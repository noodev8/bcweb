/*
=======================================================================================================================================
Module: lib/headerNav
=======================================================================================================================================
Purpose: The fixed tabs in the header bar, and the helper that says which one the current path is on.

FIXED, NOT PINNED (owner, 2026-09-23). A per-browser "star a page to pin it" version shipped on 2026-09-22 and was taken out the next
day: the star beside every page title was clutter on screens that aren't anyone's home (a segment's detail page offered to pin
Segments), and the owner wants the header to stay fixed. The four below are the ones chosen on 2026-08-27 as genuinely hopped
between with a task half-done.

The bar deliberately does NOT mirror the dashboard's five intent groups — the bar is for the mid-task hop with a known destination,
where a mindset-pick would only add a click.

LABELS ARE SHORTER THAN THE DASHBOARD'S: a header tab is read sideways at a glance, in a row shared with the brand and account controls.
=======================================================================================================================================
*/

import { ComponentType, SVGProps } from 'react';
import { ChartBarIcon, Squares2X2Icon, UserGroupIcon, ArchiveBoxIcon } from '@heroicons/react/24/outline';

export interface HeaderTab {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  // A module whose views don't all live under its own path. Reports absorbed Brands but Brands kept its route, and a tab going dark
  // on a page you reached THROUGH it reads as having lost your place.
  also?: string[];
}

export const HEADER_TABS: HeaderTab[] = [
  { label: 'Inventory', href: '/inventory', icon: ArchiveBoxIcon },
  // Also lit on the Shopify / Amazon pricing screens (lists, drills, find) — they're where Repricing takes you (owner, 2026-09-24).
  { label: 'Repricing', href: '/segments', icon: Squares2X2Icon, also: ['/pricing', '/amz'] },
  { label: 'Customer Orders', href: '/customer-orders', icon: UserGroupIcon },
  { label: 'Reports', href: '/analytics', icon: ChartBarIcon, also: ['/brands'] },
];

/*
Which tab a path belongs to, for the active highlight. Prefix match, so a drill page (/segments/IVES-COLOUR) lights up its module.
Longest match wins, so a tab nested inside another's path would not be shadowed by its parent.
*/
export function tabForPath(pathname: string): HeaderTab | undefined {
  let best: HeaderTab | undefined;
  let bestLen = -1;
  for (const t of HEADER_TABS) {
    for (const h of [t.href, ...(t.also || [])]) {
      if ((pathname === h || pathname.startsWith(h + '/')) && h.length > bestLen) {
        best = t;
        bestLen = h.length;
      }
    }
  }
  return best;
}
