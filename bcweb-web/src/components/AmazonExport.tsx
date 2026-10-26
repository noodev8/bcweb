'use client';
/*
=======================================================================================================================================
Component: AmazonExport
=======================================================================================================================================
Purpose: The "Amazon upload file" control for a product. One button that asks the server to build the Amazon Seller Central upload
         file (AMZ-Upload.xlsm) for THIS groupid and downloads it in the browser. The operator then uploads that .xlsm to Seller
         Central (Catalogue > Upload via File). It replaces putting the groupid in groupids.txt and running the batch script by hand.

         The server does the real work (Python + the SHOES.xlsm template) and returns the file base64-encoded; here we just decode it to
         a Blob and trigger a download. Heads-up shown to the user: generating also stamps the sizes as "on Amazon" (skumap) and skips
         any size already listed — same behaviour as the batch script, so re-clicking won't duplicate rows.

         Self-contained: mount with key={groupid} so it resets per product.

         QUIET (2026-10-25, owner: replace the big purple button "with something more elegant"): Amazon Order's detail row passes
         `quiet` — an outline button with a download icon, the how-to in its tooltip rather than a paragraph under it. Products keeps
         the full block.
=======================================================================================================================================
*/

import { useState } from 'react';
import { ArrowDownTrayIcon } from '@heroicons/react/24/outline';
import { generateAmazonUpload } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  groupid: string;
  sizesCount: number;   // no active sizes -> nothing to upload; disable + explain
  onDownloaded?: (groupid: string) => void;   // told after the file has downloaded (Amazon Order's session-only "File made" tag)
  quiet?: boolean;      // the small outline button (Amazon Order) — see the header
}

const HOW_TO = 'Downloads AMZ-Upload.xlsm to upload at Seller Central (Catalogue → Upload via File). Also marks these sizes as on Amazon.';

// Turn the base64 the server sent into a real file download in the browser.
function downloadBase64(filename: string, base64: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function AmazonExport({ groupid, sizesCount, onDownloaded, quiet = false }: Props) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const noSizes = sizesCount < 1;

  async function onGenerate() {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await generateAmazonUpload(groupid);
    if (res.success && res.data) {
      const d = res.data;
      downloadBase64(d.filename, d.file);
      onDownloaded?.(groupid);
      // "added" = sizes written to the file; "skipped" = sizes left out (already on Amazon, OR no barcode) — so we don't claim a reason.
      const parts = [`${d.variants} added`];
      if (d.skipped) parts.push(`${d.skipped} skipped`);
      setNote(`Downloaded ${d.filename} · ${parts.join(', ')}`);
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;
    } else {
      setError(res.error || 'Failed to build the Amazon upload file');
    }
    setBusy(false);
  }

  if (quiet) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onGenerate}
          disabled={busy || noSizes}
          title={noSizes ? 'Add and save sizes first — there is nothing to upload.' : HOW_TO}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-brand-500 hover:text-brand-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ArrowDownTrayIcon className="h-4 w-4" />
          {busy ? 'Building…' : 'Amazon upload file'}
        </button>
        {note && <span className="text-xs font-medium text-green-600">{note}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Amazon</h3>
        <span className="text-[11px] text-slate-400">Builds the Seller Central upload file for this product</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          onClick={onGenerate}
          disabled={busy || noSizes}
          title={noSizes ? 'Add and save sizes first — there is nothing to upload.' : undefined}
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          {busy ? 'Building…' : 'Amazon upload file'}
        </button>

        {note && <span className="text-xs font-medium text-green-600">{note}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {noSizes ? (
        <p className="mt-1 text-[11px] text-amber-600">Add and save sizes first — there is nothing to upload.</p>
      ) : (
        <p className="mt-1 text-[11px] text-slate-400">
          {HOW_TO}
        </p>
      )}
    </div>
  );
}
