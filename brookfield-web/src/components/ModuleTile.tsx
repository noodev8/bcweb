'use client';
/*
=======================================================================================================================================
Component: ModuleTile
=======================================================================================================================================
Purpose: A single tile on the platform dashboard. Live modules link somewhere; "coming soon" modules render disabled with a badge.
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
}

export default function ModuleTile({ title, description, href, icon: Icon, live }: ModuleTileProps) {
  const body = (
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
        {live ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">Live</span>
        ) : (
          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-500">Coming soon</span>
        )}
      </div>
      <h3 className={'text-base font-semibold ' + (live ? 'text-slate-900' : 'text-slate-500')}>{title}</h3>
      <p className={'mt-1 text-sm ' + (live ? 'text-slate-500' : 'text-slate-400')}>{description}</p>
    </div>
  );

  if (live && href) {
    return <Link href={href} className="block h-full">{body}</Link>;
  }
  // Non-live tiles are inert.
  return <div aria-disabled className="h-full cursor-not-allowed">{body}</div>;
}
