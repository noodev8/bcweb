'use client';
/*
=======================================================================================================================================
Component: MatchAmazonPanel  (Shopify "match Amazon price" autopilot control)
=======================================================================================================================================
Purpose: Turn the auto-match ON/OFF for one style, and — when ON — show the operator that the price is on autopilot and what it's
         tracking (Amazon's cheapest in-stock size). Renders differently by state:

           OFF: a compact enable card sitting under the manual PriceSetter — "Match Amazon price" + the current Amazon-lowest hint.
           ON : a prominent card that REPLACES the manual setter — the match target, a "keep matching → set a review" snooze, and a
                Turn-off button.

         Matched styles stay IN the Winners list (owner: triage is where you re-decide whether a style should remain in the match
         bracket). Their price is on autopilot, so the action for them is NOT a manual price — it's "keep matching and set a review to
         snooze" (the same pricing-park / W2 write the normal setter uses) or "turn matching off" to price by hand.

         It only flips the flag (POST /pricing-match-toggle); the price itself is (re)matched by the standalone amz-match job on its own
         schedule (deliberately NOT named here — the schedule can change and shouldn't be baked into the UI).
=======================================================================================================================================
*/

import { useState } from 'react';
import { setMatchAmazon } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import ChannelBadge from '@/components/ChannelBadge';

// Same review day-set as the PriceSetter. No "None" here — snoozing a matched style needs a real period (like the setter's park action).
const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

interface Props {
  groupid: string;
  matchAmazon: boolean;              // current state (from the loaded drill header)
  amazonLowest: number | null;      // Amazon's cheapest in-stock size = the match target (null if none in stock)
  currentPrice: number | null;      // current Shopify price, for the "now vs target" line
  applying: boolean;                 // a park write is in flight (from the parent) — disables the review action
  onPark: (reviewDays: number) => void;  // "keep matching, set a review" — parks the style out of triage (W2)
  onChanged: () => void;            // parent reloads the drill after a successful on/off flip
}

export default function MatchAmazonPanel({ groupid, matchAmazon, amazonLowest, currentPrice, applying, onPark, onChanged }: Props) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewDays, setReviewDays] = useState<number | null>(null);   // picked snooze period (null = none picked yet)

  async function flip(enabled: boolean) {
    setBusy(true);
    setError(null);
    const res = await setMatchAmazon(groupid, enabled);
    if (res.success) {
      onChanged();
      return; // parent remounts/reloads; leave busy true so the button doesn't flash before the drill swaps
    }
    if (res.return_code === 'UNAUTHORIZED') { logout(); return; }
    setError(res.error || 'Failed to update Amazon matching');
    setBusy(false);
  }

  const lowStr = amazonLowest !== null ? `£${amazonLowest.toFixed(2)}` : null;

  // ---- ON: prominent card, replaces the manual setter ----------------------------------------------------------------------------
  if (matchAmazon) {
    const nowStr = currentPrice !== null ? `£${currentPrice.toFixed(2)}` : '—';
    const matched = amazonLowest !== null && currentPrice !== null && Math.round(amazonLowest * 100) === Math.round(currentPrice * 100);
    return (
      <div className="rounded-xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-t-xl border-b border-emerald-200 bg-emerald-50 px-5 py-2.5">
          <ChannelBadge channel="shopify" label="Shopify price" />
          <span className="text-xs font-medium text-emerald-700">Auto-matched to Amazon</span>
        </div>
        <div className="p-5">
          {lowStr ? (
            <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Match target (Amazon lowest in stock)</div>
                <div className="text-2xl font-semibold text-slate-900">{lowStr}</div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400">Shopify now</div>
                <div className="text-2xl font-semibold text-slate-900">{nowStr}</div>
              </div>
              <div className="text-sm">
                {matched
                  ? <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-2.5 py-1 font-medium text-green-700"><span className="h-2 w-2 rounded-full bg-green-500" /> In step</span>
                  : <span className="inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 font-medium text-amber-700"><span className="h-2 w-2 rounded-full bg-amber-500" /> Will match at next sync</span>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No in-stock Amazon size right now — nothing to match until Amazon has stock. The style stays on autopilot and will match when a size comes back in.</p>
          )}

          <p className="mt-4 text-xs text-slate-400">
            The price updates automatically on a schedule. Manual pricing is locked while matching is on — turn it off to price by hand.
          </p>

          {/* Keep matching, but snooze it out of the Winners list for a while (the "I've reviewed it — leave it matched" action). Uses the
              same park write (W2) as the normal setter; a period must be picked (no None). */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="mb-1 text-sm font-medium text-slate-700">
              Keep matching — review again in <span className="font-normal text-slate-400">(hides it from Winners until then)</span>
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {REVIEW_CHIPS.map((d) => (
                <button
                  key={d}
                  onClick={() => setReviewDays(d)}
                  className={'rounded-full border px-3.5 py-1.5 text-sm ' + (reviewDays === d ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}
                >
                  {d}
                </button>
              ))}
              <span className="text-sm text-slate-400">days</span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => reviewDays !== null && onPark(reviewDays)}
                disabled={applying || reviewDays === null}
                title={reviewDays === null ? 'Pick a review period to snooze this style' : undefined}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {applying ? 'Working…' : 'Set review'}
              </button>
              <button
                onClick={() => flip(false)}
                disabled={busy}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? 'Working…' : 'Turn off matching'}
              </button>
              <span className="text-xs text-slate-400">Turning off restores manual pricing (the last matched price stays until you change it).</span>
              {error && <span className="text-xs text-red-600">{error}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---- OFF: compact enable card, sits under the manual setter ---------------------------------------------------------------------
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700">Match Amazon price</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Auto-keep this style at Amazon&apos;s cheapest in-stock size{lowStr ? <> (now <span className="font-semibold text-slate-700">{lowStr}</span>)</> : <> (none in stock right now)</>}. Locks manual pricing; you still review it from Winners.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {error && <span className="text-xs text-red-600">{error}</span>}
          <button
            onClick={() => flip(true)}
            disabled={busy}
            className="rounded-md border border-emerald-300 bg-white px-3.5 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Match to Amazon'}
          </button>
        </div>
      </div>
    </div>
  );
}
