'use client';
/*
=======================================================================================================================================
Component: ModuleTile
=======================================================================================================================================
Purpose: A single tile in the dashboard's menu groups. Live modules link somewhere; "coming soon" modules render disabled with a badge.

         ONE ROW: icon and title on one line with a short subtitle under it, no description paragraph — the dashboard is a menu you
         know by heart and want to cross in one glance. The full-size card with a description paragraph existed for the Reports index;
         it went when that page was removed (2026-10-26). There is no hover tooltip (owner, 2026-09-24); the subtitle is the only
         explanation a tile gives.
         A live tile carries NO badge of its own (owner, 2026-08-27 — the old green "Live" / amber "In progress" pills went): every
         tile on the grid that isn't greyed out is live, so the pill repeated what the tile's own styling already said and put a
         row of colour above titles that then had to compete with it. "Soon" stays — that one carries real information.
=======================================================================================================================================
*/

import Link from 'next/link';
import { ComponentType, SVGProps } from 'react';

interface ModuleTileProps {
  title: string;
  href?: string;                                    // present => live tile
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  live?: boolean;
  // SUBTITLE (owner, 2026-09-22) — a second line, four or five words. It exists because the dashboard rebuild put the tiles behind a
  // drill-down, and a tile you reach by opening a group is a tile you are LESS sure about than one you crossed by heart: half the
  // names here are internal shorthand (Bclog, Birk Tracker, Birkenstock vs Birk Tracker) that read fine to the team and to nobody else.
  subtitle?: string;
}

export default function ModuleTile({ title, href, icon: Icon, live, subtitle }: ModuleTileProps) {
  const body = (
    <div
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
      <div className="min-w-0">
        <h3 className={'text-sm font-semibold leading-snug ' + (live ? 'text-slate-900' : 'text-slate-500')}>{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs leading-snug text-slate-500">{subtitle}</p>}
      </div>
      {!live && (
        <span className="ml-auto shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Soon</span>
      )}
    </div>
  );

  if (live && href) {
    return <Link href={href} className="block h-full">{body}</Link>;
  }
  // Non-live tiles are inert.
  return <div aria-disabled className="h-full cursor-not-allowed">{body}</div>;
}
