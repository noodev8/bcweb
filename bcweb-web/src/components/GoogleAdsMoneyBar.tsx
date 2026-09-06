'use client';
/*
=======================================================================================================================================
Component: GoogleAdsMoneyBar
=======================================================================================================================================
Purpose: The Google Ads screen's headline. Shows what the Shopify catalogue EARNED against what Google CHARGED to earn it, for the
         window being worked, and — the point — for the same window a year ago at the same scale.

WHY THIS AND NOT A ROW OF STAT TILES
The module exists because of one relationship, and it is a relationship, not a number. Four tiles reading £4,122 / £3,656 / £466 / 9.0x
put the four figures side by side and leave the reader to do the division. Drawn as one bar they cannot be misread:

    Last 30 days          [ spend ······················ ][ kept ]      £4,122 earned · £3,656 to Google · £466 kept
    Same 30 days in 2025  [ spend ··········· ][ kept              ]    £2,145 earned · £964 to Google · £1,180 kept

Both bars are drawn to ONE shared scale, so the second is not a separate chart — it is the same measurement, a year back, and the
difference in how much dark is left is the finding. On the live data: profit nearly doubled year on year, spend went up 3.8x, and the
money actually kept FELL 60%. That is the sentence the screen has to say before anything else on it is worth reading.

DARK IS WHAT YOU KEEP
The filled dark segment is profit after ad spend; the pale segment is what went to Google. Deliberately that way round and not the
reverse: ink should track the thing you want more of, so a good month is a mostly-dark bar and a bad one is a bar that has almost
faded out. The alternative (dark = spend) makes a disastrous month look emphatic and a good one look empty.

WHEN SPEND EXCEEDS PROFIT the bar cannot just fill — that would cap at 100% and quietly hide a loss. The overspend is drawn as a
hatched tail past the end of the track, and the figure goes red. A window that lost money must not look like a window that broke even.

ROAS IS NOT HERE ON PURPOSE. A tROAS floor of 400-650% is a REVENUE target, and August 2026 cleared 9x revenue ROAS while the channel
kept 11% of its own profit. ROAS lives in the grid and the campaign panel, where it is one column among many, rather than at the top
where it would contradict the thing this component is for.
=======================================================================================================================================
*/

import { GoogleAdsWindow, GoogleAdsWindowMeta } from '@/lib/api';

// Whole pounds. Pence on a figure this size is noise, and every number here is a comparison rather than a reconciliation.
function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}

// 'Same 30 days last year' -> '6 Aug 2025 – 5 Sep 2025', from the ISO bounds the server measured. Built from the string's own parts:
// new Date('2025-08-06') is parsed as UTC midnight and prints as 5 August anywhere west of London.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ''}`;
}
function range(meta: GoogleAdsWindowMeta): string {
  const sameYear = meta.from.slice(0, 4) === meta.to.slice(0, 4);
  return `${shortDate(meta.from, !sameYear)} – ${shortDate(meta.to, true)}`;
}

interface RowProps {
  title: string;
  sub: string;
  w: GoogleAdsWindow;
  scale: number;
  muted?: boolean;
}

