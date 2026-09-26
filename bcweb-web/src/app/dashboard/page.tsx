'use client';
/*
=======================================================================================================================================
Page: /dashboard
=======================================================================================================================================
Purpose: The platform module menu (CLAUDE.md). Guarded by AppShell.

REBUILT 2026-09-22 (owner) into SEARCH + FIVE INTENT GROUPS THAT EXPAND IN PLACE, replacing four always-open bands of tiles.

WHAT WAS WRONG WITH THE BANDS. Not the tile count — the HEADINGS. "Daily" was a when, "Stock & products" a what, "Pricing" a
function, "Reports & marketing" two unrelated things bolted together. Four different kinds of label means you cannot predict which
band a screen is filed under, so you re-read all seventeen tiles every visit and pick the one you recognise. The owner's words for
it: "it feels like a bunch of cards and I'm still sifting through them to get what I need."

THE AXIS IS NOW THE MINDSET YOU ARRIVED IN (owner: "it will depend where my mindset is when coming to the app"), not the part of the
system a screen belongs to. Every heading below finishes the sentence "I came here to...". That one change is what makes the rest of
the page work, and it is the thing not to undo: if a new screen doesn't obviously finish that sentence under some heading, the answer
is a new heading, not a "Misc" group or a sixth kind of label.

  A SCREEN MAY APPEAR UNDER MORE THAN ONE HEADING, deliberately (owner). Under the old bands a tile had one home and duplication was
  a bug; with intent headings it is the entire point, because two mindsets genuinely look in two places for the same screen. Repricing
  is a daily operations job AND a pricing one; Google Ads heads the Google card AND sits with the reports. So DON'T "de-duplicate" this page — a repeat
  here is load-bearing. (It is cheap, too: a repeat is one line in one array.)

EXPANDED IN PLACE, ONE AT A TIME, rather than each heading being its own sub-page. The whole problem is not knowing where a screen
lives, so a WRONG GUESS HAS TO BE FREE: opening the wrong group and opening another costs two clicks and no navigation, where
sub-pages would put a back-press on every wrong guess and punish exactly the uncertainty this page exists to absorb. One at a time
because all five open is the seventeen-tile wall again with extra headings.
Nothing is remembered between visits: arriving at a bare /dashboard opens it closed every time. A remembered group would be right for
one mindset and quietly wrong for the other four, and re-opening is one click.

  THE ONE EXCEPTION IS COMING BACK (owner, 2026-09-22 — "I went to Winners and then went back to the full reports; I'd prefer to go
  back where I came from"). Every tile here links with `?from=<group id>`, and the page reads `?g=<group id>` on arrival and opens
  that group. AppShell turns the first into the second: on a page opened from this menu the header LOGO points at /dashboard?g=…
  (since 2026-09-24 there is no "← Dashboard" back link — the logo is the way home), and no back link to its own parent is shown,
  so home retraces the step you took rather than climbing the route tree. Winners is the case that exposed it — you
  reach it from this group in one hop, and its own parent is the reports index you never visited.
  THIS IS NOT THE REMEMBERING THE PARAGRAPH ABOVE RULES OUT. It's explicit and it's in the URL: it lasts exactly one journey, is
  visible, and is bookmarkable. Nothing is inferred about what you'd want NEXT time.

SEARCH STAYS THE FRONT DOOR and is NOT one of the five. The day starts by looking a product up, the product hub answers it, and that
path is already solved — so it sits above the groups, unboxed and hero-sized, and gets no heading of its own. THERE IS STILL NO
INVENTORY TILE at top level for the reason the 2026-08-27 note gave: the search box IS that tile on this screen. (Inventory does
appear inside Operations, where it is the browse-with-no-term case rather than the search.)

SUBTITLES ON EVERY TILE (owner, 2026-09-22, with wording reserved — "I might push back on wording as we know what we mean with
internal names at the moment"). The old compact tile was title-only with the description on hover, which is right for a menu you
cross by heart; a tile you reach by OPENING A GROUP is one you were less sure about, and half these names are internal shorthand
(Bclog; Birkenstock vs Birk Tracker; Location; Segments). The subtitle is four or five words, the full description stays on the
tooltip. THE STRINGS ARE THE OWNER'S TO EDIT — they are all in the array below, one line each, and changing them is not a design
decision.

THE HEADER BAR DELIBERATELY DOES NOT MIRROR THESE FIVE (owner, 2026-09-22 — it was the obvious "consistent" answer and it is the
wrong one). It is a fixed four (lib/headerNav.ts), because the two answer different
questions. This page answers "where do I start?" and is allowed to make you think for a second; the bar
answers "get me there, I'm mid-task", where the destination is already known and a mindset-pick would only add a click.
=======================================================================================================================================
*/

