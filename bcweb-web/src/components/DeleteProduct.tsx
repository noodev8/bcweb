'use client';
/*
=======================================================================================================================================
Component: DeleteProduct
=======================================================================================================================================
Purpose: The "Delete product" control on the Add / Modify identity card — PERMANENTLY remove a product (Shopify listing + our four
         definition tables + image). Irreversible, no archive, so it's deliberately hard to fire by accident. Presented as a small
         anchored POPOVER (same feel as "Copy product") rather than a big dimmed modal:
           - the trigger is quiet grey text in the secondary action row;
           - clicking opens a popover that spells out what happens and what's kept;
           - Delete stays DISABLED until the operator types the exact Group ID (the server re-checks this too);
           - if the product still has sellable stock, the popover blocks with a note instead — clear the local stock first.
         On success the parent clears the panel (the product no longer exists). onUnauthorized bubbles an expired session up.
=======================================================================================================================================
*/

import { useState, useEffect, useRef } from 'react';
import { deleteProduct } from '@/lib/api';

export default function DeleteProduct({
  groupid, stock, onDeleted, onUnauthorized,
}: {
  groupid: string;
  stock: number;   // current sellable stock — a product with stock can't be deleted (clear it physically first)
  onDeleted: (groupid: string) => void;
  onUnauthorized: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Reset whenever the popover opens/closes or the product changes underneath us.
  useEffect(() => { setTyped(''); setError(null); }, [open, groupid]);

  // Close on an outside click or Escape (matches the Copy popover), unless a delete is in flight.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!busy && wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open, busy]);

  const hasStock = stock > 0;
  const matches = typed.trim() === groupid;

  async function onConfirm() {
    if (!matches || hasStock) return;
    setBusy(true);
    setError(null);
    const res = await deleteProduct(groupid, typed.trim());
    if (res.success) {
      onDeleted(groupid); // parent clears the panel
      return;
    }
    if (res.return_code === 'UNAUTHORIZED') { onUnauthorized(); return; }
    setError(res.error || 'Delete failed');
    setBusy(false);
  }

  return (
    <div ref={wrapRef} className="relative inline-block">
      {/* Quiet text trigger — same weight as "Copy product" / "Image filename". */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Permanently delete this product"
        className={'transition-colors ' + (open ? 'text-slate-700' : 'text-slate-500 hover:text-slate-700')}
      >
        Delete product
      </button>

      {open && (
        // Anchored to the right (this is the row's last item, so it opens below-left and stays inside the card). Mirrors CopyToNewProduct.
        <div className="absolute right-0 top-full z-30 mt-1.5 w-72 rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-[11px] leading-relaxed text-slate-500">
            Removes it from Shopify and the catalogue (details, sizes, attributes) and deletes the image. Sales &amp; reports are kept.
            <span className="ml-1 font-medium text-red-600">Can’t be undone.</span>
          </p>

          {hasStock ? (
            // Stock guard — can't delete while there's sellable stock. Clear the local stock first.
            <div className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-800">
              Still has <span className="font-semibold">{stock} in stock</span>. Clear the local stock before deleting this product.
            </div>
          ) : (
            <>
              <div className="mb-1 text-[11px] text-slate-500">Type the Group ID to confirm</div>
              <input
                value={typed}
                onChange={(e) => { setTyped(e.target.value.toUpperCase()); setError(null); }}
                onKeyDown={(e) => { if (e.key === 'Enter' && matches && !busy) onConfirm(); }}
                autoFocus
                placeholder={groupid}
                className={'w-full rounded-md border px-2.5 py-1.5 font-mono text-sm uppercase text-slate-800 focus:outline-none focus:ring-1 ' +
                  (typed && !matches ? 'border-red-400 focus:border-red-500 focus:ring-red-500' : 'border-slate-300 focus:border-brand-500 focus:ring-brand-500')}
              />
              {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
            </>
          )}

          <div className="mt-2 flex items-center gap-2">
            {!hasStock && (
              <button
                type="button"
                onClick={onConfirm}
                disabled={!matches || busy}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {busy ? 'Deleting…' : 'Delete'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={busy}
              className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-50"
            >
              {hasStock ? 'Close' : 'Cancel'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