function Bar({ title, sub, w, scale, muted }: RowProps) {
  const kept = w.profitAfterSpend;
  const overspent = kept < 0;

  // Widths as a percentage of the shared scale. Guard the scale so an all-zero window renders an empty track rather than NaN.
  const pct = (v: number) => (scale > 0 ? Math.max(0, Math.min(100, (v / scale) * 100)) : 0);
  const spendPct = pct(w.spend);
  const keptPct = overspent ? 0 : pct(kept);
  // How far the loss runs past the earned total. Capped so a catastrophic window still fits its row.
  const overPct = overspent ? pct(Math.min(-kept, scale)) : 0;

  return (
    <div className={muted ? 'opacity-80' : ''}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold text-slate-800">{title}</span>
          <span className="text-xs text-slate-400">{sub}</span>
        </div>
        <div className="text-right">
          <span className={`text-lg font-semibold tabular-nums ${overspent ? 'text-red-600' : 'text-slate-900'}`}>
            {money(kept)}
          </span>
          <span className="ml-1.5 text-xs text-slate-500">kept</span>
        </div>
      </div>

      {/* NO TRACK FILL (owner, 2026-09-06 — "the bottom one has 3 sections, confused me").
          It used to sit on a slate-100 track. Because both bars share one scale, a smaller year only reaches part-way across and the
          unfilled remainder read as a THIRD SEGMENT — and the current window, which fills the track completely, hid the problem by
          never showing one. Unfilled space is now just space, so a shorter bar is obviously a shorter bar.
          `flex` rather than absolute positioning so the segments cannot overlap or leave a sub-pixel seam between them. */}
      <div className="flex h-7 w-full items-stretch overflow-hidden rounded-sm">
        {spendPct > 0 && (
          <div
            className="bg-slate-300"
            style={{ width: `${spendPct}%` }}
            title={`${money(w.spend)} to Google`}
          />
        )}
        {keptPct > 0 && (
          <div
            className="bg-slate-800"
            style={{ width: `${keptPct}%` }}
            title={`${money(kept)} kept`}
          />
        )}
        {overPct > 0 && (
          // Overspend: the tail past what was earned. Hatched rather than solid so it reads as "this ran off the end" and never as
          // just another segment of the same bar.
          <div
            className="border-l-2 border-red-500 bg-[repeating-linear-gradient(45deg,#fecaca_0,#fecaca_4px,#fee2e2_4px,#fee2e2_8px)]"
            style={{ width: `${overPct}%` }}
            title={`${money(-kept)} more spent than earned`}
          />
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs tabular-nums text-slate-500">
        <span><span className="font-medium text-slate-700">{money(w.profit)}</span> earned</span>
        <span><span className="font-medium text-slate-700">{money(w.spend)}</span> to Google</span>
        <span className="text-slate-400">{w.units.toLocaleString('en-GB')} units · {w.clicks.toLocaleString('en-GB')} clicks</span>
      </div>
    </div>
  );
}

interface Props {
  current: GoogleAdsWindow;
  currentMeta: GoogleAdsWindowMeta;
  lastYear: GoogleAdsWindow;
  lastYearMeta: GoogleAdsWindowMeta;
  // Only the 30-day window has a like-for-like year-ago partner. On 90d/365d the comparison is dropped rather than faked against a
  // mismatched span — half a comparison is worse than none, because it still invites the subtraction.
  showLastYear: boolean;
}

export default function GoogleAdsMoneyBar({ current, currentMeta, lastYear, lastYearMeta, showLastYear }: Props) {
  // ONE SHARED SCALE across both bars, or the year-on-year comparison is a lie — two bars each normalised to themselves would show a
  // shrinking business as two identical shapes. Taken from the largest of every figure drawn, so nothing can exceed the track.
  const scale = Math.max(
    current.profit, current.spend, Math.abs(current.profitAfterSpend),
    ...(showLastYear ? [lastYear.profit, lastYear.spend, Math.abs(lastYear.profitAfterSpend)] : []),
    1
  );

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      {/* The legend says what the two colours are, once, rather than leaving it to be inferred from the figures under each bar. Two
          swatches is cheap; guessing which block is which is not. */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Shopify profit after Google ad spend
        </h2>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" aria-hidden />
            to Google
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm bg-slate-800" aria-hidden />
            kept
          </span>
        </div>
      </div>
      <div className="space-y-4">
        <Bar title={currentMeta.label} sub={range(currentMeta)} w={current} scale={scale} />
        {showLastYear && (
          <Bar title="Same window last year" sub={range(lastYearMeta)} w={lastYear} scale={scale} muted />
        )}
      </div>
      <p className="mt-3 border-t border-slate-100 pt-2 text-xs text-slate-400">
        Bar length is what you earned; both bars share one scale, so a shorter bar earned less. Shopify sales only, profit net of
        fees, postage and returns.
      </p>
    </section>
  );
}
