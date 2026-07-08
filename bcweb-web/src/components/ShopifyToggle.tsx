'use client';
/*
=======================================================================================================================================
Component: ShopifyToggle
=======================================================================================================================================
Purpose: The Shopify ON/OFF control for a product — and the thing that actually SENDS the product to Shopify. Turning ON calls
         POST /product-shopify, which pushes the product (with its sizes, price, title, image) to Shopify via the Admin API and, only
         if that succeeds, flags it live. This replaces the legacy "upload a product CSV" step: flip it on and it appears on the store.

         NEW vs EDIT is decided server-side by looking the handle up on Shopify — a brand-new product gets the "Stock Code: <groupid>"
         placeholder description (which the owner then replaces in the Shopify UI); an existing one is updated WITHOUT touching that
         description. So this same button both creates a new listing and re-pushes edits.

         Turning OFF just clears the flag (non-destructive — it does NOT unpublish the Shopify product).

         Self-contained: mount with key={groupid} so it resets per product. Mirrors the server guards client-side (needs a price > 0 and
         at least one size) purely for immediate feedback — the server stays authoritative. On a successful change it calls onChanged so
         the parent panel's shopify flag stays in sync.
=======================================================================================================================================
*/

import { useState } from 'react';
import { setProductShopify } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  groupid: string;
  shopify: boolean;            // current live state (from the loaded product)
  price: number | null;        // Shopify price — must be > 0 to enable
  sizesCount: number;          // number of sizes — must be >= 1 to enable
  onChanged?: (shopify: boolean) => void;
}

export default function ShopifyToggle({ groupid, shopify, price, sizesCount, onChanged }: Props) {
  const { logout } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);   // success detail (e.g. "Created · 11 variants")

  // Client-side mirror of the server's enable guards, so the user sees *why* they can't push before clicking.
  const missingPrice = price === null || price <= 0;
  const missingSizes = sizesCount < 1;
  const blockReason = missingPrice
    ? 'Set a Shopify price greater than £0 first.'
    : missingSizes
      ? 'Save the sizes first.'
      : null;

  async function turnOn() {
    setBusy(true);
    setError(null);
    setNote(null);
    // status omitted -> server default ACTIVE (publish). Pass 'DRAFT' here instead if we ever want a create-as-draft option.
    const res = await setProductShopify(groupid, true);
    if (res.success && res.data) {
      const p = res.data.push;
      setNote(p ? `${p.isNew ? 'Created' : 'Updated'} on Shopify · ${p.variantCount} variant${p.variantCount === 1 ? '' : 's'}` : 'On');
      onChanged?.(true);
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;
    } else {
      setError(res.error || 'Failed to push to Shopify');
    }
    setBusy(false);
  }

  async function turnOff() {
    setBusy(true);
    setError(null);
    setNote(null);
    const res = await setProductShopify(groupid, false);
    if (res.success) {
      onChanged?.(false);
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;
    } else {
      setError(res.error || 'Failed to turn off');
    }
    setBusy(false);
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wide text-slate-400">Shopify</h3>
        <span className="text-[11px] text-slate-400">Turning on pushes this product to Shopify</span>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {shopify ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
              <span className="h-2 w-2 rounded-full bg-green-500" /> Live on Shopify
            </span>
            <button
              onClick={turnOff}
              disabled={busy}
              className="rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Turn off'}
            </button>
          </>
        ) : (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-500">
              <span className="h-2 w-2 rounded-full bg-slate-400" /> Not on Shopify
            </span>
            <button
              onClick={turnOn}
              disabled={busy || !!blockReason}
              title={blockReason || undefined}
              className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {busy ? 'Pushing…' : 'Turn on & push to Shopify'}
            </button>
          </>
        )}

        {note && <span className="text-xs font-medium text-green-600">{note}</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {/* Why the push is blocked (only when off and not pushable). */}
      {!shopify && blockReason && !error && (
        <p className="mt-1 text-[11px] text-amber-600">{blockReason}</p>
      )}
    </div>
  );
}
