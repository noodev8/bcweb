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
  a bug; with intent headings it is the entire point, because two mindsets genuinely look in two places for the same screen. Segments
  is a pricing door AND a what-needs-attention read. Amazon Pricing is a price you set AND the thing the Seller Central upload
  carries. Birk Tracker is a report AND the far end of the Birkenstock catalogue job. So DON'T "de-duplicate" this page — a repeat
  here is load-bearing. (It is cheap, too: a repeat is one line in one array.)

EXPANDED IN PLACE, ONE AT A TIME, rather than each heading being its own sub-page. The whole problem is not knowing where a screen
lives, so a WRONG GUESS HAS TO BE FREE: opening the wrong group and opening another costs two clicks and no navigation, where
sub-pages would put a back-press on every wrong guess and punish exactly the uncertainty this page exists to absorb. One at a time
because all five open is the seventeen-tile wall again with extra headings.
Nothing is remembered between visits: arriving at a bare /dashboard opens it closed every time. A remembered group would be right for
one mindset and quietly wrong for the other four, and re-opening is one click.

  THE ONE EXCEPTION IS COMING BACK (owner, 2026-09-22 — "I went to Winners and then went back to the full reports; I'd prefer to go
  back where I came from"). Every tile here links with `?from=<group id>`, and the page reads `?g=<group id>` on arrival and opens
  that group. AppShell turns the first into the second: a page opened from this menu gets a back link to /dashboard?g=… instead of
  its own parent, so back retraces the step you took rather than climbing the route tree. Winners is the case that exposed it — you
  reach it from this group in one hop, and its own parent is the reports index you never visited.
  THIS IS NOT THE REMEMBERING THE PARAGRAPH ABOVE RULES OUT. It's explicit and it's in the URL: it lasts exactly one journey, is
  visible, and is bookmarkable. Nothing is inferred about what you'd want NEXT time.

SEARCH STAYS THE FRONT DOOR and is NOT one of the five. The day starts by looking a product up, the product hub answers it, and that
path is already solved — so it sits above the groups, unboxed and hero-sized, and gets no heading of its own. THERE IS STILL NO
INVENTORY TILE at top level for the reason the 2026-08-27 note gave: the search box IS that tile on this screen. (Inventory does
appear inside "Look after the catalogue", where it is the browse-with-no-term case rather than the search.)

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
import AppShell from '@/components/AppShell';
import { useUrlParam } from '@/lib/useUrlParam';
import ModuleTile from '@/components/ModuleTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  CurrencyPoundIcon, ShoppingCartIcon, ChartBarIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
  CursorArrowRaysIcon, MapPinIcon, BanknotesIcon, TruckIcon, DocumentMagnifyingGlassIcon, BoltIcon, ArchiveBoxIcon,
  ChevronDownIcon, PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, ScaleIcon, SunIcon, TrophyIcon,
  ChartPieIcon, CalculatorIcon,
} from '@heroicons/react/24/outline';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Tile {
  title: string;
  subtitle: string;      // the four-or-five-word line under the title; owner's wording to edit
  description: string;   // the full sentence, shown on hover
  href: string;
  icon: Icon;
}

interface Group {
  id: string;
  title: string;         // finishes "I came here to..."
  blurb: string;         // one line under the heading, shown on the closed tile
  icon: Icon;
  tiles: Tile[];
}

