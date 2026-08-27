'use client';
/*
=======================================================================================================================================
Component: ModuleTile
=======================================================================================================================================
Purpose: A single tile on the platform dashboard and on the Reports index. Live modules link somewhere; "coming soon" modules render
         disabled with a badge.

         TWO DENSITIES (owner, 2026-08-27). `compact` renders icon + title on ONE line with no description; the default keeps the
         description paragraph. The dashboard is compact and the Reports index is not, because they answer different questions: the
         dashboard is a menu you know by heart and want to cross in one glance, so a paragraph per tile is nine paragraphs you read
         past every time and a page twice as tall as it needs to be. The Reports index is a shelf of things you DON'T know by heart —
         "what does Stock Position actually show me?" — and there the description is the point. A compact tile keeps its description
         as a hover tooltip, so nothing is lost, it just isn't shouted.
         A live tile carries NO badge of its own (owner, 2026-08-27 — the old green "Live" / amber "In progress" pills went): every
         tile on the grid that isn't greyed out is live, so the pill repeated what the tile's own styling already said and put a
         row of colour above titles that then had to compete with it. "Coming soon" stays — that one carries real information.
         This is what makes the dashboard a modular shell (CLAUDE.md): v1 ships one live tile (Shopify Pricing) and greyed
         placeholders (Amazon Pricing, Inventory, Orders, Analytics) so the growth path is visible without building them.
=======================================================================================================================================
*/

import Link from 'next/link';
import { ComponentType, SVGProps } from 'react';

interface ModuleTileProps {
  title: string;
  description: string;
  href?: string;                                    // present => live tile
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  live?: boolean;
  compact?: boolean;   // one-line menu row (dashboard) instead of the full card (Reports index)
}

export default function ModuleTile({ title, description, href, icon: Icon, live, compact }: ModuleTileProps) {
  // COMPACT — icon and title on one row, description demoted to the tooltip. Roughly a third the height of the full card.
  const compactBody = (
    <div
      title={description}
      className={
        'flex h-full items-center gap-3 rounded-xl border p-3.5 transition ' +
        (live
          ? 'border-slate-200 bg-white shadow-sm hover:border-brand-500 hover:shadow-md'
          : 'border-dashed border-slate-200 bg-slate-50')
      }
    >
      <span className={'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ' + (live ? 'bg-brand-50 text-brand-600' : 'bg-slate-200 text-slate-400')}>
        <Icon className="h-5 w-5" />
      </span>
      <h3 className={'min-w-0 text-sm font-semibold leading-snug ' + (live ? 'text-slate-900' : 'text-slate-500')}>{title}</h3>
      {!live && (
        <span className="ml-auto shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Soon</span>
      )}
    </div>
  );

  const fullBody = (
    <div
      className={
        'flex h-full flex-col rounded-xl border p-5 transition ' +
        (live
          ? 'border-slate-200 bg-white shadow-sm hover:border-brand-500 hover:shadow-md'
          : 'border-dashed border-slate-200 bg-slate-50')
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <span className={'inline-flex h-10 w-10 items-center justify-center rounded-lg ' + (live ? 'bg-brand-50 text-brand-600' : 'bg-slate-200 text-slate-400')}>
          <Icon className="h-6 w-6" />
        </span>
        {!live && (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Coming soon</span>
        )}
      </div>
      <h3 className={'text-base font-semibold ' + (live ? 'text-slate-900' : 'text-slate-500')}>{title}</h3>
      <p className={'mt-1 text-sm ' + (live ? 'text-slate-500' : 'text-slate-400')}>{description}</p>
    </div>
  );

  const body = compact ? compactBody : fullBody;

  if (live && href) {
    return <Link href={href} className="block h-full">{body}</Link>;
  }
  // Non-live tiles are inert.
  return <div aria-disabled className="h-full cursor-not-allowed">{body}</div>;
}
