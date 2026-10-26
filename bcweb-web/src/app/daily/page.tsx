'use client';
/*
=======================================================================================================================================
Page: /daily — Daily (owner, 2026-10-26)
=======================================================================================================================================
Purpose: the four screens of the daily round, in the owner's order — Pricing (Shopify / Amazon Pricing), Ordering (Amazon Order), New
stuff (New Additions) and Prospects. A launcher only: no data of its own. Opened from the Daily card on the dashboard (first built there
as a drop-down, then moved to its own screen — owner: "make it its own screen actually").

THE CARDS WORK LIKE THE DASHBOARD'S (owner, 2026-10-26: "make it drop down how all the others work"): the same card look, and PRICING is
a group — a click opens the dashboard's full-width panel below the row with Shopify Pricing and Amazon Pricing as tiles (the in-stock
lists, /pricing and /amz); a second click closes it. The other three are straight links, like the dashboard's Sales / Today cards.

The link cards carry ?from=daily, the dashboard's return ticket (components/AppShell.tsx): on the screen it opens, the header logo goes
home rather than up that screen's own route tree. The Pricing tiles don't — the list pages read `from` as a back-link PATH, and the
/pricing · /amz redirects drop it anyway.
=======================================================================================================================================
*/

import { useState, ComponentType, SVGProps } from 'react';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import {
  ChevronDownIcon, ClipboardDocumentListIcon, LightBulbIcon, SparklesIcon, Squares2X2Icon, ShoppingBagIcon, TagIcon,
} from '@heroicons/react/24/outline';

type Icon = ComponentType<SVGProps<SVGSVGElement>>;

interface Card {
  title: string;
  blurb: string;
  icon: Icon;
  link?: string;                                                            // a straight link
  tiles?: { title: string; subtitle: string; description: string; href: string; icon: Icon }[];   // a group (drops down)
}

// ORDER AND WORDING ARE THE OWNER'S.
const CARDS: Card[] = [
  {
    title: 'Pricing',
    blurb: 'Shopify or Amazon',
    icon: Squares2X2Icon,
    tiles: [
      {
        title: 'Shopify Pricing',
        subtitle: 'Every in-stock style',
        description: 'Every Shopify style in stock, with the Due switch.',
        href: '/pricing',
        icon: ShoppingBagIcon,
      },
      {
        title: 'Amazon Pricing',
        subtitle: 'Every in-stock SKU',
        description: 'Every Amazon SKU with FBA stock, with the Due switch.',
        href: '/amz',
        icon: TagIcon,
      },
    ],
  },
  { title: 'Ordering', blurb: 'Amazon Order', icon: ClipboardDocumentListIcon, link: '/amazon-order' },
  { title: 'New Stuff', blurb: 'New Additions', icon: SparklesIcon, link: '/analytics/new-additions' },
  { title: 'Prospects', blurb: 'New products to look into', icon: LightBulbIcon, link: '/prospects' },
];

// The dashboard's card classes (app/dashboard/page.tsx → GroupRow), so the two screens look the same.
const cardCls = 'flex h-full flex-col rounded-xl border p-4 text-left transition ';
const cardIdle = 'border-slate-200 bg-white shadow-sm hover:border-brand-500 hover:shadow-md';

export default function DailyPage() {
  const [openTitle, setOpenTitle] = useState<string | null>(null);
  const open = CARDS.find((c) => c.title === openTitle && c.tiles) ?? null;

  return (
    <AppShell title="Daily">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c) => {
          if (c.link) {
            return (
              <Link key={c.title} href={c.link + '?from=daily'} className={cardCls + cardIdle}>
                <span className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                  <c.icon className="h-5 w-5" />
                </span>
                <h2 className="text-sm font-semibold leading-snug text-slate-900">{c.title}</h2>
                <p className="mt-1 text-xs leading-snug text-slate-500">{c.blurb}</p>
              </Link>
            );
          }
          const isOpen = open?.title === c.title;
          return (
            <button
              key={c.title}
              type="button"
              onClick={() => setOpenTitle(isOpen ? null : c.title)}
              aria-expanded={isOpen}
              className={cardCls + (isOpen ? 'border-brand-500 bg-white shadow-md ring-1 ring-brand-500' : cardIdle)}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={'inline-flex h-9 w-9 items-center justify-center rounded-lg ' + (isOpen ? 'bg-brand-500 text-white' : 'bg-brand-50 text-brand-600')}>
                  <c.icon className="h-5 w-5" />
                </span>
                <ChevronDownIcon className={'h-4 w-4 text-slate-400 transition-transform ' + (isOpen ? 'rotate-180' : '')} />
              </div>
              <h2 className="text-sm font-semibold leading-snug text-slate-900">{c.title}</h2>
              <p className="mt-1 text-xs leading-snug text-slate-500">{c.blurb}</p>
            </button>
          );
        })}
      </div>

      {/* THE PANEL — full width below the row, as on the dashboard. */}
      {open?.tiles && (
        <section className="mt-3 rounded-xl bg-slate-200 p-4 ring-1 ring-slate-300">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {open.tiles.map((t) => (
              <ModuleTile key={t.href} title={t.title} subtitle={t.subtitle} description={t.description} href={t.href} icon={t.icon} live compact />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