import { useState, ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useUrlParam } from '@/lib/useUrlParam';
import ModuleTile from '@/components/ModuleTile';
import UpdateShopifyTile from '@/components/UpdateShopifyTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  ShoppingCartIcon, ChartBarIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
  CursorArrowRaysIcon, MapPinIcon, BanknotesIcon, TruckIcon, DocumentMagnifyingGlassIcon, ArchiveBoxIcon,
  ChevronDownIcon, PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, ScaleIcon, SunIcon, TrophyIcon,
  ChartPieIcon, CalculatorIcon, CloudArrowDownIcon, CalendarIcon, ShoppingBagIcon,
} from '@heroicons/react/24/outline';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Tile {
  title: string;
  subtitle: string;      // the four-or-five-word line under the title; owner's wording to edit
  description: string;   // the full sentence — not shown on the dashboard since the tooltip went (owner, 2026-09-24); kept as the
                         // tile's reference wording
  href: string;          // ignored when `action` is set
  icon: Icon;
  // A card that DOES something instead of opening a screen. Only one so far — the provisional menu's Update Shopify (owner,
  // 2026-09-24); see components/UpdateShopifyTile.tsx.
  action?: 'update-shopify';
}

interface Group {
  id: string;
  title: string;         // finishes "I came here to..."
  blurb: string;         // one line under the heading, shown on the closed tile
  icon: Icon;
  // 'main' = a double-width card that also lists what's inside it (owner, 2026-09-24: Operations and Back Office are the two most
  // used). The extra width is spent on the contents, not on white space — naming what's in a group is the whole cure for the
  // "where does that screen live?" problem this page exists to solve.
  size?: 'main';
  // A card that IS a screen rather than a group of them (owner, 2026-09-26: Sales and Winners promoted to cards of their own).
  // Clicking goes straight there; `tiles` stays empty.
  link?: string;
  tiles: Tile[];
}

