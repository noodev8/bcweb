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
       Pricing    Shopify due · AMAZON TO PRICE — the counts of the home lists' Due view (GET /pricing-all-list, /amz-all-list — in
                  stock OR on a Repricing status list, 0-stock included, so nothing Repricing calls Due is missed; owner 2026-10-28),
                  each a link to its list. No cross-channel total, as on Repricing. AMAZON (docs/amz-buybox/PLAN.md decision 27,
                  2026-11-13 — owner: "remove the 1 number rule now ... leave with due and a secondary number of BUY BOX MOVES so they
                  can address them when have time. But they will focus on due down to zero"): the big number is the sizes DUE by review
                  date (Buy Box sizes are never due — THE one rule, server utils/amzDue.js), opening the due list; under it a quieter
                  line, "Buy Box moves n", the Chilled cards, opening the Amazon Pricing home. (For a few hours on 2026-11-13 it was one
                  number, "Amazon to price" = cards + due; a queue that refills hourly made it feel like going round in circles.) The Buy Box and Fast
                  sellers tiles left the Pricing group the same day (the Buy Box screen became the Amazon Pricing home; Fast sellers
                  was retired).
       Ordering   Amazon Order (no count — its Hot / Warm / Simmer presets are the work list).
       Selling    ONE card, the two figures to keep AS HIGH AS POSSIBLE (owner, 2026-11-06: "25% as high as possible, and the longer
                  term 40% as high as possible. Do one, will help the other" — and "combine the cards so not too much highlights"):
                  New stuff — prospect performance: of the SKUs first booked in on Goods In in 90 days, the % sold since (any channel)
                  (owner, 2026-11-05) (GET /process-overview — the same rows New Additions lists) -> New Additions;
                  Range — of every size we hold, the % that sold in the last 90 days; new stock pulls it down until it sells (THE split,
                  lib/slowBands → splitHeldSizes, same request as Slow movers) -> the Slow movers front screen.
                  Selling a new SKU moves it into Range's sold part, so the first lifts the second. Range was tried as its own tile
                  beside New stuff first (the 2026-11-05 SKU HEALTH lesson: a whole-range figure can read as comparable — the shared card
                  and its heading say how they relate). Slow movers left the menu for it (no duplicates). CLEARANCE is NOT on Daily
                  (owner: "Clearance is a different thought") — it is the Slow movers front screen's last part.
       Prospects  finds on the list (same request as New stuff). Opens Prospects.
       AMZ loaded styles in stock with no size on Amazon, Birkenstock aside, still due a look (GET /amz-loaded-list, shared SWR
                  key with the screen). Opens /amz-loaded. Was a placeholder until the screen was built the same day.
     It replaced the /daily screen (that route now redirects here) and the Daily card that opened it — one home for the four.
  1b. SKU HEALTH strip — REMOVED 2026-11-05 (owner: "Take it off the dashboard"; "688 skus sold just sounds like a lot more" than New
     stuff's 25% — a whole-range count beside a new-arrivals % read as comparable). The screen stays on its Admin tile.
  2. SEARCH — the product lookup (components/ProductSearchBox). It sits ABOVE Daily, first on the page (owner, 2026-10-26).
  3. EVERYTHING ELSE — the menu, EVERY SCREEN ONCE (Sales is in Daily, so not here). Until 2026-10-26 screens were deliberately repeated across "mindset" groups
     and a second find-by-part row; the owner asked for no duplicates, so the two rows were merged into one set of groups, each
     screen filed where it is used, and anything in Daily taken out of the menu. Repricing's Status tab is the old "Winners" tile
     (both opened /segments), so that tile went. Each card opens in place, one at a time, with its contents named on the closed
     card. The Today card (/process, a map of the new-sizes funnel) was removed 2026-10-26 — Daily carries its numbers now.

COMING BACK. Every menu tile links with `?from=<group id>`; AppShell points the header logo at /dashboard?g=<group id>, and this page
re-opens that group on arrival (read from the URL, nothing remembered between visits).
=======================================================================================================================================
*/

import { useState, type ComponentType, type SVGProps } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import { useUrlParam } from '@/lib/useUrlParam';
import { useApiQuery } from '@/lib/useApiQuery';
import { SKU_HEALTH } from '@/lib/features';
import { getAmzImportLast, getAmzLoadedList, getBackupLast, getPricingDueCounts, getProcessOverview, getSalesReport, getShopifySellersList, getSlowSizes } from '@/lib/api';
import { splitHeldSizes } from '@/lib/slowBands';
import ModuleTile from '@/components/ModuleTile';
import UpdateShopifyTile from '@/components/UpdateShopifyTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  ShoppingCartIcon, TagIcon, Squares2X2Icon, SignalIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
  CursorArrowRaysIcon, MapPinIcon, TruckIcon, DocumentMagnifyingGlassIcon, ArchiveBoxIcon,
  ChevronDownIcon, ChevronRightIcon, PresentationChartLineIcon, CubeIcon, SparklesIcon, ArrowsRightLeftIcon, ScaleIcon, SunIcon,
  ChartPieIcon, CalculatorIcon, CloudArrowDownIcon, CalendarIcon, ShoppingBagIcon, BuildingStorefrontIcon, PrinterIcon, PhotoIcon,
  RectangleStackIcon, LightBulbIcon, Cog6ToothIcon, InboxStackIcon, GlobeAltIcon, MagnifyingGlassIcon,
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
  tiles: Tile[];
}

/* =====================================================================================================================================
   THE MENU — every screen ONCE (owner, 2026-10-26). Daily's screens (Shopify / Amazon Pricing, Amazon Order, New Additions,
   Prospects) are not in it. ORDER IS THE OWNER'S; don't sort.
===================================================================================================================================== */
const GROUPS: Group[] = [
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
      { title: 'Shopify vs Amazon', subtitle: 'Shopify never under Amazon', description: 'Every style live on Amazon — Shopify price against Amazon’s per-size spread.', href: '/pricing/vs-amazon', icon: ScaleIcon },
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
      // Deep sellers (2026-11-06) is NOT a tile: it opens from Range's green panel (owner), like Range's own lists — one door, no duplicates.
      // Slow movers LEFT THE MENU 2026-11-06 — it is on Daily now (the Range card), and a Daily screen is never repeated here.
      // eBay listings (2026-11-01) — read only for now: what's live on eBay, checked against our stock. Next to Slow movers: eBay is
      // where the clearance stock goes.
      { title: 'eBay listings', subtitle: "What's live on eBay", description: 'Every live eBay listing, read from eBay and checked against our stock and the postage rules.', href: '/ebay', icon: GlobeAltIcon },
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
      // SEO (2026-11-07): the tracker first (free sales, visits vs 30 a day), then its Birkenstock work list. READ ONLY.
      { title: 'SEO', subtitle: 'Sales we didn’t pay Google for', description: 'Free sales and visits against last year, then the Birkenstock work list.', href: '/seo', icon: MagnifyingGlassIcon },
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
      { title: 'Amazon status', subtitle: 'Read from Amazon automatically', description: 'Amazon sales, FBA stock, prices, returns and fees come in by themselves — check they are, and last night’s listings check.', href: '/update-amazon', icon: SignalIcon },
      { title: 'Finance', subtitle: 'Close the month', description: 'Close the month: Amazon, Shopify, PayPal and the shop, out to the two QuickFile files.', href: '/finance', icon: CalculatorIcon },
      { title: 'Facebook', subtitle: 'Social post', description: 'Queue and publish the daily Facebook post.', href: '/social', icon: MegaphoneIcon },
      // Hidden while SKU_HEALTH is false (lib/features.ts, owner 2026-11-05).
      ...(SKU_HEALTH ? [{ title: 'SKU health', subtitle: 'Sellers, stock and what has not sold', description: 'Three numbers: SKUs that sold in 90 days, SKUs in stock, and SKUs not sold in 12 months.', href: '/sku-health', icon: PresentationChartLineIcon }] : []),
      { title: 'Log', subtitle: 'Who did what, and when', description: 'Every Goods In, stock adjustment, order sync and import. Search and filter by section or person.', href: '/analytics/activity-log', icon: DocumentMagnifyingGlassIcon },
    ],
  },
];

