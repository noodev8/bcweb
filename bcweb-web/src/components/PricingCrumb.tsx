'use client';
/*
=======================================================================================================================================
Component: PricingCrumb  (the "where you are" after ← back on the Shopify / Amazon pricing lists)
=======================================================================================================================================
Purpose: Renders `GIZEH-SEG · [Shopify]` into AppShell's crumb slot, so the list reads `← Repricing / GIZEH-SEG · [Shopify]`.
         OWNER, 2026-09-24: the group name used to be the page's H1 — the loudest thing on screen for the thing you'd picked one click
         earlier, standing alone in its own row. It's context, not the subject, so it moved into the back-link line. The channel badge
         came with it because the two channels' lists are now near-identical (same tabs, columns and bulk bar) — without it nothing
         says which store a price change hits.
=======================================================================================================================================
*/

import ChannelBadge from '@/components/ChannelBadge';

export default function PricingCrumb({ name, channel, note }: {
  name: string;
  channel: 'shopify' | 'amazon';
  note?: string;   // quiet qualifier after the name, e.g. "Google campaign"
}) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-medium text-slate-800">{name}</span>
      {note && <span className="text-slate-400">{note}</span>}
      <span className="text-slate-300">·</span>
      <ChannelBadge channel={channel} />
    </span>
  );
}
