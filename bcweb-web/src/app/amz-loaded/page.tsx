'use client';
/*
=======================================================================================================================================
Page: /amz-loaded — AMZ loaded (owner, 2026-10-26; the Daily tile on the dashboard)
=======================================================================================================================================
Purpose: every style we hold locally that has NOT been loaded to Amazon — no size of it in amzfeed, so no SKU / FNSKU there —
Birkenstock left out ("obvs dont include birk"). The job: look at each and decide whether to list it on Amazon.

REVIEWS, LIKE PRICES (owner: "give them like reviews like prices so can mark if looked at"). Tick styles (or click a row) and press a
"Looked at" chip: it stamps skusummary.next_amz_load_review = today + N days (POST /amz-loaded-review) and the style drops out of the
Due view until then. "Due" switch: on (default) = only styles due (never looked at, or their date has come round); off = everything,
the ones looked at dimmed with their date. Clear makes a style due again. The list is fetched once with the looked-at ones included
(GET /amz-loaded-list?parked=include), so the switch and its counts cost no request.

Columns: Style (group id, title) · Brand · Stock (pairs held locally, sizes) · Shopify price / RRP · Sold SHP 90d (how it does where it
is) · Review (date, or Due). One style ticked lights the product hand-off cards above the table (components/ProductNavCards).

CLICK A STYLE TO OPEN ITS SIZES (owner, 2026-10-26: "need to be easy able to check amz ranking ... drop down with the sizes and their
barcodes - and let set review from there just like for pricing"). The row opens a panel under it: every size with its barcode — one
click copies it (the search links that were here went: "just give me the barcodes to copy") — its local stock, and the same Looked at
chips for THIS style. One style open at a time; the tick box (not the
row) ticks for the bulk bar.
=======================================================================================================================================
*/

