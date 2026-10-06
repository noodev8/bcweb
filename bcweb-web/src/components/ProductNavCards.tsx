'use client';
/*
=======================================================================================================================================
Component: ProductNavCards
=======================================================================================================================================
Purpose: The hand-off menu for one product — on /inventory (the sticky bar over the cards), /product/<groupid>, Sales and New
         Additions. One card per screen that can do something to the style you are looking at, each deep-linked with the groupid
         already filled in (owner, 2026-09-22): "From the product, I need to find what I need or adjust anything about it, WITHOUT HUNTING AROUND FOR THE CORRECT SCREEN."

SAME TAB, ALWAYS (owner, 2026-09-22 — "all navigation must stay on the same tab and be able to return"). This is the one thing that
makes these different from the NavPill row on the Google Ads drill, which they otherwise resemble closely: those open in a NEW tab on
purpose, because that screen's value is a filtered list with cuts and a selection built up over minutes, and navigating away throws it
away. Here every card is an ordinary same-tab link carrying `from` = the URL it left, which the destination turns into its "← Back".
A screen whose state is NOT all in its URL (Inventory: steps, cuts, scroll, open Details) passes `onLeave`, fired on the click just
before the navigation, to save that state for the return trip.
Do not add target="_blank" to these without re-reading that: a new tab per hop is exactly what the owner asked not to have.

EVERY DESTINATION USES THE DEEP LINK IT ALREADY HAD — this component invented no new conventions, it just stopped the operator
retyping the groupid into five different search boxes:
  - /pricing/style/<groupid>  lands directly on the Shopify drill; reads ?from= for its back link.
  - /amz/find?q=<groupid>     Amazon is SKU grain, so there is no single page for a style — its find fans the groupid out to a row per
                              size, which is the correct landing for "price this product on Amazon". Reads ?from=.
  - /products?groupid=        Add/Modify opens straight on the edit panel. Reads ?from= plus ?back= for the label.
  - /amazon-order?q=          Reads ?from=/?back= and seeds one Include step. THE ONLY ONE THAT NEEDED WORK — that page took no query
                              params at all before this row (see its header note).
  - /analytics/sales?q=         Seeds a Contains step (product mode, 12 months). Reads ?from=/?back=.
  - /shopify-order?q=         Seeds one Include step (added 2026-09-26). Reads ?from=/?back=.
  - /inventory?q=<groupid>    Sizes and racks. Reads ?from=/?back=. Left off (exclude) on Inventory itself, where it would be a link
                              to the screen you are on.

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

// The product page for this style (/product/<groupid>, its sizes) — offered only where asked for (showProduct), e.g. Reports → New.
// On that page itself it would be a link to the page you are on. (Tried as Add/Modify the same day and reverted — the product page is
// the leaner landing.)
const PRODUCT_TARGET: NavTarget = {
  label: 'Product',
  hint: 'Open this style on the product page — RRP, sizes, stock and every card again',
  icon: CubeIcon,
  build: (g, from) => `/product/${encodeURIComponent(g)}?from=${from}`,
};

// Grouped by channel (owner, 2026-09-26 — "group shopify with shopify and amazon with amazon"): the general cards first, then a
// captioned Shopify pair and Amazon pair in the SAME order (Order, Price), so the two channels line up card-for-card. Inside a group
// the label drops the channel word — the caption already says it; the tooltip still names it in full.
type Group = 'general' | 'Shopify' | 'Amazon';
const GROUPS: Group[] = ['general', 'Shopify', 'Amazon'];

const TARGETS: (NavTarget & { group: Group })[] = [
  {
    group: 'general',
    label: 'Sales',
    hint: '12 months of sales for this product, every channel',
    icon: ChartBarIcon,
    build: (g, from, back) => `/analytics/sales?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    group: 'general',
    label: 'Inventory',
    hint: 'The picture browse — sizes on the shelf, and which rack each one is on',
    icon: ArchiveBoxIcon,
    build: (g, from, back) => `/inventory?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  // Where a Product card leads the row (showProduct), Edit Product is left off (owner, 2026-09-26 — "they can
  // go to product first"): the product page carries this card, so it is one hop away, and the row stays one line.
  {
    group: 'general',
    label: 'Edit Product',
    hint: 'Edit this product — title, attributes, sizes, price, image',
    icon: TagIcon,
    build: (g, from, back) => `/products?groupid=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    group: 'Shopify',
    label: 'Order',
    hint: 'Shopify Order — order this style in for the Shopify shelf, size strip filtered to this product',
    icon: ShoppingCartIcon,
    build: (g, from, back) => `/shopify-order?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    group: 'Shopify',
    label: 'Price',
    hint: 'Shopify Price — set the Shopify price for this style: demand, pricing timeline and size curve',
    icon: CurrencyPoundIcon,
    build: (g, from) => `/pricing/style/${encodeURIComponent(g)}?from=${from}`,
  },
  {
    group: 'Amazon',
    label: 'Order',
    hint: 'Amazon Order — what Amazon needs of this product: what to buy in, and what to send from the local shelf',
    icon: ClipboardDocumentListIcon,
    build: (g, from, back) => `/amazon-order?q=${encodeURIComponent(g)}&from=${from}&back=${back}`,
  },
  {
    group: 'Amazon',
    label: 'Price',
    hint: 'Amazon Price — price this product on Amazon, one row per size, since Amazon prices per size',
    icon: BuildingStorefrontIcon,
    build: (g, from) => `/amz/find?q=${encodeURIComponent(g)}&from=${from}`,
  },
];

interface Props {
  /** The selected style, or null when nothing is picked yet — which greys every card. */
  groupid: string | null;
  /** The URL to come back to. Passed through as ?from= on every card that supports it. */
  from: string;
  /** Fired on a card's click, just before the navigation — for a screen that must save state its URL doesn't hold (Inventory). */
  onLeave?: () => void;
  /** Lead with a Product card (/product/<groupid>, this style's sizes). */
  showProduct?: boolean;
  /** Card labels to leave out — the screen you are ON (e.g. Sales hides 'Sales'), so no card links to the page it sits on. Matches
   *  general cards only: grouped labels ('Order', 'Price') are not unique. */
  exclude?: string[];
  // NO BARCODE CARD. It had one, toggling a column on the drill; the owner cut it (2026-09-22 — "no point having barcode button, may
  // as well just show the barcode"), and the drill now prints the column unconditionally. Nothing to reinstate here if it ever comes
  // back — a barcode belongs beside its size, not behind a button on this row.
}

