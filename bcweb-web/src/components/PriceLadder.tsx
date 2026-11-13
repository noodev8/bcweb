'use client';
/*
=======================================================================================================================================
Component: PriceLadder — one Go through card's prices on ONE line (Buy Box, 2026-11-13; docs/amz-buybox/GO-THROUGH-LAYOUT.md)
=======================================================================================================================================
Purpose: Show WHERE the suggested move sits against the market at a glance, in place of four separate numbers (Lead, Next dearer,
         Walk-away, RRP — owner, 2026-11-13: "yes" to the ladder). Display only: every figure is already on the deck card.

THE LINE: one price scale from the card's FLOOR (the £3 walk-away, or break-even on New — a red tick, the track dashed below it) to the
         RRP (a grey tick). Rivals are grey dots (hover: price, FBA / self-post, share of views); the LEAD (the non-us offer featured to
         the most views) is a larger dark dot. Our move is an arrow in the answer's colour from NOW (a ring) to the suggestion (a filled
         dot). Offers dearer than the RRP aren't drawn — counted as "+n over" on the RRP label.

LABELS: ours above the line (Now · Raise to / Cut to), the market below (floor · Lead n% · Next dearer on a raise · RRP). A label that
         would overlap the one before it drops to the next row with a thin leader line, so close prices (a cut to a penny under the
         lead) stay readable. Laid out in real pixels — the SVG is measured (ResizeObserver) so text never scales on a phone.

FIXED HEIGHT (H): the card's buttons must not move card to card (owner, 2026-11-12), so the ladder is always H tall.
=======================================================================================================================================
*/

import { useEffect, useRef, useState } from 'react';
import type { AmzDeckCard, AmzDeckKind } from '@/lib/api';

const H = 100;          // px — fixed (header)
const TRACK_Y = 42;     // the line; 2 label rows above it, 3 below
const ROW = 14;
const PAD = 8;

// The answer's colour — the only strong colour on the card (tab dot, verb tag, this arrow). Full class names for Tailwind's scanner.
const ACCENT: Record<AmzDeckKind, { fill: string; stroke: string }> = {
  raise: { fill: 'fill-emerald-500', stroke: 'stroke-emerald-500' },
  cut: { fill: 'fill-rose-500', stroke: 'stroke-rose-500' },
  new: { fill: 'fill-violet-500', stroke: 'stroke-violet-500' },
};

const money = (v: number) => `£${v.toFixed(2)}`;

type Label = { x: number; text: string; bold: string };