/* =====================================================================================================================================
   THE MENU. All five groups and every tile, as data — a screen moves group, or gains a second home, by moving or copying one entry.
   ORDER IS THE OWNER'S, set against how often each mindset actually brings you here, not against any tidier scheme: the work you do
   today first, the numbers you read next, then prices, then the channels, then the catalogue you maintain rarely and deliberately.
   Don't sort these alphabetically or by build order.
===================================================================================================================================== */
const GROUPS: Group[] = [
  {
    id: 'work',
    title: 'Do today’s work',
    blurb: 'Orders, picks, deliveries — the jobs with a queue behind them',
    icon: BoltIcon,
    // The screens a day is actually SPENT on: something is waiting, and working the screen makes the queue shorter. That is the test
    // for this group — not "touched daily" (which was what killed the old DAILY band the moment it grew), but "has a backlog".
    tiles: [
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
      {
        title: 'Order Status',
        subtitle: 'Place and chase supplier orders',
        description: "Place supplier orders and chase what's on its way.",
        href: '/order-status',
        icon: ShoppingCartIcon,
      },
      {
        title: 'Goods In',
        subtitle: 'Book in a delivery',
        description: "Book in what's arrived from a supplier and put it on the shelf.",
        href: '/goods-in',
        icon: InboxArrowDownIcon,
      },
      {
        title: 'Amazon Order',
        subtitle: 'What to buy in, what to send',
        description: 'Work out what Amazon needs — what to buy in, and what to send from the local shelf.',
        href: '/amazon-order',
        icon: ClipboardDocumentListIcon,
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
    id: 'numbers',
    title: 'See how we’re doing',
    blurb: 'Go and read a number — sales, ads, stock, month end',
    icon: ChartBarIcon,
    /* THE REPORTS THEMSELVES, NOT A DOOR TO THEM (owner, 2026-09-22). This group first held a single "Reports" tile pointing at
       /analytics, which meant reading a number cost three clicks — open the group, open Reports, pick the report — and the middle
       one told you nothing you didn't already know when you opened a group called "see how we're doing". The reports index IS this
       group; having both was the same mistake the old bands made, a category standing in front of the thing.
       /analytics IS STILL LIVE and unchanged — deep links, bookmarks and the header tab all still land on it, and it remains the
       right page when you want the full descriptions rather than these four-word ones. It simply no longer has a tile here.
       ORDER IS THE REPORTS INDEX'S OWN, kept deliberately so the two screens don't disagree about which report comes first; Birk
       Tracker and Finance are appended because they belong to this mindset but have never lived on that index.
       SEGMENTS CAME OUT (owner, 2026-09-22): it was here as a "what needs attention next" read, but everything around it is now a
       genuine report and Segments is a worklist you act on. It keeps its home under Set prices, which is how it's actually entered.
       TWELVE TILES, three rows of four, and that is fine BECAUSE IT IS BEHIND A DRILL-DOWN — the old one-row-per-band rule existed
       when every band was open at once and the page was a wall. Only one group is ever open now, so depth here costs nothing. */
    tiles: [
      {
        title: 'Sales',
        subtitle: 'Recent sales and profit',
        description: 'Recent sales with profit on every line (returns netted in) — net profit for Today / 7 / 30 / 90 days, filter by channel, search a product, export to Excel.',
        href: '/analytics/sales',
        icon: BanknotesIcon,
      },
      {
        title: 'Birk Availability',
        subtitle: 'Core sizes complete',
        description: 'How many Birkenstock styles are core-size complete (38/39/40) in stock right now — the ad-push gauge.',
        href: '/analytics/birk-availability',
        icon: PresentationChartLineIcon,
      },
      {
        title: 'Stock Position',
        subtitle: 'What’s commercially alive',
        description: 'How many products are commercially alive right now (in stock or sold in 6 months) — Shopify styles and Amazon SKUs, tracked over time.',
        href: '/analytics/stock-position',
        icon: CubeIcon,
      },
      {
        title: 'New',
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
      {
        title: 'Bclog',
        subtitle: 'Who did what, and when',
        description: 'Who did what, and when — every Goods In, stock adjustment, order sync and import, from here and PowerBuilder. Search and filter by section or person.',
        href: '/analytics/activity-log',
        icon: DocumentMagnifyingGlassIcon,
      },
      {
        title: 'Winners',
        subtitle: 'Products pulling their weight',
        description: 'How many products are pulling their weight — the count, its share of the range, and whether it is growing or stalling.',
        href: '/analytics/winners',
        icon: TrophyIcon,
      },
      {
        title: 'Brands',
        subtitle: 'What each brand earned',
        description: 'What each brand earned — revenue, profit and margin over the last year or six months, against the window before it.',
        href: '/brands',
        icon: ChartPieIcon,
      },
      {
        title: 'Birk Tracker',
        subtitle: 'Season order, placed to landed',
        description: 'Track the Birkenstock order from placed to landed — requested, invoiced, arrived.',
        href: '/birk-tracker',
        icon: TruckIcon,
      },
      {
        title: 'Finance',
        subtitle: 'Close the month',
        description: 'Close the month: Amazon, Shopify, PayPal and the shop, out to the two QuickFile files.',
        href: '/finance',
        icon: CalculatorIcon,
      },
    ],
  },
  {
    id: 'price',
    title: 'Set prices',
    blurb: 'Move a price up or down, here or on Amazon',
    icon: CurrencyPoundIcon,
    // Kept small on purpose. Pricing is normally entered FROM Segments (owner) rather than from a tile, so this group is the direct
    // hit for when the style is already known — hence Segments repeated at the end as the way in that is actually used.
    tiles: [
      {
        title: 'Shopify Pricing',
        subtitle: 'Winners and losers, by style',
        description: 'Review demand and set Shopify prices, segment by segment.',
        href: '/pricing',
        icon: CurrencyPoundIcon,
      },
      {
        title: 'Amazon Pricing',
        subtitle: 'Same job, size by size',
        description: 'Review demand and set Amazon/FBA prices, segment by segment.',
        href: '/amz',
        icon: BuildingStorefrontIcon,
      },
      {
        title: 'Segments',
        subtitle: 'The usual way in',
        description: 'See which segment needs attention next, and track who worked what.',
        href: '/segments',
        icon: Squares2X2Icon,
      },
    ],
  },
  {
    id: 'channels',
    title: 'Feed the channels',
    blurb: 'Amazon, Google and Facebook — what goes out',
    icon: MegaphoneIcon,
    // Outward-facing, and mostly "kick it off and walk away". The common thread is that the work leaves the building: a Seller
    // Central file, a Shopping campaign, a scheduled post. Amazon Pricing repeats here because the upload file is built from its log.
    tiles: [
      {
        title: 'Update Amazon',
        subtitle: 'Load Seller Central reports',
        description: 'Load the Seller Central reports — sales, returns, FBA stock and fees.',
        href: '/update-amazon',
        icon: ArrowUpTrayIcon,
      },
      {
        title: 'Google Ads',
        subtitle: 'Shopping campaigns and spend',
        description: 'Sort products into Shopping campaigns — spend, profit after ad spend, and what each campaign is doing.',
        href: '/google-ads',
        icon: CursorArrowRaysIcon,
      },
      {
        title: 'Marketing',
        subtitle: 'The daily Facebook post',
        description: 'Queue and publish the daily Facebook post — graphic, caption, link, scheduled.',
        href: '/social',
        icon: MegaphoneIcon,
      },
      {
        title: 'Amazon Pricing',
        subtitle: 'Feeds the upload file',
        description: 'Review demand and set Amazon/FBA prices, segment by segment.',
        href: '/amz',
        icon: BuildingStorefrontIcon,
      },
    ],
  },
  {
    id: 'catalogue',
    title: 'Look after the catalogue',
    blurb: 'What we hold, what it says, what we buy next season',
    icon: TagIcon,
    // The product record itself, and the once-a-season buying that fills it. Rarest of the five, so last — but it is where Inventory
    // finally gets a tile, as the browse with no search term typed.
    tiles: [
      {
        title: 'Add / Modify Product',
        subtitle: 'Edit or create a product',
        description: 'Find an existing product to edit, or create a new one.',
        href: '/products',
        icon: TagIcon,
      },
      {
        title: 'Inventory',
        subtitle: 'Browse without searching',
        description: 'Browse and filter the whole catalogue when you have no term to search for.',
        href: '/inventory',
        icon: ArchiveBoxIcon,
      },
      {
        title: 'Birkenstock',
        subtitle: 'Next season’s order sheet',
        description: 'Sold in 365 days against what we hold, size by size — what to put on the next order.',
        href: '/birkenstock',
        icon: CalendarDaysIcon,
      },
      {
        title: 'Birk Tracker',
        subtitle: 'Where that order got to',
        description: 'Track the Birkenstock order from placed to landed — requested, invoiced, arrived.',
        href: '/birk-tracker',
        icon: TruckIcon,
      },
    ],
  },
];

export default function DashboardPage() {
  // Re-open the group you left from, when you came back through a back link carrying ?g=. Read from window.location rather than
  // useSearchParams on purpose: this is a static page, and useSearchParams would force the whole menu behind a Suspense boundary to
  // build — a real cost for something only the return journey uses. An unknown id just leaves the page closed.
  const g = useUrlParam('g');
  const urlGroup = g && GROUPS.some((x) => x.id === g) ? g : null;

  // The group the operator clicked open or shut. undefined = no click yet, so the ?g= group (or nothing) shows; null = every group
  // closed, which is how a bare /dashboard opens (see the header note on not remembering).
  const [chosenId, setOpenId] = useState<string | null | undefined>(undefined);
  const openId = chosenId === undefined ? urlGroup : chosenId;
  const open = GROUPS.find((g) => g.id === openId) ?? null;

  return (
    <AppShell>
      {/* The opener. No heading above it — a search box explains itself, and a "Modules" title here would push the one thing the
          operator came to use below the fold on a laptop. */}
      <div className="mb-7">
        <ProductSearchBox />
      </div>

      {/* THE FIVE HEADINGS. Five across at lg so the whole menu is one scan of five rather than seventeen; two across below that,
          where five columns would make each heading too narrow to read its blurb. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {GROUPS.map((g) => {
          const isOpen = g.id === openId;
          return (
            <button
              key={g.id}
              type="button"
              // Clicking the open group closes it — so the same click that opened it puts the page back, with no close affordance
              // to hunt for.
              onClick={() => setOpenId(isOpen ? null : g.id)}
              aria-expanded={isOpen}
              aria-controls="group-panel"
              className={
                'flex h-full flex-col rounded-xl border p-4 text-left transition ' +
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
              <h2 className="text-sm font-semibold leading-snug text-slate-900">{g.title}</h2>
              <p className="mt-1 text-xs leading-snug text-slate-500">{g.blurb}</p>
            </button>
          );
        })}
      </div>

      {/* THE PANEL — one, below the whole row rather than under the column that was clicked. Under the column it would be a narrow
          strip that moves left and right as you change your mind; full width it is the same shape every time, and the tiles get the
          four-wide grid the old bands used. The darker slate-200 fill is the old band panel, kept for the same reason: it encloses
          the tiles so nothing has to be inferred about what belongs to what. */}
      {open && (
        <section id="group-panel" className="mt-3 rounded-xl bg-slate-200 p-4 ring-1 ring-slate-300">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {open.tiles.map((t) => (
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
    </AppShell>
  );
}
