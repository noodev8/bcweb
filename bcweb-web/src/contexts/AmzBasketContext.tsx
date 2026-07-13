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
a hard refresh re-hydrates from the DB. Because the Seller Central upload is idempotent (the file just SETS prices), the basket is a view
you can download any number of times — there is no "clear once uploaded" step, and no delete (that would be tampering with the audit log).
A rolling 12h window carries a session across midnight and then self-clears.

The file is built here, client-side, from the queued rows (each carries its Amazon SKU + RRP), so no extra round-trip is needed — both the
POST /amz-apply response and GET /amz-basket return amz_sku + rrp. Format (from AMZ_PRICING.md):
   sku <TAB> price <TAB> minimum-seller-allowed-price <TAB> maximum-seller-allowed-price
   - sku = the Amazon SKU (amzfeed.sku), NOT our code.  - min = blank.  - max = the style's RRP (blank if unknown).
=======================================================================================================================================
*/

import { createContext, useContext, useCallback, useEffect, useMemo, useState, ReactNode } from 'react';
import { getAmzBasket } from '@/lib/api';

// One queued change. Everything the Seller Central file needs lives on the item (amz_sku, new_price, rrp) so it's built without a fetch.
export interface AmzBasketItem {
  code: string;             // our SKU (the map key)
  amz_sku: string;          // the Amazon SKU written to the file
  size: string;
  title: string | null;
  segment: string | null;
  old_price: number | null;
  new_price: number;
  rrp: number | null;
}

interface AmzBasketValue {
  items: Record<string, AmzBasketItem>;   // keyed by code; re-applying a code overwrites (latest price wins)
  count: number;
  add: (item: AmzBasketItem) => void;
  refresh: () => void;                      // re-pull recent changes from the audit log (GET /amz-basket)
  download: () => void;                     // build + download the one upload file
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

  const add = useCallback((item: AmzBasketItem) => {
    setItems((prev) => ({ ...prev, [item.code]: item }));
  }, []);

  // Rebuild the basket from the audit log (this operator's recent changes). Runs on mount so a hard refresh / reopen restores the file;
  // drops any row without an Amazon SKU (can't build a file line for it). Silent on failure/UNAUTHORIZED — the page chrome handles auth.
  const refresh = useCallback(async () => {
    const res = await getAmzBasket();
    if (!res.success || !res.data) return;
    const next: Record<string, AmzBasketItem> = {};
    for (const r of res.data.items) {
      if (!r.amz_sku) continue;
      next[r.code] = {
        code: r.code, amz_sku: r.amz_sku, size: r.size, title: r.title,
        segment: r.segment, old_price: r.old_price, new_price: r.new_price, rrp: r.rrp,
      };
    }
    setItems(next);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const download = useCallback(() => {
    const list = Object.values(items);
    if (list.length) buildAndDownload(list);
  }, [items]);

  const value = useMemo<AmzBasketValue>(
    () => ({ items, count: Object.keys(items).length, add, refresh, download }),
    [items, add, refresh, download]
  );

  return <AmzBasketContext.Provider value={value}>{children}</AmzBasketContext.Provider>;
}

// Hook — throws if used outside the provider (a wiring bug, not a runtime condition to handle).
export function useAmzBasket(): AmzBasketValue {
  const ctx = useContext(AmzBasketContext);
  if (!ctx) throw new Error('useAmzBasket must be used within an AmzBasketProvider');
  return ctx;
}
