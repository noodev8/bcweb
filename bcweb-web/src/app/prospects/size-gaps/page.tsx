'use client';
/*
=======================================================================================================================================
Page: /prospects/size-gaps  (SIZE GAPS — reached from the "Size gaps · n" link on Prospects)
=======================================================================================================================================
Purpose: Sizes missing from styles we already sell, as SKU-level PROSPECTS (owner, 2026-11-08: "We buy products and get the core sizes
         to test, but then forget what is there and just keep ordering the same sizes"). Ordered BY HAND from the supplier, then it
         arrives and is loaded onto the system as usual. EVERY RULE IS SERVER-SIDE (bcweb-server/utils/sizeGaps.js — read its header):
         the brand range (Lunar UK 3–9; Rieker / Remonte / Strive Womens EU 36–42 — each in its own sizing, set by hand), a gap = NOT ON OUR SYSTEM ("new") or EMPTY (no stock anywhere, nothing on order,
         no net sale in 90 days), Can't get styles left out — a style holding nothing at all stays (owner: "It is on the list so
         won't be misplaced").

THE ORDER = THE STYLE'S BEST SIZE BY PROFIT A PAIR (owner, 2026-11-09: "If a size can make good size profit, then maybe another size
         can. Not interested in qty at this stage") — 12 months, ONLINE channels (the shop / CM3 left out — its profit is gross, owner
         2026-11-09), net of returns; nothing sold online in 12 months = last.
         SHOWN, because it is why a style is where it is (owner: "There's no indication of why you sorted that way"): the BEST SIZE
         column ("£6.12 a pair · 5 UK") and each size's own figure on its tile's hover. No success bar — the owner works top to
         bottom and parks the low ones.

THE ROW = Range's / New Additions' style row: picture, group id, title, the size run as tiles, Brand, Best size, and an AMAZON link
         to our listing where the style is on Amazon (to check how a size ranks — not all are; the supplier's website is checked by
         hand).
  WHITE tile  = a gap to work: a solid border = on our system but empty, a DASHED border + "new" = not on our system yet.
  GREY tile   = held, on order, selling (sold in 90 days) — or a gap already marked (a small dark dot; hover says which). Not worked here.

MARKS, PER SIZE ONLY (owner): Park 14 · 30 · 90 · 180 days (180 put back 2026-11-09 for rarely ordered sizes — UK 3s / EU 36s; owner, 2026-11-09: "use days so they are all the same" — 14 / 30 for a supplier
         that is out of stock, so the season isn't missed; was 3 / 6 months) · Not made (no date; released by hand) · Ordered (90 days). EVERY mark
         ends when the size arrives (a Goods In since the mark) — server rule. "When working on it, we will do the whole style": a ROW CLICK picks every open gap of the style, a TILE
         CLICK picks or drops one size (Blaze 9 only, say). Ctrl / Shift are not needed — a click adds to the pick; Esc / Clear empties
         it. The bar acts on what is picked. Marked sizes leave the list behind Parked · Ordered · Not made links
         (in the bar, right-hand end — moved up from under the list 2026-11-09, owner couldn't find them) each opens its sizes with EVERY choice plus Release (owner, 2026-11-09: "is there a way to change the park length or set the
         whole style to park?"): marking again replaces the mark — a 14-day park becomes 90 days, a park becomes Not made. A whole
         style = its row click in each view (the open list for its unmarked gaps, Parked for the parked ones). Release is Not made's
         only way back.

THE COUNT = STYLES with an open gap (owner: "we will do the whole style"); Prospects' link reads the same number from the same
         request (SWR key 'size-gaps'), so a mark here moves it there.

VIEW STATE IN THE URL (?view=park|ordered|notmade), written by the handlers — never an effect. Consumes GET /size-gaps.
=======================================================================================================================================
*/

