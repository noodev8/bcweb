'use client';
/*
=======================================================================================================================================
Page: /dashboard
=======================================================================================================================================
Purpose: The platform module menu (CLAUDE.md). Guarded by AppShell.

REBUILT 2026-08-27 (owner) around how the day actually runs, replacing a flat grid of twelve equal tiles in roughly build order.
Three things were wrong with that grid and each is fixed here:

  1. SEARCH IS THE FRONT DOOR. The day starts by looking a product up, and Inventory — the screen that answers it — sat seventh.
     Worse, searching cost two moves before a single character was typed. So the page now OPENS on a search box that hands its term
     straight to Inventory (see ProductSearchBox).

     THERE IS NO INVENTORY CARD (owner, 2026-08-27), and the reason matters, because the obvious one is wrong. It is NOT "it's in
     the header bar" — Segments, Customer Orders and Reports are in the header too, and deleting every card that has a tab would gut
     this page and leave it no longer a map of the platform. It is that the search box IS the Inventory tile on this screen: hero
     sized, four inches above where the card sat, same route. Inventory is the only module duplicated on the SAME screen, which is
     the line. The card's one unique job was the browse with no term typed, and the header tab does that in one click from anywhere.

  2. TILES ARE BANDED, NOT RANKED. Twelve peers in one grid make the operator re-read the whole thing to find one screen. Four small
     labelled bands are scannable by heading alone. DAILY is only the screens a day is STARTED on — the moment it grew to include
     everything touched daily it stopped meaning anything. A short band is a part-row of the same four tracks
     everything else uses, not a resized one — see the `Band` note on why the two short bands no longer share a row.

  3. PRICING SITS LAST. Shopify/Amazon Pricing are normally entered FROM Segments, not from here (owner) — they led the old grid on
     build order alone. They keep tiles, for when you already know what you're repricing, but they're the bottom band: the tile you
     reach for least often should not be the one nearest your eye.

  BAND ORDER and the order WITHIN each band are the owner's, set against how the day runs, not against any tidier scheme — so don't
  "fix" them into alphabetical or build order. Daily -> Stock & products -> Reports & marketing -> Pricing; and within Stock &
  products, Order Status -> Amazon Order -> Goods In -> Add / Modify (Update Amazon left that band on 2026-09-03, and Pick left it
  for DAILY).

  Pick joined DAILY and Goods In joined STOCK & PRODUCTS on 2026-09-03 (owner); the reasons are on the two tiles.

  Also: Analytics/Brands/Amazon Order were three separate doors onto "read a number". Analytics and Brands are now one Reports tile
  (owner) — see /analytics, which absorbed Brands as a view. Amazon Order came back out to STOCK & PRODUCTS on 2026-09-03 once it
  stopped being a report and became a screen you work, and Update Amazon crossed the other way into REPORTS & MARKETING on the same
  day; see both tiles below.

DENSITY, second pass (owner, 2026-08-27 — "too much of nothing"). The first cut of this page used the full ModuleTile card: a big
icon, a title and a two-line description, about 200px per tile. Nine of those plus four band headings made the page TALLER than the
flat twelve-tile grid it replaced, and a band of two tiles in a three-wide grid left a hole the size of a tile. Two changes fix it:
  - COMPACT tiles (icon + title on one line, description moved to the hover tooltip). This is a menu crossed by someone who knows it
    by heart, not a shelf of things being explained — the paragraphs were read past every single time.
  - FOUR columns at lg instead of three, so the bands read as deliberate part-rows rather than gaps. (STOCK & PRODUCTS filled a row
    of four exactly until the Inventory card came out; three of four still reads as a row.) The 2026-09-03 swap — Amazon Order in,
    Update Amazon out to REPORTS & MARKETING — keeps it at four.
Together the whole menu lands in about the height DAILY and STOCK & PRODUCTS used to take on their own.

KEEP EVERY BAND ONE ROW OF TILES. That is the rule the 2026-09-03 tidy-up came down to (owner: the page was "looking a bit odd with
all the different heights"), and with a four-wide grid it means a band of at most four. All four are currently 3 / 3 / 4 / 2. A fifth
tile in any band wraps it, and a wrapped band is the thing that looked wrong — so a fifth tile is a prompt to move something out or
split the band, not something to absorb.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  CurrencyPoundIcon, ShoppingCartIcon, ChartBarIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon, HandRaisedIcon, ClipboardDocumentListIcon, InboxArrowDownIcon, CalendarDaysIcon,
} from '@heroicons/react/24/outline';

// One band of the menu. Kept as data so the headings stay visually identical and a tile moves band by moving one line.
//
// EVERY BAND IS FULL WIDTH (owner, 2026-09-03 — "looking a bit odd with all the different heights"). DAILY and REPORTS & MARKETING
// used to share the top row as two `half` panels, and the 2026-09-03 tile moves broke that arrangement in three ways at once, all of
// them visible: a half panel is only two tracks wide, so REPORTS & MARKETING at three tiles wrapped and left one tile alone on a
// second row; the panels were stretched to a common height (`h-full`), so DAILY at one row of tiles grew a band of dead grey to match
// its taller neighbour; and a half panel spends the same two lots of horizontal padding across two tiles that a full one spends
// across four, so its tiles came out ~8px narrower and every column below sat slightly out of line.
// Unpairing settles all three and costs almost nothing in height: the paired row was already two tile-rows tall, so splitting it
// gives one row each and the page grows by a heading and a panel's padding, not by a row of tiles. Every tile on the page is now one
// width on one set of four tracks, and a band is exactly as tall as the tiles in it.
//
// THE PANEL (owner, 2026-08-27). The last tile of STOCK & PRODUCTS sat in the third track with nothing to its right, directly under
// Reports, and at a glance read as part of REPORTS & MARKETING — the grey heading alone was too quiet to stop the eye running a column
// down through it. (The tile that exposed it was Update Amazon, which has since moved into that band for real — but the panels are
// what stop ANY part-row band bleeding into the one above, so they stay.)
// A hairline rule above each band was tried first and was too faint against a slate-100 page to register at all. So each band now sits
// in its own soft panel: a container that encloses its tiles leaves nothing to infer.
// The page background is slate-100 and the tiles are white, so the panel goes DARKER (slate-200) rather than lighter — going lighter
// would put the panel between the two and flatten both edges at once. It started at slate-200/60 and that was barely a step off the
// page; solid slate-200 plus a slate-300 ring gives the panel an actual edge as well as a fill, so it reads as a container rather than
// a smudge.
// ALIGNMENT is now free: one padding, one grid, one tile width. That was the "structural fix" the 2026-08-27 note here reserved for
// if the half-panel stagger ever had to go — it did, so this is it. The two things NOT to undo: the panels stay (see above), and the
// grid stays four-wide, so a short band reads as a deliberate part-row of a known width rather than as a gap.
const BAND_PANEL = 'rounded-xl bg-slate-200 p-4 ring-1 ring-slate-300';

function Band({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className={BAND_PANEL + ' mb-6'}>
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{children}</div>
    </section>
  );
}

export default function DashboardPage() {
  return (
    <AppShell>
      {/* The opener. No heading above it — a search box explains itself, and a "Modules" title here would push the one thing the
          operator came to use below the fold on a laptop. */}
      <div className="mb-7">
        <ProductSearchBox />
      </div>

      {/* DAILY — where a day is STARTED. Three tiles, and three is the cap this band can take without a fourth pushing it to a
          second row; see the header note on keeping every band to one row. */}
      <Band title="Daily">
        {/* Segments is the "what needs attention next" heatmap, and the way into both pricing screens. */}
        <ModuleTile
          title="Segments"
          description="See which segment needs attention next, and track who worked what."
          href="/segments"
          icon={Squares2X2Icon}
          live
          compact
        />

        {/* Customer Orders — FULFILMENT (ordertype=1), worked every day against a long grid. */}
        <ModuleTile
          title="Customer Orders"
          description="Fulfil what customers have bought — what's picked, what's short, what's waiting."
          href="/customer-orders"
          icon={UserGroupIcon}
          live
          compact
        />

        {/* Pick — the physical shelf: what has to come off it, for a customer order or for the next FBA shipment. MOVED HERE from
            STOCK & PRODUCTS (owner, 2026-09-03). The 2026-08-30 call kept it out of DAILY because picking mostly happens on the
            mobile app and this screen was where you came when a pick needed a second look; in practice it is opened at the start of
            the day like the other two, alongside the customer orders it picks against, so it now sits with them. Third, after
            Customer Orders: the pick is what those orders turn into. */}
        <ModuleTile
          title="Pick"
          description="What has to come off a shelf — customer picks, and stock to gather for Amazon."
          href="/pick"
          icon={HandRaisedIcon}
          live
          compact
        />
      </Band>

      {/* REPORTS & MARKETING — the read-a-number screens, behind one door, plus the jobs you kick off and walk away from
          (Marketing's scheduled post, and the Seller Central ingest that moved in on 2026-09-03). Second rather than beside DAILY as
          it used to be: the owner is in it repeatedly through the day, so it stays high. */}
      <Band title="Reports & marketing">
        {/* One tile over six views (Sales, Birk Tracker, Stock Position, New Additions, Price Changes, Brands). Brands used to be a
            top-level tile; folding it in is the owner's call (2026-08-27) — both were "go and read a number", and two doors onto
            that made it a peer of screens worked every day. Amazon Order was folded in at the same time and came back out on
            2026-09-03 once it stopped being a report. */}
        <ModuleTile
          title="Reports"
          description="Sales, stock, margin and brand reporting — everything you go to read a number on."
          href="/analytics"
          icon={ChartBarIcon}
          live
          compact
        />

        {/* Marketing -> Social. Queue a graphic + caption; a sweep publishes it to the Facebook Page at the due minute. */}
        <ModuleTile
          title="Marketing"
          description="Queue and publish the daily Facebook post — graphic, caption, link, scheduled."
          href="/social"
          icon={MegaphoneIcon}
          live
          compact
        />

        {/* Update Amazon — the daily Seller Central ingest that replaces the legacy PowerBuilder UPDATE AMAZON button. Moved here
            from STOCK & PRODUCTS (owner, 2026-09-03) when Amazon Order took its place in that band. It sat there because it feeds
            the catalogue, but what it IS is a job you kick off and walk away from — which is exactly what Marketing beside it is
            too, so this band is read-a-number screens plus the run-and-leave jobs, and it belongs to the second half. It stays out
            of DAILY for the reason it always did: a data job, not a screen you make decisions on. */}
        <ModuleTile
          title="Update Amazon"
          description="Load the Seller Central reports — sales, returns, FBA stock and fees."
          href="/update-amazon"
          icon={ArrowUpTrayIcon}
          live
          compact
        />
      </Band>

      {/* STOCK & PRODUCTS — the catalogue itself: what we hold, what it says, and what's coming in. */}
      <Band title="Stock & products">
        {/* Order Status — PROCUREMENT: place what's been chosen, then chase what's on its way. Banded with stock rather than beside
            Customer Orders (owner, 2026-08-27): they read as a pair but they're opposite jobs — this is a sit-down session about
            replenishing stock, that is a daily fulfilment grid. */}
        <ModuleTile
          title="Order Status"
          description="Place supplier orders and chase what's on its way."
          href="/order-status"
          icon={ShoppingCartIcon}
          live
          compact
        />

        {/* Amazon Order — a dashboard tile again (owner, 2026-09-03), after a spell inside Reports. It went in there as the flat
            profit report it was; it has since become a working screen — rate fills, an Order basket and a Pick basket, and two DB
            writes on the button — so filing it under "go and read a number" put a job you DO behind a door marked reading. Third
            in the band, straight after Order Status: the two are the same errand a step apart, deciding what to buy and then
            placing it. */}
        <ModuleTile
          title="Amazon Order"
          description="Work out what Amazon needs — what to buy in, and what to send from the local shelf."
          href="/amazon-order"
          icon={ClipboardDocumentListIcon}
          live
          compact
        />

        {/* Goods In — booking a supplier delivery onto the shelf: the far end of the Order Status errand, and the only step in the
            band that ADDS stock. Placed straight after Amazon Order so the band reads as one chain — decide, place, receive — with
            Add / Modify, the catalogue job, left at the end. */}
        <ModuleTile
          title="Goods In"
          description="Book in what's arrived from a supplier and put it on the shelf."
          href="/goods-in"
          icon={InboxArrowDownIcon}
          live
          compact
        />

        {/* Birkenstock — the seasonal re-order sheet (365-day sales against stock, size by size, Live vs Full). In STOCK & PRODUCTS
            rather than DAILY or REPORTS: it is a sit-down buying session, held a few times a year, and it is a decision screen, not a
            number you go and read. Last in the replenishment chain the band already tells — decide, place, receive — because it is
            the one brand where that chain runs on a season instead of a shelf: the order goes in ~6 months ahead and cannot be topped
            up, so it is a different KIND of buying decision and sits apart from the three that share a rhythm.
            A calendar rather than the clipboard this tile first carried: Amazon Order has since taken the clipboard, and two tiles in
            one band wearing the same icon is worse than either choice of icon. The calendar is the truer one anyway — what makes this
            screen hard is that it is months ahead of itself. */}
        <ModuleTile
          title="Birkenstock"
          description="Sold in 365 days against what we hold, size by size — what to put on the next order."
          href="/birkenstock"
          icon={CalendarDaysIcon}
          live
          compact
        />

        <ModuleTile
          title="Add / Modify Product"
          description="Find an existing product to edit, or create a new one."
          href="/products"
          icon={TagIcon}
          live
          compact
        />
      </Band>

      {/* PRICING — last band (owner, 2026-08-27). Normally entered from Segments; these tiles are for a direct hit when the style is
          already known, which is the rarer case. */}
      <Band title="Pricing">
        <ModuleTile
          title="Shopify Pricing"
          description="Review demand and set Shopify prices, segment by segment."
          href="/pricing"
          icon={CurrencyPoundIcon}
          live
          compact
        />

        {/* SKU-grain mirror of the Shopify flow. Applies queue into a Seller Central upload file — no live push. */}
        <ModuleTile
          title="Amazon Pricing"
          description="Review demand and set Amazon/FBA prices, segment by segment."
          href="/amz"
          icon={BuildingStorefrontIcon}
          live
          compact
        />
      </Band>
    </AppShell>
  );
}