export default function DashboardPage() {
  // Re-open the group you left from (?g=, see the header). An unknown id just leaves the menu closed.
  const g = useUrlParam('g');
  const urlGroup = g && GROUPS.some((x) => x.id === g) ? g : null;
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

      <AmzReadWarning />
      <AmzHistoryWarning />
      <BackupWarning />

      {/* Two rows of three; each row's panel opens directly under it. No heading (owner, 2026-11-01: remove "Everything else") —
          the first row keeps the gap below Daily that the heading used to give. */}
      {[0, 3].map((i) => (
        <div key={i} className={i === 0 ? 'mt-8' : 'mt-3'}>
          <GroupRow groups={GROUPS.slice(i, i + 3)} openId={openId} onToggle={setOpenId} />
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
  // The new SKUs New Additions lists (GET /process-overview) — the tile's figure is counted from the same rows.
  const overview = useApiQuery('process-overview', () => getProcessOverview());
  // PROSPECT PERFORMANCE (owner, 2026-11-05): of every SKU FIRST booked in on Goods In in the last 90 days, the % that has made a sale
  // (any channel, eBay included). Once sold it is ticked off — buying or selling more changes nothing; new stock landing pulls it down
  // on purpose ("tells me to slow down getting new stuff until the percentage is healthy"). Rules: bcweb-server/utils/processMap.js →
  // NEW_SKUS_SQL. New Additions lists the same SKUs (2026-11-05).
  const newSkus = overview.data ? overview.data.newSkus : null;
  const soldPct = newSkus ? `${newSkus.total > 0 ? Math.round((newSkus.sold / newSkus.total) * 100) : 0}%` : null;
  const prospects = overview.data ? overview.data.prospects : null;
  // RANGE (owner, 2026-11-06 — "worth a look?", A TRIAL): of every size we hold, the % that sold in the last 90 days — Slow movers'
  // Sold box, THE split (lib/slowBands → splitHeldSizes), the same request and key as that screen. Up only when sizes sell; new stock
  // pulls it down until it sells, the same signal New stuff gives. Opens the Slow movers front screen. NB the 2026-11-05 SKU HEALTH strip
  // was taken off for reading as comparable with New stuff — this tile is on trial for exactly that.
  const slow = useApiQuery('analytics-slow-sizes', () => getSlowSizes());
  const range = slow.data && overview.data ? splitHeldSizes(slow.data.sizes, overview.data.rows) : null;
  const rangePct = range ? `${range.held > 0 ? Math.round((range.counts.sold.sizes / range.held) * 100) : 0}%` : null;
  // Today's headline from the Sales screen's own route (all channels). limit 1: only the summary is read, not the lines.
  const sales = useApiQuery('dashboard-sales-today', () => getSalesReport({ window: 'today', limit: 1 }));
  const today = sales.data?.summary ?? null;
  // Shared with the AMZ loaded screen (same key) — its due count is the styles not looked at yet (or whose date has come round).
  const amzLoaded = useApiQuery('amz-loaded-list', () => getAmzLoadedList());
  const amzLoadedDue = amzLoaded.data ? amzLoaded.data.filter((r) => !r.parked).length : null;
  // Shared with Shopify Order's Sellers view (same key) — Missed is the server's rule, so the tile and the list can't disagree.
  const sellers = useApiQuery('shopify-sellers-list', () => getShopifySellersList());
  const shopifyMissed = sellers.data ? sellers.data.missed_count : null;

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
          <TileHead icon={Squares2X2Icon} title="Pricing" sub="Prices to look at" />
          <div className="mt-auto grid grid-cols-3 gap-2 pt-4">
            <CountLink href="/pricing" label="Shopify" n={due.data?.shopify ?? null} unit="due" />
            {/* AMAZON (decision 27, owner 2026-11-13): DUE (by review date, worked to zero) and BUY BOX MOVES (the Chilled cards)
                side by side; each says under it how many it worked today. BOTH open the Amazon Pricing home (owner, 2026-11-13: "same
                navigation as its neighbour") — Due's tile there opens the Due cards; the list is under Look up. */}
            <CountLink href="/amz" label="Amazon" n={due.data?.amazon ?? null} unit="due" done={due.data?.amazonDoneDue ?? null} />
            <CountLink href="/amz" label="Buy Box" n={due.data?.amazonMoves ?? null} unit="moves" done={due.data?.amazonDoneMoves ?? null} />
          </div>
        </div>

        {/* ORDERING — two screens, two links, like Pricing (owner, 2026-10-27: "will have to choose which one they want"). Amazon has
            no count; Shopify's is the Sellers view's Sold out (missed in code) — sold in 30 days with nothing local, on order or at FBA. */}
        <div className="flex flex-col rounded-xl bg-white p-4">
          <TileHead icon={ClipboardDocumentListIcon} title="Ordering" sub="What needs buying in or sending" />
          <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
            <Link
              href="/amazon-order"
              className="flex flex-col rounded-lg border border-slate-200 px-3 py-2 text-center outline-none transition hover:border-brand-500 hover:bg-brand-50 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-100"
            >
              <span className="block text-xs font-medium text-slate-500">Amazon</span>
              <span className="mt-auto block pt-1 text-sm font-medium text-brand-700">Open Amazon Order</span>
            </Link>
            <CountLink href="/shopify-order" label="Shopify" n={shopifyMissed} unit="sizes sold out" />
          </div>
        </div>

        {/* SELLING — the two figures to keep AS HIGH AS POSSIBLE, one card (owner, 2026-11-06: "25% as high as possible, and the
            longer term 40% as high as possible. Do one, will help the other"): New stuff — of the new SKUs (first in 90 days) the %
            sold -> New Additions; Range — of every size we hold the % sold in the last 90 days -> the Slow movers front screen. Selling
            a new SKU moves it into the Range's sold part, so pushing the first lifts the second. */}
        <div className="flex flex-col rounded-xl bg-white p-4">
          <TileHead icon={SparklesIcon} title="Selling" sub="Both as high as possible" />
          <div className="mt-auto grid grid-cols-2 gap-2 pt-4">
            <CountLink href="/analytics/new-additions" label="New stuff" n={soldPct} unit={newSkus ? `${newSkus.sold} of ${newSkus.total} new` : 'new SKUs'} />
            <CountLink href="/analytics/slow-sizes" label="Range" n={rangePct}
              unit={range ? `${range.counts.sold.sizes.toLocaleString('en-GB')} of ${range.held.toLocaleString('en-GB')} held` : 'held'} />
          </div>
        </div>

        {/* PROSPECTS and AMZ LOADED — one figure each, in the SAME inner box as the paired cards (owner, 2026-11-06: "align the 7 and 0
            … to match the other boxes"), so every number on Daily sits at one height and size. */}
        <div className="flex flex-col rounded-xl bg-white p-4">
          <TileHead icon={LightBulbIcon} title="Prospects" sub="New products to look into" />
          <div className="mt-auto grid grid-cols-1 gap-2 pt-4">
            <CountLink href="/prospects" label="On the list" n={prospects} unit="finds" />
          </div>
        </div>

        <div className="flex flex-col rounded-xl bg-white p-4">
          <TileHead icon={InboxStackIcon} title="AMZ loaded" sub="In stock, not on Amazon yet" />
          <div className="mt-auto grid grid-cols-1 gap-2 pt-4">
            <CountLink href="/amz-loaded" label="To look at" n={amzLoadedDue} unit="styles" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* =====================================================================================================================================
   AMAZON SIZE HISTORY WARNING — shown ONLY when the history has gone stale: more than 3 days with no FBA Inventory import (owner,
   2026-11-03: Update Amazon's status line + a dashboard warning, so it isn't forgotten). When all is well it renders nothing, so Daily
   doesn't get busier. Same read (and SWR key) as the Update Amazon screen's status line.
===================================================================================================================================== */
function AmzHistoryWarning() {
  const last = useApiQuery('amz-import-last', getAmzImportLast);
  const h = last.data?.history ?? null;
  // The red Amazon read warning below says it first (a stale history means a read has stopped) — never both.
  if (!h || !h.stale || (last.data?.amazonApi?.problems?.length ?? 0) > 0) return null;
  return (
    <Link
      href="/update-amazon"
      className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 outline-none transition hover:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-200"
    >
      <span className="font-semibold">No Amazon stock reading for {h.daysSince} days</span>
      <span className="text-amber-800">Last {h.lastDay}. The automatic Amazon stock read isn&apos;t running — see Update Amazon for the error. These days have no stock or price history.</span>
      <ChevronRightIcon className="ml-auto h-4 w-4 self-center text-amber-600" />
    </Link>
  );
}

/* =====================================================================================================================================
   AMAZON READ WARNING — red, shown ONLY when an automatic Amazon read needs attention (owner, 2026-11-09, with the uploads gone):
   its last attempt failed (stock / orders in Update orders, or a nightly report), or the nightly job hasn't run for 36 hours.
   Server-side rule (routes/amz-import-last.js → problems); same read and SWR key as the Amazon status screen it links to.
===================================================================================================================================== */
function AmzReadWarning() {
  const last = useApiQuery('amz-import-last', getAmzImportLast);
  const problems = last.data?.amazonApi?.problems ?? [];
  if (problems.length === 0) return null;
  return (
    <Link
      href="/update-amazon"
      className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-red-300 bg-red-50 px-4 py-2.5 text-sm text-red-900 outline-none transition hover:border-red-400 focus-visible:ring-2 focus-visible:ring-red-200"
    >
      <span className="font-semibold">Amazon data not coming in</span>
      <span className="text-red-800">{problems.join(' · ')}. See Amazon status for the error.</span>
      <ChevronRightIcon className="ml-auto h-4 w-4 self-center text-red-600" />
    </Link>
  );
}

/* =====================================================================================================================================
   DATABASE BACKUP WARNING — shown ONLY when the nightly backup needs attention (owner, 2026-11-08): the last run FAILED, no good backup
   for 2 days, or none has ever reported. The crontab has no MAILTO, so this is the only place a failed backup is seen (in 2026 backups
   silently stopped reaching Google Drive for 109 days). Red, not amber: without a backup a bad day can't be undone. It needs the VPS —
   the fix is never on this screen — so it links to the Activity log, where the 'Backup' rows say what went wrong.
===================================================================================================================================== */
function BackupWarning() {
  const q = useApiQuery('backup-last', getBackupLast);
  const b = q.data ?? null;
  if (!b || !b.stale) return null;
  const head = b.lastFailed ? 'Last night’s database backup FAILED'
    : b.lastOk ? `No database backup for ${b.daysSince} days` : 'No database backup has reported yet';
  const detail = b.lastFailed ? `${b.lastFailed.log}. ${b.lastOk ? `Last good backup ${b.lastOk}.` : ''}`
    : b.lastOk ? `Last good backup ${b.lastOk}. The backup runs at 1am — check it on the server.`
      : 'The backup reports here after each night’s run (1am). If this stays, check the backup on the server.';
  return (
    <Link
      href="/analytics/activity-log"
      className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl border border-rose-300 bg-rose-50 px-4 py-2.5 text-sm text-rose-900 outline-none transition hover:border-rose-400 focus-visible:ring-2 focus-visible:ring-rose-200"
    >
      <span className="font-semibold">{head}</span>
      <span className="text-rose-800">{detail}</span>
      <ChevronRightIcon className="ml-auto h-4 w-4 self-center text-rose-600" />
    </Link>
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

function gbp(v: number) {
  return `${v < 0 ? '-' : ''}£${Math.abs(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}


// One channel's count inside the Pricing tile — its own link.
// Every inner box on Daily is centred — label, figure, unit (owner, 2026-11-06: "center those inner values and text inside their box").
// done (Amazon only, owner 2026-11-13 — "so she knows she's done some Buy Box today too"): sizes worked today, a line under the unit —
// green "✓ n" once something is done today (hover: "n done today"), a grey "✓ 0" before — no word, the boxes are narrow; so the two Amazon boxes stay the same height.
function CountLink({ href, label, n, unit, done }: { href: string; label: string; n: number | string | null; unit: string; done?: number | null }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-200 px-3 py-2 text-center outline-none transition hover:border-brand-500 hover:bg-brand-50 focus-visible:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-100"
    >
      <span className="block text-xs font-medium text-slate-500">{label}</span>
      <span className="block text-3xl font-semibold tabular-nums leading-tight text-slate-900">{n === null ? '–' : n}</span>
      <span className="block text-xs text-slate-500">{unit}</span>
      {done !== undefined && (done
        ? <span className="block text-xs font-medium text-emerald-700" title={`${done} done today`}>✓ {done}</span>
        : <span className="block text-xs text-slate-400" title="None done today yet">✓ 0</span>)}
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {groups.map((g) => {
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
                href={t.href + (t.href.includes('?') ? '&' : '?') + 'from=' + open.id}
                icon={t.icon}
                live
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}
