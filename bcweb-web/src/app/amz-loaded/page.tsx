'use client';
/*
=======================================================================================================================================
Page: /amz-loaded — AMZ loaded (owner, 2026-10-26; the Daily tile on the dashboard)
=======================================================================================================================================
Purpose: every style we hold locally that has NOT been loaded to Amazon — no size of it in amzfeed, so no SKU / FNSKU there —
Birkenstock left out ("obvs dont include birk"). The job: look at each and decide whether to list it on Amazon.

REVIEWS, LIKE PRICES (owner: "give them like reviews like prices so can mark if looked at", then "make the review date thing look like
how it does for pricing so its clear what it is"). The same controls as the pricing lists, so it reads the same:
  - the "Due" switch (components/ListViewControls): on (default) = only styles due (never reviewed, or their date has come round);
    off = everything, the parked ones dimmed.
  - the Review column: a parked style shows its date as an amber chip, a due one says Due.
  - "Review in (None) 3 5 7 10 14 30 90 days" round chips + "Set review" — in a collapsed "Bulk edit" bar for the ticked styles (as
    on the pricing lists, owner 2026-10-26), and in a style's drop-down
    for that style. Set review stamps skusummary.next_amz_load_review = today + N (POST /amz-loaded-review); Clear review empties it.
The list is fetched once with the parked ones included (GET /amz-loaded-list?parked=include), so the switch costs no request.

Columns: Style (group id, title) · Brand · Stock (pairs held locally, sizes) · Shopify price / RRP · Sold SHP 90d (how it does where it
is) · Review. No subtitle and no product hand-off cards (both taken off, owner 2026-10-26).

CLICK A STYLE TO OPEN ITS SIZES (owner, 2026-10-26): every size with its barcode — one click copies it ("just give me the barcodes to
copy") — and its local stock; the AMAZON UPLOAD FILE button ("let me get the amz upload file from there as well") — the same file as Add
/ Modify (components/AmazonExport → POST /product-amazon: the SHOES.xlsm listing loader for this style, which also stamps the sizes'
skumap sku/status as the batch script does); and the review chips for this style. One style open at a time; the tick box (not the row)
ticks for the bar.
=======================================================================================================================================
*/

