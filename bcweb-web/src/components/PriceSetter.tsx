'use client';
/*
=======================================================================================================================================
Component: PriceSetter  (the set-price control — CLAUDE.md)
=======================================================================================================================================
Purpose: The reduced-typing price control. Layout mirrors the owner's desktop app:

   [COST 20.83]  [RRP 50.00]  |36 37 37.5 38 39 40 41|  Amazon: 37.30-41.09   <- size run: every size + our count
                               | 0  1   1   3  2  1  0|
   New price  current £36.95                                    <- current is a quiet note on the label line
               [-£1][-50p]  [ 37.95 ]  [+50p][+£1][+£2]        <- big editable field
   Note:       [ optional — why the price is changing (saved to the price log) ]
   Review in:  (None)(3)(5)(7)(10)(14)(30)(90) days            <- single-select; None (default) = no review. No auto-suggested pick.
   [ Apply price ]   [ No change — just set review ]   [ Cancel ]

Rules, enforced here for UX and AGAIN on the server (never trust the client):
  - Nudge buttons step the editable price.
  - Disable Apply if price < cost. Warn (but allow) if price > rrp. (min/max shopify-price bounds removed per owner.)
  - Amazon's live price spread is shown on the reference line, and going under its lowest raises a note. Both ADVISORY, neither blocks:
    Shopify is priced independently of Amazon (2026-09-15, replacing the autopilot that pinned it to Amazon's cheapest in-stock size).
  - Review is OPTIONAL (None by default): a day chip parks the style out of triage until today+N; None leaves the review date untouched.
  - "No change — just set review" (park) needs a real period, so it's disabled while None is selected.
  - Note is optional and only enabled on a real price change; it's saved to the price_change_log row (was hardcoded blank before).
  - A price change REQUIRES a review period (chip). "No change — just set review" needs only a chip.
  - Suggested review per move type: raise ~7, cut ~14, hold ~30 (suggest; user can change).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import ChannelBadge from '@/components/ChannelBadge';
import { DrillHeader, SizeRow } from '@/lib/api';

const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

// Core Birkenstock sizes — our at-a-glance "is the run intact?" guardrail. Full core = it'll sell through, so a raise is safe; a
// gappy core is the classic "looks dead but it's just sold-out cores" trap before a cut (CLAUDE.md size-curve principle).
const CORE_SIZES = ['38', '39', '40'];

// Max length of the optional price-change note. Front-end only — kept short so notes stay to one tidy line on the Price Changes /
// history reports (the same cap is used on the Amazon setter and the bulk bar). The DB column is untouched.
const NOTE_MAX = 80;

interface PriceSetterProps {
  header: DrillHeader;
  sizes: SizeRow[];                                             // stock by size, full range (from the drill) — the size run
  applying: boolean;                                            // disables buttons while a write is in flight
  onApply: (newPrice: number, reviewDays: number | null, note: string) => void;
  onPark: (reviewDays: number) => void;
  onCancel: () => void;
}


export default function PriceSetter({ header, sizes, applying, onApply, onPark, onCancel }: PriceSetterProps) {
  const now = header.now;

  // Every size the style comes in (skumap's full range — sold-out sizes are rows with qty 0), in size order.
  const run = useMemo(
    () => [...sizes].sort((a, b) => (Number(a.size) - Number(b.size)) || a.size.localeCompare(b.size)),
    [sizes],
  );
  // Editable price starts at the current price (or blank if unknown). Kept as a string so the user can type freely.
  const [priceStr, setPriceStr] = useState<string>(now !== null ? now.toFixed(2) : '');
  // Review period: null = None (the default — no auto-suggested pick; the user chooses). An optional note rides the audit row.
  const [reviewDays, setReviewDays] = useState<number | null>(null);
  const [note, setNote] = useState('');

  const price = useMemo(() => {
    const p = parseFloat(priceStr);
    return Number.isFinite(p) ? p : NaN;
  }, [priceStr]);

  // The live margin dial that sat on the reference line was REMOVED (owner, 2026-09-24 — not used). Its ex-VAT reasoning (2026-08-31)
  // is in git history and the drill route; cost and RRP, now boxed, are the reference instead.

  // Bounds. (min/max removed per owner — unused; only the below-cost block and above-RRP warning remain.)
  const belowCost = header.cost !== null && Number.isFinite(price) && price < header.cost;
  const aboveRrp = header.rrp !== null && Number.isFinite(price) && price > header.rrp;
  // Ad floor — recomputed against the price IN THE BOX, not header.below_ad_floor (which describes the price already saved), so the
  // warning tracks the nudge buttons live. Advisory only: it never gates Apply.
  const belowAdFloor = header.ad_floor !== null && Number.isFinite(price) && price < header.ad_floor;
  // Undercutting our own Amazon listing. ADVISORY ONLY (owner, 2026-09-15) — deliberately NOT a bound like below-cost: Amazon prices
  // per size, this compares against the cheapest of them, and there are good reasons to sit under it (funding a Google click, moving
  // a size Amazon doesn't stock). It replaced the retired autopilot that made this comparison a RULE and pinned Shopify to it.
  const belowAmazon = header.amazon_lowest !== null && Number.isFinite(price) && price < header.amazon_lowest;
  const priceValid = Number.isFinite(price) && price > 0;
  const changed = now === null || (Number.isFinite(price) && Math.round(price * 100) !== Math.round(now * 100));

  const applyDisabled = applying || !priceValid || belowCost || !changed;

  function nudge(delta: number) {
    const base = Number.isFinite(price) ? price : (now ?? 0);
    const next = Math.max(0, Math.round((base + delta) * 100) / 100);
    setPriceStr(next.toFixed(2));
  }

  function pickReview(days: number) {
    setReviewDays(days);
  }
  function pickReviewNone() {
    setReviewDays(null);
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      {/* Platform banner — the Shopify and Amazon drills look near-identical, so name the channel RIGHT ON the control (not just in the
          top nav) to kill the "I thought I was changing the other platform" mix-up. Green = Shopify throughout; Apply here is LIVE. */}
      <div className="-mx-5 -mt-5 mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-t-xl border-b border-emerald-200 bg-emerald-50 px-5 py-2.5">
        <ChannelBadge channel="shopify" label="Shopify price" />
        <span className="text-xs text-emerald-700/80">Apply updates the live store immediately</span>
        {/* The review cooldown, here rather than as its own line above the card (owner, 2026-09-24): the band had room to spare. */}
        {header.next_review && <span className="ml-auto text-xs text-emerald-700/80">Parked until {header.next_review}</span>}
      </div>

      {/* Reference line: bounds / stock / Amazon */}
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        {/* COST AND RRP ARE THE TWO BOUNDS, SO THEY LEAD (owner, 2026-09-24 — "far more emphasised"). They were faint grey text at the
            end of the line, read last, when they are what every price here is judged against: Apply is BLOCKED under cost and FLAGGED
            over RRP. So: first on the line, boxed, with the figure as big as anything on the line. Neutral slate on purpose —
            a colour would read as a status (good/bad), and they are neither; they are the frame. */}
        <span className="inline-flex items-baseline gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 ring-1 ring-slate-200">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Cost</span>
          <span className="text-base font-semibold text-slate-900">{header.cost !== null ? `£${header.cost.toFixed(2)}` : '—'}</span>
        </span>
        <span className="inline-flex items-baseline gap-1.5 rounded-md bg-slate-100 px-2.5 py-1 ring-1 ring-slate-200">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">RRP</span>
          <span className="text-base font-semibold text-slate-900">{header.rrp !== null ? `£${header.rrp.toFixed(2)}` : '—'}</span>
        </span>
        {/* THE SIZE RUN (owner, 2026-09-24): every size with our count, replacing "Stock: N" and the three core chips. A total hides
            the shape — 10 pairs all in 36 and 41 is not 10 pairs you can sell — and the full run (sold-out sizes shown as a faint 0,
            not hidden) is the guardrail the old size curve gave before a cut, in one glance-sized strip. Core 38/39/40 keep their
            a shaded cell; the graded "Core 3/3" badge went (owner, 2026-09-24) — the shaded cells say the same thing. */}
        {run.length > 0 && (
          <span className="inline-flex items-center gap-2" title="Our sellable stock by size. Core sizes 38/39/40 are shaded — a full core sells through (safe to raise); a gappy core can look dead when it's just sold-out cores.">
            <span className="inline-flex overflow-hidden rounded-md ring-1 ring-slate-200">
              {run.map((r, i) => {
                const isCore = CORE_SIZES.includes(r.size);
                return (
                  <span
                    key={r.size}
                    className={'flex min-w-8 flex-col items-center px-1 py-0.5 leading-tight ' + (isCore ? 'bg-slate-100' : 'bg-white') + (i > 0 ? ' border-l border-slate-200' : '')}
                  >
                    <span className={'font-mono text-[10px] ' + (isCore ? 'font-semibold text-slate-600' : 'text-slate-400')}>{r.size}</span>
                    <span className={'text-xs font-semibold ' + (r.qty > 0 ? 'text-slate-800' : 'text-slate-300')}>{r.qty}</span>
                  </span>
                );
              })}
            </span>
          </span>
        )}
        {/* What Amazon is charging for the same style, as a SPREAD — Amazon prices per size, so a single figure would be a fiction.
            Shown only when a size is actually live there. Reference for the decision, not a bound on it; the per-size detail is in the
            size curve below. Collapses to one figure when every live size happens to sit at the same price. */}
        {header.amazon_lowest !== null && (
          <span
            className="text-slate-500"
            title={
              `Amazon's live price across its in-stock sizes${header.amazon_live_total ? `, ${header.amazon_live_total} units` : ''}. ` +
              'Amazon prices per size and Shopify per style, so there is no single price to match. Reference only — it does not block an apply.'
            }
          >
            Amazon:{' '}
            <span className="font-semibold text-slate-800">
              £{header.amazon_lowest.toFixed(2)}
              {header.amazon_highest !== null && Math.round(header.amazon_highest * 100) !== Math.round(header.amazon_lowest * 100)
                ? `–£${header.amazon_highest.toFixed(2)}`
                : ''}
            </span>
          </span>
        )}
        {/* Ad floor. Rendered ONLY when the server could actually derive one — a floor built on a handful of clicks reads as
            authoritative as a solid one, so 'none' shows nothing rather than a hedged number. A 'segment' floor is an estimate
            borrowed from neighbouring styles and says so, both in the label and in the tooltip. */}
        {header.ad_floor !== null && (
          <span
            className="text-slate-500"
            title={
              `Below this price the style stops paying for its own Google ads. A customer cost £${header.ad_cost_per_sale?.toFixed(2)} ` +
              `over the last ${header.ad_floor_basis?.days ?? 90} days` +
              (header.ad_floor_confidence === 'segment'
                ? ', estimated from this style’s segment because its own ad data is too thin to trust.'
                : ` (${header.ad_floor_basis?.clicks} clicks, ${header.ad_floor_basis?.units} sold, £${header.ad_floor_basis?.spend.toFixed(2)} spent).`) +
              ' Advisory only — it does not block an apply.'
            }
          >
            Ad floor: <span className="font-semibold text-slate-800">£{header.ad_floor.toFixed(2)}</span>
            {header.ad_floor_confidence === 'segment' && <span className="text-slate-400"> (est)</span>}
          </span>
        )}
      </div>

      {/* New price row: nudge down | editable | nudge up */}
      {/* CURRENT lives here now, quietly, on the label line (owner, 2026-09-24): it was first on the reference line, competing with
          the bounds — but it is only the starting point of the box below, so it sits beside it as a small grey note. */}
      <div className="mb-1 flex items-baseline gap-2">
        <span className="text-sm font-medium text-slate-700">New price</span>
        <span className="text-xs text-slate-400">current {now !== null ? `£${now.toFixed(2)}` : '—'}</span>
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button onClick={() => nudge(-1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−£1</button>
        <button onClick={() => nudge(-0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">−50p</button>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-slate-400">£</span>
          <input
            value={priceStr}
            onChange={(e) => setPriceStr(e.target.value)}
            inputMode="decimal"
            className="w-32 rounded-md border-2 border-slate-300 py-2 pl-7 pr-2 text-center text-xl font-semibold text-slate-900 focus:border-brand-500 focus:outline-none"
          />
        </div>
        <button onClick={() => nudge(0.5)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+50p</button>
        <button onClick={() => nudge(1)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+£1</button>
        <button onClick={() => nudge(2)} className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50">+£2</button>
        {/* Reset to RRP — fills the box with the style's RRP; nothing is written until Apply, so the usual bounds still speak. */}
        <button
          onClick={() => header.rrp !== null && setPriceStr(header.rrp.toFixed(2))}
          disabled={header.rrp === null}
          title={header.rrp === null ? 'No RRP on file' : `Reset to RRP (£${header.rrp.toFixed(2)})`}
          className="ml-1 rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40"
        >
          Reset to RRP
        </button>
      </div>

      {/* Bound feedback */}
      <div className="mb-4 min-h-[1.25rem] text-xs">
        {belowCost && <span className="text-red-600">Below cost (£{header.cost!.toFixed(2)}) — can&apos;t apply.</span>}
        {!belowCost && aboveRrp && (
          <span className="text-amber-600">Above RRP (£{header.rrp!.toFixed(2)}) — allowed, but check.</span>
        )}
        {/* The ad-floor advisory sits BELOW the two existing bounds in priority: those are about the price itself, this is about what
            the customer cost to buy. Shown only when neither of them is already speaking, so the line never stacks two warnings. */}
        {!belowCost && !aboveRrp && belowAdFloor && (
          <span className="text-amber-600">
            Below the ad floor (£{header.ad_floor!.toFixed(2)}
            {header.ad_floor_confidence === 'segment' ? ', est' : ''}) — at this price the ads cost more than the unit makes.
          </span>
        )}
        {/* Bottom of the priority order: the three above are about whether the price works at all, this is a channel judgement the
            operator may well overrule. Slate, not amber — it is information, not a warning. Never stacks with the others. */}
        {!belowCost && !aboveRrp && !belowAdFloor && belowAmazon && (
          <span className="text-slate-500">
            Under your Amazon lowest (£{header.amazon_lowest!.toFixed(2)}) — you&apos;d undercut your own listing. Fine if that&apos;s the intent.
          </span>
        )}
      </div>

      {/* Note (optional) — saved to the price_change_log row. Only meaningful on a real price change (Apply is the only path that logs). */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Note <span className="font-normal text-slate-400">(optional — saved to the price log)</span>
      </div>
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={!changed}
        maxLength={NOTE_MAX}
        placeholder={changed ? 'Why the price is changing' : 'Change the price to add a note'}
        className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
      />
      {/* Live length counter — keeps notes tidy on the reports (they render on one line). Amber once the cap is reached. */}
      <div className={'mb-4 text-right text-xs ' + (note.length >= NOTE_MAX ? 'text-amber-600' : 'text-slate-400')}>
        {note.length}/{NOTE_MAX}
      </div>

      {/* Review chips — optional single-select. None (default) leaves the review date untouched; a day parks the style out of triage. */}
      <div className="mb-1 text-sm font-medium text-slate-700">
        Review in <span className="font-normal text-slate-400">(optional — hides from pricing triage until then)</span>
      </div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        {/* Explicit None (no review) — selected by default. */}
        <button
          onClick={pickReviewNone}
          className={
            'rounded-full border px-3.5 py-1.5 text-sm ' +
            (reviewDays === null ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
          }
        >
          None
        </button>
        {REVIEW_CHIPS.map((d) => {
          const isSel = reviewDays === d;
          return (
            <button
              key={d}
              onClick={() => pickReview(d)}
              className={
                'rounded-full border px-3.5 py-1.5 text-sm ' +
                (isSel ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')
              }
            >
              {d}
            </button>
          );
        })}
        <span className="text-sm text-slate-400">days</span>
      </div>

      {/* Actions */}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onApply(Math.round(price * 100) / 100, reviewDays, note.trim())}
          disabled={applyDisabled}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          {applying ? 'Applying…' : 'Apply to Shopify'}
        </button>
        <button
          onClick={() => reviewDays !== null && onPark(reviewDays)}
          disabled={applying || reviewDays === null}
          title={reviewDays === null ? 'Pick a review period (not None) to park without changing the price' : undefined}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          No change — just set review
        </button>
        <button
          onClick={onCancel}
          disabled={applying}
          className="rounded-md px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
