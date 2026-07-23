'use client';
/*
=======================================================================================================================================
Component: InvStyleCard
=======================================================================================================================================
Purpose: One result in the Inventory BROWSE. The redesign (2026-07-23) drops the old finder-list + single detail panel in favour of
         scrolling a stack of rich cards, like a shop's category page — because the real pain is "a dozen near-identical black Arizonas
         came back; which one, is my size in, and where". A list shows one picture at a time; a browse shows them all at once, which is
         how a human tells them apart. The image stops being something you summon and becomes the result itself.

STAY LIGHT UNTIL CLICKED (owner, 2026-07-23). The whole face paints from the /inv-styles row already in memory — image, title, price,
and the size chips with their LOCAL counts (row.localSizes). The heavy per-style detail (/inv-stock: every rack, the 12 buckets) is
fetched ONLY when the operator taps a size to see where it is, and cached after the first tap. Nothing here fires a request on render,
so a screen full of cards costs zero extra round-trips until someone actually asks a question of one.

SIZE CHIP = the 2-digit code suffix (owner) — "38", "06" — which is the canonical EU size in this DB (RIGHT(code,2)). localSizes is
keyed by that suffix, so the chip prints the key verbatim. EVERY size shows a chip — sold-out ones (qty 0) greyed IN PLACE, so a
missing middle size can't slide a bigger size into the gap and read as a different size (owner, 2026-07-23). localSizes now carries the
full range (0 for sold-out), so the face still needs no fetch. The count rides on a chip only when qty > 1 — a lone "1" is just noise.

SIZE-FILTER LEAD. When the operator has a size filter on ("the customer's a 41"), the whole result set is already narrowed to styles
that HOLD a 41, so each card LEADS with that size's count — pulled free from localSizes, no fetch — and the matching chip is ringed.
That answers "who has my size, and how many" for every candidate at a glance while you scroll and confirm by picture. The racks are
still one tap away; we do not auto-fetch 40 styles' worth of detail just because a size filter is on (owner's over-fetch concern).
=======================================================================================================================================
*/