import { Fragment, useMemo, useState } from 'react';
import { ChevronRightIcon, ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/20/solid';
import AppShell from '@/components/AppShell';
import AmazonExport from '@/components/AmazonExport';
import ListViewControls, { fmtReviewDate } from '@/components/ListViewControls';
import { useApiQuery } from '@/lib/useApiQuery';
import { getAmzLoadedList, markAmzLoadedReview, type AmzLoadedRow } from '@/lib/api';

// The pricing screens' review periods (components/PriceSetter REVIEW_CHIPS), so the two read the same.
const REVIEW_CHIPS = [3, 5, 7, 10, 14, 30, 90];

const NO_ROWS: AmzLoadedRow[] = [];

function money(v: number | null) {
  return v === null ? '—' : `£${v.toFixed(2)}`;
}

export default function AmzLoadedPage() {
  const q = useApiQuery('amz-loaded-list', () => getAmzLoadedList());
  const rows = q.data ?? NO_ROWS;

  const [dueOnly, setDueOnly] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);   // the style whose sizes are showing
  const [bulkOpen, setBulkOpen] = useState(false);              // the Bulk edit panel (collapsed by default, as on pricing)
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
  // Ticks only count while their row is on screen (switching Due on can hide a ticked row).
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

  // Set the review (days > 0) or clear it (0) on `ids`. Returns true when saved, so the caller can reset its chip.
  async function setReview(ids: string[], days: number): Promise<boolean> {
    if (ids.length === 0) return false;
    setBusy(true); setMsg(null);
    const res = await markAmzLoadedReview(ids, days);
    setBusy(false);
    if (res.success && res.data) {
      const n = res.data.updated;
      const what = `${n} style${n === 1 ? '' : 's'}`;
      setMsg({
        ok: true,
        text: days === 0 ? `Review cleared on ${what} — due again.` : `Review set on ${what} — until ${res.data.nextReview ? fmtReviewDate(res.data.nextReview) : `${days} days`}.`,
      });
      setSelected(new Set());
      q.refresh();
      return true;
    }
    setMsg({ ok: false, text: res.error || 'Could not save the review.' });
    return false;
  }

  return (
    <AppShell title="AMZ loaded">
      {q.error && <div className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{q.error.message}</div>}
      {q.isLoading && <p className="text-sm text-slate-400">Loading…</p>}

      {q.data && (
        <>
          {/* The pricing lists' controls: the count on the left, the Due switch on the right. */}
          <ListViewControls
            view="all"
            onViewChange={() => {}}
            counts={null}
            dueOnly={dueOnly}
            onDueOnlyChange={setDueOnly}
            showTabs={false}
            summary={
              <div className="text-sm text-slate-500">
                <p><span className="text-2xl font-semibold tabular-nums text-slate-900">{visible.length}</span> style{visible.length === 1 ? '' : 's'}</p>
                <p className="tabular-nums">{dueCount} due for review · {rows.length - dueCount} not due</p>
              </div>
            }
          />

          {/* BULK EDIT — the pricing lists' collapsed bar (components/BulkActionBar): the selection count and the last result always
              visible, "Bulk edit ▸" opens the review control for the ticked styles. */}
          <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
            <button type="button" onClick={() => setBulkOpen((o) => !o)} aria-expanded={bulkOpen} className="flex w-full items-center gap-3 px-4 py-3 text-left">
              <span className="text-sm font-medium text-slate-700">
                {ticked.length > 0 ? `${ticked.length} selected` : 'Select rows to bulk edit'}
              </span>
              {msg && <span className={'text-xs font-medium ' + (msg.ok ? 'text-emerald-700' : 'text-red-600')}>{msg.text}</span>}
              <span className="ml-auto text-xs text-slate-400">{bulkOpen ? 'Hide ▾' : 'Bulk edit ▸'}</span>
            </button>
            {bulkOpen && (
              <div className="border-t border-slate-100 px-4 py-4">
                <ReviewPicker
                  busy={busy}
                  disabled={ticked.length === 0}
                  canClear={ticked.some((g) => rows.find((r) => r.groupid === g)?.next_review)}
                  onSet={(d) => setReview(ticked, d)}
                />
              </div>
            )}
          </div>

          <div className="overflow-clip rounded-xl border border-slate-200 bg-white shadow-sm">

            {visible.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">
                {rows.length === 0
                  ? 'Every style in stock is on Amazon (Birkenstock aside).'
                  : `Nothing due for review — all ${rows.length} are parked. Switch off “Due” to see them.`}
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
                    <th className="w-24 py-2.5 pl-3 pr-4 text-left font-medium">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((r) => {
                    const isTicked = selected.has(r.groupid);
                    const isOpen = openId === r.groupid;
                    return (
                      <Fragment key={r.groupid}>
                        {/* A click on the row OPENS its sizes; the tick box ticks (for the bar). */}
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
                          <td className="whitespace-nowrap px-3 py-2">{r.brand || '—'}</td>
                          <td className="px-3 py-2 text-center tabular-nums">
                            <span className={r.parked ? '' : 'font-medium text-slate-900'}>{r.units}</span>
                            <span className="ml-1 text-xs text-slate-400">· {r.sizes} size{r.sizes === 1 ? '' : 's'}</span>
                          </td>
                          <td className={'px-3 py-2 text-right tabular-nums ' + (r.parked ? '' : 'font-medium text-slate-800')}>{money(r.price)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-slate-500">{money(r.rrp)}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{r.u90 ? r.u90 : <span className="text-slate-300">·</span>}</td>
                          {/* As on the pricing lists: a parked style's date in an amber chip, otherwise Due. */}
                          <td className="whitespace-nowrap py-2 pl-3 pr-4">
                            {r.parked
                              ? <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs font-medium text-amber-700">{fmtReviewDate(r.next_review)}</span>
                              : <span className="text-xs text-slate-400">Due</span>}
                          </td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-slate-200 bg-slate-50">
                            <td colSpan={8} className="px-4 pb-4 pt-1">
                              <SizesPanel row={r} busy={busy} copied={copied} onCopy={copy} onSetReview={(d) => setReview([r.groupid], d)} />
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

// "Review in (None) 3 5 7 10 14 30 90 days  [Set review]  Clear review" — the pricing screens' review control (components/PriceSetter,
// BulkActionBar): pick a period, then Set review. None is the default, so nothing is set by accident.
function ReviewPicker({ busy, disabled, canClear, onSet }: {
  busy: boolean; disabled: boolean; canClear: boolean; onSet: (days: number) => Promise<boolean>;
}) {
  const [days, setDays] = useState<number | null>(null);
  const chip = (on: boolean) =>
    'rounded-full border px-3 py-1 text-sm disabled:opacity-50 ' + (on ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 text-slate-600 hover:bg-slate-50');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-medium text-slate-700">Review in</span>
      <button type="button" disabled={busy || disabled} onClick={() => setDays(null)} className={chip(days === null)}>None</button>
      {REVIEW_CHIPS.map((d) => (
        <button key={d} type="button" disabled={busy || disabled} onClick={() => setDays(d)} className={chip(days === d)}>{d}</button>
      ))}
      <span className="text-sm text-slate-400">days</span>
      <button
        type="button"
        disabled={busy || disabled || days === null}
        onClick={async () => { if (days !== null && await onSet(days)) setDays(null); }}
        title={days === null ? 'Pick a review period first' : undefined}
        className="ml-1 rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
      >
        Set review
      </button>
      {canClear && (
        <button
          type="button"
          disabled={busy || disabled}
          onClick={() => onSet(0)}
          title="Clear the review date — due again"
          className="rounded-md px-2 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-800 disabled:opacity-50"
        >
          Clear review
        </button>
      )}
    </div>
  );
}

// THE DROP-DOWN for one style: its sizes with barcodes to COPY and local stock; the Amazon upload file; and the review for this style.
function SizesPanel({ row, busy, copied, onCopy, onSetReview }: {
  row: AmzLoadedRow; busy: boolean; copied: string | null; onCopy: (ean: string) => void; onSetReview: (days: number) => Promise<boolean>;
}) {
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-lg border border-slate-200 bg-white p-4">
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

      <div className="flex min-w-0 flex-1 flex-col gap-5">
        {/* The listing file — the same as Add / Modify's (it also marks these sizes as sent to Amazon, as the batch script does). */}
        <div>
          <p className="mb-1.5 text-sm font-medium text-slate-700">Load to Amazon</p>
          <AmazonExport key={row.groupid} groupid={row.groupid} sizesCount={row.sizes_list.length} quiet />
        </div>
        <div>
          <p className="mb-1.5 text-sm text-slate-500">
            {row.parked && row.next_review ? <>Parked until <strong className="font-medium text-slate-700">{fmtReviewDate(row.next_review)}</strong></> : 'Due for review'}
          </p>
          <ReviewPicker busy={busy} disabled={false} canClear={!!row.next_review} onSet={onSetReview} />
        </div>
      </div>
    </div>
  );
}
