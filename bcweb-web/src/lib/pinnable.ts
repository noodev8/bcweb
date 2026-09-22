/*
=======================================================================================================================================
Module: lib/pinnable
=======================================================================================================================================
Purpose: The one list of screens that can sit in the header bar, and the helper that says which one the current path is on.

WHY A REGISTRY AND NOT JUST THE DASHBOARD ARRAY. Two things need this list and they need different shapes of it: AppShell renders the
pinned few by href (it only has a pathname to go on, not a tile), and the pin button has to name the screen it is about to pin. The
dashboard's GROUPS array can't serve either — a screen appears in it twice on purpose (Segments, Amazon Pricing, Birk Tracker), so a
lookup by href there is ambiguous, and it carries per-group wording that would read oddly in a header tab. So this is the flat,
one-entry-per-screen view: href is the key and is UNIQUE here.

KEEP IT IN STEP with the dashboard's GROUPS when a module is added — a screen missing from here simply can't be pinned, which is a
quiet failure rather than a loud one. It is the only duplication between the two, and it is deliberate: the alternative is deriving
one from the other and inheriting the duplicate entries.

LABELS ARE SHORTER THAN THE DASHBOARD'S. A header tab is read sideways at a glance, in a row that has to fit five of them plus the
brand and the account controls, so "Add / Modify Product" is "Products" here. Same screen, less room.
=======================================================================================================================================
*/

import { ComponentType, SVGProps } from 'react';
import {
  CurrencyPoundIcon, ShoppingCartIcon, ChartBarIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
  CursorArrowRaysIcon, MapPinIcon, BanknotesIcon, TruckIcon, DocumentMagnifyingGlassIcon, ArchiveBoxIcon,
} from '@heroicons/react/24/outline';

export interface Pinnable {
  label: string;
  href: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  // A module whose views don't all live under its own path. Reports absorbed Brands but Brands kept its route, and a tab going dark
  // on a page you reached THROUGH it reads as having lost your place.
  also?: string[];
}

export const PINNABLE: Pinnable[] = [
  { label: 'Inventory', href: '/inventory', icon: ArchiveBoxIcon },
  { label: 'Segments', href: '/segments', icon: Squares2X2Icon },
  { label: 'Customer Orders', href: '/customer-orders', icon: UserGroupIcon },
  { label: 'Reports', href: '/analytics', icon: ChartBarIcon, also: ['/brands'] },
  { label: 'Pick', href: '/pick', icon: HandRaisedIcon },
  { label: 'Order Status', href: '/order-status', icon: ShoppingCartIcon },
  { label: 'Goods In', href: '/goods-in', icon: InboxArrowDownIcon },
  { label: 'Amazon Order', href: '/amazon-order', icon: ClipboardDocumentListIcon },
  { label: 'Location', href: '/locations', icon: MapPinIcon },
  { label: 'Finance', href: '/finance', icon: BanknotesIcon },
  { label: 'Birk Tracker', href: '/birk-tracker', icon: TruckIcon },
  { label: 'Bclog', href: '/analytics/activity-log', icon: DocumentMagnifyingGlassIcon },
  { label: 'Shopify Pricing', href: '/pricing', icon: CurrencyPoundIcon },
  { label: 'Amazon Pricing', href: '/amz', icon: BuildingStorefrontIcon },
  { label: 'Update Amazon', href: '/update-amazon', icon: ArrowUpTrayIcon },
  { label: 'Google Ads', href: '/google-ads', icon: CursorArrowRaysIcon },
  { label: 'Marketing', href: '/social', icon: MegaphoneIcon },
  { label: 'Products', href: '/products', icon: TagIcon },
  { label: 'Birkenstock', href: '/birkenstock', icon: CalendarDaysIcon },
];

export function findPinnable(href: string): Pinnable | undefined {
  return PINNABLE.find((p) => p.href === href);
}

/*
Which registry entry a path belongs to — used both to highlight the active tab and to decide what the pin button on a page would pin.

LONGEST MATCH WINS, and that is the whole reason this isn't a one-line `startsWith`. Bclog lives at /analytics/activity-log, INSIDE
Reports' /analytics: a plain prefix scan in array order highlights Reports while you are standing on Bclog, and a pin button there
would offer to pin Reports. Matching on the longest href that fits puts you on Bclog and leaves Reports alone, while a drill page
(/pricing/style/…, /amz/sku/…) with no deeper entry still resolves to its module.
*/
export function pinnableForPath(pathname: string): Pinnable | undefined {
  let best: Pinnable | undefined;
  let bestLen = -1;
  for (const p of PINNABLE) {
    for (const h of [p.href, ...(p.also || [])]) {
      if ((pathname === h || pathname.startsWith(h + '/')) && h.length > bestLen) {
        best = p;
        bestLen = h.length;
      }
    }
  }
  return best;
}