export default function PriceLadder({ card }: { card: AmzDeckCard }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const accent = ACCENT[card.deck];
  const rrp = card.rrp;
  const floor = card.floor;
  // The lead: the non-us offer featured to the most views (null when we lead, or nobody is featured).
  const lead = [...card.featured].sort((a, b) => b.share - a.share).find((f) => !f.us && f.price !== null && f.share > 0) ?? null;
  const leadIsTop = !!lead && !card.featured.some((f) => f.us && f.share > lead.share);
  const shareOf = (seller: string) => card.featured.find((f) => f.seller === seller)?.share ?? 0;

  const rivals = card.offers.filter((o) => !o.us && o.price !== null) as (AmzDeckCard['offers'][number] & { price: number })[];
  const overRrp = rrp === null ? 0 : rivals.filter((o) => o.price > rrp + 0.005).length;

  // The scale: everything that gets a label, plus a little room each side.
  const pts = [card.our_price, card.suggest, floor, rrp, leadIsTop && lead ? lead.price : null, card.deck === 'raise' ? card.next_up : null]
    .filter((v): v is number => v !== null && Number.isFinite(v));
  let lo = Math.min(...pts), hi = Math.max(...pts);
  if (hi - lo < 1) { lo -= 0.5; hi += 0.5; }
  const pad = (hi - lo) * 0.03;
  lo -= pad; hi += pad;
  const x = (p: number) => PAD + ((p - lo) / (hi - lo)) * (w - PAD * 2);

  // Labels in rows: sorted left to right, each in the first row where it clears the one before (estimated text width).
  function rows(items: Label[], dir: 1 | -1, first: number, maxRows: number) {
    const ends: number[] = [];
    return items.sort((a, b) => a.x - b.x).map((it) => {
      const width = it.text.length * 6.2 + it.bold.length * 7 + 4;
      const left = Math.max(0, Math.min(w - width, it.x - width / 2));
      let r = 0;
      while (r < maxRows - 1 && ends[r] !== undefined && left < ends[r] + 10) r++;
      ends[r] = left + width;
      return { ...it, left, y: first + dir * r * ROW, r };
    });
  }

  const above = rows([
    { x: x(card.our_price), text: 'Now', bold: money(card.our_price) },
    { x: x(card.suggest), text: card.deck === 'raise' ? 'Raise to' : 'Cut to', bold: money(card.suggest) },
  ], -1, TRACK_Y - 14, 2);
  const belowItems: Label[] = [];
  if (floor !== null) belowItems.push({ x: x(floor), text: card.deck === 'new' ? 'Break-even' : 'Walk-away', bold: money(floor) });
  if (leadIsTop && lead && lead.price !== null) belowItems.push({ x: x(lead.price), text: `Lead ${Math.round(lead.share)}%`, bold: money(lead.price) });
  if (card.deck === 'raise' && card.next_up !== null) belowItems.push({ x: x(card.next_up), text: 'Next dearer', bold: money(card.next_up) });
  if (rrp !== null) belowItems.push({ x: x(rrp), text: overRrp ? `RRP (+${overRrp} over)` : 'RRP', bold: money(rrp) });
  const below = rows(belowItems, 1, TRACK_Y + 24, 3);

  const x0 = x(card.our_price), x1 = x(card.suggest), dir = x1 >= x0 ? 1 : -1;
  const trackEnd = rrp !== null ? x(rrp) : w - PAD;
  const trackStart = floor !== null ? x(floor) : PAD;

  return (
    <div ref={ref} className="h-[100px] w-full" aria-label={`Price ladder: now ${money(card.our_price)}, suggested ${money(card.suggest)}`}>
      {w > 0 && (
        <svg width={w} height={H} className="block overflow-visible text-[11.5px]" role="img">
          {/* Under the floor: dashed (not a price to go to); floor → RRP solid. */}
          {floor !== null && <line x1={PAD} y1={TRACK_Y} x2={trackStart} y2={TRACK_Y} className="stroke-slate-300" strokeWidth={3} strokeDasharray="3 4" />}
          <line x1={trackStart} y1={TRACK_Y} x2={trackEnd} y2={TRACK_Y} className="stroke-slate-300" strokeWidth={3} strokeLinecap="round" />
          {floor !== null && <line x1={x(floor)} y1={TRACK_Y - 9} x2={x(floor)} y2={TRACK_Y + 9} className="stroke-red-600" strokeWidth={2} />}
          {rrp !== null && <line x1={x(rrp)} y1={TRACK_Y - 9} x2={x(rrp)} y2={TRACK_Y + 9} className="stroke-slate-400" strokeWidth={2} />}

          {/* Rivals (hover for who); the lead larger and darker. */}
          {rivals.filter((o) => rrp === null || o.price <= rrp + 0.005).map((o, i) => {
            const isLead = leadIsTop && lead?.seller === o.seller;
            const share = shareOf(o.seller);
            return (
              <circle key={`${o.seller}-${i}`} cx={x(o.price)} cy={TRACK_Y} r={isLead ? 6 : 4}
                className={isLead ? 'fill-slate-800' : share > 0 ? 'fill-slate-500' : 'fill-slate-400'}>
                <title>{`${isLead ? 'Lead' : 'Rival'} ${money(o.price)} · ${o.fba ? 'FBA' : 'self-post'}${share > 0 ? ` · shown to ${Math.round(share)}% of views` : ''}`}</title>
              </circle>
            );
          })}

          {/* Our move: now (ring) → suggestion (filled), an arrow in the answer's colour. */}
          {Math.abs(x1 - x0) > 14 && (
            <>
              <line x1={x0} y1={TRACK_Y} x2={x1 - dir * 9} y2={TRACK_Y} className={accent.stroke} strokeWidth={4} />
              <path d={`M${x1 - dir * 12} ${TRACK_Y - 6} L${x1 - dir * 2} ${TRACK_Y} L${x1 - dir * 12} ${TRACK_Y + 6} z`} className={accent.fill} />
            </>
          )}
          <circle cx={x0} cy={TRACK_Y} r={7} className="fill-white stroke-slate-500" strokeWidth={2.5}><title>{`Now ${money(card.our_price)}`}</title></circle>
          <circle cx={x1} cy={TRACK_Y} r={7} className={accent.fill}><title>{`Suggested ${money(card.suggest)}`}</title></circle>

          {[...above, ...below].map((l) => {
            const up = l.y < TRACK_Y;
            return (
              <g key={`${l.text}-${l.x}`}>
                {l.r > 0 && <line x1={l.x} y1={up ? TRACK_Y - 9 : TRACK_Y + 9} x2={l.x} y2={up ? l.y + 3 : l.y - 11} className="stroke-slate-200" strokeWidth={1} />}
                <text x={l.left} y={l.y} className="fill-slate-500">
                  {l.text}<tspan dx={4} className="fill-slate-900 font-semibold tabular-nums">{l.bold}</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
