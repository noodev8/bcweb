'use client';
/*
=======================================================================================================================================
Page: /dashboard
=======================================================================================================================================
Purpose: The platform's front page. Guarded by AppShell.

DAILY IS THE MAIN THING (owner, 2026-10-26: "i want daily to be the main thing so its clear what to work on ... i dont want
duplicates"). The page reads top to bottom in order of importance:

  1. DAILY — the day's jobs, the one bold block on the page (a deep brand band). SIZED BY WEIGHT (owner, 2026-10-26: "sales can be
     smaller"): the five jobs are equal tiles in one row; Sales is a compact figure in the band's header bar. Each says how much is waiting, so it is clear where to start:
       Sales      today's profit and units, all channels (GET /analytics-sales?window=today — the Sales screen's own headline).
                  Moved here from the menu (owner, 2026-10-26: "add sales to daily").
       Pricing    Shopify due · Amazon due — the counts of the in-stock lists' Due view (GET /pricing-all-list, /amz-all-list),
                  each a link to its list (/pricing, /amz). No cross-channel total, as on Repricing.
       Ordering   Amazon Order (no count — its Hot / Warm / Simmer presets are the work list).
       New stuff  new SIZES not sold anywhere yet, of the styles added in 90 days — the Today screen's Unsold, from the same data
                  (GET /process-overview, shared SWR key). Opens New Additions.
       Prospects  finds on the list (same request). Opens Prospects.
       AMZ loaded styles in stock with no size on Amazon, Birkenstock aside, still due a look (GET /amz-loaded-list, shared SWR
                  key with the screen). Opens /amz-loaded. Was a placeholder until the screen was built the same day.
     It replaced the /daily screen (that route now redirects here) and the Daily card that opened it — one home for the four.
  2. SEARCH — the product lookup (components/ProductSearchBox). It sits ABOVE Daily, first on the page (owner, 2026-10-26).
  3. EVERYTHING ELSE — the menu, EVERY SCREEN ONCE (Sales is in Daily, so not here). Until 2026-10-26 screens were deliberately repeated across "mindset" groups
     and a second find-by-part row; the owner asked for no duplicates, so the two rows were merged into one set of groups, each
     screen filed where it is used, and anything in Daily taken out of the menu. Repricing's Status tab is the old "Winners" tile
     (both opened /segments), so that tile went. A card that is a single screen (Today) links straight there; the rest open
     in place, one at a time, with their contents named on the closed card.

COMING BACK. Every menu tile links with `?from=<group id>`; AppShell points the header logo at /dashboard?g=<group id>, and this page
re-opens that group on arrival (read from the URL, nothing remembered between visits).
=======================================================================================================================================
*/

import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useUrlParam } from '@/lib/useUrlParam';
import { useApiQuery } from '@/lib/useApiQuery';
import { getAmzLoadedList, getPricingDueCounts, getProcessOverview, getSalesReport } from '@/lib/api';
import { isSold } from '@/lib/process';
import ModuleTile from '@/components/ModuleTile';
import UpdateShopifyTile from '@/components/UpdateShopifyTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  ShoppingCartIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
  CursorArrowRaysIcon, MapPinIcon, TruckIcon, DocumentMagnifyingGlassIcon, ArchiveBoxIcon,
  ChevronDownIcon, ChevronRightIcon, PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, ScaleIcon, SunIcon,
  ChartPieIcon, CalculatorIcon, CloudArrowDownIcon, CalendarIcon, ShoppingBagIcon, BuildingStorefrontIcon, PrinterIcon, PhotoIcon,
  RectangleStackIcon, ClockIcon, AdjustmentsHorizontalIcon, LightBulbIcon, BoltIcon, Cog6ToothIcon, InboxStackIcon,
} from '@heroicons/react/24/outline';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Tile {
  title: string;
  subtitle: string;      // the short line under the title; owner's wording to edit
  description: string;   // the full sentence — the tile's reference wording (not shown on the dashboard)
  href: string;          // ignored when `action` is set
  icon: Icon;
  // A card that DOES something instead of opening a screen — Update Shopify (components/UpdateShopifyTile.tsx).
  action?: 'update-shopify';
}

interface Group {
  id: string;            // also the ?from= / ?g= id — keep stable ('ops', 'reports' are linked from other screens)
  title: string;
  blurb: string;         // one line under the heading
  icon: Icon;
  link?: string;         // a card that IS a screen: clicking goes straight there; `tiles` stays empty
  tiles: Tile[];
}

