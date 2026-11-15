'use client';
/*
=======================================================================================================================================
Component: ShopifyCardFrame  (THE Shopify price card layout — owner, 2026-11-15, docs/shopify-cards/PLAN.md decision 2)
=======================================================================================================================================
Purpose: The Shopify price card, laid out like the Amazon one (components/AmzCardFrame — owner: "closely laid out like the Amazon
         ones") so the eye finds the price, the profit and the buttons in the same places on both channels. A separate frame, not a
         generalised AmzCardFrame, because the middle differs (Google's benchmark and Amazon's floor where the Buy Box goes) and the
         Amazon cards are settled — a change for Shopify must not move anything on them.

THE CARD, top to bottom:
           who        picture, groupid, n of N, name, brand, RRP (tap = into the box, amber "over" when the box is above it),
                      [status], links (style drill / Shopify)
           price      −£5 −£2 −£1 [box] +£1 +£2 +£5 (decision 3: Shopify prices are mostly £50–£100) · "back to" once moved
           profit     Now £x keeps £y a pair → at £z keeps £w. Only a LOSS is coloured (red) — the Amazon £3 walk-away colours are
                      an Amazon rule, not copied (decision 2)
           market     the page's lines: Google's benchmark (with its size list), Amazon's dearest live size, size prices
           facts      one or two quiet lines
           decide     review chips · ← · secondary (Leave / Next) · primary (Set / Already) — Set green going up, red going down,
                      with an arrow, as on Amazon
           note       one reserved line
         The page owns the data, the writes and what a press means; the frame only lays it out and takes the keys.

KEYS (as the Amazon cards; not while typing in another input; in the box only Enter / Esc / ↑ ↓): Enter = primary · → or L =
         secondary · ← = previous · E = edit the price · in the box ↑ / ↓ = +£1 / −£1.
=======================================================================================================================================
*/

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { money, type CardButton } from '@/components/AmzCardFrame';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';
const NUDGES = [-5, -2, -1, 1, 2, 5];   // decision 3
const BOX_STEP = 1;                     // ↑ / ↓ in the box
const r2 = (n: number) => Math.round(n * 100) / 100;
const keepCls = (v: number | null) => (v !== null && v < 0 ? 'text-red-600' : 'text-slate-900');

export interface ShopifyCardFrameProps {
  // WHO
  groupid: string; title: string | null; brand: string | null; imagename: string | null;
  counter?: string;
  links: { href: string; label: string; external?: boolean; title?: string }[];
  status?: ReactNode;
  // PRICE — the box is the page's state
  priceStr: string; setPriceStr: (s: string) => void;
  now: number | null; profitAt: (price: number) => number | null; rrp: number | null;
  // MARKET — the page's lines under the profit (Google, Amazon, size prices)
  market: ReactNode;
  // FACTS
  facts: ReactNode;
  // DECIDE
  review: ReactNode;
  onPrev: () => void; prevDisabled?: boolean;
  secondary: CardButton; primary: CardButton;
  note?: ReactNode;
}

