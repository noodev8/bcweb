'use client';
/*
=======================================================================================================================================
Component: GoogleAdsDrill
=======================================================================================================================================
Purpose: One style, opened out. Answers the question the grid cannot: "did moving this style change anything?"

THE LABEL RUNS ARE THE POINT
Google keeps true per-day custom-label history, so we can show every bucket a style has actually served under with the money spent
under each — going back as far as the imported data reaches. That is the module's evidence, and it is the only place the
bucket-versus-split argument can be settled with numbers rather than instinct:

    C00           2025-08-01 → 2026-04-13   256 days   £89.74 spent   £701 returned   7.8×
    BIRK-WINNER   2026-04-29 → 2026-09-05   130 days   £704.35 spent  £4,240 returned 6.0×

RUNS CAN OVERLAP BY A DAY OR TWO, AND THAT IS THE DATA, NOT A BUG. On the day a label changes Google splits the day's activity across
both labels and reports two rows, so the changeover day belongs to the run either side of it. The totals still reconcile exactly to
the style's own total; only the date ranges touch.

A short run with no clicks and no spend is real but uninteresting — the tail of a changeover. It is drawn quietly rather than dropped,
because "we spent nothing under that label" and "we have no data" are different facts.

WHAT THE ASSIGNMENT LOG ADDS THAT GOOGLE CANNOT
Google records what the label WAS. It never records who decided it, or when they decided it — and the ~day between an assignment and
the feed carrying it is invisible to Google entirely. The log starts 2026-09-05 and cannot be backfilled, so it is empty on most
styles and that is expected rather than broken.
=======================================================================================================================================
*/

import Image from 'next/image';
import Link from 'next/link';
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { getGoogleAdsDrill, GoogleAdsLabelRun } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}
const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

function money(v: number): string {
  const r = Math.round(v);
  return `${r < 0 ? '-' : ''}£${Math.abs(r).toLocaleString('en-GB')}`;
}

/**
 * A link out to another module for this same style. Opens in a NEW TAB on purpose: the operator is part-way through working a
 * filtered list here, and navigating away would lose the narrowing, the cuts and the selection they had built up.
 */
function NavPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 rounded-full border border-slate-300 px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-800"
    >
      {label}
      <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5 text-slate-400" />
    </Link>
  );
}

/** A run with no activity at all — drawn quietly. Usually one or two days at a changeover. */
function isQuiet(r: GoogleAdsLabelRun): boolean {
  return r.clicks === 0 && r.spend === 0 && r.impressions === 0;
}

