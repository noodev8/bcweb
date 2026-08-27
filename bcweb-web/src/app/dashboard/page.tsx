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
     labelled bands are scannable by heading alone. DAILY is deliberately only the two screens a day is STARTED on — the moment it
     grew to include everything touched daily it stopped meaning anything. The two short bands share the top row (see `half`) so the
     menu doesn't open on two half-empty rows.

  3. PRICING SITS LAST. Shopify/Amazon Pricing are normally entered FROM Segments, not from here (owner) — they led the old grid on
     build order alone. They keep tiles, for when you already know what you're repricing, but they're the bottom band: the tile you
     reach for least often should not be the one nearest your eye.

  BAND ORDER and the order WITHIN each band are the owner's, set against how the day runs, not against any tidier scheme — so don't
  "fix" them into alphabetical or build order. Daily -> Stock & products -> Reports & marketing -> Pricing; and within Stock &
  products, Order Status -> Add / Modify -> Update Amazon.

  Also: Analytics/Brands/Amazon Order were three separate doors onto "read a number". They are now one Reports tile (owner) — see
  /analytics, which absorbed Brands and Amazon Order as views.

DENSITY, second pass (owner, 2026-08-27 — "too much of nothing"). The first cut of this page used the full ModuleTile card: a big
icon, a title and a two-line description, about 200px per tile. Nine of those plus four band headings made the page TALLER than the
flat twelve-tile grid it replaced, and a band of two tiles in a three-wide grid left a hole the size of a tile. Two changes fix it:
  - COMPACT tiles (icon + title on one line, description moved to the hover tooltip). This is a menu crossed by someone who knows it
    by heart, not a shelf of things being explained — the paragraphs were read past every single time.
  - FOUR columns at lg instead of three, so the bands read as deliberate part-rows rather than gaps. (STOCK & PRODUCTS filled a row
    of four exactly until the Inventory card came out; three of four still reads as a row.)
Together the whole menu lands in about the height DAILY and STOCK & PRODUCTS used to take on their own.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import ProductSearchBox from '@/components/ProductSearchBox';
import {
  CurrencyPoundIcon, ShoppingCartIcon, ChartBarIcon, BuildingStorefrontIcon, TagIcon, Squares2X2Icon, ArrowUpTrayIcon,
  UserGroupIcon, MegaphoneIcon,
} from '@heroicons/react/24/outline';

// One band of the menu. Kept as data so the headings stay visually identical and a tile moves band by moving one line.
// `half` is for a band sharing a row with another (see the paired row below): it stays two tiles across instead of opening out to
// four, and gives up its own bottom margin because the pairing wrapper owns the spacing between the two.
function Band({ title, children, half }: { title: string; children: React.ReactNode; half?: boolean }) {
  return (
    <section className={half ? undefined : 'mb-6'}>
      <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h2>
      <div className={'grid grid-cols-2 gap-3' + (half ? '' : ' lg:grid-cols-4')}>{children}</div>
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

      {/* PAIRED ROW (owner, 2026-08-27). Two short bands side by side instead of stacked, so the first row of the menu is a full
          row rather than two half-empty ones. The columns are laid out so the tiles land on the SAME four tracks the full-width
          bands below use — outer gap and inner gap both 3, so 2x(2 tiles + gap) + gap measures exactly a 4-column grid and every
          tile on the page is one width. Reports sitting level with Daily rather than below it is honest: the owner is in it
          repeatedly through the day. */}
      <div className="mb-6 grid gap-x-3 gap-y-6 lg:grid-cols-2">
        {/* DAILY — where a day is STARTED. Two tiles on purpose; see the header note. */}
        <Band title="Daily" half>
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
        </Band>

        {/* REPORTS & MARKETING — the read-a-number screens, behind one door, plus the one outbound job. */}
        <Band title="Reports & marketing" half>
          {/* One tile over seven views (Sales, Birk Tracker, Stock Position, New Additions, Price Changes, Brands, Amazon Order). Brands
              and Amazon Order used to be top-level tiles; folding them in is the owner's call (2026-08-27) — all three were "go and read
              a number", and three doors onto that made them peers of screens worked every day. */}
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
        </Band>
      </div>

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

        <ModuleTile
          title="Add / Modify Product"
          description="Find an existing product to edit, or create a new one."
          href="/products"
          icon={TagIcon}
          live
          compact
        />

        {/* Update Amazon — the daily Seller Central ingest that replaces the legacy PowerBuilder UPDATE AMAZON button. Last in the
            band (owner, 2026-08-27): it IS a once-a-day job, but it's one you run and walk away from, so it doesn't compete with the
            three screens above it that get opened and re-opened. It stays out of DAILY for the same reason — a data job, not a screen
            you make decisions on. */}
        <ModuleTile
          title="Update Amazon"
          description="Load the Seller Central reports — sales, returns, FBA stock and fees."
          href="/update-amazon"
          icon={ArrowUpTrayIcon}
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
