'use client';
/*
=======================================================================================================================================
Component: BulkActionBar  (bulk price + review control for the Winners/Losers lists)
=======================================================================================================================================
Purpose: The collapsible bulk editor that sits above a Winners/Losers table once rows are ticked. It mirrors the individual drill's
         price-setter — the SAME two independent actions, applied across a selection instead of one item:

           1. Apply a RELATIVE price move built from the same denomination buttons as the drill (e.g. tap +50p twice -> +£1.00). Because
              the selected rows sit at different current prices, the move is a signed DELTA applied to each row's own price — not one typed
              absolute price. Optionally also parks each row (a review chip), exactly like the drill's Apply.
           2. Set a review period only (no price change) — the bulk "park", for rows the operator looked at and is leaving unchanged.

         Both are optional and independent: price-only, review-only, or both — just like the drill. This bar is deliberately DUMB: it owns
         only its own input state and emits the operator's intent via two callbacks. Each list page owns the actual writes (Shopify loops
         POST /pricing-apply so every style's live Shopify+Google push still runs; Amazon loops POST /amz-apply and queues the upload
         basket; review-only uses the batch park endpoints). The page feeds back `busy`, `progress` and a `resultSummary` so the bar can
         show "Applying 4/8…" and the outcome without owning any of it.

         Collapsed by default so the list stays lean until the operator opens it (the card gets tall when expanded).
=======================================================================================================================================
*/

import { useMemo, useState } from 'react';
import ChannelBadge from '@/components/ChannelBadge';

// One nudge button = a labelled signed £ delta (the drill's denominations, passed in per channel so the two stay identical).
export interface Nudge { label: string; delta: number; }

// Max length of the optional bulk price-change note. Front-end only — kept short so notes stay to one tidy line on the Price Changes /
// history reports (matches the Shopify + Amazon single price-setters). The price-log columns are untouched.
const NOTE_MAX = 80;

// Per-channel banner (logo + live-vs-queued note) so the operator can never mistake WHICH channel a bulk change hits — the same guard
// the individual price-setters use (the two screens look near-identical). Amber = Amazon (queued upload), green = Shopify (live push).
const CHANNEL_BANNER: Record<'shopify' | 'amazon', { wrap: string; note: string; noteClass: string }> = {
  shopify: { wrap: 'border-emerald-200 bg-emerald-50', note: 'Apply updates the live Shopify store immediately', noteClass: 'text-emerald-700/80' },
  amazon: { wrap: 'border-amber-200 bg-amber-50', note: 'Apply queues a Seller Central upload — no live change', noteClass: 'text-amber-700/90' },
};

// Per-channel theming so the bar reads as the right platform (green = Shopify / live, amber = Amazon / queued), matching the drills.
export interface BulkTone {
  chipOn: string;      // selected review chip / active accent (bg+border+text)
  applyBtn: string;    // primary "apply price" button
  panel: string;       // expanded panel border/tint
}

interface BulkActionBarProps {
  channel: 'shopify' | 'amazon';                   // drives the logo banner (which channel this bulk change hits)
  count: number;                                   // how many rows are ticked
  nudges: Nudge[];                                 // channel denominations (signed), left(-) to right(+)
  reviewChips: number[];                           // review-period options in days (None is added by the bar)
  tone: BulkTone;
  busy: boolean;                                   // a write is in flight — disable inputs
  progress: { done: number; total: number } | null; // live loop progress (price apply loops per row); null when idle
  resultSummary: string | null;                    // outcome line from the last run (e.g. "Applied 5 · 1 below cost skipped")
  error: string | null;
  noteEnabled?: boolean;                           // Amazon/Shopify both log an optional note on a price change; default true
  onApplyPrice: (delta: number, reviewDays: number | null, note: string) => void;
  onSetReview: (reviewDays: number) => void;
  // OPTIONAL absolute mode ("set all to £X"). Passing this is what reveals the Move by / Set all to toggle — omit it and the bar behaves
  // exactly as it always has, relative-only. Deliberately opt-in per page: Shopify's Apply pushes live to the store, so its lists keep
  // the relative-only bar until the owner asks otherwise (owner, 2026-07-25).
  onApplySetPrice?: (price: number, reviewDays: number | null, note: string) => void;
}

