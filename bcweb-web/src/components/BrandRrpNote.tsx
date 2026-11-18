'use client';
/*
=======================================================================================================================================
Component: BrandRrpNote  (+ useBrandRrp) — brands that asked for RRP on a channel (owner, 2026-11-18)
=======================================================================================================================================
Strive asks for RRP on Amazon, Free Spirit on Shopify. Brand-wide, per channel; the list is bcweb-server/utils/brandPriceRequest.js
(THE copy), set by hand. A REMINDER, NEVER A RULE — nothing blocks or changes a price. Shown on the price cards (both channels), the
pricing lists and the size-price screens (clearance / overstock sizes too, "just as a reminder"). Amber when the price differs from
the RRP, quiet grey when it is the RRP. Only on the channel the brand named.

The list is read once (SWR caches it for every card and row on the page).
=======================================================================================================================================
*/

import { useApiQuery } from '@/lib/useApiQuery';
import { getBrandPriceRequests } from '@/lib/api';

const money = (v: number) => `£${v.toFixed(2)}`;

/** True when `brand` has asked for RRP on `channel`. */
export function useBrandRrp(brand: string | null | undefined, channel: 'SHP' | 'AMZ'): boolean {
  const { data } = useApiQuery(['brand-price-requests'], () => getBrandPriceRequests(), { revalidateIfStale: false });
  if (!brand || !data) return false;
  const b = brand.trim().toLowerCase();
  return data.some((r) => r.channel === channel && r.brand.trim().toLowerCase() === b);
}

/** Price differs from RRP (to the penny)? Unknown price or RRP = not "off". */
export function offRrp(price: number | null | undefined, rrp: number | null | undefined): boolean {
  if (price == null || rrp == null || !Number.isFinite(price) || !Number.isFinite(rrp)) return false;
  return Math.round(price * 100) !== Math.round(rrp * 100);
}

/** The line on a card or a panel: "Free Spirit asks for RRP on Shopify (£59.99)". Renders nothing for other brands. */
export default function BrandRrpNote({ brand, channel, rrp, price, className = '' }: {
  brand: string | null | undefined; channel: 'SHP' | 'AMZ'; rrp: number | null | undefined; price: number | null | undefined;
  className?: string;
}) {
  const asked = useBrandRrp(brand, channel);
  if (!asked) return null;
  const off = offRrp(price, rrp);
  return (
    <div className={'text-sm ' + (off ? 'font-medium text-amber-700' : 'text-slate-500') + (className ? ' ' + className : '')}
      title="A reminder only — nothing stops another price">
      {brand} asks for RRP on {channel === 'SHP' ? 'Shopify' : 'Amazon'}{rrp != null ? ` (${money(rrp)})` : ''}
      {off ? ' — this price isn’t RRP' : ''}
    </div>
  );
}

/** Small tag for a list row: "RRP asked" (amber when the row's price isn't RRP). */
export function BrandRrpTag({ brand, channel, rrp, price }: {
  brand: string | null | undefined; channel: 'SHP' | 'AMZ'; rrp: number | null | undefined; price: number | null | undefined;
}) {
  const asked = useBrandRrp(brand, channel);
  if (!asked) return null;
  const off = offRrp(price, rrp);
  return (
    <span title={`${brand} asks for RRP on ${channel === 'SHP' ? 'Shopify' : 'Amazon'} — a reminder only`}
      className={'whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ' + (off ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>
      RRP asked
    </span>
  );
}
