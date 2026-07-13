'use client';
/*
=======================================================================================================================================
Context: AmzBasketContext  (the Amazon Pricing upload basket)
=======================================================================================================================================
Purpose: Amazon has no live price push — a price change is logged (POST /amz-apply) and only reaches Amazon when the operator uploads ONE
         tab-separated file to Seller Central. This context is that basket: the set of price changes queued during the current sitting.

Why a context (not per-page state): the flow is multi-page (apply on a SKU's detail page, navigate back to the list, apply another). The
provider lives in the module layout (src/app/amz/layout.tsx), above every /amz page, so the basket survives client-side navigation between
them.

DURABLE + TEAM-WIDE, regenerate-anytime (2026-07-12): the basket is no longer only in browser memory — it is a VIEW of "the team's Amazon
price changes in the last 12 hours" (any operator, so whoever is at the desk can upload a colleague's pending change), rebuilt from the
audit log (GET /amz-basket) on mount. So switching the machine off before downloading no longer loses the file: reopen and recent changes
are still there (they were persisted to amz_price_log by every Apply). add() still updates it optimistically on Apply for instant feedback;
a hard refresh re-hydrates from the DB. The basket shows only PENDING changes (uploaded_at IS NULL): downloading the file arms a confirm
step, and pressing "I've uploaded" (POST /amz-mark-uploaded) stamps those rows uploaded team-wide so they leave the basket for good — which
is what tells the operator (and a colleague, and tomorrow-morning-them) the work is done. Confirmation is deliberate, not auto-on-download:
a download may be a preview, and a Seller Central upload can fail after the file is fetched, so nothing clears until a human confirms it went
live. lastUpload surfaces the team's most recent confirmed upload (who/when/how many) so an empty basket reads as "done", not "did anyone
check?". A generous rolling 72h window bounds the pending set as a backstop; the upload confirmation, not the clock, is what normally clears
a row. No delete (that would tamper with the audit log); re-confirming is a harmless no-op since the upload itself is idempotent.

The file is built here, client-side, from the queued rows (each carries its Amazon SKU + RRP), so no extra round-trip is needed — both the
POST /amz-apply response and GET /amz-basket return amz_sku + rrp. Format (from AMZ_PRICING.md):
   sku <TAB> price <TAB> minimum-seller-allowed-price <TAB> maximum-seller-allowed-price
   - sku = the Amazon SKU (amzfeed.sku), NOT our code.  - min = blank.  - max = the style's RRP (blank if unknown).
=======================================================================================================================================
*/