import { Fragment, useMemo, useState } from 'react';
import { ChevronRightIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import ProductNavCards from '@/components/ProductNavCards';
import { useApiQuery } from '@/lib/useApiQuery';
import { getAmzLoadedList, markAmzLoadedReview, type AmzLoadedRow } from '@/lib/api';

const SELF = '/amz-loaded';
// The "Looked at" chips — how long a style stays out of the Due view. Same spirit as the price review chips.
const REVIEW_CHIPS = [7, 14, 30, 90];

const NO_ROWS: AmzLoadedRow[] = [];

function money(v: number | null) {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}
// 'YYYY-MM-DD' -> '9 Nov' — split, never through Date (a bare date string is read as UTC and can shift a day in BST).
function shortDate(iso: string) {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]}`;
}

export default function AmzLoadedPage() {
  const q = useApiQuery('amz-loaded-list', () => getAmzLoadedList());
  const rows = q.data ?? NO_ROWS;

  const [dueOnly, setDueOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);   // the style whose sizes are showing
  const [copied, setCopied] = useState<string | null>(null);   // the barcode just copied (a tick for a moment)

  async function copy(ean: string) {
    try {
      await navigator.clipboard.writeText(ean);
      setCopied(ean);
      setTimeout(() => setCopied((c) => (c === ean ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  }

  const dueCount = useMemo(() => rows.filter((r) => !r.parked).length, [rows]);
  const visible = useMemo(() => (dueOnly ? rows.filter((r) => !r.parked) : rows), [rows, dueOnly]);
  // Ticks only count while their row is on screen (switching Due off→on can hide a ticked row).
  const ticked = visible.filter((r) => selected.has(r.groupid)).map((r) => r.groupid);
  const allTicked = visible.length > 0 && ticked.length === visible.length;

  function toggle(g: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(g)) next.delete(g); else next.add(g);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allTicked ? new Set() : new Set(visible.map((r) => r.groupid)));
  }

  // Set (or clear, days 0) the review on `ids` — the ticked styles from the bar, or one style from its open panel.
  async function mark(days: number, ids: string[] = ticked) {
    if (ids.length === 0) return;
    setBusy(true); setMsg(null);
    const res = await markAmzLoadedReview(ids, days);
    setBusy(false);
    if (res.success && res.data) {
      const n = res.data.updated;
      setMsg({
        ok: true,
        text: days === 0
          ? `${n} style${n === 1 ? '' : 's'} due again.`
          : `${n} style${n === 1 ? '' : 's'} marked looked at — back ${res.data.nextReview ? shortDate(res.data.nextReview) : `in ${days} days`}.`,
      });
      setSelected(new Set());
      q.refresh();
    } else {
      setMsg({ ok: false, text: res.error || 'Could not save the review.' });
    }
  }

  return (
    <AppShell title="AMZ loaded" subtitle="Styles in stock with nothing on Amazon yet — Birkenstock left out">
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {q.data && (
        <>
          {/* Hand-off cards for ONE ticked style — open it on Product, Inventory, the pricing and order screens. */}
          <div className="mb-3">
            <ProductNavCards groupid={ticked.length === 1 ? ticked[0] : null} from={SELF} showProduct />
          </div>

          <div className="overflow-clip rounded-xl border border-slate-200 bg-white shadow-sm">
            {/* Bar: the Due switch and count on the left; the Looked at chips on the right, live once something is ticked. */}
            <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-2.5 text-sm">
              <div className="flex items-center gap-4">
                <div className="inline-flex rounded-lg bg-slate-100 p-0.5" role="group" aria-label="Which styles to show">
                  {[{ v: true, label: `Due ${dueCount}` }, { v: false, label: `All ${rows.length}` }].map((o) => (
                    <button
                      key={String(o.v)}
                      type="button"
                      aria-pressed={dueOnly === o.v}
                      onClick={() => setDueOnly(o.v)}
                      className={'rounded-md px-3 py-1 text-sm font-medium tabular-nums transition ' + (dueOnly === o.v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800')}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {ticked.length > 0 && <span className="text-slate-500"><strong className="text-slate-800">{ticked.length}</strong> ticked</span>}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-slate-500">Looked at — back in</span>
                {REVIEW_CHIPS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    disabled={busy || ticked.length === 0}
                    onClick={() => mark(d)}
                    className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium tabular-nums text-slate-700 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {d}d
                  </button>
                ))}
                <button
                  type="button"
                  disabled={busy || ticked.length === 0}
                  onClick={() => mark(0)}
                  title="Clear the review date — the style is due again"
                  className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Clear
                </button>
              </div>
            </div>

            {msg && (
              <div className={'border-b px-4 py-2 text-sm ' + (msg.ok ? 'border-emerald-100 bg-emerald-50 text-emerald-800' : 'border-red-100 bg-red-50 text-red-700')}>{msg.text}</div>
            )}

            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {rows.length === 0
                  ? 'Every style in stock is on Amazon (Birkenstock aside).'
                  : `Nothing due — all ${rows.length} have been looked at. Switch to All to see them.`}
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-10 bg-white text-[11px] uppercase tracking-wide text-slate-500 shadow-[0_1px_0_0_theme(colors.slate.200)]">
                  <tr>
                    <th className="w-10 py-2.5 pl-4">
                      <input type="checkbox" checked={allTicked} onChange={toggleAll} aria-label="Tick every style shown" className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
                    </th>
                    <th className="px-3 py-2.5 text-left font-medium">Style</th>
                    <th className="px-3 py-2.5 text-left font-medium">Brand</th>
                    <th className="w-28 px-3 py-2.5 text-center font-medium">Stock</th>
                    <th className="w-28 px-3 py-2.5 text-right font-medium">Shopify</th>
                    <th className="w-24 px-3 py-2.5 text-right font-medium">RRP</th>
                    <th className="w-28 px-3 py-2.5 text-center font-medium" title="Shopify units sold in the last 90 days">Sold SHP 90d</th>
                    <th className="w-28 py-2.5 pl-3 pr-4 text-right font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const isTicked = selected.has(r.groupid);
                    const isOpen = openId === r.groupid;
                    return (
                      <Fragment key={r.groupid}>
                      {/* A click on the row OPENS its sizes; the tick box ticks (for the bulk bar). */}
                      <tr
                        onClick={() => setOpenId(isOpen ? null : r.groupid)}
                        aria-expanded={isOpen}
                        className={'cursor-pointer border-b border-slate-100 ' + (isOpen ? 'bg-slate-50' : isTicked ? 'bg-brand-50' : 'hover:bg-slate-50') + (r.parked ? ' text-slate-400' : '')}
                      >
                        <td className="py-2 pl-4" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" checked={isTicked} onChange={() => toggle(r.groupid)} aria-label={`Tick ${r.groupid}`} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-400" />
                        </td>
                        <td className="max-w-0 px-3 py-2">
                          <div className={'flex items-center gap-1 font-mono text-[13px] font-semibold tracking-tight ' + (r.parked ? 'text-slate-400' : 'text-slate-900')}>
                            <ChevronRightIcon className={'h-4 w-4 shrink-0 text-slate-400 transition-transform ' + (isOpen ? 'rotate-90' : '')} />
                            {r.groupid}
                          </div>
                          <div className="truncate pl-5 text-xs text-slate-400" title={r.title || undefined}>{r.title || 'Untitled'}</div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{r.brand || '—'}</td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          <span className={r.parked ? '' : 'font-medium text-slate-900'}>{r.units}</span>
                          <span className="ml-1 text-xs text-slate-400">· {r.sizes} size{r.sizes === 1 ? '' : 's'}</span>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{money(r.price)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.rrp)}</td>
                        <td className="px-3 py-2 text-center tabular-nums">{r.u90 ? r.u90 : <span className="text-slate-300">·</span>}</td>
                        <td className="whitespace-nowrap py-2 pl-3 pr-4 text-right">
                          {r.parked && r.next_review
                            ? <span className="text-xs">back {shortDate(r.next_review)}</span>
                            : <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">Due</span>}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="border-b border-slate-200 bg-slate-50">
                          <td colSpan={8} className="px-4 pb-4 pt-1">
                            <SizesPanel row={r} busy={busy} copied={copied} onCopy={copy} onMark={(days) => mark(days, [r.groupid])} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </AppShell>
  );
}

// THE DROP-DOWN for one style: its sizes with barcodes to COPY (no Amazon search links — owner, 2026-10-26: "just give me the barcodes
// to copy"), local stock, and the Looked at chips for this style alone — the same as setting a review on a pricing drill.
function SizesPanel({ row, busy, copied, onCopy, onMark }: {
  row: AmzLoadedRow; busy: boolean; copied: string | null; onCopy: (ean: string) => void; onMark: (days: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-8 rounded-lg border border-slate-200 bg-white p-4">
      <table className="text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-500">
          <tr className="border-b border-slate-200">
            <th className="py-1.5 pr-5 text-left font-medium">Size</th>
            <th className="py-1.5 pr-5 text-left font-medium">Barcode</th>
            <th className="py-1.5 text-center font-medium">Local</th>
          </tr>
        </thead>
        <tbody>
          {row.sizes_list.map((z) => (
            <tr key={z.code} className="border-b border-slate-100 last:border-0">
              <td className="py-1.5 pr-5" title={z.code}>
                <span className="inline-block min-w-[2.75rem] rounded bg-slate-100 px-2 py-0.5 text-center font-mono text-xs font-medium text-slate-700">{z.size}</span>
              </td>
              <td className="py-1.5 pr-5">
                {z.ean ? (
                  // The whole barcode is the copy button — one click, then paste it into Amazon.
                  <button
                    type="button"
                    onClick={() => onCopy(z.ean as string)}
                    title="Copy barcode"
                    aria-label={`Copy barcode ${z.ean}`}
                    className={'inline-flex items-center gap-2 rounded-md border px-2 py-1 transition ' +
                      (copied === z.ean ? 'border-emerald-300 bg-emerald-50' : 'border-slate-200 hover:border-brand-500 hover:bg-brand-50')}
                  >
                    <span className="font-mono text-[13px] tabular-nums text-slate-800">{z.ean}</span>
                    {copied === z.ean
                      ? <span className="inline-flex items-center gap-0.5 text-xs font-medium text-emerald-700"><CheckIcon className="h-4 w-4" />Copied</span>
                      : <ClipboardDocumentIcon className="h-4 w-4 text-slate-400" />}
                  </button>
                ) : <span className="text-xs text-slate-400">no barcode</span>}
              </td>
              <td className="py-1.5 text-center tabular-nums">{z.local ? z.local : <span className="text-slate-300">·</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="flex min-w-[16rem] flex-col gap-4">
        <div>
          <p className="mb-1.5 text-sm text-slate-600">
            Looked at — back in
            {row.parked && row.next_review && <span className="ml-1 text-xs text-slate-400">(now back {shortDate(row.next_review)})</span>}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {REVIEW_CHIPS.map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => onMark(d)}
                className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium tabular-nums text-slate-700 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-700 disabled:opacity-40"
              >
                {d}d
              </button>
            ))}
            {row.next_review && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onMark(0)}
                title="Clear the review date — the style is due again"
                className="ml-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:text-slate-800 disabled:opacity-40"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
