'use client';
/*
=======================================================================================================================================
Component: SliderBadge  (+ the useSliderMarks hook)   — Pricing Slider phase 4
=======================================================================================================================================
Purpose: The "this product is in a slider" indication on the Shopify and Amazon pricing screens (owner, 2026-10-17). The slider doesn't
         touch review dates, so without it a product in a slider looks like any other on a pricing list — and pricing it by hand there
         quietly takes it out of the slider (it reads as "priced by hand" at the next Move prices).

useSliderMarks()  ONE fetch of GET /slider-marks, cached by SWR under one key ('slider-marks' — the slider page revalidates it after any
                  change), so every screen and every row shares it. Lookups: shp(groupid) the style's Shopify mark, amz(code) the size's.
<SliderBadge>     a small pill — Sliding / Found / At floor (+ "paused") — linking to the slider's page; the slider's name is the tooltip,
                  or shown in full with `named`.
<SliderWarning>   the line for a price setter: setting a price here takes it out of the slider.
=======================================================================================================================================
*/

import { useMemo } from 'react';
import Link from 'next/link';
import { AdjustmentsHorizontalIcon } from '@heroicons/react/24/outline';
import { useApiQuery } from '@/lib/useApiQuery';
import { getSliderMarks, SliderMark } from '@/lib/api';

const NONE: SliderMark[] = [];

export function useSliderMarks() {
  // Not revalidated on focus (useApiQuery's default) — a badge a few minutes stale is fine; the slider page itself is always fresh.
  const q = useApiQuery('slider-marks', getSliderMarks);
  const marks = q.data ?? NONE;
  return useMemo(() => {
    const shp = new Map<string, SliderMark>();
    const amz = new Map<string, SliderMark>();
    for (const m of marks) (m.channel === 'SHP' ? shp : amz).set(m.key, m);
    return {
      shp: (groupid: string) => shp.get(groupid) ?? null,
      amz: (code: string) => amz.get(code) ?? null,
    };
  }, [marks]);
}

const LABEL: Record<SliderMark['state'], string> = { sliding: 'Sliding', found: 'Found', floor: 'At floor' };
const TONE: Record<SliderMark['state'], string> = {
  sliding: 'bg-orange-50 text-orange-700 ring-orange-200 hover:bg-orange-100',
  found: 'bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100',
  floor: 'bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100',
};

interface BadgeProps {
  mark: SliderMark | null;
  named?: boolean;   // show the slider's name in the pill (drill pages), not just as the tooltip (lists)
  from?: string;     // ?from= for the slider page's back link
}

export default function SliderBadge({ mark, named = false, from }: BadgeProps) {
  if (!mark) return null;
  const paused = mark.group_state === 'paused';
  const text = `${LABEL[mark.state]}${paused ? ' · paused' : ''}${named ? ` · ${mark.name}` : ''}`;
  return (
    <Link
      href={`/slider/${mark.group_id}${from ? `?from=${encodeURIComponent(from)}` : ''}`}
      // The row underneath is often clickable (it opens the drill) — the badge goes to the slider instead.
      onClick={(e) => e.stopPropagation()}
      title={`In the Pricing Slider "${mark.name}"${paused ? ' (paused)' : ''} — open it`}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ${TONE[mark.state]}`}
    >
      <AdjustmentsHorizontalIcon className="h-3 w-3" />
      {text}
    </Link>
  );
}

// Beside a price setter: the human can still set a price — it just leaves the slider.
export function SliderWarning({ mark, from }: { mark: SliderMark | null; from?: string }) {
  if (!mark) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md bg-orange-50 px-3 py-2 text-sm text-orange-800 ring-1 ring-orange-200">
      <SliderBadge mark={mark} named from={from} />
      <span>Setting a price here takes it out of the slider.</span>
    </div>
  );
}
