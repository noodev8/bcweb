'use client';
/*
=======================================================================================================================================
Page: /update-amazon  (Update Amazon module)
=======================================================================================================================================
Purpose: Replace the legacy PowerBuilder UPDATE AMAZON button. Drop the Amazon Seller Central reports in, see exactly what they will
         do, then apply. Design: _amz-port/design/update-amazon-port.md.

         DROP FILES  ->  CHECK (writes nothing)  ->  APPLY (one transaction)

Two things drive the whole shape of this screen, both inherited from how the legacy version went wrong:

  1. IT NEVER SAID ANYTHING. `FileOpen` on a missing file returned -1 and the import carried on with an empty datastore. Two of its
     five inputs had been failing that way for a long time and the button gave no clue. So here nothing is written until the operator
     has seen a full account of it, and a file that can't be identified is named and refused rather than skipped.

  2. FILENAMES ARE MEANINGLESS. Seller Central names these 118981020662.txt and the number changes every download. Files are therefore
     identified by their HEADER, server-side — the operator never has to tell us which report is which, and cannot get it wrong.

Any subset of the four reports may be dropped; whatever is absent is left untouched. That is a real workflow (the fee report only
arrives monthly), not an edge case.

State is local and deliberately un-cached: an import is an action, not a view. There is nothing to re-fetch on mount, so no SWR here —
which also keeps it clear of the no-fetching-in-effects rule (docs/maintenance-notes.md).
=======================================================================================================================================
*/

import { useCallback, useRef, useState } from 'react';
import {
  ArrowUpTrayIcon, CheckCircleIcon, DocumentTextIcon, ExclamationCircleIcon, XMarkIcon,
} from '@heroicons/react/24/outline';
import AppShell from '@/components/AppShell';
import AmzImportSummary from '@/components/AmzImportSummary';
import AmzBarcodePanel from '@/components/AmzBarcodePanel';
import { previewAmzImport, commitAmzImport, getAmzImportLast, AmzImportSummary as Summary, AmzRejectedFile } from '@/lib/api';
import { useApiQuery } from '@/lib/useApiQuery';

const MAX_FILES = 4;

type Stage = 'choose' | 'checked' | 'done';