/* =====================================================================================================================================
   THE MENU. All four groups and every tile, as data — a screen moves group, or gains a second home, by moving or copying one entry.
   RE-ALIGNED 2026-09-24 (owner). Built first as a "provisional new menu" rendered UNDER the old one so the team's menu didn't move
   while the shape was worked out, then promoted to be the only menu. The old five (Do today's work / See how we're doing / Set
   prices / Feed the channels / Look after the catalogue) are in git history. What changed, on purpose:
     - Shopify Pricing and Amazon Pricing have NO tile. Their homes (/pricing, /amz) are only a segment picker + a Find link, both
       covered by Repricing and the product search; the lists and drills under them are still reached from Repricing.
     - Birkenstock and Google each get a card of their own, pulled out of the reports.
     - Back Office is a deliberate holding pen (reports + Finance + Facebook). If Email arrives, Facebook + Email become a Marketing
       card.
     - Update Shopify is the one tile that RUNS something rather than opening a screen (UpdateShopifyTile).
   ORDER IS THE OWNER'S. Don't sort these alphabetically or by build order.
===================================================================================================================================== */
const GROUPS: Group[] = [
  {
    id: 'sales',
    title: 'Sales',
    blurb: 'Recent sales and profit',
    icon: BanknotesIcon,
    link: '/analytics/sales',
    tiles: [],
  },
  {
    id: 'winners',
    title: 'Winners',
    blurb: 'Products pulling their weight',
    icon: TrophyIcon,
    link: '/segments',
    tiles: [],
  },
  {
    id: 'ops',
    title: 'Operations',
    blurb: 'Stock in, orders out, supplier orders',
    icon: TruckIcon,
    size: 'main',
    tiles: [
      {
        title: 'Goods In',
        subtitle: 'Book in a delivery',
        description: "Book in what's arrived from a supplier and put it on the shelf.",
        href: '/goods-in',
        icon: InboxArrowDownIcon,
      },
      {
        title: 'Customer Orders',
        subtitle: 'Fulfil what customers bought',
        description: "Fulfil what customers have bought — what's picked, what's short, what's waiting.",
        href: '/customer-orders',
        icon: UserGroupIcon,
      },
      {
        title: 'Pick',
        subtitle: 'What to take off the shelf',
        description: "What has to come off a shelf — customer picks, and stock to gather for Amazon.",
        href: '/pick',
        icon: HandRaisedIcon,
      },
      {
        title: 'Amazon Order',
        subtitle: 'What to buy in, what to send',
        description: 'Work out what Amazon needs — what to buy in, and what to send from the local shelf.',
        href: '/amazon-order',
        icon: ClipboardDocumentListIcon,
      },
      {
        // The local-shelf counterpart of Amazon Order, beside it (owner, 2026-09-26).
        title: 'Shopify Order',
        subtitle: 'What to buy in for the shelf',
        description: 'Read each style’s size curve — shelf stock, on order, Shopify sales — and order the sizes the shelf needs.',
        href: '/shopify-order',
        icon: ShoppingBagIcon,
      },
      {
        // Renamed from "Order Status" here only (owner, 2026-09-24) — beside Customer Orders and Amazon Order, "Order Status" no
        // longer said WHOSE order. Same screen; the live menu and the screen's own title still say Order Status.
        title: 'Supplier Orders',
        subtitle: 'What’s placed, what’s coming',
        description: "Place supplier orders and chase what's on its way.",
        href: '/order-status',
        icon: ShoppingCartIcon,
      },
      {
        title: 'Repricing',
        subtitle: 'Selling and stuck lists',
        description: 'See which segment needs attention next, and track who worked what.',
        href: '/segments',
        icon: Squares2X2Icon,
      },
      {
        title: 'Update Shopify',
        subtitle: 'Pull in new orders now',
        description: 'Run the Shopify order update now rather than waiting for the scheduled run — the same as the Update orders button on Sales and Customer Orders.',
        href: '/customer-orders',
        icon: CloudArrowDownIcon,
        action: 'update-shopify',
      },
      {
        title: 'Update Amazon',
        subtitle: 'Load Seller Central reports',
        description: 'Load the Seller Central reports — sales, returns, FBA stock and fees.',
        href: '/update-amazon',
        icon: ArrowUpTrayIcon,
      },
    ],
  },
  {
    id: 'reports',
    title: 'Back Office',
    blurb: 'The numbers, month end, the daily post',
    icon: ChartBarIcon,
    size: 'main',
    // Started as a copy of the live menu's "See how we're doing" tiles (so it stands on its own when GROUPS is retired); renamed
    // from Reports to Back Office when Facebook (the /social screen) joined Finance here (owner, 2026-09-24) — a holding pen: if
    // Email arrives, Facebook + Email become their own Marketing card. The id stays 'reports' so ?from=/?g= links keep working.
    tiles: [
      {
        title: 'Stock Position',
        subtitle: 'What’s commercially alive',
        description: 'How many products are commercially alive right now (in stock or sold in 6 months) — Shopify styles and Amazon SKUs, tracked over time.',
        href: '/analytics/stock-position',
        icon: CubeIcon,
      },
      {
        // Location and Inventory moved here from Operations (owner, 2026-09-26), beside Stock Position.
        title: 'Location',
        subtitle: "What's on a rack",
        description: "Work from the shelf, not the product — what's on a rack, and moving stock on and off it.",
        href: '/locations',
        icon: MapPinIcon,
      },
      {
        title: 'Inventory',
        subtitle: 'Browse without searching',
        description: 'Browse and filter the whole catalogue when you have no term to search for.',
        href: '/inventory',
        icon: ArchiveBoxIcon,
      },
      {
        // Moved here from the retired Business Flow strip (owner, 2026-09-26) — its only door for creating a product; beside New
        // Products because adding one is when the owner checks it. Titled Add / Modify, the module's own name (owner, 2026-09-26).
        title: 'Add / Modify',
        subtitle: 'Edit or create a product',
        description: 'Find an existing product to edit, or create a new one.',
        href: '/products',
        icon: TagIcon,
      },
      {
        title: 'New Products',
        subtitle: 'Added in the last 30 days',
        description: 'Shopify styles added in the last 30 days — how many, and how each new line has sold (units, revenue, profit).',
        href: '/analytics/new-additions',
        icon: SparklesIcon,
      },
      {
        title: 'Price Changes',
        subtitle: 'Recent moves, and what shifted',
        description: 'The latest price moves across Shopify & Amazon — before → after, who & when, and units sold since. Filter by channel or user.',
        href: '/analytics/price-changes',
        icon: ArrowsRightLeftIcon,
      },
      {
        title: 'Log',
        subtitle: 'Who did what, and when',
        description: 'Who did what, and when — every Goods In, stock adjustment, order sync and import, from here and PowerBuilder. Search and filter by section or person.',
        href: '/analytics/activity-log',
        icon: DocumentMagnifyingGlassIcon,
      },
      {
        // Its own Back Office job (owner, 2026-09-25), done in a review mindset: which styles really sell all year, and every style
        // marked "Can't get it". Season no longer affects any status (2026-09-26).
        title: 'Seasons',
        subtitle: 'Summer, winter or all year',
        description: 'Each style’s year of sales month by month, against its season — spot the all-year sellers and re-season them in bulk.',
        href: '/seasons',
        icon: CalendarIcon,
      },
      {
        title: 'Brands',
        subtitle: 'What each brand earned',
        description: 'What each brand earned — revenue, profit and margin over the last year or six months, against the window before it.',
        href: '/brands',
        icon: ChartPieIcon,
      },
      {
        title: 'Finance',
        subtitle: 'Close the month',
        description: 'Close the month: Amazon, Shopify, PayPal and the shop, out to the two QuickFile files.',
        href: '/finance',
        icon: CalculatorIcon,
      },
      {
        title: 'Facebook',
        subtitle: 'Social post',
        description: 'Queue and publish the daily Facebook post — graphic, caption, link, scheduled.',
        href: '/social',
        icon: MegaphoneIcon,
      },
    ],
  },
];