// Shared look. A card is white-on-slate with a real edge — the same "this is clickable" treatment the dashboard tiles use — and the
// disabled state drops to a flat slate fill so it reads as inert rather than as a tile that failed to load.
const BASE =
  'inline-flex w-32 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition'; // one width for every card (owner, 2026-09-26); w-32 since the grouped labels got short
const ENABLED = 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900';
const DISABLED = 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400';

export default function ProductNavCards({ groupid, from, showProduct, exclude, onLeave }: Props) {
  const encodedFrom = encodeURIComponent(from);
  // The destination's back-link label names where you actually came from ("Inventory", "New Additions"), not a fixed label.
  const encodedBack = encodeURIComponent(prettyPathLabel(from));

  const all = showProduct ? [{ ...PRODUCT_TARGET, group: 'general' as Group }, ...TARGETS] : TARGETS;
  const visible = all.filter((t) =>
    t.group !== 'general' || !(exclude?.includes(t.label) || (showProduct && t.label === 'Edit Product')));

  const card = (t: NavTarget & { group: Group }) => {
    const Icon = t.icon;
    const key = `${t.group}-${t.label}`;
    // No groupid = a span, not a link. See the header: disabled cards must not be navigable by any route, including middle-click
    // and keyboard, not just unclickable by mouse.
    if (!groupid) {
      return (
        <span key={key} aria-disabled className={`${BASE} ${DISABLED}`}>
          <Icon className="h-4 w-4 text-slate-300" />
          {t.label}
        </span>
      );
    }
    return (
      <Link key={key} href={t.build(groupid, encodedFrom, encodedBack)} onClick={onLeave} className={`${BASE} ${ENABLED}`}>
        <Icon className="h-4 w-4 text-brand-600" />
        {t.label}
      </Link>
    );
  };

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      {GROUPS.map((g) => {
        const items = visible.filter((t) => t.group === g);
        if (!items.length) return null;
        return (
          <div key={g} className="flex flex-col gap-1">
            {/* Every group is captioned (owner, 2026-09-26) — the general cards are all about the product itself. */}
            <span className="h-4 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{g === 'general' ? 'Product' : g}</span>
            <div className="flex flex-wrap gap-2">{items.map(card)}</div>
          </div>
        );
      })}
    </div>
  );
}
