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
and the size chips with their LOCAL counts (row.localSizes). The heavy per-style detail (/inv-stock: every rack, the buckets) is fetched
ONLY once something is OPEN on this card — a size's racks or the Detail panel — and cached thereafter. The fetch is DERIVED from that
open state (a null SWR key while nothing is open), not fired from the click handlers, so any new way of opening the card gets the data
without remembering to ask for it. Nothing fires a request on render, so a screen full of cards costs zero extra round-trips until
someone actually asks a question of one.

Detail's open/closed flag is the LIST's state, passed in — see the props and the keyboard cursor on /inventory.

SIZE CHIP = the 2-digit code suffix (owner) — "38", "06" — which is the canonical EU size in this DB (RIGHT(code,2)). localSizes is
keyed by that suffix, so the chip prints the key verbatim. EVERY size shows a chip — sold-out ones (qty 0) greyed IN PLACE, so a
missing middle size can't slide a bigger size into the gap and read as a different size (owner, 2026-07-23). localSizes now carries the
full range (0 for sold-out), so the face still needs no fetch. The count rides on a chip only when qty > 1 — a lone "1" is just noise.
A sold-out chip is still tappable (phase 2): opening it shows the racks panel's "add to a location" control, so stock can be put on it.

SIZE-FILTER LEAD. When the operator has a size filter on ("the customer's a 41"), the whole result set is already narrowed to styles
that HOLD a 41, so each card LEADS with that size's count — pulled free from localSizes, no fetch — and the matching chip is ringed.
That answers "who has my size, and how many" for every candidate at a glance while you scroll and confirm by picture. The racks are
still one tap away; we do not auto-fetch 40 styles' worth of detail just because a size filter is on (owner's over-fetch concern).
=======================================================================================================================================
*/

import Image from 'next/image';
import { useCallback, useMemo, useState } from 'react';
import { ChevronRightIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getInvStock, adjustStock, InvStyleRow, InvStockData, InvLocationRow } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useApiQuery } from '@/lib/useApiQuery';
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

