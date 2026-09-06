'use client';
/*
=======================================================================================================================================
Component: GoogleAdsImport
=======================================================================================================================================
Purpose: Get Google's own numbers into the database. Pick the report file(s), see exactly what a commit would write, commit.

         Collapsed to a single button by default: importing is something you do occasionally, and the screen's job is the grid.
         What it does show at all times is HOW OLD the data is, because every number below it is only as current as the last import.

WHY THERE IS NO SCHEDULE
Imports are deliberately unscheduled (docs/google-ads-spec.md §7.8). The operator downloads the reports when about to work the
screen, which may be weekly or quarterly. That makes staleness a normal state rather than a fault — so it is reported plainly instead
of being treated as an error.

THE GAPS ARE WHY THE FRESHNESS LINE EXISTS
google_campaign_daily silently lost 12 July – 2 August 2026 — 22 days — because imports were sporadic and a Last-30-days window on
3 September could not reach back far enough. Nothing announced it. On screen a silent hole reads as a quiet month, which in August
would have read as a seasonal slowdown rather than a missing import. Holes are recoverable while you know about them: Google still
holds the data, and a custom-range export imports like any other file.

PREVIEW THEN COMMIT, AND THE FILES ARE SENT TWICE
Nothing is stashed on the server between the two calls. Commit re-derives the plan inside its own transaction from the same files, so
a preview taken ten minutes ago can never be committed blind.

A LARGE "LABEL MISMATCH" IS NOT AN ERROR on an old window — before the 2026-09-05 reset the label was not maintained at all, and the
first 13-month backfill reported 153 of 399 styles. It matters on a FRESH window, where it means the feed has stopped reaching Google.
The preview reports the number and says which way to read it; it does not decide.
=======================================================================================================================================
*/

import { useRef, useState } from 'react';
import { ArrowUpTrayIcon, XMarkIcon } from '@heroicons/react/24/outline';
import {
  googleAdsImportPreview, googleAdsImportCommit, getGoogleAdsImportLast,
  GoogleAdsImportSide, GoogleAdsImportResult, GoogleAdsCoverage,
} from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Built from the ISO string's own parts: new Date('2026-09-05') is parsed as UTC midnight and prints as 4 September west of London.
function shortDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
}

/** How stale, in words. "1 day old" is reassuring; "94 days old" is the point of the line. */
function staleness(c: GoogleAdsCoverage | null): string {
  if (!c) return 'never imported';
  if (c.daysOld === null) return `to ${shortDate(c.to)}`;
  if (c.daysOld <= 1) return `to ${shortDate(c.to)} · current`;
  return `to ${shortDate(c.to)} · ${c.daysOld} days old`;
}

function Coverage({ title, c }: { title: string; c: GoogleAdsCoverage | null }) {
  const missing = c?.gaps.reduce((a, g) => a + g.days, 0) ?? 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
      <span className="font-medium text-slate-600">{title}</span>
      <span className="text-slate-500">{staleness(c)}</span>
      {c && (
        <span className="text-slate-400">
          · {c.days.toLocaleString('en-GB')} days from {shortDate(c.from)}
        </span>
      )}
      {missing > 0 && (
        <span
          className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800"
          title={c!.gaps.map((g) => (g.days === 1 ? shortDate(g.from) : `${shortDate(g.from)} – ${shortDate(g.to)}`)).join(', ')}
        >
          {missing} day{missing === 1 ? '' : 's'} missing
        </span>
      )}
    </div>
  );
}

/** One report's plan, rendered as the arithmetic the operator checks: rows in file = write + unchanged + skipped. */
function SidePreview({ side }: { side: GoogleAdsImportSide }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">{side.label}</span>
        <span className="text-xs text-slate-400">{side.filename}</span>
      </div>
      {side.window && (
        <div className="mb-2 text-xs text-slate-500">
          {shortDate(side.window.from)} – {shortDate(side.window.to)} · {side.window.days} days
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
        <span className="text-slate-500">{side.rowsInFile.toLocaleString('en-GB')} rows</span>
        <span className="text-slate-400">=</span>
        <span><span className="font-semibold text-slate-800">{side.counts.write.toLocaleString('en-GB')}</span> <span className="text-slate-500">to write</span></span>
        <span><span className="font-semibold text-slate-800">{side.counts.unchanged.toLocaleString('en-GB')}</span> <span className="text-slate-500">unchanged</span></span>
        <span><span className="font-semibold text-slate-800">{side.counts.skipped.toLocaleString('en-GB')}</span> <span className="text-slate-500">skipped</span></span>
      </div>

      {/* If this ever fails, a row has been dropped without a reason — the one thing the import is built to make impossible. */}
      {!side.counts.balances && (
        <div className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700">
          The row counts do not add up. Do not commit — send this to whoever maintains the import.
        </div>
      )}

      {side.skipped.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-slate-500">
          {side.skipped.map((s) => (
            <li key={s.reason}>{s.count.toLocaleString('en-GB')} × {s.label}</li>
          ))}
        </ul>
      )}

      {side.styles && side.styles.unmatched > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {side.styles.unmatched} of {side.styles.inFile} styles are no longer in the catalogue — their spend is still recorded.
        </div>
      )}

      {side.labelMismatch && side.labelMismatch.styles > 0 && (
        <div className="mt-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
          <span className="font-medium">{side.labelMismatch.styles} of {side.labelMismatch.ofStyles} styles</span> show a different
          campaign in Google than here. Expected on an older window; on a recent one it means the feed is not reaching Google.
        </div>
      )}

      {side.emptyDays.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          {side.emptyDays.length} day{side.emptyDays.length === 1 ? '' : 's'} in this range had no activity at all.
        </div>
      )}

      {side.extraColumns.length > 0 && (
        <div className="mt-2 text-xs text-slate-500">
          New columns in the report, ignored: {side.extraColumns.join(', ')}
        </div>
      )}
    </div>
  );
}