// Format a signed delta as "+£1.00" / "−£0.50" / "£0.00" (proper minus sign, matching the drill's button glyphs).
function fmtDelta(d: number): string {
  const abs = Math.abs(d).toFixed(2);
  if (d > 0) return `+£${abs}`;
  if (d < 0) return `−£${abs}`;
  return `£${abs}`;
}

// Read the typed move box into a number. Tolerates what an operator actually types — a leading "+", a "£", spaces, or a half-finished
// "-" / "." mid-keystroke (all of which parse to 0 rather than NaN, so the bar just stays disabled until the number is real).
function parseDelta(raw: string): number {
  const n = Number.parseFloat(raw.replace(/[£+\s,]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export default function BulkActionBar({
  channel, count, nudges, reviewChips, tone, busy, progress, resultSummary, error, noteEnabled = true, onApplyPrice, onSetReview,
  onApplySetPrice,
}: BulkActionBarProps) {
  const banner = CHANNEL_BANNER[channel];
  const [open, setOpen] = useState(false);
  // TWO WAYS TO PRICE A SELECTION, because they answer different jobs and neither can do the other's:
  //   'move' — a signed DELTA applied to each row's own price. Right when the rows are sensibly priced relative to each other and the
  //            whole set should shift ("everything up 50p").
  //   'set'  — ONE absolute price written to every row. Right when the rows have DRIFTED apart and the spread is the problem: an Amazon
  //            repricer can leave one size run at £55.59/£77.19/£56.99/£72.99/£62.19, and no delta can pull that back into line (owner,
  //            2026-07-25). Only available when the page passes onApplySetPrice.
  // Each mode keeps its own typed box, so switching back and forth never silently reinterprets a number as the other kind.
  const canSetPrice = typeof onApplySetPrice === 'function';
  const [mode, setMode] = useState<'move' | 'set'>('move');
  const active: 'move' | 'set' = canSetPrice ? mode : 'move';
  // Both boxes are TEXT, not numbers: an operator mid-keystroke ("-", "7.") isn't a valid number yet, and a number input would fight
  // them for it. parseDelta turns whatever is there into a usable figure (0 while it's unusable, which just leaves Apply disabled).
  const [moveText, setMoveText] = useState('0.00');
  const [setText, setSetText] = useState('');
  const [note, setNote] = useState('');
  // Review period the actions use. null = None (default) — Apply won't park; "Set review" is disabled (needs a real period).
  const [reviewDays, setReviewDays] = useState<number | null>(null);

  const delta = parseDelta(moveText);
  const setPrice = parseDelta(setText);

  // The +/- buttons drive whichever box is active — in 'set' mode they nudge the target price itself, so they stay useful rather than
  // going dead (owner: "the + and - should work regardless").
  function bump(d: number) {
    if (active === 'set') {
      setSetText((prev) => Math.max(0, Math.round((parseDelta(prev) + d) * 100) / 100).toFixed(2));
    } else {
      setMoveText((prev) => (Math.round((parseDelta(prev) + d) * 100) / 100).toFixed(2));
    }
  }
  function resetPrice() {
    if (active === 'set') setSetText('');
    else setMoveText('0.00');
  }

  const hasMove = Math.abs(delta) >= 0.005;
  const hasSetPrice = setPrice >= 0.01;
  const priceStaged = active === 'set' ? hasSetPrice : hasMove;
  const priceDisabled = busy || count === 0 || !priceStaged;
  const reviewOnlyDisabled = busy || count === 0 || reviewDays === null;

  // Header summary line — count + a hint of what's staged.
  const staged = useMemo(() => {
    const bits: string[] = [];
    if (active === 'set') { if (hasSetPrice) bits.push(`→ £${setPrice.toFixed(2)}`); }
    else if (hasMove) bits.push(fmtDelta(delta));
    if (reviewDays !== null) bits.push(`review ${reviewDays}d`);
    return bits.join(' · ');
  }, [active, hasMove, delta, hasSetPrice, setPrice, reviewDays]);

  return (
    <div className={'mb-4 overflow-hidden rounded-lg border bg-white ' + tone.panel}>
      {/* Collapsed header — always visible: selection count, staged summary, expand toggle. */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-slate-700">
          {count > 0 ? `${count} selected` : 'Select rows to bulk edit'}
        </span>
        {staged && <span className="text-xs text-slate-500">{staged}</span>}
        {progress && (
          <span className="text-xs font-medium text-slate-500">Applying {progress.done}/{progress.total}…</span>
        )}
        {resultSummary && !progress && <span className="text-xs font-medium text-emerald-700">{resultSummary}</span>}
        <span className="ml-auto text-xs text-slate-400">{open ? 'Hide ▾' : 'Bulk edit ▸'}</span>
      </button>

      {open && (
        <div className="border-t border-slate-100">
          {/* Channel banner — logo + live-vs-queued note, shown once the panel is open so the operator can't mistake which channel a bulk
              change hits (the Shopify and Amazon lists look near-identical). Same guard as the individual price-setter cards. */}
          <div className={'flex flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b px-4 py-2 ' + banner.wrap}>
            <ChannelBadge channel={channel} label={channel === 'amazon' ? 'Amazon — bulk price' : 'Shopify — bulk price'} />
            <span className={'text-xs ' + banner.noteClass}>{banner.note}</span>
          </div>

          <div className="px-4 py-4">
          {/* MODE TOGGLE — only when the page offers absolute pricing. Two tabs rather than one clever box: the same typed number means
              two completely different things ("+5" vs "£5"), so the mode has to be visible at all times, and the Apply button below
              restates it in words as the final guard. */}
          {canSetPrice && (
            <div className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5">
              {([['move', 'Move by'], ['set', 'Set all to']] as const).map(([k, label]) => (
                <button key={k} onClick={() => setMode(k)} disabled={busy} aria-pressed={active === k}
                  className={'rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ' +
                    (active === k ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  {label}
                </button>
              ))}
            </div>
          )}

          {/* The price figure — typed directly, with the denomination buttons adjusting whatever is in the box. */}
          <div className="mb-1 text-sm font-medium text-slate-700">
            {active === 'set' ? (
              <>Price <span className="font-normal text-slate-400">(every selected row is set to this exact price)</span></>
            ) : (
              <>Price move <span className="font-normal text-slate-400">(applied to each row&apos;s current price)</span></>
            )}
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {nudges.filter((n) => n.delta < 0).map((n) => (
              <button key={n.label} onClick={() => bump(n.delta)} disabled={busy}
                className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{n.label}</button>
            ))}
            {/* Typed box. Focus selects the whole value so typing straight over it replaces the figure (owner: "type a value over the
                0.00"). Kept text + inputMode=decimal so a half-typed "-" or "7." doesn't get eaten by a number input. */}
            <div className={'flex w-32 items-center rounded-md border-2 bg-white px-2 py-2 ' +
              (active === 'set' && hasSetPrice ? 'border-slate-400' : 'border-slate-300')}>
              <span className="pl-0.5 text-xl font-semibold text-slate-400">£</span>
              <input
                value={active === 'set' ? setText : moveText}
                onChange={(e) => (active === 'set' ? setSetText(e.target.value) : setMoveText(e.target.value))}
                onFocus={(e) => e.target.select()}
                inputMode="decimal"
                disabled={busy}
                placeholder={active === 'set' ? '0.00' : '0.00'}
                aria-label={active === 'set' ? 'Price to set on every selected row' : 'Price move applied to each row'}
                className="w-full min-w-0 bg-transparent text-center text-xl font-semibold text-slate-900 outline-none placeholder:text-slate-300 disabled:text-slate-400"
              />
            </div>
            {nudges.filter((n) => n.delta > 0).map((n) => (
              <button key={n.label} onClick={() => bump(n.delta)} disabled={busy}
                className="rounded-md border border-slate-300 px-2.5 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">{n.label}</button>
            ))}
            <button onClick={resetPrice} disabled={busy || !priceStaged}
              className="ml-1 rounded-md px-2.5 py-2 text-xs text-slate-500 hover:bg-slate-50 disabled:opacity-40">reset</button>
          </div>

          {/* Absolute mode is the blunter instrument — it overwrites every selected price rather than nudging it, so say plainly what is
              about to happen. Per-row server bounds (below cost blocked, above RRP flagged) still apply on each write. */}
          {active === 'set' && hasSetPrice && count > 0 && (
            <div className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              All <strong>{count}</strong> selected {count === 1 ? 'row' : 'rows'} will be set to <strong>£{setPrice.toFixed(2)}</strong>,
              whatever they are priced at now — the current spread between them is discarded.
            </div>
          )}

          {/* Optional note — saved to each row's price-log row on a price change (mirrors the drill). Only meaningful with a move. */}
          {noteEnabled && (
            <>
              <div className="mb-1 text-sm font-medium text-slate-700">Note <span className="font-normal text-slate-400">(optional — saved to the price log for each change)</span></div>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                disabled={busy || !priceStaged}
                maxLength={NOTE_MAX}
                placeholder={priceStaged ? 'Why the prices are changing' : active === 'set' ? 'Set a price to add a note' : 'Set a price move to add a note'}
                className="mb-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              />
              {/* Live length counter — keeps notes tidy on the reports (they render on one line). Amber once the cap is reached. */}
              <div className={'mb-4 text-right text-xs ' + (note.length >= NOTE_MAX ? 'text-amber-600' : 'text-slate-400')}>
                {note.length}/{NOTE_MAX}
              </div>
            </>
          )}

          {/* Review chips — optional single-select, shared by both actions exactly like the drill: Apply uses it as an optional park,
              "Set review" requires a real (non-None) period. */}
          <div className="mb-1 text-sm font-medium text-slate-700">Review in <span className="font-normal text-slate-400">(optional — hides from triage until then)</span></div>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button onClick={() => setReviewDays(null)} disabled={busy}
              className={'rounded-full border px-3.5 py-1.5 text-sm disabled:opacity-50 ' + (reviewDays === null ? tone.chipOn : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>None</button>
            {reviewChips.map((d) => (
              <button key={d} onClick={() => setReviewDays(d)} disabled={busy}
                className={'rounded-full border px-3.5 py-1.5 text-sm disabled:opacity-50 ' + (reviewDays === d ? tone.chipOn : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>{d}</button>
            ))}
            <span className="text-sm text-slate-400">days</span>
          </div>

          {/* Actions — mirror the drill's two buttons. */}
          <div className="flex flex-wrap items-center gap-3">
            {/* The button STATES THE OUTCOME rather than saying a generic "Apply" — it is the last place the operator can catch a
                misread mode, and "+£5.00" vs "£70.00" is the whole difference between nudging a set and flattening it. */}
            <button
              onClick={() => (active === 'set'
                ? onApplySetPrice && onApplySetPrice(setPrice, reviewDays, note.trim())
                : onApplyPrice(delta, reviewDays, note.trim()))}
              disabled={priceDisabled}
              className={'rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-50 ' + tone.applyBtn}
            >
              {busy && progress
                ? 'Applying…'
                : active === 'set'
                  ? `Set all ${count} to ${hasSetPrice ? `£${setPrice.toFixed(2)}` : '…'}`
                  : `Apply ${hasMove ? fmtDelta(delta) + ' ' : ''}to ${count}`}
            </button>
            <button
              onClick={() => reviewDays !== null && onSetReview(reviewDays)}
              disabled={reviewOnlyDisabled}
              title={reviewDays === null ? 'Pick a review period (not None) to set a review without changing prices' : undefined}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Set review on {count} (no price change)
            </button>
          </div>

          {resultSummary && !progress && <div className="mt-3 text-xs text-slate-500">{resultSummary}</div>}
          {error && <div className="mt-2 text-xs text-red-600">{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