export default function GoogleAdsDrill({ groupid, onClose }: { groupid: string; onClose: () => void }) {
  const q = useApiQuery(`google-ads-drill:${groupid}`, () => getGoogleAdsDrill(groupid));
  const d = q.data;

  return (
    // A right-hand sheet rather than a modal: the grid stays readable behind it, so you can see the row you came from and the ones
    // around it while reading the history.
    <div className="fixed inset-0 z-30 flex justify-end" role="dialog" aria-modal="true" aria-label={`${groupid} detail`}>
      <button type="button" className="flex-1 bg-slate-900/20" onClick={onClose} aria-label="Close detail" />
      <div className="flex w-full max-w-2xl flex-col overflow-y-auto border-l border-slate-300 bg-white shadow-xl">
        <div className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{groupid}</h2>
            <p className="text-sm text-slate-500">{d?.header.title || (q.isLoading ? 'Loading…' : '—')}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label="Close">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        {q.error && (
          <div className="m-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {q.error.message}
          </div>
        )}

        {d && (
          <div className="space-y-6 px-5 py-4">
            {/* ---- picture + header facts -------------------------------------------------------------------------------
                THE PICTURE IS THE FASTEST FACT ON THE PANEL (owner, 2026-09-06). A groupid and a stripped title identify a style to
                the database; the photograph identifies it to a person, and the judgement being made here — is this a summer sandal
                I should stop paying for right now? — is answered by looking at it long before any column is read.
                Intrinsic size is unknown (legacy image library), so next/image gets a fixed box and object-contain letterboxes it. */}
            <div className="flex gap-4">
              {d.header.imagename && (
                <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white">
                  <Image
                    src={`${IMAGE_BASE}${d.header.imagename}`}
                    alt={d.header.title || groupid}
                    fill
                    sizes="112px"
                    className="object-contain"
                  />
                </div>
              )}
              <dl className="grid flex-1 grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Campaign</dt><dd className="font-medium text-slate-800">{d.header.campaign || '—'}</dd></div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Google says</dt>
                <dd className={`font-medium ${d.header.googleLabel && d.header.googleLabel.toUpperCase() !== d.header.campaign.toUpperCase() ? 'text-amber-700' : 'text-slate-800'}`}>
                  {d.header.googleLabel || '—'}
                </dd>
              </div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Stock</dt><dd className="font-medium tabular-nums text-slate-800">{d.header.stock}</dd></div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Price</dt>
                {/* Amber when the price sits under the ad floor — the one state where a perfectly ordinary-looking price is losing
                    money on every unit once the click is paid for. */}
                <dd className={`font-medium tabular-nums ${d.header.belowAdFloor ? 'text-amber-700' : 'text-slate-800'}`}>
                  {d.header.price === null ? '—' : money(d.header.price)}
                </dd>
              </div>
              {/* Rendered only when the server could derive a floor: a number built on a handful of clicks would read as confidently
                  as a solid one. 'segment' is an estimate borrowed from neighbouring styles and is labelled (est). */}
              {d.header.adFloor !== null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-slate-400">Ad floor</dt>
                  <dd
                    className={`font-medium tabular-nums ${d.header.belowAdFloor ? 'text-amber-700' : 'text-slate-800'}`}
                    title={
                      `A customer cost £${d.header.adCostPerSale?.toFixed(2)} over the last 90 days (Google spend / units sold). ` +
                      `Below £${d.header.adFloor.toFixed(2)} the unit does not cover that.` +
                      (d.header.adFloorConfidence === 'segment' ? ' Estimated from this style’s segment — its own ad data is too thin to trust.' : '') +
                      ' Fixed 90-day basis, so it does not follow the window switch. Advisory only.'
                    }
                  >
                    {money(d.header.adFloor)}
                    {d.header.adFloorConfidence === 'segment' && <span className="text-slate-400"> (est)</span>}
                  </dd>
                </div>
              )}
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Segment</dt><dd className="text-slate-700">{d.header.segment || '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Brand</dt><dd className="text-slate-700">{d.header.brand || '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">Season</dt><dd className="text-slate-700">{d.header.season || '—'}</dd></div>
              <div><dt className="text-xs uppercase tracking-wide text-slate-400">In feed</dt><dd className="text-slate-700">{d.header.googleLive ? 'Yes' : 'No'}</dd></div>
              </dl>
            </div>

            {/* ---- jump to the other modules ------------------------------------------------------------------------------
                This panel diagnoses; it does not fix. Every conclusion it supports hands off somewhere else — a thin margin is a
                Shopify Pricing job, an empty size run is an Add/Modify or ordering job — and without these the operator reads the
                answer here, then goes and retypes the groupid into another screen's search box.
                Each uses the deep-link convention that module already has: /pricing/style/<groupid> lands directly, Amazon is SKU
                grain so it goes through its find with ?q=, and Add/Modify takes ?groupid= and opens on the edit panel. */}
            <div className="flex flex-wrap gap-2">
              <NavPill href={`/pricing/style/${encodeURIComponent(groupid)}`} label="Shopify price" />
              <NavPill href={`/amz/find?q=${encodeURIComponent(groupid)}`} label="Amazon price" />
              <NavPill href={`/products?groupid=${encodeURIComponent(groupid)}`} label="Add / Modify" />
            </div>

            {/* ---- size curve ------------------------------------------------------------------------------------------
                WHERE the holes are, not just how many. The grid's "4/11" says the shelf is thin; this says whether it is thin in a
                way that matters. Missing 45 and 46 costs almost nothing. Missing 38, 39 and 40 is why a style can take 117 clicks
                and make one sale — most of the demand sits in the middle of the run, and those people clicked, found nothing in
                their size and left. That distinction decides whether the row wants pausing or repricing. */}
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Sizes on the shelf</h3>
              {d.sizes.length === 0 ? (
                <p className="text-sm text-slate-400">This style carries no sizes.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1">
                    {d.sizes.map((sz) => (
                      <div
                        key={sz.size}
                        title={sz.qty === 0 ? `Size ${sz.size} — none on the shelf` : `Size ${sz.size} — ${sz.qty} on the shelf`}
                        className={`w-11 rounded border px-1 py-1 text-center ${
                          sz.qty === 0
                            ? 'border-amber-200 bg-amber-50 text-amber-700'
                            : 'border-slate-200 bg-white text-slate-700'
                        }`}
                      >
                        <div className="text-xs text-slate-500">{sz.size}</div>
                        <div className="text-sm font-semibold tabular-nums">{sz.qty}</div>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-400">
                    {d.sizes.filter((x) => x.qty > 0).length} of {d.sizes.length} sizes in stock. An empty size still costs you
                    clicks — the ad runs on the style, not the size.
                  </p>
                </>
              )}
            </section>

            {/* ---- label runs ------------------------------------------------------------------------------------------ */}
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Campaigns this style has run under</h3>
              {d.labelRuns.length === 0 ? (
                <p className="text-sm text-slate-400">No Google data imported for this style yet.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                        <th className="py-1.5 pr-2 text-left font-semibold">Campaign</th>
                        <th className="px-2 py-1.5 text-left font-semibold">From</th>
                        <th className="px-2 py-1.5 text-left font-semibold">To</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Clicks</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Spend</th>
                        <th className="px-2 py-1.5 text-right font-semibold">Returned</th>
                        <th className="py-1.5 pl-2 text-right font-semibold">ROAS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.labelRuns.map((r, i) => {
                        const quiet = isQuiet(r);
                        return (
                          <tr key={`${r.label ?? 'none'}-${r.from}-${i}`} className={`border-b border-slate-100 last:border-0 ${quiet ? 'text-slate-400' : ''}`}>
                            <td className="py-1.5 pr-2 font-medium">{r.label ?? <span className="italic text-slate-400">no campaign</span>}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{shortDate(r.from)}</td>
                            <td className="px-2 py-1.5 whitespace-nowrap text-slate-500">{shortDate(r.to)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{r.clicks.toLocaleString('en-GB')}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(r.spend)}</td>
                            <td className="px-2 py-1.5 text-right tabular-nums">{money(r.convValue)}</td>
                            <td className="py-1.5 pl-2 text-right tabular-nums">{r.roas === null ? '—' : `${r.roas.toFixed(1)}×`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="mt-2 text-xs text-slate-400">
                &ldquo;Returned&rdquo; is Google&rsquo;s own attributed revenue, not our net profit. Runs can overlap by a day: Google
                splits a changeover day across both campaigns.
              </p>
            </section>

            {/* ---- our own changes ------------------------------------------------------------------------------------- */}
            <section>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Changes made here</h3>
              {d.assignments.length === 0 ? (
                <p className="text-sm text-slate-400">This style has not been moved from this screen yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {d.assignments.map((a, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-slate-700">
                      <span className="text-slate-400">{a.from ?? 'unset'}</span>
                      <span className="text-slate-400">→</span>
                      <span className="font-medium">{a.to}</span>
                      <span className="text-xs text-slate-400">{a.by} · {a.at}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

          </div>
        )}
      </div>
    </div>
  );
}
