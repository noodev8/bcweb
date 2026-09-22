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
  - /inventory?q=<groupid>    The picture browse. Deliberately kept on the row even though the hub list shows a thumbnail: the browse
                              answers "which rack is it on", which nothing else here does, and the dashboard search box no longer
                              lands on it, so without this card Inventory is reachable only from the header tab.

DISABLED UNTIL A ROW IS PICKED (owner: "we can either grey out the buttons until a groupid is selected or wait for a double click").
Greying out was the choice: a card that navigates SOMEWHERE ELSE depending on which row is highlighted is the kind of control that is
right 95% of the time and silently wrong the rest. Disabled cards render as spans, not links — not merely pointer-events-none, so
there is nothing to middle-click or tab onto either.
=======================================================================================================================================
*/

import Link from 'next/link';
import {
  ClipboardDocumentListIcon, BuildingStorefrontIcon, CurrencyPoundIcon, TagIcon, ArchiveBoxIcon, QrCodeIcon,
} from '@heroicons/react/24/outline';

// One destination. `build` gets the selected groupid and the encoded origin, so a card's whole deep-link convention sits on one line
// next to its label — which is where you will look for it when a destination changes its params.
interface NavTarget {
  label: string;
  hint: string;                                   // tooltip — what the screen is FOR, since the label alone is just a module name
  icon: React.ComponentType<{ className?: string }>;
  build: (groupid: string, from: string) => string;
}

const TARGETS: NavTarget[] = [
  {
    label: 'Amazon Order',
    hint: 'What Amazon needs of this product — what to buy in, and what to send from the local shelf',
    icon: ClipboardDocumentListIcon,
    build: (g, from) => `/amazon-order?q=${encodeURIComponent(g)}&from=${from}&back=Product`,
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
    label: 'Add / Modify',
    hint: 'Edit this product — title, attributes, sizes, price, image',
    icon: TagIcon,
    build: (g, from) => `/products?groupid=${encodeURIComponent(g)}&from=${from}&back=Product`,
  },
  {
    label: 'Inventory',
    hint: 'The picture browse — sizes on the shelf, and which rack each one is on',
    icon: ArchiveBoxIcon,
    build: (g) => `/inventory?q=${encodeURIComponent(g)}`,
  },
];

interface Props {
  /** The selected style, or null when nothing is picked yet — which greys every card. */
  groupid: string | null;
  /** The hub URL to come back to. Passed through as ?from= on every card that supports it. */
  from: string;
  /**
   * Barcode is a PANEL, not a page (owner listed it alongside the others, wondering about "a new window or popup allowing barcode
   * copy"). It stays on this screen for the same reason the rest are same-tab: a popup is a window to dismiss and a page is a trip,
   * and all the barcode needs is to be readable and copyable next to the size it belongs to. Omit the prop to drop the card — the
   * list page has no size rows to show barcodes against, so it does.
   */
  onBarcode?: () => void;
  barcodeOpen?: boolean;
}

// Shared look. A card is white-on-slate with a real edge — the same "this is clickable" treatment the dashboard tiles use — and the
// disabled state drops to a flat slate fill so it reads as inert rather than as a tile that failed to load.
const BASE =
  'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition';
const ENABLED = 'border-slate-300 bg-white text-slate-700 shadow-sm hover:border-slate-400 hover:bg-slate-50 hover:text-slate-900';
const DISABLED = 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400';

export default function ProductNavCards({ groupid, from, onBarcode, barcodeOpen }: Props) {
  const encodedFrom = encodeURIComponent(from);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {TARGETS.map((t) => {
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
          <Link key={t.label} href={t.build(groupid, encodedFrom)} title={t.hint} className={`${BASE} ${ENABLED}`}>
            <Icon className="h-4 w-4 text-brand-600" />
            {t.label}
          </Link>
        );
      })}

      {onBarcode && (
        <button
          type="button"
          onClick={onBarcode}
          disabled={!groupid}
          title={groupid ? 'Show the barcode for each size, ready to copy' : 'Pick a product first'}
          className={`${BASE} ${groupid ? ENABLED : DISABLED} ${barcodeOpen && groupid ? 'ring-2 ring-brand-500/30' : ''}`}
        >
          <QrCodeIcon className={`h-4 w-4 ${groupid ? 'text-brand-600' : 'text-slate-300'}`} />
          {barcodeOpen ? 'Hide barcodes' : 'Barcode'}
        </button>
      )}
    </div>
  );
}
