'use client';
/*
=======================================================================================================================================
Component: AmzCardFrame  (THE one Amazon price card layout — owner, 2026-11-14)
=======================================================================================================================================
Purpose: Owner: "each card (selling, not selling) have different layouts … my brain does get confused with what I'm looking at when it
         switches" → "we really should be looking at the same layout and make it simpler". Every Amazon price card is drawn by this
         frame, so the price, the profit, the Buy Box and the buttons sit in the same place on every card:
           Buy Box cards   /amz/buybox/deck            (app/amz/buybox/deck/page.tsx — the box starts at the suggestion, a reason line)
           Price cards     /amz/due-cards, /amz/search-cards  (components/AmzPriceCards.tsx — the box starts at today's price)
         The pages own the data, the writes and what a press means; the frame only lays it out and takes the keys.

THE CARD, top to bottom (owner's trim, 2026-11-14: "too many figures … I am interested in matching the buy box or moving up or down as
         normal. Want to see what my current profit"):
           who        picture, groupid + size chip, n of N, name, brand, links (price screen / Amazon)
           [reason]   one line (Buy Box cards: the answer tag + why; search cards: the Buy Box suggestion with Use it)
           price      −£1 −50p −30p [box] +30p +50p +£1
           profit     Now £x keeps £y a pair → at £z keeps £w  (red = a loss; "over RRP" only when it is)
           Buy Box    who leads at what · we're shown n% · N offers (the sellers pop-up, BB tags) · match keeps £x [Match £y]
           facts      one or two quiet lines (stock and sales; the last price change)
           decide     review (chips, or the Buy Box cards' fixed date) · ← · secondary (Leave / Next) · primary (Set / Undo)
           note       one reserved line (warnings / what was sent)
         MATCH only fills the box — the primary button still writes. No Match when we hold the Buy Box.
         No walk-away / break-even figures or walk-away warnings (owner, 2026-11-14) — the profit figure says it.

KEYS (not while typing in another input; in the box only Enter / Esc / ↑ ↓): Enter = primary · → or L = secondary · ← = previous ·
         E = edit the price · in the box ↑ / ↓ = +30p / −30p · anything else = the page's onKey (the Buy Box cards' U = undo).
=======================================================================================================================================
*/

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import type { AmzBuyBoxFeatured, AmzBuyBoxOffer, AmzLastChange } from '@/lib/api';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const NUDGES = [-1, -0.5, -0.3, 0.3, 0.5, 1];   // the price screen's steps (components/AmzPriceSetter)

// Amazon's own seller id on amazon.co.uk — names its row in the sellers pop-up (owner, 2026-11-14). The server's copy (the
// "Amazon sells it" tag) is utils/amzBuyBox.js AMAZON_RETAIL_UK.
const AMAZON_RETAIL_UK = 'A3P5ROKL5A1OLE';

export const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `£${v.toFixed(2)}`);
const r2 = (n: number) => Math.round(n * 100) / 100;
// Profit a pair: red when it is a loss — the only colour.
const keepCls = (v: number | null) => (v !== null && v < 0 ? 'text-red-600' : 'text-slate-900');

// THE LAST PRICE CHANGE line — both kinds of card (it replaced the Buy Box cards' price line with dots, owner 2026-11-14).
function changeDay(v: string): string {
  const t = Date.parse(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'));
  return Number.isFinite(t) ? new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'Europe/London' }) : v;
}
export function LastChangeLine({ change }: { change: AmzLastChange | null | undefined }) {
  return (
    <div className="text-slate-500">
      {change
        ? <>Last change {money(change.old_price)} → {money(change.new_price)} on {changeDay(change.at)}{change.by ? ` (${change.by})` : ''} · {change.sold_since} sold since</>
        : 'No price change on record'}
    </div>
  );
}

export interface CardButton { label: ReactNode; onClick: () => void; disabled?: boolean; title?: string }