import { createContext, useContext, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { getAmzBasket, markAmzUploaded, AmzLastUpload } from '@/lib/api';

// One queued change. Everything the Seller Central file needs lives on the item (amz_sku, new_price, rrp) so it's built without a fetch.
export interface AmzBasketItem {
  id: number;               // the amz_price_log row id — sent to /amz-mark-uploaded so the server knows which rows the file covered
  code: string;             // our SKU (the map key)
  amz_sku: string;          // the Amazon SKU written to the file
  size: string;
  title: string | null;
  segment: string | null;
  old_price: number | null;
  new_price: number;
  rrp: number | null;
}

// A snapshot taken at download time: exactly the rows written to the file the operator now has. Kept separate from the live `items` so a
// change applied AFTER the download (by them or a colleague) doesn't get swept into "I've uploaded" — only what was downloaded is cleared.
interface PendingUpload {
  items: AmzBasketItem[];   // what the downloaded file contained (used to re-download the identical file)
  ids: number[];            // their log-row ids (latest pending row per SKU) — the mark-uploaded payload
}

interface AmzBasketValue {
  items: Record<string, AmzBasketItem>;   // keyed by code; re-applying a code overwrites (latest price wins)
  count: number;
  lastUpload: AmzLastUpload | null;        // the team's most recent confirmed Seller Central upload (reassurance line)
  pending: PendingUpload | null;           // set while a downloaded file awaits its "I've uploaded" confirmation
  add: (item: AmzBasketItem) => void;
  refresh: () => void;                      // re-pull recent changes from the audit log (GET /amz-basket)
  download: () => void;                     // build + download the one upload file, then await confirmation
  redownload: () => void;                   // re-download the identical pending file (same snapshot)
  confirmUploaded: () => Promise<void>;     // stamp the downloaded rows uploaded -> they leave the basket (team-wide)
  cancelPending: () => void;                // dismiss the confirm prompt without marking (rows stay pending)
}

const AmzBasketContext = createContext<AmzBasketValue | null>(null);

// Build the ONE tab-separated upload file from the queued items and trigger a browser download.
function buildAndDownload(items: AmzBasketItem[]) {
  const header = 'sku\tprice\tminimum-seller-allowed-price\tmaximum-seller-allowed-price';
  const lines = items.map((i) => `${i.amz_sku}\t${i.new_price.toFixed(2)}\t\t${i.rrp != null ? i.rrp.toFixed(2) : ''}`);
  const content = [header, ...lines].join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'AMZ-Price-Upload.txt';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AmzBasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Record<string, AmzBasketItem>>({});
  const [lastUpload, setLastUpload] = useState<AmzLastUpload | null>(null);
  const [pending, setPending] = useState<PendingUpload | null>(null);

  const add = useCallback((item: AmzBasketItem) => {
    setItems((prev) => ({ ...prev, [item.code]: item }));
  }, []);

  // Rebuild the basket from the audit log (the team's recent PENDING changes) + the last confirmed upload. Runs on mount so a hard refresh
  // / reopen restores the file; drops any row without an Amazon SKU (can't build a file line for it). Silent on failure/UNAUTHORIZED — the
  // page chrome handles auth.
  const refresh = useCallback(async () => {
    const res = await getAmzBasket();
    if (!res.success || !res.data) return;
    const next: Record<string, AmzBasketItem> = {};
    for (const r of res.data.items) {
      if (!r.amz_sku) continue;
      next[r.code] = {
        id: r.id, code: r.code, amz_sku: r.amz_sku, size: r.size, title: r.title,
        segment: r.segment, old_price: r.old_price, new_price: r.new_price, rrp: r.rrp,
      };
    }
    setItems(next);
    setLastUpload(res.data.lastUpload);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Download the file AND snapshot exactly what it contained, so the confirm step marks only those rows (not anything applied afterwards).
  const download = useCallback(() => {
    const list = Object.values(items);
    if (!list.length) return;
    buildAndDownload(list);
    setPending({ items: list, ids: list.map((i) => i.id) });
  }, [items]);

  // Re-download the identical file the operator is confirming (same snapshot) — e.g. they lost the first download.
  const redownload = useCallback(() => {
    if (pending && pending.items.length) buildAndDownload(pending.items);
  }, [pending]);

  // Confirm the download is live in Seller Central: stamp its rows uploaded (server-side, team-wide), then re-pull — the stamped rows drop
  // out of the basket and lastUpload updates. Clears the confirm prompt only on success, so a failed mark leaves the operator able to retry.
  const confirmUploaded = useCallback(async () => {
    if (!pending || !pending.ids.length) { setPending(null); return; }
    const res = await markAmzUploaded(pending.ids);
    if (!res.success) return;
    setPending(null);
    await refresh();
  }, [pending, refresh]);

  const cancelPending = useCallback(() => setPending(null), []);

  const value = useMemo<AmzBasketValue>(
    () => ({
      items, count: Object.keys(items).length, lastUpload, pending,
      add, refresh, download, redownload, confirmUploaded, cancelPending,
    }),
    [items, lastUpload, pending, add, refresh, download, redownload, confirmUploaded, cancelPending]
  );

  return <AmzBasketContext.Provider value={value}>{children}</AmzBasketContext.Provider>;
}

// Hook — throws if used outside the provider (a wiring bug, not a runtime condition to handle).
export function useAmzBasket(): AmzBasketValue {
  const ctx = useContext(AmzBasketContext);
  if (!ctx) throw new Error('useAmzBasket must be used within an AmzBasketProvider');
  return ctx;
}
