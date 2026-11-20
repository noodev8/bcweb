/*
=======================================================================================================================================
Module: lib/userAccess  (THE copy — which screens a non-admin sees)
=======================================================================================================================================
Purpose: Admin vs not admin (owner, 2026-11-20). An admin sees every screen. Not admin sees ONLY the five warehouse screens below:
         their dashboard is these five as big buttons, the header tabs are these five, and AppShell sends any other screen (a typed URL,
         a bookmark, an old link) back to the dashboard.

HIDDEN ON SCREEN ONLY. The API refuses nothing on it (owner: "don't need to worry about server") — apart from the Users screen's own
         write. Who is an admin is app_users.is_admin, switched on Admin -> Users (/users), read from GET /me by contexts/AuthContext.

Adding a screen for non-admins: add it here, and check it has no links into screens that aren't here (they would bounce back to the
         dashboard). The five were checked on 2026-11-20: they link only to each other (Goods In <-> AMZ Shipment, Customer Orders -> Pick).
=======================================================================================================================================
*/

import { ComponentType, SVGProps } from 'react';
import { UserGroupIcon, InboxArrowDownIcon, CubeIcon, HandRaisedIcon, MapPinIcon } from '@heroicons/react/24/outline';

export interface StaffScreen {
  label: string;
  subtitle: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
}

// The owner's order (2026-11-20). Labels match the dashboard tiles.
export const NON_ADMIN_SCREENS: StaffScreen[] = [
  { label: 'Customer Orders', subtitle: 'Fulfill what customers bought', href: '/customer-orders', icon: UserGroupIcon },
  { label: 'Goods In', subtitle: 'Book in a delivery', href: '/goods-in', icon: InboxArrowDownIcon },
  { label: 'AMZ Shipment', subtitle: 'Pack the Amazon boxes', href: '/amz-shipment', icon: CubeIcon },
  { label: 'Pick', subtitle: 'What to take off the shelf', href: '/pick', icon: HandRaisedIcon },
  { label: 'Location', subtitle: "What's on a rack", href: '/locations', icon: MapPinIcon },
];

// Can this user see this path? The dashboard is always allowed (a non-admin's shows only the five buttons).
export function canSee(pathname: string, isAdmin: boolean): boolean {
  if (isAdmin) return true;
  if (pathname === '/dashboard') return true;
  return NON_ADMIN_SCREENS.some((s) => pathname === s.href || pathname.startsWith(s.href + '/'));
}
