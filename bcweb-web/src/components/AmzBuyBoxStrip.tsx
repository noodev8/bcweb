'use client';
/*
=======================================================================================================================================
Component: AmzBuyBoxStrip — WHERE WE WIN AND LOSE THE BUY BOX (Amazon Pricing home, under the title; owner 2026-11-21)
=======================================================================================================================================
Agreed one decision at a time (docs/amz-buybox/PLAN.md, decision 6's 2026-11-21 note), after the FBM talk: "Where are we winning and
where are we losing ... We dont care [if the rival is] FBM or FBA."
  LEFT   the % = SKUs we have the Buy Box on / SKUs in stock at Amazon — all or nothing per SKU, so it adds up with the numbers beside
         it (owner: "A - as they are the numbers we are showing"). Not the average share (avg_share, API only). Never "page views"
         (owner: sounds like our own website).
  RIGHT  "We don't have it on n": the three parts as buttons into the BUY BOX CARDS (/amz/lost-cards?part=) — rival cheaper than us
         (biggest price gap first) · rival at our price or dearer · nobody has it. Only the parts open cards; the big numbers don't
         ("The cards will be too many"). A part at 0 is shown, not a link.
The split is server-side (utils/amzBuyBox.js → lostPart), the same for these counts and their cards; the words are lib/buyboxAnswers
→ LOST_TEXT. An old server (no headline.lead) shows nothing — deploy the VPS first.
=======================================================================================================================================
*/

import Link from 'next/link';
import type { AmzBuyBoxData, AmzLostPart } from '@/lib/api';
import { LOST_TEXT } from '@/lib/buyboxAnswers';

const PARTS: AmzLostPart[] = ['cheaper', 'level', 'nobody'];

export default function AmzBuyBoxStrip({ data }: { data: AmzBuyBoxData | undefined }) {
  const h = data?.headline;
  const l = h?.lead;
  if (!h || !l || h.sizes <= 0) return null;
  const n = { cheaper: l.cheaper, level: l.level, nobody: l.nobody };
  const lost = h.sizes - l.us;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums tracking-tight text-slate-900">{Math.round((l.us / h.sizes) * 100)}%</span>
            <span className="text-base text-slate-600">of our SKUs have the Buy Box</span>
          </div>
          <div className="mt-1 text-sm text-slate-500">
            <span className="font-medium tabular-nums text-slate-800">{l.us}</span> of{' '}
            <span className="font-medium tabular-nums text-slate-800">{h.sizes}</span> in stock at Amazon
          </div>
        </div>
        <div className="flex flex-col gap-2 lg:items-end">
          <div className="text-sm text-slate-600">We don&apos;t have it on <span className="font-semibold tabular-nums text-slate-900">{lost}</span>:</div>
          <div className="grid grid-cols-3 gap-2">
            {PARTS.map((p) => {
              const inner = (
                <>
                  <span className="text-2xl font-semibold tabular-nums text-slate-900">{n[p]}</span>
                  <span className="text-sm leading-snug text-slate-600">{LOST_TEXT[p].label}{n[p] > 0 && ' →'}</span>
                </>
              );
              const cls = 'flex min-h-[5.5rem] w-full flex-col justify-between rounded-lg border px-3 py-2 text-left lg:w-40';
              return n[p] > 0 ? (
                <Link key={p} href={`/amz/lost-cards?part=${p}`} title={`Price cards for these ${n[p]} · ${LOST_TEXT[p].hint}`}
                  className={`${cls} border-slate-200 bg-white shadow-sm hover:border-slate-300 hover:bg-slate-50`}>{inner}</Link>
              ) : (
                <div key={p} className={`${cls} border-slate-100 bg-slate-50`}>{inner}</div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
