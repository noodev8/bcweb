'use client';
/*
=======================================================================================================================================
Component: AmzBarcodePanel  (Update Amazon -> barcode labels)
=======================================================================================================================================
Purpose: New Amazon products need a barcode label image in the barcode folder before they can be picked and shipped. Everything else
         on this page is the daily import; this is an occasional add-on to it, and is deliberately built to LOOK like one.

THE DESIGN CONSTRAINT, in the owner's words: "90% of the time there will be nothing to do." So:

  - It renders NOTHING but a quiet one-line link unless the import just introduced a product (`newProducts`, computed server-side in
    planStock — see utils/amzImport.js). No card, no headings, no instructions sitting on screen for a job that isn't due. The page
    goes further and doesn't mount this at all until files have been checked — nobody visits this screen to look at barcodes.
  - It NEVER asks where the barcode folder is until there is something to write into it. That was the awkward bit: the folder can only
    be discovered by asking, and asking on the off-chance is exactly the interruption to avoid. Being told by the import which products
    are new means the question is only ever put at the moment it has an obvious answer.
  - One button does the whole job — check the folder, write what's missing, say what it did. The operator is not asked to run a check,
    read a diff and then decide; there is only ever one sensible next action.

Jargon stays out of the normal path: "barcode label", not FNSKU/.bmp/300dpi. The FNSKU is shown small next to the product name because
it is the filename and appears on the label, but it never leads.

THE SPLIT THAT DEFINES THIS COMPONENT: the API knows which barcodes SHOULD exist (it can read amzfeed). It cannot know which DO — the
folder is a synced Google Drive directory on a PC and the API runs on a VPS. So the diff happens here, between an ordinary API read and
a File System Access API directory listing. No image is ever uploaded anywhere: they are made locally and written straight back.

Chrome/Edge only, by virtue of the File System Access API — surfaced if and when the operator tries, never as a standing warning.
=======================================================================================================================================
*/

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircleIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { getAmzBarcodeCheck } from '@/lib/api';
import { fnskuBarcodeBmp } from '@/lib/barcode128';
import {
  chooseBarcodeFolder, ensureFolderPermission, folderApiAvailable, listExistingBarcodes, savedBarcodeFolder, writeBarcode,
} from '@/lib/barcodeFolder';

type Folder = Awaited<ReturnType<typeof savedBarcodeFolder>>;

interface Props {
  /** Products the import just introduced. Non-empty is the ONLY thing that makes this component speak up on its own. */
  newProducts?: { fnsku: string; sku: string }[];
}

export default function AmzBarcodePanel({ newProducts = [] }: Props) {
  const [folder, setFolder] = useState<Folder>(null);
  const [manual, setManual] = useState(false);          // operator opened it themselves via the quiet link
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Recover the folder picked in a previous session. IndexedDB, not an API call — the no-fetching-in-effects rule
  // (docs/maintenance-notes.md) is about server data. Both setState calls sit inside the async callback: synchronous setState in an
  // effect trips react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!folderApiAvailable()) return;
      try {
        const saved = await savedBarcodeFolder();
        if (!cancelled) setFolder(saved);
      } catch { /* nothing remembered — we'll ask when there's a reason to */ }
    })();
    return () => { cancelled = true; };
  }, []);

  const prompted = newProducts.length > 0;
  const open = prompted || manual;

  /**
   * The whole job, behind one button: make sure we have a folder, diff it against what should be there, write the difference.
   *
   * It re-reads the full list from the API rather than trusting `newProducts`, because a product being new to amzfeed does not prove
   * its barcode is absent (it may have been made by hand) and older gaps deserve filling while we're here. `newProducts` decides
   * whether to ASK; the folder decides what to WRITE.
   */
  const run = useCallback(async (existingFolder: Folder) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      let handle = existingFolder;
      if (!handle) {
        handle = await chooseBarcodeFolder();
        if (!handle) { setBusy(false); return; }   // picker cancelled — no folder, no message, no fuss
        setFolder(handle);
      }
      if (!(await ensureFolderPermission(handle))) {
        setError('Access to the barcode folder was declined — nothing was written.');
        return;
      }

      const [listed, res] = await Promise.all([listExistingBarcodes(handle), getAmzBarcodeCheck()]);
      if (!res.success || !res.data) {
        setError(res.error || 'Could not load the product list');
        return;
      }

      const missing = res.data.fnskus.filter((f) => !listed.has(f.fnsku.toUpperCase()));
      if (missing.length === 0) {
        setResult('Every product already has a barcode label — nothing to do.');
        return;
      }
      for (const item of missing) {
        await writeBarcode(handle, item.fnsku, fnskuBarcodeBmp(item.fnsku));
      }
      setResult(`Created ${missing.length} barcode label${missing.length > 1 ? 's' : ''} in ${handle.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not write to the barcode folder');
    } finally {
      setBusy(false);
    }
  }, []);

  // Named for the operator, not for us: the first click is "set this up", every later one is "do it".
  const buttonLabel = useMemo(() => {
    if (busy) return 'Working…';
    if (!folder) return 'Choose barcode folder…';
    return prompted ? 'Create barcode labels' : 'Check barcode labels';
  }, [busy, folder, prompted]);

  // --- The quiet state: one muted line, and only after the operator has had a reason to look at this page at all. --------------
  if (!open) {
    return (
      <div className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <QrCodeIcon className="h-4 w-4" />
        <button type="button" onClick={() => setManual(true)} className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600">
          Check barcode labels
        </button>
      </div>
    );
  }

  return (
    <div className={`mt-6 rounded-xl border p-4 ${prompted ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <QrCodeIcon className={`h-5 w-5 shrink-0 ${prompted ? 'text-amber-500' : 'text-slate-400'}`} />
        <p className={`flex-1 text-sm ${prompted ? 'font-medium text-amber-900' : 'text-slate-700'}`}>
          {prompted
            ? `${newProducts.length} new product${newProducts.length > 1 ? 's' : ''} — ${newProducts.length > 1 ? 'they need' : 'it needs'} a barcode label.`
            : 'Check that every Amazon product has a barcode label.'}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => run(folder)}
          className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {buttonLabel}
        </button>
      </div>

      {/* The new products themselves. Product name leads; the code is there because it is what ends up on the label. */}
      {prompted && !result && (
        <ul className="mt-3 space-y-1 pl-8">
          {newProducts.slice(0, 6).map((p) => (
            <li key={p.fnsku} className="flex items-baseline gap-2 text-xs text-amber-900/80">
              <span className="font-mono">{p.sku}</span>
              <span className="font-mono text-amber-900/40">{p.fnsku}</span>
            </li>
          ))}
          {newProducts.length > 6 && (
            <li className="text-xs text-amber-900/50">and {newProducts.length - 6} more</li>
          )}
        </ul>
      )}

      {result && (
        <div className="mt-3 flex items-center gap-2 pl-8 text-xs font-medium text-emerald-700">
          <CheckCircleIcon className="h-4 w-4" />
          {result}
        </div>
      )}

      {error && <div className="mt-3 pl-8 text-xs text-red-700">{error}</div>}

      {/* Housekeeping, deliberately the smallest thing here — it only matters if the folder is ever wrong. */}
      {folder && (
        <p className="mt-3 pl-8 text-[11px] text-slate-400">
          Saving to <span className="font-medium text-slate-500">{folder.name}</span>
          {' · '}
          <button type="button" onClick={() => run(null)} className="underline decoration-slate-300 underline-offset-2 hover:text-slate-600">
            change folder
          </button>
        </p>
      )}
    </div>
  );
}
