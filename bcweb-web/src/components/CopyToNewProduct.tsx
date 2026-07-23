'use client';
/*
=======================================================================================================================================
Component: CopyToNewProduct
=======================================================================================================================================
Purpose: The "Copy" control on the Add / Modify identity card — clone the loaded product to a brand-new Group ID. Used rarely, so it's
         deliberately UNDERSTATED: an icon-only button sitting next to the clipboard "copy Group ID" icon (its partner), not a labelled
         block in the lookup flow. Clicking opens a small POPOVER with the new-Group-ID field; nothing about the clone is on screen until
         you ask for it. The headline case is copying a Birkenstock to build its opposite-width twin (Narrow -> Regular).

         The clone (server side, POST /product-copy) carries the header, ALL pricing and the sizes across, but BLANKS the barcodes,
         forces Shopify OFF, and — for Birkenstock — swaps the title's width word for the <Narrow/Regular> placeholder so it can't go
         live until the operator sets the correct width. On success the parent loads the new product so the user finishes it off
         (barcodes, width, then price/Shopify when ready).

         The new Group ID is checked for existence live (debounced), like the create form: a copy is an INSERT and the server rejects a
         clash, but we surface it immediately so Copy is blocked before the click. onUnauthorized bubbles an expired session up.
=======================================================================================================================================
*/

import { useState, useEffect, useRef } from 'react';
import { copyProduct, getProduct } from '@/lib/api';

export default function CopyToNewProduct({
  sourceGroupid, onCopied, onUnauthorized,
}: {
  sourceGroupid: string;
  onCopied: (groupid: string) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [newGroupid, setNewGroupid] = useState('');
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  // Live "does this Group ID already exist?" guard (a copy can't reuse a key).
  const [exists, setExists] = useState(false);
  const [checking, setChecking] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reset the little form whenever it's closed or the source product changes underneath us.
  useEffect(() => { setNewGroupid(''); setError(null); setNote(null); setExists(false); }, [sourceGroupid, open]);

  // Close the popover on an outside click or Escape (it overlaps content, so it shouldn't linger).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  useEffect(() => {
    const gid = newGroupid.trim().toUpperCase();
    if (!gid) { setExists(false); setChecking(false); return; }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(async () => {
      const res = await getProduct(gid);
      if (cancelled) return;
      if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
      setExists(res.success);
      setChecking(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [newGroupid, onUnauthorized]);

  const gid = newGroupid.trim().toUpperCase();
  const sameAsSource = gid === sourceGroupid.toUpperCase();
  const blocked = copying || checking || exists || sameAsSource || !gid;

  async function onCopy() {
    if (!gid) { setError('Enter a Group ID for the copy'); return; }
    if (sameAsSource) { setError('The new Group ID must differ from the source'); return; }
    if (exists) { setError('That Group ID already exists — pick another'); return; }
    setCopying(true);
    setError(null);
    const res = await copyProduct(sourceGroupid, gid);
    if (res.success && res.data) {
      if (!res.data.image.copied) setNote('Copied — image didn’t carry over, add one below.');
      onCopied(res.data.groupid); // parent swaps the panel to the new product
      return;
    }
    if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
    setError(res.error || 'Copy failed');
    setCopying(false);
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      {/* Understated trigger — quiet text in the identity card's secondary action row, next to "Image file" (and, soon, "Delete"). */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Clone this product to a new Group ID"
        className={'transition-colors ' + (open ? 'text-brand-700' : 'text-slate-500 hover:text-slate-700')}
      >
        Copy product
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            Header, price and sizes carry across. Barcodes are cleared and it stays off Shopify. For Birkenstock the width becomes a
            <span className="mx-1 font-mono">&lt;Narrow/Regular&gt;</span> placeholder to fill in.
          </p>
          <input
            value={newGroupid}
            onChange={(e) => { setNewGroupid(e.target.value.toUpperCase()); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !blocked) onCopy(); }}
            autoFocus
            placeholder="New Group ID"
            className={'w-full rounded-md border px-2.5 py-1.5 font-mono text-sm uppercase text-slate-800 focus:outline-none focus:ring-1 ' +
              (exists || sameAsSource ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500')}
          />
          {exists && <p className="mt-1 text-[11px] text-red-600">Already exists — a copy can’t reuse a key.</p>}
          {sameAsSource && !exists && <p className="mt-1 text-[11px] text-red-600">Pick a Group ID different from the source.</p>}
          {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
          {note && <p className="mt-1 text-[11px] text-amber-600">{note}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={onCopy}
              disabled={blocked}
              className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {copying ? 'Copying…' : 'Copy'}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={copying}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
