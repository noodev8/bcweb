'use client';
/*
=======================================================================================================================================
Page: /daily — Daily (owner, 2026-10-26)
=======================================================================================================================================
Purpose: the four screens of the daily round, in the owner's order — Pricing (Repricing), Ordering (Amazon Order), New stuff (New
Additions) and Prospects. A launcher only: no data of its own. Opened from the Daily card on the dashboard (first built there as a
drop-down, then moved to its own screen — owner: "make it its own screen actually").

Each tile carries ?from=daily, the dashboard's return ticket (components/AppShell.tsx): on the screen it opens, the header logo goes
home rather than up that screen's own route tree.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import ModuleTile from '@/components/ModuleTile';
import { ClipboardDocumentListIcon, LightBulbIcon, SparklesIcon, Squares2X2Icon } from '@heroicons/react/24/outline';

// ORDER AND WORDING ARE THE OWNER'S.
const TILES = [
  {
    title: 'Pricing',
    subtitle: 'Repricing',
    description: 'The Repricing screen — status, segment and campaign lists to price.',
    href: '/segments',
    icon: Squares2X2Icon,
  },
  {
    title: 'Ordering',
    subtitle: 'Amazon Order',
    description: 'Work out what Amazon needs — what to buy in, and what to send from the local shelf.',
    href: '/amazon-order',
    icon: ClipboardDocumentListIcon,
  },
  {
    title: 'New Stuff',
    subtitle: 'New Additions',
    description: 'Styles added in the last 90 days — how many, and how each new line has sold.',
    href: '/analytics/new-additions',
    icon: SparklesIcon,
  },
  {
    title: 'Prospects',
    subtitle: 'New products to look into',
    description: 'Log finds from Amazon — rank, price, sellers — check them again later, share notes, then order or delete.',
    href: '/prospects',
    icon: LightBulbIcon,
  },
];

export default function DailyPage() {
  return (
    <AppShell title="Daily">
      <div className="grid max-w-3xl grid-cols-1 gap-3 sm:grid-cols-2">
        {TILES.map((t) => (
          <ModuleTile
            key={t.href}
            title={t.title}
            subtitle={t.subtitle}
            description={t.description}
            href={t.href + '?from=daily'}
            icon={t.icon}
            live
            compact
          />
        ))}
      </div>
    </AppShell>
  );
}