export interface AmzCardFrameProps {
  // WHO
  code: string; groupid: string | null; size: string | null; title: string | null; brand: string | null; imagename: string | null;
  counter?: string;                                   // "2 of 35"
  links: { href: string; label: string; external?: boolean; title?: string }[];
  status?: ReactNode;                                 // search cards: due / not due
  reason?: ReactNode;                                 // one line above the price
  // PRICE — the box is the page's state (it decides where it starts)
  priceStr: string; setPriceStr: (s: string) => void; locked?: boolean;   // locked = set this visit (the Buy Box cards' Undo state)
  now: number | null; profitNow: number | null; profitAt: (price: number) => number | null; rrp: number | null;
  start?: number | null;                              // where the box started (the Buy Box cards: the suggestion) — default `now`
  profitExtra?: ReactNode;                            // after the profit line (raise: + £x a week)
  // BUY BOX
  holder: string;                                     // "A self-poster at £58.97", "We have it"
  share: number | null;                               // our share of views
  matchAt: number | null;                             // the lead's price — null when we hold it / unknown
  offers?: AmzBuyBoxOffer[]; featured?: AmzBuyBoxFeatured[];
  rank?: number | null;                               // Amazon Fashion Best Sellers Rank (owner, 2026-11-14: "Rank:", nothing else)
  bbTags?: ReactNode;                                 // "following us", "Amazon sells it"
  // FACTS — one or two quiet lines
  facts: ReactNode;
  // DECIDE
  review: ReactNode;
  onPrev: () => void; prevDisabled?: boolean;
  secondary: CardButton; primary: CardButton & { tone?: 'set' | 'plain' };
  note?: ReactNode;
  onKey?: (e: KeyboardEvent) => boolean;              // a page key; true = handled
}