/* =====================================================================================================================================
   THE MENU — every screen ONCE (owner, 2026-10-26). Daily's screens (Shopify / Amazon Pricing, Amazon Order, New Additions,
   Prospects) are not in it. ORDER IS THE OWNER'S; don't sort.
===================================================================================================================================== */
const GROUPS: Group[] = [
  {
    // TODAY (owner, 2026-10-26): the map of the business in blocks — /process (the route kept its first name).
    id: 'today', title: 'Today', blurb: 'New lines, unsold, winners and losers', icon: SunIcon, link: '/process', tiles: [],
  },
  {
    id: 'ops',
    title: 'Operations',
    blurb: 'Stock in, orders out, buying',
    icon: TruckIcon,
    tiles: [
      { title: 'Goods In', subtitle: 'Book in a delivery', description: "Book in what's arrived from a supplier and put it on the shelf.", href: '/goods-in', icon: InboxArrowDownIcon },
      { title: 'Customer Orders', subtitle: 'Fulfil what customers bought', description: "Fulfil what customers have bought — what's picked, what's short, what's waiting.", href: '/customer-orders', icon: UserGroupIcon },
      { title: 'Pick', subtitle: 'What to take off the shelf', description: 'What has to come off a shelf — customer picks, and stock to gather for Amazon.', href: '/pick', icon: HandRaisedIcon },
      { title: 'AMZ Shipment', subtitle: 'Pack the Amazon boxes', description: 'Pack what has been gathered on C3-Amazon into boxes for the next FBA shipment.', href: '/amz-shipment', icon: CubeIcon },
      { title: 'Shop Sale', subtitle: 'Record a sale in the shop', description: 'Record anything sold in the shop (CM3) — a product, in stock or not, or a misc item.', href: '/shop-sale', icon: BuildingStorefrontIcon },
      { title: 'Shopify Order', subtitle: 'What to buy in for the shelf', description: 'Read each style’s size curve — shelf stock, on order, Shopify sales — and order the sizes the shelf needs.', href: '/shopify-order', icon: ShoppingBagIcon },
      // Renamed from "Order Status" on the menu (owner, 2026-09-24) — beside Customer Orders, it has to say WHOSE order.
      { title: 'Supplier Orders', subtitle: 'What’s placed, what’s coming', description: "Place supplier orders and chase what's on its way.", href: '/order-status', icon: ShoppingCartIcon },
    ],
  },
  {
    id: 'pricing',
    title: 'Pricing',
    blurb: 'Groups, rules and price checks',
    icon: TagIcon,
    tiles: [
      { title: 'Repricing', subtitle: 'Status, segment and campaign lists', description: 'Winners, steady, new and losers per channel, and the segment and campaign lists.', href: '/segments', icon: Squares2X2Icon },
      { title: 'Pricing Slider', subtitle: 'Step prices down', description: 'Groups whose price steps down by a % of RRP every few days until each product sells, then holds.', href: '/slider', icon: AdjustmentsHorizontalIcon },
      { title: 'Shopify vs Amazon', subtitle: 'Shopify never under Amazon', description: 'Every style live on Amazon — Shopify price against Amazon’s per-size spread.', href: '/pricing/vs-amazon', icon: ScaleIcon },
      { title: 'Fast sellers', subtitle: 'Amazon sizes selling fast', description: 'Every Amazon size sold in 30 days, fastest first — room to push the price up.', href: '/amz/fast', icon: BoltIcon },
      { title: 'Collections', subtitle: 'Shopify collection tags', description: 'Put styles in Shopify collections, or take them out — up to 3 per style.', href: '/collections', icon: RectangleStackIcon },
      { title: 'Price Changes', subtitle: 'Recent moves, and what shifted', description: 'The latest price moves across Shopify & Amazon — before → after, who & when, and units sold since.', href: '/analytics/price-changes', icon: ArrowsRightLeftIcon },
    ],
  },
  {
    id: 'products',
    title: 'Products & stock',
    blurb: 'The range, where it sits, how it moves',
    icon: ArchiveBoxIcon,
    tiles: [
      { title: 'Inventory', subtitle: 'Browse without searching', description: 'Browse and filter the whole catalogue when you have no term to search for.', href: '/inventory', icon: ArchiveBoxIcon },
      { title: 'Location', subtitle: "What's on a rack", description: "Work from the shelf, not the product — what's on a rack, and moving stock on and off it.", href: '/locations', icon: MapPinIcon },
      { title: 'Add / Modify', subtitle: 'Edit or create a product', description: 'Find an existing product to edit, or create a new one.', href: '/products', icon: TagIcon },
      { title: 'Missing Images', subtitle: 'Products with one image', description: 'Every Shopify product with a single image, Winners and in-stock first.', href: '/images-missing', icon: PhotoIcon },
      { title: 'Stock Position', subtitle: 'Are we selling what we buy?', description: 'Stock in and out, 90-day stock against a year ago, stock held against stock sold.', href: '/analytics/stock-position', icon: ScaleIcon },
      { title: 'Slow Sizes', subtitle: "Sizes that haven't sold", description: 'Every size held, by how long since it last sold.', href: '/analytics/slow-sizes', icon: ClockIcon },
      { title: 'Seasons', subtitle: 'Summer, winter or all year', description: 'Each style’s year of sales against its season — re-season in bulk.', href: '/seasons', icon: CalendarIcon },
      { title: 'Brands', subtitle: 'What each brand earned', description: 'Revenue, profit and margin per brand over the last year or six months.', href: '/brands', icon: ChartPieIcon },
      { title: 'Shop Labels', subtitle: 'Print shop price labels', description: 'Pick styles and print their price labels for the shop.', href: '/shop-labels', icon: PrinterIcon },
    ],
  },
  {
    id: 'birk',
    title: 'Birkenstock',
    blurb: 'Order it, track it, keep sizes in',
    icon: CalendarDaysIcon,
    tiles: [
      { title: 'Birk Order Book', subtitle: 'Next season’s order sheet', description: 'Sold in 365 days against what we hold, size by size.', href: '/birkenstock', icon: CalendarDaysIcon },
      { title: 'Birk Tracker', subtitle: 'Placed to delivered', description: 'Track the Birkenstock order from placed to landed.', href: '/birk-tracker', icon: TruckIcon },
      { title: 'Birk Availability', subtitle: 'Size range', description: 'How many Birkenstock styles are core-size complete in stock right now.', href: '/analytics/birk-availability', icon: PresentationChartLineIcon },
    ],
  },
  {
    id: 'google',
    title: 'Google',
    blurb: 'Campaigns, and what the spend earns',
    icon: CursorArrowRaysIcon,
    tiles: [
      { title: 'Google Ads', subtitle: 'Shopping campaigns and spend', description: 'Sort products into Shopping campaigns — spend, profit after ad spend.', href: '/google-ads', icon: CursorArrowRaysIcon },
      { title: 'Ad Efficiency', subtitle: 'What survives Google spend', description: "How much of each month's Shopify profit survived Google ad spend.", href: '/analytics/ad-efficiency', icon: ScaleIcon },
      { title: 'Ad Daily', subtitle: 'Spend vs sales, day by day', description: 'Google spend against Shopify sales, day by day over a fortnight.', href: '/analytics/ad-daily', icon: SunIcon },
    ],
  },
  {
    // id stays 'reports' (it was Back Office's id) so existing ?from=reports / ?g=reports links still open a group.
    id: 'reports',
    title: 'Admin',
    blurb: 'Data updates, month end, the daily post',
    icon: Cog6ToothIcon,
    tiles: [
      { title: 'Update Shopify', subtitle: 'Pull in new orders now', description: 'Run the Shopify order update now rather than waiting for the scheduled run.', href: '/customer-orders', icon: CloudArrowDownIcon, action: 'update-shopify' },
      { title: 'Update Amazon', subtitle: 'Load Seller Central reports', description: 'Load the Seller Central reports — sales, returns, FBA stock and fees.', href: '/update-amazon', icon: ArrowUpTrayIcon },
      { title: 'Finance', subtitle: 'Close the month', description: 'Close the month: Amazon, Shopify, PayPal and the shop, out to the two QuickFile files.', href: '/finance', icon: CalculatorIcon },
      { title: 'Facebook', subtitle: 'Social post', description: 'Queue and publish the daily Facebook post.', href: '/social', icon: MegaphoneIcon },
      { title: 'Log', subtitle: 'Who did what, and when', description: 'Every Goods In, stock adjustment, order sync and import. Search and filter by section or person.', href: '/analytics/activity-log', icon: DocumentMagnifyingGlassIcon },
    ],
  },
];