import { Suspense, useMemo, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { ArrowLeftIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import AppShell from '@/components/AppShell';
import StyleThumb from '@/components/StyleThumb';
import { useApiQuery } from '@/lib/useApiQuery';
import {
  getSizeGaps, markSizeGaps, releaseSizeGaps,
  type SizeGapChoice, type SizeGapMarkKind, type SizeGapSize, type SizeGapStyle,
} from '@/lib/api';

type View = 'open' | SizeGapMarkKind;
const VIEWS: View[] = ['open', 'park', 'ordered', 'notmade'];
const VIEW_NAME: Record<SizeGapMarkKind, string> = { park: 'Parked', ordered: 'Ordered', notmade: 'Not made' };
const VIEW_RULE: Record<SizeGapMarkKind, string> = {
  park: 'Parked for 14, 30, 90 or 180 days — each comes back by itself on its date.',
  ordered: 'Ordered from the supplier — each leaves when it arrives, or comes back after 90 days if nothing came.',
  notmade: 'Not made by the supplier — no date, so these stay off unless one arrives after all. Release one to put it back on the list.',
};
// label = the full name (the saved message says it); short = the number shown in the compact Park group (owner, 2026-11-09:
// "compact those park buttons ... park with just the numbers").
const CHOICES: { key: SizeGapChoice; label: string; short?: string; tip: string }[] = [
  { key: 'park14', label: 'Park 14 days', short: '14', tip: 'Off the list for 14 days, then back by itself — e.g. the supplier is out, check again soon' },
  { key: 'park30', label: 'Park 30 days', short: '30', tip: 'Off the list for 30 days, then back by itself' },
  { key: 'park90', label: 'Park 90 days', short: '90', tip: 'Off the list for 90 days, then back by itself — not now' },
  { key: 'park180', label: 'Park 180 days', short: '180', tip: 'Off the list for 180 days (about 6 months), then back by itself — a size we rarely order, e.g. a 3' },
  { key: 'notmade', label: 'Not made', tip: 'The supplier doesn\'t make this size — off for good, until released' },
  { key: 'ordered', label: 'Ordered', tip: 'Ordered from the supplier — off until it arrives (back after 90 days if nothing came)' },
];

// 'YYYY-MM-DD' -> "8 Feb 27", read by split, never the JS Date parser (CLAUDE.md: a pg date handed to Date drifts a day in BST).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayOf = (d: string) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return `${dd} ${MONTHS[m - 1]} ${String(y).slice(2)}`; };
const n = (v: number) => v.toLocaleString('en-GB');
const money = (v: number) => `${v < 0 ? '−' : ''}£${Math.abs(v).toFixed(2)}`;
const key = (groupid: string, uk: number) => `${groupid}|${uk}`;

// What a size can be picked for in a view: open view = an unmarked gap; a marked view = a size with that mark.
const pickable = (z: SizeGapSize, view: View) =>
  z.state === 'gap' && (view === 'open' ? !z.mark : z.mark?.mark === view);

// useSearchParams needs a Suspense boundary for Next's build.
export default function SizeGapsPage() {
  return (
    <Suspense fallback={null}>
      <SizeGapsBody />
    </Suspense>
  );
}

function SizeGapsBody() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [view, setViewState] = useState<View>(() => VIEWS.find((v) => v === sp.get('view')) ?? 'open');
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const q = useApiQuery('size-gaps', getSizeGaps);
  const data = q.data;

  const setView = (v: View) => {
    setViewState(v);
    setPicked(new Set());
    setMsg(null);
    router.replace(v === 'open' ? pathname : `${pathname}?view=${v}`, { scroll: false });
  };

  // The rows of this view: styles with at least one pickable size, in the server's order (12-month profit).
  const rows = useMemo(
    () => (data?.styles ?? []).filter((s) => s.sizes.some((z) => pickable(z, view))),
    [data, view]);

  // Where a link leaves from (this view included), for the destination's Back.
  const qs = sp.toString();
  const here = encodeURIComponent(qs ? `${pathname}?${qs}` : pathname);
  const hereBack = encodeURIComponent('Size gaps');

  const rangeLine = (data?.ranges ?? []).map((r) => `${r.brand} ${r.uk_from}–${r.uk_to} ${r.sizing ?? 'UK'}`).join(', ');

  // PICKING — a row click toggles all its pickable sizes (all picked -> none), a tile click toggles one.
  const rowKeys = (s: SizeGapStyle) => s.sizes.filter((z) => pickable(z, view)).map((z) => key(s.groupid, z.uk));
  // Functional updates, so clicks landing before a re-render never overwrite each other (found 2026-11-09 browser test).
  const clickRow = (s: SizeGapStyle) => {
    const ks = rowKeys(s);
    setPicked((prev) => {
      const all = ks.every((k) => prev.has(k));
      const next = new Set(prev);
      for (const k of ks) { if (all) next.delete(k); else next.add(k); }
      return next;
    });
    setMsg(null);
  };
  const clickTile = (e: ReactMouseEvent, groupid: string, z: SizeGapSize) => {
    e.stopPropagation();
    if (!pickable(z, view)) return;
    const k = key(groupid, z.uk);
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
    setMsg(null);
  };
  // Only what is on screen counts (a pick can't outlive the row it was made on).
  const pickedHere = useMemo(() => {
    const out: { groupid: string; uk: number }[] = [];
    for (const s of rows) for (const z of s.sizes) if (pickable(z, view) && picked.has(key(s.groupid, z.uk))) out.push({ groupid: s.groupid, uk: z.uk });
    return out;
  }, [rows, view, picked]);
  const pickedStyles = new Set(pickedHere.map((p) => p.groupid)).size;

  const act = async (choice: SizeGapChoice | 'release') => {
    if (!pickedHere.length || busy) return;
    setBusy(true);
    setMsg(null);
    const res = choice === 'release'
      ? await releaseSizeGaps({ sizes: pickedHere })
      : await markSizeGaps({ mark: choice, sizes: pickedHere });
    if (!res.success || !res.data) {
      setBusy(false);
      setMsg({ ok: false, text: res.error || 'That didn\'t save — try again' });
      return;
    }
    const d = res.data as { saved?: number; released?: number; until?: string | null; skipped?: string[] };
    const done = choice === 'release' ? d.released ?? 0 : d.saved ?? 0;
    const what = choice === 'release' ? 'Released' : CHOICES.find((c) => c.key === choice)!.label;
    const skipped = d.skipped?.length ? ` · ${d.skipped.length} no longer a gap, left alone` : '';
    setPicked(new Set());
    // The list reloads BEFORE the message shows, so the message and the counts beside it always agree (2026-11-09 browser test:
    // "Not made: 1 size" showed next to the old count for a moment).
    await q.refresh();
    setBusy(false);
    setMsg({ ok: true, text: `${what}: ${done} size${done === 1 ? '' : 's'}${d.until ? ` until ${dayOf(d.until)}` : ''}${skipped}` });
  };

  const counts = data?.counts;
  const marked = view !== 'open';

  return (
    <AppShell title="Size gaps" backHref="/prospects" backLabel="Prospects">
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {data && (
        <div className="space-y-3" tabIndex={-1} onKeyDown={(e) => { if (e.key === 'Escape') setPicked(new Set()); }}>
          {/* THE RULE — one line, and where a marked view is open, its name and Back to the list. */}
          {marked ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => setView('open')}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50">
                <ArrowLeftIcon className="h-4 w-4" /> Back to the list
              </button>
              <span className="text-sm text-slate-600">
                <span className="font-semibold text-slate-900">{VIEW_NAME[view]} · {n(counts?.[view] ?? 0)}</span> — {VIEW_RULE[view]}
                {' '}Click a style to pick all its sizes here, or one size on its own — then Release, or a new mark to change it.
              </span>
            </div>
          ) : (
            <p className="text-sm text-slate-500">
              Sizes in the brand&apos;s range ({rangeLine || 'none set'}) that aren&apos;t on our system, or have no stock, nothing on
              order and no sale in 90 days. Sorted by each style&apos;s best size — its profit a pair over 12 months (Best size).
              Click a style to pick all its gaps, or a size to pick one.
            </p>
          )}

          {/* THE BAR — what's picked and what to do with it. Sticky, so it stays in reach down a long list. */}
          <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-600 shadow-sm">
            <span className="tabular-nums">
              {marked ? `${n(rows.length)} style${rows.length === 1 ? '' : 's'}` : `${n(counts?.open_styles ?? 0)} style${counts?.open_styles === 1 ? '' : 's'} · ${n(counts?.open_sizes ?? 0)} gap sizes`}
            </span>
            <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
            <span className="tabular-nums text-slate-900">
              {pickedHere.length ? `${n(pickedHere.length)} size${pickedHere.length === 1 ? '' : 's'} picked in ${n(pickedStyles)} style${pickedStyles === 1 ? '' : 's'}` : 'Nothing picked'}
            </span>
            {/* A marked view offers EVERY choice as well as Release (owner, 2026-11-09: "is there a way to change the park length") —
                marking again replaces the mark, so a 14-day park can become 90 days, or a parked size can become Not made / Ordered. */}
            {/* PARK — one compact group, just the days (owner, 2026-11-09); the hover names it in full. */}
            <span className="inline-flex items-center gap-1.5">
              <span className={'text-sm ' + (pickedHere.length && !busy ? 'text-slate-700' : 'text-slate-400')}>Park</span>
              <span className="inline-flex divide-x divide-slate-300 overflow-hidden rounded-md border border-slate-300">
                {CHOICES.filter((c) => c.short).map((c) => (
                  <button key={c.key} type="button" onClick={() => act(c.key)} disabled={!pickedHere.length || busy} title={c.tip}
                    className="bg-white px-2 py-0.5 text-sm font-medium tabular-nums text-slate-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white">
                    {c.short}
                  </button>
                ))}
              </span>
              <span className={'text-sm ' + (pickedHere.length && !busy ? 'text-slate-500' : 'text-slate-400')}>days</span>
            </span>
            {(marked ? [...CHOICES, { key: 'release' as const, label: 'Release', tip: 'Back on the list (if it is still a gap)' }] : CHOICES).filter((c) => !('short' in c && c.short)).map((c) => (
              <button key={c.key} type="button" onClick={() => act(c.key)} disabled={!pickedHere.length || busy} title={c.tip}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-0.5 text-sm font-medium text-slate-700 hover:border-brand-500 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-slate-300 disabled:hover:bg-white">
                {c.label}
              </button>
            ))}
            {pickedHere.length > 0 && (
              <button type="button" onClick={() => setPicked(new Set())}
                className="text-sm font-medium text-slate-500 hover:text-slate-900 hover:underline">
                Clear
              </button>
            )}
            {/* THE MARKED SIZES — in the bar, right-hand end (owner, 2026-11-09: "Couldn't see how to unpark an individual size" —
                they were small grey links under the whole list, out of sight). Counts are SIZES; the open view is bold. */}
            {counts && (
              <span className="ml-auto flex items-center gap-3 text-sm">
                {(['park', 'ordered', 'notmade'] as const).map((v) => (
                  <button key={v} type="button" onClick={() => setView(view === v ? 'open' : v)} title={VIEW_RULE[v]}
                    className={'tabular-nums hover:underline ' + (view === v ? 'font-semibold text-slate-900' : 'text-slate-500 hover:text-slate-800')}>
                    {VIEW_NAME[v]} · {n(counts[v])}
                  </button>
                ))}
              </span>
            )}
            {busy && <span className="ml-1 text-sm text-slate-400">Saving…</span>}
            {msg && <span className={'ml-1 text-sm ' + (msg.ok ? 'text-emerald-700' : 'text-red-700')}>{msg.text}</span>}
          </div>

          <div className="w-fit max-w-full overflow-clip rounded-xl border border-slate-200 bg-white">
            {rows.length === 0 ? (
              <p className="px-6 py-10 text-center text-sm text-slate-500">
                {marked ? 'Nothing marked like this.' : 'No size gaps — every size in range is held, on order, selling or marked.'}
              </p>
            ) : (
              <table className="text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr>
                    <th className="w-[30rem] py-2.5 pl-4 pr-3 text-left font-medium">Style</th>
                    <th className="w-32 border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium">Brand</th>
                    <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-right font-medium"
                      title="The style's best size: its profit a pair over the last 12 months, online channels (shop sales left out — their profit is gross), net of returns. The list runs highest first — qty plays no part. Under it, the style's pairs sold online in 12 months (shown only). Hover a size for its own figure.">Best size</th>
                    {marked && <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium">Marked</th>}
                    <th className="border-l border-slate-200 py-2.5 pl-3 pr-4 text-left font-medium"
                      title="Our sales of the style, its Amazon Order, and our Amazon listing (to check how a size ranks)">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const ks = rowKeys(s);
                    const allPicked = ks.length > 0 && ks.every((k) => picked.has(k));
                    return (
                      <tr key={s.groupid} onClick={() => clickRow(s)} aria-selected={allPicked}
                        className={'cursor-pointer border-t border-slate-100 first:border-t-0 ' + (allPicked ? 'bg-brand-50' : 'hover:bg-slate-50')}>
                        <td className="w-[30rem] max-w-[30rem] py-3 pl-4 pr-3 align-top">
                          <div className="flex items-start gap-3">
                            <StyleThumb imagename={s.imagename} alt={s.title || s.groupid} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate font-mono text-base font-semibold text-slate-900">{s.groupid}</div>
                              <div className="mt-0.5 truncate text-xs text-slate-500"><span title={s.title || undefined}>{s.title || 'Untitled'}</span></div>
                              <div className="mt-2 flex flex-wrap gap-1">
                                {s.sizes.map((z) => (
                                  <SizeTile key={z.uk} z={z} sizing={s.sizing ?? 'UK'} view={view} picked={picked.has(key(s.groupid, z.uk))}
                                    onClick={(e) => clickTile(e, s.groupid, z)} />
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="border-l border-slate-100 py-3 pl-3 pr-4 align-top text-slate-700">
                          {s.brand || <span className="text-slate-300">–</span>}
                        </td>
                        {/* BEST SIZE — why the style is where it is (THE ORDER). */}
                        <td className="whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 text-right align-top tabular-nums">
                          {s.best ? (
                            <>
                              <div className={'font-semibold ' + (s.best.per_pair < 0 ? 'text-red-700' : 'text-slate-900')}>{money(s.best.per_pair)}</div>
                              <div className="text-xs text-slate-500">a pair · {s.best.size}</div>
                              {/* The style's pairs (owner, 2026-11-09: "an easy indication of total sales qty") — shown, never sorts. */}
                              {s.pairs_12m != null && (
                                <div className="mt-0.5 text-xs text-slate-400">{n(s.pairs_12m)} pair{s.pairs_12m === 1 ? '' : 's'} in 12m</div>
                              )}
                            </>
                          ) : <span className="text-xs text-slate-400">No sales 12m</span>}
                        </td>
                        {marked && (
                          <td className="border-l border-slate-100 py-3 pl-3 pr-4 align-top text-xs text-slate-600">
                            {s.sizes.filter((z) => z.mark?.mark === view).map((z) => (
                              <div key={z.uk} className="whitespace-nowrap tabular-nums">
                                <span className="font-semibold text-slate-900">{z.uk} {s.sizing ?? 'UK'}</span>
                                {z.mark?.until ? ` · until ${dayOf(z.mark.until)}` : ''}
                                {` · ${z.mark?.marked_by || '?'} ${dayOf(z.mark!.marked_on)}`}
                              </div>
                            ))}
                          </td>
                        )}
                        {/* LINKS (owner, 2026-11-09): our Sales and Amazon Order open on the style in this tab (the standard product-menu deep
                            links, ?q= + from / back, so their Back returns here); the Amazon listing opens a new tab as before. */}
                        <td className="whitespace-nowrap border-l border-slate-100 py-3 pl-3 pr-4 align-top">
                          <div className="flex flex-col items-start gap-1">
                          <Link href={`/analytics/sales?q=${encodeURIComponent(s.groupid)}&from=${here}&back=${hereBack}`}
                            onClick={(e) => e.stopPropagation()} title="Our sales of this style — every channel, 12 months"
                            className="font-medium text-brand-700 hover:underline">Sales</Link>
                          <Link href={`/amazon-order?q=${encodeURIComponent(s.groupid)}&from=${here}&back=${hereBack}`}
                            onClick={(e) => e.stopPropagation()} title="Amazon Order for this style — what to buy in and what to send to FBA"
                            className="font-medium text-brand-700 hover:underline">Amazon order</Link>
                          {s.asin ? (
                            <a href={`https://www.amazon.co.uk/dp/${encodeURIComponent(s.asin)}`} target="_blank" rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()} title={`Our Amazon listing (${s.asin})`}
                              className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                              Amazon <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                            </a>
                          ) : <span className="text-xs text-slate-400">Not on Amazon</span>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

        </div>
      )}
    </AppShell>
  );
}

// ONE SIZE TILE. White = pickable in this view (dashed + "new" if not on our system); picked = brand ring and tint. Grey = the rest.
function SizeTile({ z, sizing, view, picked, onClick }: { z: SizeGapSize; sizing: string; view: View; picked: boolean; onClick: (e: ReactMouseEvent) => void }) {
  const tip = tileTip(z, sizing);
  if (pickable(z, view)) {
    return (
      <button type="button" onClick={onClick} title={tip} aria-pressed={picked}
        className={'flex h-6 min-w-[2.25rem] items-center justify-center gap-1 rounded border px-1.5 text-[11px] font-semibold tabular-nums transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 ' +
          // Picked = SOLID FILLED (a faint tint was too easy to miss when picking single sizes, 2026-11-09 browser test).
          (picked ? 'border-solid border-brand-700 bg-brand-700 text-white'
            : (z.is_new ? 'border-dashed ' : 'border-solid ') + 'border-slate-500 bg-white text-slate-900 hover:border-brand-500 hover:bg-brand-50')}>
        {z.uk}{z.is_new && <span className={'font-normal ' + (picked ? 'text-brand-100' : 'text-slate-500')}>new</span>}
      </button>
    );
  }
  // A MARKED gap (parked / ordered / not made) carries a small dark dot, so it doesn't read as a size we hold (2026-11-09 browser test:
  // Blaze Nude's Not made 9 looked held). Hover says which mark.
  return (
    <span onClick={(e) => e.stopPropagation()} title={tip}
      className="relative flex h-6 w-9 items-center justify-center rounded bg-slate-100 text-[11px] tabular-nums text-slate-400">
      {z.uk}
      {z.state === 'gap' && z.mark && <span aria-hidden className="absolute right-0.5 top-0.5 inline-block h-1.5 w-1.5 rounded-full bg-slate-600" />}
    </span>
  );
}

function tileTip(z: SizeGapSize, sizing: string): string {
  const size = `${z.uk} ${sizing}`;   // UK for Lunar, EU for Rieker / Remonte / Strive
  // Each size's own profit a pair (12 months) — the figure the Best size column picks the highest of.
  const pp = z.per_pair != null ? ` · ${money(z.per_pair)} a pair (12m)` : '';
  if (z.state === 'held') return `${size} · ${n(z.units)} in stock${pp}`;
  if (z.state === 'onorder') return `${size} · ${n(z.on_order)} on order${pp}`;
  if (z.state === 'selling') return `${size} · sold in the last 90 days${z.last_sale ? ` (last ${dayOf(z.last_sale)})` : ''}${pp}`;
  const what = (z.is_new ? 'not on our system' : `on our system, none in stock or on order, ${z.last_sale ? `last sold ${dayOf(z.last_sale)}` : 'never sold'}`) + pp;
  if (!z.mark) return `${size} · ${what}`;
  const m = z.mark;
  const how = m.mark === 'notmade' ? 'Not made' : m.mark === 'ordered' ? `Ordered — until ${dayOf(m.until!)} or it arrives` : `Parked until ${dayOf(m.until!)}`;
  return `${size} · ${how} (${m.marked_by || '?'}, ${dayOf(m.marked_on)}) · ${what}`;
}