export default function GoogleAdsImport({ onImported }: { onImported: () => void }) {
  const lastQ = useApiQuery('google-ads-import-last', getGoogleAdsImportLast);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<{ rejected: { filename: string; reason: string }[]; product: GoogleAdsImportSide | null; campaign: GoogleAdsImportSide | null } | null>(null);
  const [result, setResult] = useState<{ product: GoogleAdsImportResult | null; campaign: GoogleAdsImportResult | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onPick(list: FileList | null) {
    if (!list || list.length === 0) return;
    const picked = Array.from(list);
    setFiles(picked); setPreview(null); setResult(null); setError(null);
    setBusy(true);
    const res = await googleAdsImportPreview(picked);
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not read the report'); return; }
    setPreview(res.data!);
  }

  async function commit() {
    setBusy(true); setError(null);
    const res = await googleAdsImportCommit(files);
    setBusy(false);
    if (!res.success) { setError(res.error || 'The import failed and nothing was written'); return; }
    setResult(res.data!);
    setPreview(null);
    setFiles([]);
    if (inputRef.current) inputRef.current.value = '';
    lastQ.refresh();
    onImported();
  }

  function close() {
    setOpen(false); setFiles([]); setPreview(null); setResult(null); setError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  const nothingToWrite = preview !== null
    && (preview.product?.counts.write ?? 0) === 0
    && (preview.campaign?.counts.write ?? 0) === 0;

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* The freshness line is always visible, even when the panel is shut — it is the caveat on everything else on the page. */}
      <div className="space-y-0.5">
        <Coverage title="Product data" c={lastQ.data?.product ?? null} />
        <Coverage title="Campaign data" c={lastQ.data?.campaign ?? null} />
      </div>

      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        <ArrowUpTrayIcon className="h-4 w-4" />
        Import report
      </button>

      {open && (
        <div className="w-full rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Import a Google Ads report</h3>
              <p className="text-xs text-slate-500">
                Report editor → download <span className="font-mono">bcweb_product_30</span> or{' '}
                <span className="font-mono">adcost_summary_30</span> as CSV. Both at once is fine. The dates in the file decide what
                is imported, so widen the range to fill a gap.
              </p>
            </div>
            <button type="button" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600" aria-label="Close">
              <XMarkIcon className="h-5 w-5" />
            </button>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            multiple
            onChange={(e) => onPick(e.target.files)}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-slate-200 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-300"
          />

          {busy && <div className="mt-3 text-sm text-slate-500">Reading…</div>}
          {error && <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

          {preview && (
            <div className="mt-3 space-y-2">
              {preview.rejected.map((r) => (
                <div key={r.filename} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  <span className="font-medium">{r.filename}</span> — {r.reason}
                </div>
              ))}
              {preview.product && <SidePreview side={preview.product} />}
              {preview.campaign && <SidePreview side={preview.campaign} />}

              {(preview.product || preview.campaign) && (
                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={commit}
                    disabled={busy}
                    className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
                  >
                    {nothingToWrite ? 'Import anyway' : 'Import'}
                  </button>
                  {nothingToWrite && (
                    <span className="text-sm text-slate-500">Everything in this file is already imported.</span>
                  )}
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="mt-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
              {result.product && (
                <div>
                  Product report: <span className="font-semibold tabular-nums">{result.product.written.toLocaleString('en-GB')}</span> rows written
                  {result.product.unchanged > 0 && <span className="text-slate-500">, {result.product.unchanged.toLocaleString('en-GB')} already current</span>}
                  {result.product.window && <span className="text-slate-400"> · {shortDate(result.product.window.from)} – {shortDate(result.product.window.to)}</span>}
                </div>
              )}
              {result.campaign && (
                <div>
                  Campaign report: <span className="font-semibold tabular-nums">{result.campaign.written.toLocaleString('en-GB')}</span> rows written
                  {result.campaign.unchanged > 0 && <span className="text-slate-500">, {result.campaign.unchanged.toLocaleString('en-GB')} already current</span>}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