export default function UpdateAmazonPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [stage, setStage] = useState<Stage>('choose');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rejected, setRejected] = useState<AmzRejectedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Just a "when did this last run" line — one lightweight read on mount, not a heavy aggregate, so it's fine to fetch here despite
  // the file's usual no-SWR stance (see header note).
  const { data: lastRun, refresh: refreshLastRun } = useApiQuery('amz-import-last', getAmzImportLast);

  /** Adding or removing a file invalidates any check already done — the summary must never outlive the files it describes. */
  const resetCheck = useCallback(() => {
    setStage('choose');
    setSummary(null);
    setRejected([]);
    setError(null);
  }, []);

  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    setFiles((prev) => {
      // De-duplicate by name+size so dropping the same file twice doesn't send it twice. The server would reject the pair as a
      // duplicate report anyway, but failing here is friendlier than failing after an upload.
      const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
      const merged = [...prev];
      for (const f of list) {
        if (!seen.has(`${f.name}:${f.size}`) && merged.length < MAX_FILES) merged.push(f);
      }
      return merged;
    });
    resetCheck();
  }, [resetCheck]);

  const removeFile = useCallback((idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    resetCheck();
  }, [resetCheck]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  }, [addFiles]);

  async function runCheck() {
    setBusy(true);
    setError(null);
    const res = await previewAmzImport(files);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || 'Could not read the files');
      setRejected([]);
      return;
    }
    setSummary(res.data.summary);
    setRejected(res.data.rejected);
    setStage('checked');
  }

  async function runApply() {
    setBusy(true);
    setError(null);
    // The same files go up again — nothing was stashed server-side, and the commit rebuilds its plan from the database inside its
    // own transaction rather than trusting the check we just ran.
    const res = await commitAmzImport(files);
    setBusy(false);
    if (!res.success || !res.data) {
      setError(res.error || 'The import failed — nothing was written');
      return;
    }
    setSummary(res.data.summary);
    setRejected(res.data.rejected);
    setStage('done');
    refreshLastRun();
  }

  function startOver() {
    setFiles([]);
    resetCheck();
    if (inputRef.current) inputRef.current.value = '';
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Update Amazon</h1>
        <p className="mt-1 text-sm text-slate-500">
          Drop the Seller Central reports in. Nothing is written until you have seen what they will do.
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Last processed: {lastRun?.lastRun ? `${lastRun.lastRun}${lastRun.by ? ` — ${lastRun.by}` : ''}` : 'unknown'}
        </p>
      </div>

      {/* --- Stage 1: the files -------------------------------------------------------------------------------------------- */}
      {stage !== 'done' && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            dragging ? 'border-slate-900 bg-slate-50' : 'border-slate-300 bg-white'
          }`}
        >
          <ArrowUpTrayIcon className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-700">Drop the Amazon reports here</p>
          <p className="mt-1 text-xs text-slate-500">
            Orders · FBA Inventory · FBA Returns · FBA Fee Preview — any combination, up to {MAX_FILES} files.
          </p>
          <p className="mt-1 text-xs text-slate-400">Safe to re-run any file as often as you like — reprocessing the same data won&apos;t cause issues.</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Choose files
          </button>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".txt,.csv,.tsv,text/plain"
            className="hidden"
            onChange={(e) => { if (e.target.files) addFiles(e.target.files); }}
          />
        </div>
      )}

      {/* Staged files */}
      {files.length > 0 && stage !== 'done' && (
        <ul className="mt-4 space-y-2">
          {files.map((f, i) => (
            <li key={`${f.name}:${f.size}`} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <DocumentTextIcon className="h-4 w-4 shrink-0 text-slate-400" />
              <span className="flex-1 truncate text-sm text-slate-700">{f.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-slate-400">{(f.size / 1024).toFixed(0)} KB</span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={`Remove ${f.name}`}
              >
                <XMarkIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Files the server could not identify. Named individually with the reason — this is the case the legacy import turned into
          silence, so it is given real estate rather than a toast. */}
      {rejected.length > 0 && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800">
            <ExclamationCircleIcon className="h-4 w-4" />
            {rejected.length} file{rejected.length > 1 ? 's' : ''} could not be used
          </div>
          <ul className="mt-2 space-y-1.5">
            {rejected.map((rj) => (
              <li key={rj.filename} className="text-xs text-red-700">
                <span className="font-mono font-medium">{rj.filename}</span> — {rj.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {/* --- Actions ------------------------------------------------------------------------------------------------------ */}
      <div className="mt-5 flex items-center gap-3">
        {stage === 'choose' && (
          <button
            type="button"
            disabled={files.length === 0 || busy}
            onClick={runCheck}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Checking…' : 'Check files'}
          </button>
        )}

        {stage === 'checked' && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={runApply}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? 'Applying…' : 'Apply'}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={startOver}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
            >
              Cancel
            </button>
            <span className="text-xs text-slate-500">Nothing has been written yet.</span>
          </>
        )}

        {stage === 'done' && (
          <button
            type="button"
            onClick={startOver}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Run another update
          </button>
        )}
      </div>

      {stage === 'done' && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
          <CheckCircleIcon className="h-5 w-5" />
          Done — everything below is what was written.
        </div>
      )}

      {/* --- The account -------------------------------------------------------------------------------------------------- */}
      {summary && (
        <div className="mt-6">
          <AmzImportSummary summary={summary} />
        </div>
      )}

      {/* Barcode labels — an occasional add-on to the import, not a feature of it.

          Nothing at all until files have been checked: nobody comes to this page to look at barcodes, they come to process the latest
          Amazon file, so an empty page has no business mentioning them. From then on it is a single muted line, and it only speaks up
          when the import has actually introduced a product.

          `newProducts` is passed ONLY at the 'done' stage, never after a check: until the import is committed the product isn't in
          amzfeed, so there would be nothing for the panel to write and the prompt would be a lie. */}
      {stage !== 'choose' && (
        <AmzBarcodePanel newProducts={stage === 'done' ? summary?.stock?.newBarcodes ?? [] : []} />
      )}
    </AppShell>
  );
}
