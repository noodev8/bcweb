'use client';
/*
=======================================================================================================================================
Component: ProductNavCards
=======================================================================================================================================
Purpose: The hand-off row on the product hub (/product and /product/<groupid>). One card per screen that can do something to the style
         you are looking at, each deep-linked with the groupid already filled in — the whole point of the hub (owner, 2026-09-22):
         "From the product, I need to find what I need or adjust anything about it, WITHOUT HUNTING AROUND FOR THE CORRECT SCREEN."

SAME TAB, ALWAYS (owner, 2026-09-22 — "all navigation must stay on the same tab and be able to return"). This is the one thing that
makes these different from the NavPill row on the Google Ads drill, which they otherwise resemble closely: those open in a NEW tab on
purpose, because that screen's value is a filtered list with cuts and a selection built up over minutes, and navigating away throws it
away. The hub has nothing to lose — its state is one search term, which lives in the URL and comes back intact. So every card here is
an ordinary same-tab link, and each one carries `from` = the exact hub URL it left, which the destination turns into its "← Back".
Do not add target="_blank" to these without re-reading that: a new tab per hop is exactly what the owner asked not to have.

EVERY DESTINATION USES THE DEEP LINK IT ALREADY HAD — this component invented no new conventions, it just stopped the operator
retyping the groupid into five different search boxes:
  - /pricing/style/<groupid>  lands directly on the Shopify drill; reads ?from= for its back link.
  - /amz/find?q=<groupid>     Amazon is SKU grain, so there is no single page for a style — its find fans the groupid out to a row per
                              size, which is the correct landing for "price this product on Amazon". Reads ?from=.
  - /products?groupid=        Add/Modify opens straight on the edit panel. Reads ?from= plus ?back= for the label.
  - /amazon-order?q=          Reads ?from=/?back= and seeds one Include step. THE ONLY ONE THAT NEEDED WORK — that page took no query
                              params at all before the hub (see its header note).
  - /analytics/sales?q=         Seeds a Contains step (product mode, 12 months). Reads ?from=/?back=.
  - /shopify-order?q=         Seeds one Include step (added 2026-09-26). Reads ?from=/?back=.
  - /inventory?q=<groupid>    The picture browse. Deliberately kept on the row even though the hub list shows a thumbnail: the browse
                              answers "which rack is it on", which nothing else here does, and the dashboard search box no longer
                              lands on it, so without this card Inventory is reachable only from the header tab.
                              It learned ?from=/?back= on 2026-09-22 (owner) - it had neither, because nothing used to send you into
                              it, and arriving from here with no way out was a dead end.

DISABLED UNTIL A ROW IS PICKED (owner: "we can either grey out the buttons until a groupid is selected or wait for a double click").
Greying out was the choice: a card that navigates SOMEWHERE ELSE depending on which row is highlighted is the kind of control that is
right 95% of the time and silently wrong the rest. Disabled cards render as spans, not links — not merely pointer-events-none, so
there is nothing to middle-click or tab onto either.
=======================================================================================================================================
*/

import Link from 'next/link';
import { prettyPathLabel } from '@/lib/nav';
import {
  ClipboardDocumentListIcon, BuildingStorefrontIcon, CurrencyPoundIcon, TagIcon, ArchiveBoxIcon, ChartBarIcon, ShoppingCartIcon, CubeIcon,
} from '@heroicons/react/24/outline';

// One destination. `build` gets the selected groupid and the encoded origin, so a card's whole deep-link convention sits on one line
// next to its label — which is where you will look for it when a destination changes its params.
interface NavTarget {
  label: string;
  hint: string;                                   // tooltip — what the screen is FOR, since the label alone is just a module name
  icon: React.ComponentType<{ className?: string }>;
  build: (groupid: string, from: string, back: string) => string;
}