export default function DashboardPage() {
  // Re-open the group you left from (?g=, see the header). An unknown id just leaves the menu closed.
  const g = useUrlParam('g');
  const urlGroup = g && GROUPS.some((x) => x.id === g && !x.link) ? g : null;
  // undefined = no click yet, so the ?g= group (or nothing) shows; null = every group closed.
  const [chosenId, setOpenId] = useState<string | null | undefined>(undefined);
  const openId = chosenId === undefined ? urlGroup : chosenId;

  return (
    <AppShell>
      {/* Search first, then Daily (owner, 2026-10-26: "put the search bar above daily"). */}
      <div className="mb-6">
        <ProductSearchBox />
      </div>

      <Daily />

      <h2 className="mb-3 mt-8 text-sm font-semibold text-slate-500">Everything else</h2>
      {/* Two rows of four; each row's panel opens directly under it. */}
      {[0, 4].map((i) => (
        <div key={i} className={i === 0 ? '' : 'mt-3'}>
          <GroupRow groups={GROUPS.slice(i, i + 4)} openId={openId} onToggle={setOpenId} />
        </div>
      ))}
    </AppShell>
  );
}

/* =====================================================================================================================================
   DAILY — the hero. A deep brand band: Sales as a compact figure in its header bar, then the five jobs as equal white tiles, each with how much is waiting. Counts load on their own
   (the menu never waits for them); a count that fails shows a dash, never an error over the page.
===================================================================================================================================== */
function Daily() {
  const due = useApiQuery('dashboard-pricing-due', () => getPricingDueCounts());
  // Shared with the Today screen (same key), so whichever opens first fills the other's cache.
  const overview = useApiQuery('process-overview', () => getProcessOverview());
  const unsold = overview.data ? overview.data.rows.filter((r) => !isSold(r)).length : null;
  const newStyles = overview.data ? overview.data.styles : null;
  const prospects = overview.data ? overview.data.prospects : null;
  // Today's headline from the Sales screen's own route (all channels). limit 1: only the summary is read, not the lines.
  const sales = useApiQuery('dashboard-sales-today', () => getSalesReport({ window: 'today', limit: 1 }));
  const today = sales.data?.summary ?? null;
  // Shared with the AMZ loaded screen (same key) — its due count is the styles not looked at yet (or whose date has come round).
  const amzLoaded = useApiQuery('amz-loaded-list', () => getAmzLoadedList());
  const amzLoadedDue = amzLoaded.data ? amzLoaded.data.filter((r) => !r.parked).length : null;

  return (
    <section aria-labelledby="daily-heading" className="rounded-2xl bg-brand-700 p-5 shadow-lg sm:p-6">
      {/* Header bar: the title, and SALES as a compact figure — a glance, not a job (owner, 2026-10-26: "sales can be smaller"). */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex items-baseline gap-4">
          <h1 id="daily-heading" className="text-2xl font-semibold tracking-tight text-white">Daily</h1>
          <p className="text-sm text-brand-100">The numbers are what&apos;s waiting.</p>
        </div>
        <Link
          href="/analytics/sales"
          className="inline-flex items-baseline gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm text-brand-100 outline-none ring-1 ring-white/20 transition hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
        >
          <span className="font-medium text-white">Sales today</span>
          <span className="text-lg font-semibold tabular-nums text-white">{today ? gbp(today.profit) : '–'}</span>
          <span>profit{today ? ` · ${today.unitsNet} units` : ''}</span>
          <ChevronRightIcon className="h-4 w-4 self-center text-white/60" />
        </Link>
      </div>

      {/* THE JOBS — five equal tiles. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {/* PRICING — two lists, two counts, two links (no cross-channel total). */}
        <div className="flex flex-col rounded-xl bg-white p-4">
          <TileHead icon={Squares2X2Icon} title="Pricing" sub="Prices due a review" />
          <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
            <CountLink href="/pricing" label="Shopify" n={due.data?.shopify ?? null} unit="styles due" />
            <CountLink href="/amz" label="Amazon" n={due.data?.amazon ?? null} unit="sizes due" />
          </div>
        </div>

        <DailyLink href="/amazon-order" icon={ClipboardDocumentListIcon} title="Ordering" sub="What Amazon needs — buy in or send">
          <span className="text-sm font-medium text-brand-700">Open Amazon Order</span>
        </DailyLink>

        <DailyLink href="/analytics/new-additions" icon={SparklesIcon} title="New stuff" sub={newStyles === null ? 'Styles added in 90 days' : `${newStyles} styles added in 90 days`}>
          <Big n={unsold} unit="new sizes not sold yet" />
        </DailyLink>

        <DailyLink href="/prospects" icon={LightBulbIcon} title="Prospects" sub="New products to look into">
          <Big n={prospects} unit="on the list" />
        </DailyLink>

        <DailyLink href="/amz-loaded" icon={InboxStackIcon} title="AMZ loaded" sub="In stock, not on Amazon yet">
          <Big n={amzLoadedDue} unit="styles to look at" />
        </DailyLink>
      </div>
    </section>
  );
}

function TileHead({ icon: I, title, sub }: { icon: Icon; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        <I className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <h2 className="text-base font-semibold leading-snug text-slate-900">{title}</h2>
        <p className="text-xs leading-snug text-slate-500">{sub}</p>
      </div>
    </div>
  );
}

// A whole-tile link (Ordering, New stuff, Prospects).
function DailyLink({ href, icon, title, sub, children }: { href: string; icon: Icon; title: string; sub: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="flex flex-col rounded-xl bg-white p-4 outline-none ring-brand-100 transition hover:ring-4 focus-visible:ring-4"
    >
      <TileHead icon={icon} title={title} sub={sub} />
      <div className="mt-auto pt-4">{children}</div>
    </Link>
  );
}

function gbp(v: number) {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// The big figure on a tile. null = still loading or failed — a dash, never a 0 that isn't true.
function Big({ n, unit }: { n: number | string | null; unit: string }) {
  return (
    <div>
      <span className="text-4xl font-semibold tabular-nums leading-none text-slate-900">{n === null ? '–' : n}</span>
      <span className="ml-2 text-sm text-slate-500">{unit}</span>
    </div>
  );
}

// One channel's count inside the Pricing tile — its own link.
function CountLink({ href, label, n, unit }: { href: string; label: string; n: number | null; unit: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 px-3 py-2 outline-none transition hover:border-brand-500 hover:bg-brand-50 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-100"
    >
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <span className="block text-3xl font-semibold tabular-nums leading-tight text-slate-900">{n === null ? '–' : n}</span>
      <span className="block text-xs text-slate-500">{unit}</span>
    </Link>
  );
}

// A row of menu cards with its expand-in-place panel below. Group cards name their contents, so you can see where a screen lives
// without opening anything.
function GroupRow({ groups, openId, onToggle }: { groups: Group[]; openId: string | null; onToggle: (id: string | null) => void }) {
  const open = groups.find((g) => g.id === openId) ?? null;
  const card = 'flex h-full flex-col rounded-xl border bg-white p-4 text-left transition ';
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => {
          if (g.link) {
            return (
              <Link key={g.id} href={g.link + '?from=' + g.id} className={card + 'border-slate-200 shadow-sm hover:border-brand-500 hover:shadow-md'}>
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                    <g.icon className="h-4 w-4" />
                  </span>
                  <h3 className="text-sm font-semibold leading-snug text-slate-900">{g.title}</h3>
                  <ChevronRightIcon className="ml-auto h-4 w-4 text-slate-400" />
                </div>
                <p className="mt-2 text-xs leading-snug text-slate-500">{g.blurb}</p>
              </Link>
            );
          }
          const isOpen = g.id === openId;
          return (
            <button
              key={g.id}
              type="button"
              // Clicking the open group closes it — the same click puts the page back.
              onClick={() => onToggle(isOpen ? null : g.id)}
              aria-expanded={isOpen}
              aria-controls={'group-panel-' + g.id}
              className={card + (isOpen ? 'border-brand-500 shadow-md ring-1 ring-brand-500' : 'border-slate-200 shadow-sm hover:border-brand-500 hover:shadow-md')}
            >
              <div className="flex items-center gap-3">
                <span className={'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ' + (isOpen ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-600')}>
                  <g.icon className="h-4 w-4" />
                </span>
                <h3 className="text-sm font-semibold leading-snug text-slate-900">{g.title}</h3>
                <ChevronDownIcon className={'ml-auto h-4 w-4 text-slate-400 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </div>
              <p className="mt-2 text-xs leading-snug text-slate-500">{g.blurb}</p>
              <p className="mt-2 text-xs leading-relaxed text-slate-400">{g.tiles.map((t) => t.title).join(', ')}</p>
            </button>
          );
        })}
      </div>

      {/* THE PANEL — one, full width below the row. */}
      {open && (
        <section id={'group-panel-' + open.id} className="mt-3 rounded-xl bg-slate-200 p-4 ring-1 ring-slate-300">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {open.tiles.map((t) => t.action === 'update-shopify' ? (
              <UpdateShopifyTile key={open.id + t.title} title={t.title} subtitle={t.subtitle} />
            ) : (
              // `?from=` is the return ticket AppShell reads (see the header).
              <ModuleTile
                key={open.id + t.href}
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