export default function InvStyleCard({
  row,
  sizeFilter,
  detailOpen,
  onToggleDetail,
}: {
  row: InvStyleRow;
  sizeFilter: string | null;
  // Detail's open/closed state is OWNED BY THE LIST, not the card, so the keyboard cursor's Enter can open the current card (see
  // useListCursor on /inventory). Each card still opens and closes independently — the list keeps a set of open groupids, so one
  // card's Detail never collapses another's (owner, 2026-07-23).
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
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

  // Click-to-enlarge. The face image is deliberately small enough to scroll a lot of list; this is the pressure valve for the times
  // two colourways really do need looking at properly.
  const [zoom, setZoom] = useState(false);

  // Which size's racks are open, as a localSizes key ("38"/"06"); null = none. Set ONLY by a tap, so opening a card's racks is always
  // a deliberate act.
  const [openSize, setOpenSize] = useState<string | null>(null);

  // Lazy detail — the racks and buckets. A NULL KEY means "don't fetch yet", so OPENING SOMETHING IS THE TRIGGER: tap a size, or open
  // Detail, and the fetch follows on its own. Nothing on render, so a screen full of cards still costs zero round-trips.
  //
  // It is deliberately DERIVED from what is open rather than fired imperatively from the tap handler. The imperative version had a
  // hole: Enter on the keyboard cursor sets `detailOpen` from the LIST, which never ran the card's fetch call — so the chevron
  // flipped open onto an empty panel, and only worked if a size tap had already loaded the data (owner, 2026-07-27). Derived, there
  // is no call for a new way of opening the card to forget. Same pattern as InvSales.
  const needDetail = openSize !== null || detailOpen;
  const {
    data: detailData,
    error: detailLoadError,
    busy: detailLoading,
    refresh: reloadDetail,
  } = useApiQuery(needDetail ? ['inv-stock', row.groupid] : null, () => getInvStock(row.groupid));
  const detail: InvStockData | null = detailData ?? null;
  const detailError = detailLoadError?.message ?? null;

  const sizes = useMemo(() => sortedSizes(row.localSizes), [row.localSizes]);

  // The size-filter lead: the chip key that matches the active filter, and its local count — both free from memory. `matchedKey` also
  // rings the chip so the eye lands on it as you scroll.
  const matchedKey = useMemo(() => {
    if (!sizeFilter) return null;
    const t = normSize(sizeFilter);
    return Object.keys(row.localSizes).find((k) => normSize(k) === t) || null;
  }, [sizeFilter, row.localSizes]);

  // Tap a size chip: toggle its racks open/closed. The fetch follows from `openSize` (see above) — nothing to trigger by hand.
  const onTapSize = useCallback((key: string) => {
    setOpenSize((prev) => (prev === key ? null : key));
  }, []);

  // ---- Phase 2: +/- stock adjustments (writes) ----
  // A per-size override of the chip count, applied right after a successful +/- so the face reflects the new total immediately (the
  // base counts come from the /inv-styles snapshot, which doesn't know about this edit). Keyed by the chip/size key.
  const [sizeOverride, setSizeOverride] = useState<Record<string, number>>({});
  const [adjustError, setAdjustError] = useState<string | null>(null);

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

  // The deep breakdown (full size range incl. sold-out zeros, the buckets, reprice/product links, recent sales). Open/closed is the
  // LIST's state (see the props) so Enter on the keyboard cursor can drive it; the fetch stays here. It reads the same /inv-stock the
  // racks use, so opening it after a size tap costs nothing more.
  const showBreakdown = detailOpen;

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

  // The open size's code, for the "add to a location" control — which must work even when the size has no rack rows yet.
  const openCode = useMemo(() => {
    if (!openSize) return '';
    const t = normSize(openSize);
    return detail?.sizes.find((x) => normSize(x.eu) === t)?.code || '';
  }, [openSize, detail]);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex gap-3 p-3">
        {/* ---- Image: furniture, always drawn. next/image is lazy by default, so a stack of cards only fetches the pictures actually
                on screen. Square, and it SETS THE CARD'S HEIGHT — the face's text is shorter than the picture, so the picture is the
                only real lever on how many cards fit on a screen. Trimmed from w-28/32 to w-24/28 (owner, 2026-07-27) to scroll more
                of the list at once: still big enough to tell two black Arizonas apart at a glance, and CLICK TO ENLARGE covers the
                times it isn't. Any smaller and the browse stops working as a browse. ---- */}
        <button
          type="button"
          onClick={() => src && setZoom(true)}
          title={src ? 'Click to enlarge' : undefined}
          className={
            'relative aspect-square w-24 shrink-0 overflow-hidden rounded-md border border-slate-200 bg-white sm:w-28 '
            + (src ? 'cursor-zoom-in hover:border-slate-300' : 'cursor-default')
          }
        >
          {src && !imgFailed ? (
            <Image key={reloadKey} src={src} alt="" fill sizes="112px" onError={onImgError} className="object-contain" />
          ) : (
            <div className="flex h-full w-full items-center justify-center px-2 text-center text-[11px] text-slate-400">
              {row.imagename ? 'Image not found' : 'No image'}
            </div>
          )}
        </button>

        {/* ---- Face content ---- */}
        <div className="min-w-0 flex-1">
          {/* pr-7 reserves the top-right corner for the list's cut cross (page.tsx overlays one there) so the price never sits under it. */}
          <div className="flex items-start justify-between gap-3 pr-7">
            <div className="min-w-0">
              <div className="truncate font-medium text-slate-800" title={row.title || row.groupid}>
                {row.title || <span className="text-slate-400">Untitled product</span>}
              </div>
              {/* The groupid line doubles as the Detail toggle's home. Detail used to own a whole row below the size chips for one
                  word; the code line is short and the space beside it was dead, so the card loses a row for nothing (owner,
                  2026-07-27). Kept off the chips row on purpose — a control that wraps in among the sizes reads as another size. */}
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-500">{row.groupid}</span>
                <span className="text-slate-200">|</span>
                <button
                  type="button"
                  // blur(): a mouse click leaves focus sitting on this button, and the operator's next keystroke is almost always an
                  // arrow meant for the list cursor — after opening and closing Detail with the mouse, up/down were scrolling the page
                  // instead of moving to the next card (owner, 2026-07-27). Handing focus back to the page removes the question.
                  onClick={(e) => { onToggleDetail(); e.currentTarget.blur(); }}
                  className="inline-flex items-center gap-0.5 text-xs font-medium text-slate-500 hover:text-slate-700"
                >
                  <ChevronRightIcon className={`h-3 w-3 transition-transform ${showBreakdown ? 'rotate-90' : ''}`} />
                  Detail
                </button>
              </div>
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
              {/* Stock + sales indicators — the two numbers a drop call weighs against each other, tucked under the price so they cost no
                  vertical row of their own. Stock = local + Amazon (hover splits it); Sales = units sold in the last 30 days, all channels. */}
              <div className="mt-1 flex flex-wrap justify-end gap-1">
                <span
                  title={`${row.local} local + ${row.amazon} at Amazon`}
                  className="inline-flex items-baseline gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  <span className="font-semibold tabular-nums text-slate-800">{row.local + row.amazon}</span> in stock
                </span>
                <span
                  title="Units sold in the last 30 days (all channels)"
                  className="inline-flex items-baseline gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600"
                >
                  <span className="font-semibold tabular-nums text-slate-800">{row.sold30}</span> sold 30d
                </span>
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
              const isOpen = openSize === key;
              const isMatch = matchedKey === key;
              const soldOut = qty <= 0;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onTapSize(key)}
                  // Sold-out sizes stay greyed IN PLACE (so a gap can't read as a different size) but are now TAPPABLE too — opening one
                  // shows an empty racks panel with the "add to a location" control, so stock can be put on a size that has none.
                  title={soldOut ? `Size ${key} — none on the shelf (tap to add)` : `Where is size ${key}?`}
                  className={
                    'inline-flex items-baseline gap-1 rounded-md border px-2 py-1 text-sm transition ' +
                    (isOpen
                      ? 'border-brand-500 bg-brand-50 text-brand-800'
                      : soldOut
                        ? 'border-slate-100 bg-slate-50 text-slate-300 hover:bg-slate-100 hover:text-slate-500'
                        : isMatch
                          ? 'border-brand-300 bg-white text-slate-800 ring-1 ring-brand-200'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                  }
                >
                  <span className={soldOut ? 'tabular-nums' : 'font-semibold tabular-nums'}>{key}</span>
                  {qty >= 2 && <span className="text-xs text-slate-400">{qty}</span>}
                </button>
              );
            })}
          </div>

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
            <InvLocations rows={openRacks} sizeLabel={openLabel} code={openCode} onAdjust={handleAdjust} />
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

      {/* ---- Enlarged image. Click anywhere or press Escape to close.
              data-list-cursor="off" tells the list's keyboard cursor to keep its hands off while this is open — otherwise Escape
              would close the zoom AND clear the operator's place in the list, which is the exact thing the cursor exists to protect.
              It takes focus on mount so the keystroke actually originates inside the overlay. ---- */}
      {zoom && src && (
        <div
          data-list-cursor="off"
          tabIndex={-1}
          ref={(el) => { el?.focus(); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setZoom(false); }}
          onClick={() => setZoom(false)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-slate-900/70 p-6 outline-none"
        >
          {/* A visible way out. Click-anywhere and Escape both already close this, but neither is VISIBLE — an operator who doesn't
              know that is stuck looking at a full-screen picture, so the X earns its place even as the third route (owner, 2026-07-27). */}
          <button
            type="button"
            onClick={() => setZoom(false)}
            title="Close (or press Escape)"
            className="absolute right-4 top-4 rounded-full bg-white/90 p-1.5 text-slate-600 shadow-lg transition hover:bg-white hover:text-slate-900"
          >
            <XMarkIcon className="h-5 w-5" />
          </button>

          {/* Intrinsic size is unknown (legacy image library), so give next/image a generous box and let object-contain letterbox it. */}
          <Image
            src={src}
            alt={row.title || row.groupid}
            width={1400}
            height={1400}
            className="h-auto max-h-[88vh] w-auto max-w-[92vw] rounded-lg bg-white object-contain shadow-2xl"
          />
        </div>
      )}
    </div>
  );
}