export default function ShopifyCardFrame(p: ShopifyCardFrameProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const boxRef = useRef<HTMLInputElement>(null);
  const price = Number.parseFloat(p.priceStr);
  const valid = Number.isFinite(price) && price > 0;
  const changed = valid && (p.now === null || Math.round(price * 100) !== Math.round(p.now * 100));
  const moved = valid ? p.now === null || changed : p.priceStr !== '';
  const profitNow = p.now !== null ? p.profitAt(p.now) : null;
  const profit = valid ? p.profitAt(price) : null;
  const goingDown = changed && p.now !== null && price < p.now;
  const nudge = (d: number) => {
    const base = valid ? price : p.now ?? 0;
    p.setPriceStr(Math.max(0.01, r2(base + d)).toFixed(2));
  };

  // KEYS (header). Re-bound each render so the handlers see this render's props.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const inBox = e.target === boxRef.current;
      if (!inBox && (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) return;
      if (e.key === 'Enter') { e.preventDefault(); if (!p.primary.disabled) p.primary.onClick(); return; }
      if (inBox) {
        if (e.key === 'ArrowUp') { e.preventDefault(); nudge(BOX_STEP); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-BOX_STEP); }
        else if (e.key === 'Escape') boxRef.current?.blur();
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'l' || e.key === 'L') { e.preventDefault(); if (!p.secondary.disabled) p.secondary.onClick(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); if (!p.prevDisabled) p.onPrev(); }
      else if (e.key === 'e' || e.key === 'E') { e.preventDefault(); boxRef.current?.focus(); boxRef.current?.select(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const pill = 'inline-flex h-9 min-w-[3.25rem] items-center justify-center rounded-md border border-slate-200 bg-white px-2 text-sm font-medium tabular-nums text-slate-700 hover:bg-slate-50 disabled:opacity-40';

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* WHO */}
      <div className="flex items-center gap-4 border-b border-slate-100 px-5 py-4">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
          {p.imagename && !imgFailed && (
            <Image src={IMAGE_BASE + p.imagename} alt={p.title || p.groupid} fill sizes="80px" onError={() => setImgFailed(true)} className="object-contain" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-base font-semibold text-slate-900">{p.groupid}</span>
            {p.counter && <span className="text-xs tabular-nums text-slate-400">{p.counter}</span>}
          </div>
          <div className="mt-0.5 truncate text-sm text-slate-600" title={p.title || undefined}>{p.title || '—'}<span className="ml-2 text-slate-400">{p.brand}</span></div>
          {p.rrp !== null && (
            <div className="mt-0.5 text-sm text-slate-500">
              <button type="button" onClick={() => p.setPriceStr(p.rrp!.toFixed(2))} title="Put the RRP in the box (Set still saves it)"
                className={'hover:text-slate-900 ' + (valid && price > p.rrp + 0.005 ? 'text-amber-700' : '')}>
                {valid && price > p.rrp + 0.005 ? 'over ' : ''}RRP {money(p.rrp)}
              </button>
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

      {/* THE PRICE — the box with the nudges · profit · the market lines. */}
      <div className="px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          {NUDGES.filter((d) => d < 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} className={pill}>−£{-d}</button>
          ))}
          <div className="relative">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xl font-semibold text-slate-400">£</span>
            <input ref={boxRef} value={p.priceStr} onChange={(e) => p.setPriceStr(e.target.value)} inputMode="decimal" aria-label="New price"
              className="h-11 w-32 rounded-lg border border-slate-300 bg-white pl-7 pr-2 text-xl font-semibold tabular-nums text-slate-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" />
          </div>
          {NUDGES.filter((d) => d > 0).map((d) => (
            <button key={d} type="button" onClick={() => nudge(d)} className={pill}>+£{d}</button>
          ))}
          {moved && (
            <button type="button" onClick={() => p.setPriceStr(p.now !== null ? p.now.toFixed(2) : '')} className="text-xs text-slate-500 underline hover:text-slate-700">
              back to {money(p.now)}
            </button>
          )}
        </div>
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600">
          <span>Now <b className="tabular-nums text-slate-900">{money(p.now)}</b> keeps <b className={'tabular-nums ' + keepCls(profitNow)}>{money(profitNow)}</b> a pair</span>
          {changed && <span>→ at {money(price)} keeps <b className={'tabular-nums ' + keepCls(profit)}>{money(profit)}</b></span>}
        </div>
        <div className="mt-1.5 space-y-1 text-sm text-slate-600">{p.market}</div>
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
              className={'inline-flex h-11 items-center gap-1.5 rounded-lg px-6 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-400 '
                + (goingDown ? 'bg-red-600 hover:bg-red-700' : 'bg-emerald-600 hover:bg-emerald-700')}>
              {p.primary.label}
              {changed && p.now !== null && <span aria-label={price > p.now ? 'up' : 'down'}>{price > p.now ? '↑' : '↓'}</span>}
            </button>
          </span>
        </div>
        <div className="mt-2 flex h-5 items-baseline gap-x-4 overflow-hidden whitespace-nowrap text-sm">{p.note}</div>
      </div>
    </div>
  );
}