/* =====================================================================================================================================
   FIND-BY-PART CARDS (owner, 2026-09-26). A second row BELOW the main menu, left exactly as it was. Each card gathers every screen for
   one part of the business so it can be found by what it is rather than by mindset. Every tile here ALSO lives in the main menu (or
   was deliberately left off it) — the repeats are the point, don't de-duplicate.
===================================================================================================================================== */
const PART_GROUPS: Group[] = [
  {
    id: 'packing',
    title: 'Packing',
    blurb: 'Book it in, pick it, send it',
    icon: ArchiveBoxIcon,
    tiles: [
      {
        title: 'Goods In',
        subtitle: 'Book in a delivery',
        description: "Book in what's arrived from a supplier and put it on the shelf.",
        href: '/goods-in',
        icon: InboxArrowDownIcon,
      },
      {
        title: 'Pick',
        subtitle: 'What to take off the shelf',
        description: "What has to come off a shelf — customer picks, and stock to gather for Amazon.",
        href: '/pick',
        icon: HandRaisedIcon,
      },
      {
        title: 'Customer Orders',
        subtitle: 'Fulfil what customers bought',
        description: "Fulfil what customers have bought — what's picked, what's short, what's waiting.",
        href: '/customer-orders',
        icon: UserGroupIcon,
      },
    ],
  },
  {
    id: 'orders',
    title: 'Orders',
    blurb: 'What to buy in, and what’s coming',
    icon: ShoppingCartIcon,
    tiles: [
      {
        title: 'Shopify Order',
        subtitle: 'What to buy in for the shelf',
        description: 'Read each style’s size curve — shelf stock, on order, Shopify sales — and order the sizes the shelf needs.',
        href: '/shopify-order',
        icon: ShoppingBagIcon,
      },
      {
        title: 'Amazon Order',
        subtitle: 'What to buy in, what to send',
        description: 'Work out what Amazon needs — what to buy in, and what to send from the local shelf.',
        href: '/amazon-order',
        icon: ClipboardDocumentListIcon,
      },
      {
        title: 'Supplier Orders',
        subtitle: 'What’s placed, what’s coming',
        description: "Place supplier orders and chase what's on its way.",
        href: '/order-status',
        icon: ShoppingCartIcon,
      },
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing',
    blurb: 'Every pricing screen in one place',
    icon: TagIcon,
    tiles: [
      {
        title: 'Repricing',
        subtitle: 'Selling and stuck lists',
        description: 'See which segment needs attention next, and track who worked what.',
        href: '/segments',
        icon: Squares2X2Icon,
      },
      {
        title: 'Shopify Price',
        subtitle: 'Shopify pricing home',
        description: 'Shopify pricing — pick a segment or find a style.',
        href: '/pricing',
        icon: ShoppingBagIcon,
      },
      {
        title: 'Amazon Price',
        subtitle: 'Amazon pricing home',
        description: 'Amazon pricing — pick a segment or find a SKU.',
        href: '/amz',
        icon: ShoppingCartIcon,
      },
      {
        title: 'Price Changes',
        subtitle: 'Recent moves, and what shifted',
        description: 'The latest price moves across Shopify & Amazon — before → after, who & when, and units sold since. Filter by channel or user.',
        href: '/analytics/price-changes',
        icon: ArrowsRightLeftIcon,
      },
    ],
  },
  {
    id: 'data',
    title: 'Data',
    blurb: 'Pull in orders and reports',
    icon: CloudArrowDownIcon,
    tiles: [
      {
        title: 'Update Shopify',
        subtitle: 'Pull in new orders now',
        description: 'Run the Shopify order update now rather than waiting for the scheduled run — the same as the Update orders button on Sales and Customer Orders.',
        href: '/customer-orders',
        icon: CloudArrowDownIcon,
        action: 'update-shopify',
      },
      {
        title: 'Update Amazon',
        subtitle: 'Load Seller Central reports',
        description: 'Load the Seller Central reports — sales, returns, FBA stock and fees.',
        href: '/update-amazon',
        icon: ArrowUpTrayIcon,
      },
      {
        title: 'Log',
        subtitle: 'Who did what, and when',
        description: 'Who did what, and when — every Goods In, stock adjustment, order sync and import, from here and PowerBuilder. Search and filter by section or person.',
        href: '/analytics/activity-log',
        icon: DocumentMagnifyingGlassIcon,
      },
    ],
  },
  {
    id: 'products',
    title: 'Products',
    blurb: 'The range — what’s in it, how it’s doing',
    icon: CubeIcon,
    tiles: [
      {
        title: 'Winners',
        subtitle: 'Products pulling their weight',
        description: 'Winners, steady, new and losers per channel — with winners by brand.',
        href: '/segments',
        icon: TrophyIcon,
      },
      {
        title: 'Add / Modify',
        subtitle: 'Edit or create a product',
        description: 'Find an existing product to edit, or create a new one.',
        href: '/products',
        icon: TagIcon,
      },
      {
        title: 'New Products',
        subtitle: 'Added in the last 30 days',
        description: 'Shopify styles added in the last 30 days — how many, and how each new line has sold (units, revenue, profit).',
        href: '/analytics/new-additions',
        icon: SparklesIcon,
      },
      {
        title: 'Brands',
        subtitle: 'What each brand earned',
        description: 'What each brand earned — revenue, profit and margin over the last year or six months, against the window before it.',
        href: '/brands',
        icon: ChartPieIcon,
      },
      {
        title: 'Seasons',
        subtitle: 'Summer, winter or all year',
        description: 'Each style’s year of sales month by month, against its season — spot the all-year sellers and re-season them in bulk.',
        href: '/seasons',
        icon: CalendarIcon,
      },
      {
        title: 'Stock Position',
        subtitle: 'What’s commercially alive',
        description: 'How many products are commercially alive right now (in stock or sold in 6 months) — Shopify styles and Amazon SKUs, tracked over time.',
        href: '/analytics/stock-position',
        icon: CubeIcon,
      },
    ],
  },
  {
    id: 'location',
    title: 'Location',
    blurb: 'Where stock sits, and what’s held',
    icon: MapPinIcon,
    tiles: [
      {
        title: 'Inventory',
        subtitle: 'Browse without searching',
        description: 'Browse and filter the whole catalogue when you have no term to search for.',
        href: '/inventory',
        icon: ArchiveBoxIcon,
      },
      {
        title: 'Location',
        subtitle: "What's on a rack",
        description: "Work from the shelf, not the product — what's on a rack, and moving stock on and off it.",
        href: '/locations',
        icon: MapPinIcon,
      },
    ],
  },
  {
    id: 'birk',
    title: 'Birkenstock',
    blurb: 'Order it, track it, keep sizes on the shelf',
    icon: CalendarDaysIcon,
    // Moved out of Reports (owner, 2026-09-24): the Birk screens are one job — next season's order, where it's got to, and
    // whether the core sizes are in — so they sit together rather than scattered across reports and catalogue.
    tiles: [
      {
        title: 'Birk Order Book',
        subtitle: 'Next season’s order sheet',
        description: 'Sold in 365 days against what we hold, size by size — what to put on the next order.',
        href: '/birkenstock',
        icon: CalendarDaysIcon,
      },
      {
        title: 'Birk Tracker',
        subtitle: 'Placed to delivered',
        description: 'Track the Birkenstock order from placed to landed — requested, invoiced, arrived.',
        href: '/birk-tracker',
        icon: TruckIcon,
      },
      {
        title: 'Birk Availability',
        subtitle: 'Size range',
        description: 'How many Birkenstock styles are core-size complete (38/39/40) in stock right now — the ad-push gauge.',
        href: '/analytics/birk-availability',
        icon: PresentationChartLineIcon,
      },
    ],
  },
  {
    id: 'google',
    title: 'Google',
    blurb: 'Campaigns, and what the spend is earning',
    icon: CursorArrowRaysIcon,
    // Google Ads plus the two ad reports moved out of Reports (owner, 2026-09-24) — the campaigns and the read on whether the
    // spend is paying sit together.
    tiles: [
      {
        title: 'Google Ads',
        subtitle: 'Shopping campaigns and spend',
        description: 'Sort products into Shopping campaigns — spend, profit after ad spend, and what each campaign is doing.',
        href: '/google-ads',
        icon: CursorArrowRaysIcon,
      },
      {
        title: 'Ad Efficiency',
        subtitle: 'What survives Google spend',
        description: "How much of each month's Shopify profit survived Google ad spend — 13 months of units, profit, spend, kept per unit and the share kept.",
        href: '/analytics/ad-efficiency',
        icon: ScaleIcon,
      },
      {
        title: 'Ad Daily',
        subtitle: 'Spend vs sales, day by day',
        description: 'Google spend against Shopify sales, day by day over a fortnight, with one total that says what the book kept. The owner’s read on whether a budget change is working.',
        href: '/analytics/ad-daily',
        icon: SunIcon,
      },
    ],
  },
];

export default function DashboardPage() {
  // Re-open the group you left from, when you came back through a back link carrying ?g=. Read from window.location rather than
  // useSearchParams on purpose: this is a static page, and useSearchParams would force the whole menu behind a Suspense boundary to
  // build — a real cost for something only the return journey uses. An unknown id just leaves the page closed.
  const g = useUrlParam('g');
  const urlGroup = g && [...GROUPS, ...PART_GROUPS].some((x) => x.id === g && !x.link) ? g : null;

  // The group the operator clicked open or shut. undefined = no click yet, so the ?g= group (or nothing) shows; null = every group
  // closed, which is how a bare /dashboard opens (see the header note on not remembering).
  const [chosenId, setOpenId] = useState<string | null | undefined>(undefined);
  const openId = chosenId === undefined ? urlGroup : chosenId;

  return (
    <AppShell>
      {/* The opener. No heading above it — a search box explains itself, and a "Modules" title here would push the one thing the
          operator came to use below the fold on a laptop. */}
      <div className="mb-7">
        <ProductSearchBox />
      </div>

      <GroupRow groups={GROUPS} openId={openId} onToggle={setOpenId} />

      {/* Find-by-part row, below the main menu. Shares the one open-group state, so opening a card here closes one above. */}
      {/* Rendered four cards per GroupRow so each row's panel opens directly under that row, not below all of them. */}
      {[0, 4].map((i) => (
        <div key={i} className={i === 0 ? 'mt-6' : 'mt-3'}>
          <GroupRow groups={PART_GROUPS.slice(i, i + 4)} openId={openId} onToggle={setOpenId} cols="lg:grid-cols-4" />
        </div>
      ))}

    </AppShell>
  );
}

// The row of group headings with its expand-in-place panel below. (A separate component because the menu was briefly rendered twice
// — old and provisional — during the 2026-09-24 re-alignment; kept, it's a clean split of state from layout.)
function GroupRow({ groups, openId, onToggle, cols = 'lg:grid-cols-6' }: { groups: Group[]; openId: string | null; onToggle: (id: string | null) => void; cols?: string }) {
  const open = groups.find((g) => g.id === openId) ?? null;
  return (
    <>
      {/* THE HEADINGS. Six columns at lg: the two 'main' cards take two each, the rest one — so Operations and Back Office read
          first and biggest, Birkenstock and Google trail. Below lg, main cards go full width and the small ones pair up. */}
      <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 ' + cols}>
        {groups.map((g) => {
          const isOpen = g.id === openId;
          if (g.link) {
            return (
              <Link
                key={g.id}
                // ?from= hides the screen's own back link to its parent (Reports) — home via the logo lands on the dashboard.
                href={g.link + '?from=' + g.id}
                className="flex h-full flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-brand-500 hover:shadow-md"
              >
                <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <g.icon className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold leading-snug text-slate-900">{g.title}</h2>
                <p className="mt-1 text-xs leading-snug text-slate-500">{g.blurb}</p>
              </Link>
            );
          }
          return (
            <button
              key={g.id}
              type="button"
              // Clicking the open group closes it — so the same click that opened it puts the page back, with no close affordance
              // to hunt for.
              onClick={() => onToggle(isOpen ? null : g.id)}
              aria-expanded={isOpen}
              aria-controls={'group-panel-' + g.id}
              className={
                'flex h-full flex-col rounded-xl border p-4 text-left transition ' +
                (g.size === 'main' ? 'sm:col-span-2 ' : '') +
                (isOpen
                  ? 'border-brand-500 bg-white shadow-md ring-1 ring-brand-500'
                  : 'border-slate-200 bg-white shadow-sm hover:border-brand-500 hover:shadow-md')
              }
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={'inline-flex h-9 w-9 items-center justify-center rounded-lg ' + (isOpen ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-600')}>
                  <g.icon className="h-5 w-5" />
                </span>
                <ChevronDownIcon className={'h-4 w-4 text-slate-400 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </div>
              <h2 className={'font-semibold leading-snug text-slate-900 ' + (g.size === 'main' ? 'text-base' : 'text-sm')}>{g.title}</h2>
              <p className="mt-1 text-xs leading-snug text-slate-500">{g.blurb}</p>
              {g.size === 'main' && (
                <p className="mt-3 text-xs leading-relaxed text-slate-400">{g.tiles.map((t) => t.title).join(' · ')}</p>
              )}
            </button>
          );
        })}
      </div>

      {/* THE PANEL — one, below the whole row rather than under the column that was clicked. Under the column it would be a narrow
          strip that moves left and right as you change your mind; full width it is the same shape every time, and the tiles get the
          four-wide grid the old bands used. The darker slate-200 fill is the old band panel, kept for the same reason: it encloses
          the tiles so nothing has to be inferred about what belongs to what. */}
      {open && (
        <section id={'group-panel-' + open.id} className="mt-3 rounded-xl bg-slate-200 p-4 ring-1 ring-slate-300">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {open.tiles.map((t) => t.action === 'update-shopify' ? (
              <UpdateShopifyTile key={open.id + t.title} title={t.title} subtitle={t.subtitle} />
            ) : (
              // key includes the group id because a tile can appear in two groups — title alone is not unique across the menu.
              // `?from=` is the return ticket AppShell reads to build the back link (see the header note). Appended rather than
              // built into the data so the hrefs stay plain, and with a `?`/`&` check in case a tile ever carries its own query.
              <ModuleTile
                key={open.id + t.href + t.title}
                title={t.title}
                subtitle={t.subtitle}
                description={t.description}
                href={t.href + (t.href.includes('?') ? '&' : '?') + 'from=' + open.id}
                icon={t.icon}
                live
                compact
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
