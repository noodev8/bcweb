'use client';
/*
=======================================================================================================================================
Component: ChannelBadge
=======================================================================================================================================
Purpose: A small, reusable "which sales channel is this?" marker — the real Shopify / Amazon logo seated in a white chip, next to a
         channel-coloured label. Born from a live mix-up: the Shopify and Amazon pricing screens look near-identical, so an operator
         dropped a Shopify price thinking they were on Amazon. The logo is the unambiguous cue (colour alone can clash with the
         Winners=emerald / Losers=amber job colours on the segment lists), so this always leads with the logo.

         The logo sits in a bg-white chip so it reads cleanly on any background AND hides the Amazon source file's baked-in white
         background (it's a JPG, not a transparent PNG). Used on: the two price-setter banners (PriceSetter / AmzPriceSetter) and the
         segment WINNERS/LOSERS list headers (/pricing/[segment], /amz/[segment]).
=======================================================================================================================================
*/

import Image from 'next/image';

type Channel = 'shopify' | 'amazon';

// Per-channel asset + palette. Logos live in public/brands (shopify.png is transparent; amazon.jpg is white-backed — the chip hides it).
const CHANNELS: Record<Channel, {
  src: string; alt: string; dims: number; imgClass: string; ring: string; text: string; defaultLabel: string;
}> = {
  shopify: { src: '/brands/shopify.png', alt: 'Shopify', dims: 18, imgClass: 'h-[18px] w-[18px]', ring: 'ring-emerald-200', text: 'text-emerald-800', defaultLabel: 'Shopify' },
  amazon: { src: '/brands/amazon.jpg', alt: 'Amazon', dims: 20, imgClass: 'h-5 w-5', ring: 'ring-amber-200', text: 'text-amber-900', defaultLabel: 'Amazon' },
};

interface ChannelBadgeProps {
  channel: Channel;
  label?: string;      // overrides the default channel name (e.g. "Shopify price" on a setter, "Shopify pricing" on a list header)
  className?: string;  // extra classes on the wrapper (spacing, etc.)
}

export default function ChannelBadge({ channel, label, className = '' }: ChannelBadgeProps) {
  const c = CHANNELS[channel];
  return (
    <span className={'inline-flex items-center gap-2 ' + className}>
      <span className={'flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white shadow-sm ring-1 ' + c.ring}>
        <Image src={c.src} alt={c.alt} width={c.dims} height={c.dims} className={c.imgClass + ' object-contain'} />
      </span>
      <span className={'text-sm font-semibold ' + c.text}>{label ?? c.defaultLabel}</span>
    </span>
  );
}