export default function AmzCardFrame(p: AmzCardFrameProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  // The sellers pop-up closes on a click anywhere outside it (owner, 2026-11-14) — <details> alone only closes on its own summary.
  const offersRef = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    function onDown(e: MouseEvent) {
      const d = offersRef.current;
      if (d?.open && !d.contains(e.target as Node)) d.open = false;
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const price = Number.parseFloat(p.priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const changed = valid && (p.now === null || Math.round(price * 100) !== Math.round(p.now * 100));
  const start = p.start !== undefined ? p.start : p.now;
  const movedFromStart = valid ? start === null || Math.round(price * 100) !== Math.round(start * 100) : p.priceStr !== '';
  const profit = valid ? p.profitAt(price) : null;
  const goingDown = changed && p.now !== null && price < p.now;
  const matchKeeps = p.matchAt !== null ? p.profitAt(p.matchAt) : null;
  const atMatch = p.matchAt !== null && valid && Math.round(price * 100) === Math.round(p.matchAt * 100);
  const nudge = (d: number) => {
    if (p.locked) return;
    const base = valid ? price : p.now ?? 0;
    p.setPriceStr(Math.max(0.01, r2(base + d)).toFixed(2));
  };

  // KEYS (header). Re-bound each render so the handlers see this render's props.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const inBox = e.target === boxRef.current;
      if (!inBox && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
      // Enter only presses a Set (tone 'set') — never an Undo in the primary's place.
      if (e.key === 'Enter') { e.preventDefault(); if (!p.primary.disabled && p.primary.tone !== 'plain') p.primary.onClick(); return; }
      if (inBox) {
        if (e.key === 'ArrowUp') { e.preventDefault(); nudge(0.3); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-0.3); }
        else if (e.key === 'Escape') boxRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); if (!p.secondary.disabled) p.secondary.onClick(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!p.prevDisabled) p.onPrev(); }
      else if ((e.key === 'e' || e.key === 'E') && !p.locked) { e.preventDefault(); boxRef.current?.focus(); boxRef.current?.select(); }
      else if (p.onKey?.(e)) e.preventDefault();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pill = 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-medium tabular-nums text-slate-700 hover:bg-slate-50 disabled:opacity-40';
  const offersSorted = p.offers ? [...p.offers].sort((a, b) => (a.price ?? 0) - (b.price ?? 0)) : [];
  const lead = p.featured ? [...p.featured].filter((f) => f.share > 0).sort((a, b) => b.share - a.share)[0] ?? null : null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* WHO */}
      <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
          {p.imagename && !imgFailed && (
            <Image src={IMAGE_BASE + p.imagename} alt={p.title || p.code} fill sizes="80px" onError={() => setImgFailed(true)} className="object-contain" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2" title={p.code}>
            {/* The full code, size included — no separate size badge (owner, 2026-11-14: "takes focus away") */}
            <span className="font-mono text-base font-semibold text-slate-900">{p.code}</span>
            {p.counter && <span className="text-xs tabular-nums text-slate-400">{p.counter}</span>}
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-600" title={p.title || undefined}>{p.title || '—'}<span className="ml-2 text-slate-400">{p.brand}</span></div>
          {/* RRP + Rank by the title (owner, 2026-11-14: the Buy Box line was cramped). RRP always shown ("add RRP as well"); amber,
              worded "over", only when the box is above it. A tap puts it in the box ("some suppliers insist on RRP") — like Match, it
              only fills the box; Set still writes. Rank: Amazon's Fashion rank — 0 = Amazon gave none ("none", usually not selling);
              null = not read, shown as nothing. */}
          {(p.rrp !== null || p.rank != null) && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-4 text-sm text-slate-500">
              {p.rrp !== null && (
                <button type="button" onClick={() => p.setPriceStr(p.rrp!.toFixed(2))} disabled={p.locked}
                  title="Put the RRP in the box (Set still sends it)"
                  className={'hover:text-slate-900 ' + (valid && price > p.rrp + 0.005 ? 'text-amber-700' : '')}>
                  {valid && price > p.rrp + 0.005 ? 'over ' : ''}RRP {money(p.rrp)}
                </button>
              )}
              {p.rank != null && <span>Rank: <b className="font-medium tabular-nums text-slate-900">{p.rank > 0 ? p.rank.toLocaleString('en-GB') : 'none'}</b></span>}
            </div>
          )}
          {p.status && <div className="mt-1 text-sm font-medium">{p.status}</div>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-0.5 text-sm sm:flex-row sm:gap-4">
          {p.links.map((l) => l.external
            ? <a key={l.href} href={l.href} target="_blank" rel="noreferrer" title={l.title} className="text-brand-700 hover:underline">{l.label}</a>
            : <Link key={l.href} href={l.href} title={l.title} className="text-brand-700 hover:underline">{l.label}</Link>)}
        </div>
      </div>

      {/* THE PRICE — [reason] · the box with the nudges · profit · the Buy Box with Match, together under the box (owner, 2026-11-14). */}
      <div className="px-5 py-4">
        {p.reason && <div className="mb-3 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">{p.reason}</div>}
        <div className="flex flex-wrap items-center gap-2">
          {NUDGES.filter((d) => d < 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} disabled={p.locked} className={pill}>
              −{d <= -1 ? `£${-d}` : `${Math.round(-d * 100)}p`}
            </button>
          ))}
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-400">£</span>
            <input ref={boxRef} value={p.priceStr} onChange={(e) => p.setPriceStr(e.target.value)} inputMode="decimal" aria-label="New price" disabled={p.locked}
              className="h-11 w-32 rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-xl font-semibold tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100" />
          </div>
          {NUDGES.filter((d) => d > 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} disabled={p.locked} className={pill}>
              +{d >= 1 ? `£${d}` : `${Math.round(d * 100)}p`}
            </button>
          ))}
          {/* BACK TO only once the box has moved from where it STARTED (owner, 2026-11-14: a Buy Box card showed "back to" on
              arrival — its box starts at the suggestion, not today's price). */}
          {movedFromStart && !p.locked && (
            <button type="button" onClick={() => p.setPriceStr(start !== null ? start.toFixed(2) : '')} className="text-xs text-slate-500 underline hover:text-slate-700">
              back to {money(start)}
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>Now <b className="tabular-nums text-slate-900">{money(p.now)}</b> keeps <b className={'tabular-nums ' + keepCls(p.profitNow)}>{money(p.profitNow)}</b> a pair</span>
          {changed && <span>→ at {money(price)} keeps <b className={'tabular-nums ' + keepCls(profit)}>{money(profit)}</b></span>}
          {p.profitExtra}
        </div>
        <div className="relative mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>Buy Box <b className="font-medium text-slate-900">{p.holder}</b>
            {p.share !== null && <span className="text-slate-500"> · we&apos;re shown {Math.round(p.share)}%</span>}
            {p.offers && p.offers.length > 0 && (
              <>
                {' · '}
                <details ref={offersRef} className="inline">
                  <summary className="inline cursor-pointer list-none text-brand-700 hover:underline">{p.offers.length} offers</summary>
                  {/* The sellers pop-up — over the card, so it never takes space. BB = Amazon's own Buy Box winner flag (itemOffers):
                      the share-of-views list can leave a winner out (L3882-00-38: £53.24 flagged, 16% of views credited to nobody). */}
                  <div className="absolute left-0 top-full z-20 mt-1 rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-lg">
                    <table className="text-xs">
                      <tbody>
                        {offersSorted.map((o, i) => {
                          const f = p.featured?.find((x) => x.seller === o.seller);
                          const isLead = !!lead && !lead.us && f === lead;
                          return (
                            <tr key={`${o.seller}-${i}`} className={o.us ? 'font-semibold text-slate-900' : 'text-slate-600'}>
                              <td className="py-px pr-4 tabular-nums">{money(o.price)}</td>
                              <td className="py-px pr-4">{o.us ? 'Us' : o.seller === AMAZON_RETAIL_UK ? (isLead ? 'Amazon · lead' : 'Amazon') : isLead ? 'Lead' : 'Rival'}</td>
                              <td className="py-px pr-4">{o.fba ? 'FBA' : 'Self-post'}</td>
                              <td className="py-px pr-3">{o.bb && <span className="rounded border border-emerald-300 px-1 text-[10px] font-medium text-emerald-700" title="Amazon flags this offer as a Buy Box winner">BB</span>}</td>
                              <td className="py-px tabular-nums text-emerald-700">{f && f.share > 0 ? `${Math.round(f.share)}%` : ''}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </span>
          {p.bbTags}
          {p.matchAt !== null && (
            <span className="inline-flex items-center gap-3">
              <span>match keeps <b className={'tabular-nums ' + keepCls(matchKeeps)}>{money(matchKeeps)}</b></span>
              <button type="button" onClick={() => p.setPriceStr(p.matchAt!.toFixed(2))} disabled={p.locked || atMatch}
                className="rounded-md border border-slate-300 bg-white px-3 py-0.5 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40">Match {money(p.matchAt)}</button>
            </span>
          )}
        </div>
      </div>

      {/* FACTS — quiet lines. */}
      <div className="space-y-0.5 border-y border-slate-100 px-5 py-2.5 text-sm text-slate-600">{p.facts}</div>

      {/* DECIDE — review · ← · secondary · primary (where Enter is). Pinned to the bottom of the screen on a phone. */}
      <div className="rounded-b-xl px-5 py-4 max-sm:sticky max-sm:bottom-0 max-sm:z-10 max-sm:bg-white">
        <div className="flex flex-wrap items-center gap-2">
          {p.review}
          <span className="ml-auto inline-flex gap-2">
            <button type="button" onClick={p.onPrev} disabled={p.prevDisabled} title="Previous card (←)"
              className="inline-flex h-11 items-center rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40">←</button>
            <button type="button" onClick={p.secondary.onClick} disabled={p.secondary.disabled} title={p.secondary.title}
              className="inline-flex h-11 items-center rounded-lg border border-slate-300 bg-white px-5 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50">
              {p.secondary.label}
            </button>
            <button type="button" onClick={p.primary.onClick} disabled={p.primary.disabled} title={p.primary.title}
              // SET'S COLOUR = THE DIRECTION (owner, 2026-11-14, a trial: "green up, red down … the red won't get in the way").
              className={'inline-flex h-11 items-center gap-1.5 rounded-lg px-6 text-sm font-semibold ' + (p.primary.tone === 'plain'
                ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:opacity-50'
                : (goingDown ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700') + ' text-white disabled:bg-slate-200 disabled:text-slate-400')}>
              {p.primary.label}
              {/* UP or DOWN from today's price, as an arrow only (owner, 2026-11-14: "not obvious if I'm going up or down … an arrow
                  symbol is fine" — no wording, the button keeps its one colour). */}
              {p.primary.tone !== 'plain' && changed && p.now !== null && <span aria-label={price > p.now ? 'up' : 'down'}>{price > p.now ? '↑' : '↓'}</span>}
            </button>
          </span>
        </div>
        <div className="mt-2 flex h-5 items-baseline gap-x-4 overflow-hidden whitespace-nowrap text-sm">{p.note}</div>
      </div>
    </div>
  );
}