import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { ChevronRightIcon } from '@heroicons/react/24/outline';
import { getInvStock, adjustStock, InvStyleRow, InvStockData, InvLocationRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import InvLocations from '@/components/InvLocations';
import InvBreakdown from '@/components/InvBreakdown';

const IMAGE_BASE = 'https://images.brookfieldcomfort.com/';

// Normalise a size token for matching, so a typed "5" finds a stored "05" and a chip key "38" finds a location eu "38". Numeric where
// possible (drops the leading zero via parseFloat); otherwise a trimmed lowercase string. Mirrors the same helper on the page.
function normSize(s: string): string {
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? String(n) : s.trim().toLowerCase();
}

// Size chips in ascending numeric order (35, 36, … 46) rather than the map's insertion order, which is whatever the SQL emitted.
function sortedSizes(localSizes: Record<string, number>): [string, number][] {
  return Object.entries(localSizes).sort((a, b) => {
    const na = Number.parseFloat(a[0]);
    const nb = Number.parseFloat(b[0]);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a[0].localeCompare(b[0]);
  });
}

export default function InvStyleCard({ row, sizeFilter }: { row: InvStyleRow; sizeFilter: string | null }) {
  const { logout } = useAuth();

  const src = row.imagename ? IMAGE_BASE + row.imagename : null;

  // Image load WITH RETRY. A single onError used to latch "Image not found" forever — but on a fast scroll a burst of lazy images
  // loads at once and some transiently fail (the optimizer/CDN under load, or an aborted request), not because the file is missing
  // (owner: "the image has always been there and is showing now — did I scroll too fast?"). So we retry a few times with a short,
  // growing backoff by remounting the <Image> (key=reloadKey), and only fall back to the placeholder once retries are genuinely
  // exhausted. A truly missing file just fails all attempts and lands on the same placeholder, a beat later.
  const MAX_RETRIES = 3;
  const [imgErrors, setImgErrors] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const imgFailed = imgErrors >= MAX_RETRIES;
  const onImgError = useCallback(() => {
    setImgErrors((n) => {
      const next = n + 1;
      // Retries left — schedule a remount after a growing delay, giving a momentary saturation time to clear before we try again.
      if (next < MAX_RETRIES) window.setTimeout(() => setReloadKey((k) => k + 1), 400 * next);
      return next;
    });
  }, []);

  // Lazy detail — the racks and buckets — fetched on the FIRST size tap and cached. Never on render.
  const [detail, setDetail] = useState<InvStockData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  // Which size's racks are open, as a localSizes key ("38"/"06"); null = none. Set ONLY by a tap, so opening a card's racks is always
  // a deliberate act (and the only thing that triggers the /inv-stock fetch).
  const [openSize, setOpenSize] = useState<string | null>(null);

  const sizes = useMemo(() => sortedSizes(row.localSizes), [row.localSizes]);

  // The size-filter lead: the chip key that matches the active filter, and its local count — both free from memory. `matchedKey` also
  // rings the chip so the eye lands on it as you scroll.
  const matchedKey = useMemo(() => {
    if (!sizeFilter) return null;
    const t = normSize(sizeFilter);
    return Object.keys(row.localSizes).find((k) => normSize(k) === t) || null;
  }, [sizeFilter, row.localSizes]);

  // Fetch detail once, idempotently. Called only from a tap.
  const ensureDetail = useCallback(async () => {
    if (detail || detailLoading) return;
    setDetailLoading(true);
    setDetailError(null);
    const res = await getInvStock(row.groupid);
    if (res.success && res.data) {
      setDetail(res.data);
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
      return;
    } else {
      setDetailError(res.error || 'Could not load locations');
    }
    setDetailLoading(false);
  }, [detail, detailLoading, row.groupid, logout]);

  // Tap a size chip: toggle its racks open/closed, fetching detail the first time.
  const onTapSize = useCallback((key: string) => {
    setOpenSize((prev) => (prev === key ? null : key));
    ensureDetail();
  }, [ensureDetail]);

  // ---- Phase 2: +/- stock adjustments (writes) ----
  // A per-size override of the chip count, applied right after a successful +/- so the face reflects the new total immediately (the
  // base counts come from the /inv-styles snapshot, which doesn't know about this edit). Keyed by the chip/size key.
  const [sizeOverride, setSizeOverride] = useState<Record<string, number>>({});
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // Force a fresh /inv-stock (bypasses ensureDetail's "already loaded" guard) so the racks reflect a just-made edit.
  const reloadDetail = useCallback(async () => {
    const res = await getInvStock(row.groupid);
    if (res.success && res.data) setDetail(res.data);
    else if (res.return_code === 'UNAUTHORIZED') logout();
  }, [row.groupid, logout]);

  // Handle a +/- from the locations panel: call the write endpoint, then update the edited size's chip count from the server's fresh
  // total and re-pull the racks. On failure, still re-pull, so the screen shows the true state rather than an optimistic guess.
  const handleAdjust = useCallback(async (args: { code: string; location: string; delta: number; ids: string[] }) => {
    setAdjustError(null);
    const res = await adjustStock(args);
    if (res.success && res.data) {
      const local = res.data.local;
      if (openSize) setSizeOverride((p) => ({ ...p, [openSize]: local }));
      await reloadDetail();
    } else if (res.return_code === 'UNAUTHORIZED') {
      logout();
    } else {
      setAdjustError(res.error || 'Could not adjust stock');
      await reloadDetail();
    }
  }, [openSize, reloadDetail, logout]);

  // The deep breakdown (full size range incl. sold-out zeros, the 12 buckets, reprice/product links, recent sales). Each card owns its
  // own open/close — the operator opens and closes whichever they want, and one card's breakdown never collapses another (an earlier
  // accordion did that, and the collapse-jump was jarring — owner, 2026-07-23). It reads the same /inv-stock the racks use, so opening
  // it after a size tap costs nothing more.
  const [showBreakdown, setShowBreakdown] = useState(false);
  const onToggleBreakdown = useCallback(() => {
    setShowBreakdown((v) => !v);
    ensureDetail();
  }, [ensureDetail]);

  // Racks for the open size — matched out of the fetched detail by 2-digit size (loc.eu), numeric so a padded "06" still lines up.
  const openRacks: InvLocationRow[] = useMemo(() => {
    if (!openSize || !detail) return [];
    const t = normSize(openSize);
    return detail.locations.filter((l) => normSize(l.eu) === t);
  }, [openSize, detail]);

  // The full customer-facing label for the open size ("38 EU / 5 UK"), pulled from the detail once loaded; falls back to the chip key
  // so the header still reads sensibly while the fetch is in flight.
  const openLabel = useMemo(() => {
    if (!openSize) return '';
    const t = normSize(openSize);
    return detail?.sizes.find((x) => normSize(x.eu) === t)?.sizeDisplay || openSize;
  }, [openSize, detail]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-4 p-3">
        {/* ---- Image: furniture, always drawn. next/image is lazy by default, so a stack of cards only fetches the pictures actually
                on screen. Square, big enough to tell two black Arizonas apart. ---- */}
        <div className="relative aspect-square w-28 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white sm:w-32">
          {src && !imgFailed ? (
            <Image key={reloadKey} src={src} alt="" fill sizes="128px" onError={onImgError} className="object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
              {row.imagename ? 'Image not found' : 'No image'}
            </div>
          )}
        </div>

        {/* ---- Face content ---- */}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800" title={row.title || row.groupid}>
                {row.title || <span className="text-slate-400">Untitled product</span>}
              </div>
              <div className="font-mono text-xs text-slate-500">{row.groupid}</div>
            </div>
            <div className="shrink-0 text-right">
              {row.price !== null && (
                <div className="flex items-baseline justify-end gap-1.5">
                  {row.rrp !== null && row.rrp > row.price && (
                    <span className="text-xs text-slate-400 line-through">£{row.rrp.toFixed(2)}</span>
                  )}
                  <span className="text-base font-semibold tabular-nums text-slate-900">£{row.price.toFixed(2)}</span>
                </div>
              )}
              {/* On the shelf, not Total: the card answers "have we physically got it". Total (which folds in Amazon + the Birk book)
                  belongs in the breakdown, a later slice. */}
              <div className="text-xs text-slate-400">
                <span className={row.local ? 'font-medium text-slate-600' : ''}>{row.local}</span> on the shelf
              </div>
            </div>
          </div>

          {/* Size-filter lead — the answer to "have you got my size" for THIS card, free from memory, no fetch. */}
          {sizeFilter && (
            <div className="mt-2 text-sm">
              {matchedKey ? (
                <span className="text-slate-600">
                  Size <span className="font-semibold text-slate-900">{sizeFilter}</span> —{' '}
                  <span className="font-semibold text-slate-900">{sizeOverride[matchedKey] ?? row.localSizes[matchedKey]}</span> on the shelf
                </span>
              ) : (
                <span className="text-slate-400">No size {sizeFilter} on the shelf</span>
              )}
            </div>
          )}

          {/* Size chips — EVERY size, sold-out ones greyed IN PLACE so a missing middle size can't read as a different one. In-stock
              sizes are tappable to see where they are; the count shows only when there is more than one (a lone "1" is noise). A
              sold-out size is a plain muted chip — nothing to locate, so it is not a button. */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sizes.length === 0 && <span className="text-xs text-slate-400">No sizes set up</span>}
            {sizes.map(([key, baseQty]) => {
              // Prefer a just-edited count over the list snapshot, so a +/- shows on the chip without a page reload.
              const qty = sizeOverride[key] ?? baseQty;
              if (qty <= 0) {
                return (
                  <span
                    key={key}
                    title={`No size ${key} on the shelf`}
                    className="inline-flex items-baseline rounded-md border border-slate-100 bg-slate-50 px-2 py-1 text-sm text-slate-300"
                  >
                    <span className="tabular-nums">{key}</span>
                  </span>
                );
              }
              const isOpen = openSize === key;
              const isMatch = matchedKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onTapSize(key)}
                  title={`Where is size ${key}?`}
                  className={
                    'inline-flex items-baseline gap-1 rounded-md border px-2 py-1 text-sm transition ' +
                    (isOpen
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : isMatch
                        ? 'border-brand-300 bg-white text-slate-800 ring-1 ring-brand-200'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                  }
                >
                  <span className="font-semibold tabular-nums">{key}</span>
                  {qty >= 2 && <span className="text-xs text-slate-400">{qty}</span>}
                </button>
              );
            })}
          </div>

          {/* Breakdown toggle — the deep view is behind a click so the face stays light (owner: minimal until clicked). */}
          <button
            type="button"
            onClick={onToggleBreakdown}
            className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
          >
            <ChevronRightIcon className={`h-3.5 w-3.5 transition-transform ${showBreakdown ? 'rotate-90' : ''}`} />
            Breakdown
          </button>
        </div>
      </div>

      {/* ---- Where the open size is. Only rendered once a chip is tapped, so the fetch is genuinely on demand. ---- */}
      {openSize && (
        detailLoading ? (
          <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-slate-400">Loading locations…</div>
        ) : detailError ? (
          <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-red-600">{detailError}</div>
        ) : (
          <>
            {adjustError && (
              <div className="border-t border-slate-200 bg-rose-50 px-4 py-2 text-center text-xs text-rose-700">{adjustError}</div>
            )}
            <InvLocations rows={openRacks} sizeLabel={openLabel} onAdjust={handleAdjust} />
          </>
        )
      )}

      {/* ---- The deep breakdown, below the racks. Shares the same fetched detail. ---- */}
      {showBreakdown && (
        detailLoading ? (
          <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-slate-400">Loading breakdown…</div>
        ) : detailError ? (
          <div className="border-t border-slate-200 px-4 py-3 text-center text-sm text-red-600">{detailError}</div>
        ) : detail ? (
          <InvBreakdown data={detail} />
        ) : null
      )}
    </div>
  );
}