// The product hub page for this style — offered only by screens OUTSIDE the hub (showProduct), e.g. Reports → New. On the hub itself
// it would be a link to the page you are on. (Tried as Add/Modify the same day and reverted — the hub page is the leaner landing.)
const PRODUCT_TARGET: NavTarget = {
  label: 'Product',
  hint: 'Open this style on the product page — RRP, sizes, stock and every card again',
  icon: CubeIcon,
  build: (g, from) => `/product/${encodeURIComponent(g)}?from=${from}`,
};

const TARGETS: NavTarget[] = [
  {
    label: 'Sales',
    hint: '12 months of sales for this product, every channel',
    icon: ChartBarIcon,
    build: (g, from, back) => `/analytics/sales?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    label: 'Shopify Order',
    hint: 'Order this style in for the Shopify shelf — size strip, filtered to this product',
    icon: ShoppingCartIcon,
    build: (g, from, back) => `/shopify-order?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    label: 'Amazon Order',
    hint: 'What Amazon needs of this product — what to buy in, and what to send from the local shelf',
    icon: ClipboardDocumentListIcon,
    build: (g, from, back) => `/amazon-order?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    label: 'Amazon Price',
    hint: 'Price this product on Amazon — one row per size, since Amazon prices per size',
    icon: BuildingStorefrontIcon,
    build: (g, from) => `/amz/find?q=${encodeURIComponent(g)}&from=${from}`,
  },
  {
    label: 'Shopify Price',
    hint: 'Set the Shopify price for this style — demand, pricing timeline and size curve',
    icon: CurrencyPoundIcon,
    build: (g, from) => `/pricing/style/${encodeURIComponent(g)}?from=${from}`,
  },
  {
    label: 'Edit Product',
    hint: 'Edit this product — title, attributes, sizes, price, image',
    icon: TagIcon,
    build: (g, from, back) => `/products?groupid=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    label: 'Inventory',
    hint: 'The picture browse — sizes on the shelf, and which rack each one is on',
    icon: ArchiveBoxIcon,
    build: (g, from, back) => `/inventory?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
];

interface Props {
  /** The selected style, or null when nothing is picked yet — which greys every card. */
  groupid: string | null;
  /** The hub URL to come back to. Passed through as ?from= on every card that supports it. */
  from: string;
  /** Lead with a Product card (the hub page for this style). For screens outside the hub. */
  showProduct?: boolean;
  // NO BARCODE CARD. It had one, toggling a column on the drill; the owner cut it (2026-09-22 — "no point having barcode button, may
  // as well just show the barcode"), and the drill now prints the column unconditionally. Nothing to reinstate here if it ever comes
  // back — a barcode belongs beside its size, not behind a button on this row.
}

// Shared look. A card is white-on-slate with a real edge — the same "this is clickable" treatment the dashboard tiles use — and the
// disabled state drops to a flat slate fill so it reads as inert rather than as a tile that failed to load.
const BASE =
  'inline-flex w-40 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition'; // one width for every card (owner, 2026-09-26)
const ENABLED = 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900';
const DISABLED = 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400';

export default function ProductNavCards({ groupid, from, showProduct }: Props) {
  const encodedFrom = encodeURIComponent(from);
  // The destination's back-link label names where you actually came from ("Product", "New Additions"), not a fixed "Product".
  const encodedBack = encodeURIComponent(prettyPathLabel(from));

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(showProduct ? [PRODUCT_TARGET, ...TARGETS] : TARGETS).map((t) => {
        const Icon = t.icon;
        // No groupid = a span, not a link. See the header: disabled cards must not be navigable by any route, including middle-click
        // and keyboard, not just unclickable by mouse.
        if (!groupid) {
          return (
            <span key={t.label} aria-disabled className={`${BASE} ${DISABLED}`} title="Pick a product first">
              <Icon className="h-4 w-4 text-slate-300" />
              {t.label}
            </span>
          );
        }
        return (
          <Link key={t.label} href={t.build(groupid, encodedFrom, encodedBack)} title={t.hint} className={`${BASE} ${ENABLED}`}>
            <Icon className="h-4 w-4 text-brand-600" />
            {t.label}
          </Link>
        );
      })}

    </div>
  );
}
