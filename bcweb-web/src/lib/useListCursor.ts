'use client';
/*
=======================================================================================================================================
Hook: useListCursor
=======================================================================================================================================
Purpose: Up/down keyboard movement through a list, with a HIGHLIGHT THAT STAYS PUT — the legacy PowerBuilder behaviour the operators
         still work by. The job it solves is not navigation, it is "where was I": you walk off to the racks, come back to the screen,
         and the row you were on is still lit.

SHARED ON PURPOSE. Inventory is the first screen to use it, but Order Status / pricing lists want the same gesture, and a per-screen
copy would drift. The hook therefore owns ONLY what every list shares — which key is current, moving it, scrolling it into view — and
knows nothing about rows, cards or what Enter means. Each screen supplies its own keys and its own onEnter.

WHAT THE CALLER OWNS:
  - `keys`     the CURRENT visible order (filtered, sorted). Need not be memoised — it is read through a ref, never a dependency.
  - `enabled`  false while the list isn't painted (Inventory: above the card gate), so keys don't move an invisible cursor.
  - `onEnter`  what Enter does to the current row. Omit it and Enter is left alone.
  - the LOOK of the highlight, and a `scroll-mt-*` on each item big enough to clear any sticky header — otherwise `scrollIntoView`
    parks the current row underneath it. The hook cannot know that height; the screen can.

KEYS ARE IDENTITIES, NOT INDEXES. The cursor tracks a key (a groupid, an order id), so filtering, sorting or cutting leaves it on the
same ROW rather than sliding it to whatever now sits at position 7. If the current key disappears from the list entirely, the cursor
falls back to the nearest surviving position.

THE ENDS ARE NOT WALLS. At the first/last row the cursor clamps, and the keystroke is handed back to the browser to scroll the page as
usual — so arrowing past the bottom of the list carries on down the screen instead of stopping dead. The cursor stays put while you do.

TYPING ALWAYS WINS, but only as far as it has to. A focused FIELD swallows every key (arrows move its caret, Enter submits it). A
focused BUTTON or LINK swallows only Enter — arrows still move the cursor, because focus lands on a button the moment the operator
clicks anything on a row, and eating arrows there would silently kill the keyboard until they clicked bare page.
=======================================================================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

// Focus in a FIELD means every keystroke belongs to it — arrows move the caret, Enter submits. The list keeps out entirely.
const FIELD_TAGS = /^(INPUT|TEXTAREA|SELECT)$/;
// A focused BUTTON or LINK is different, and the distinction matters: only ENTER belongs to it (pressing it would otherwise both
// activate the control and fire the list's Enter). Arrows must still move the cursor — focus lands on a button every time the
// operator clicks a size chip or Detail, and swallowing arrows there would silently kill the keyboard until they clicked elsewhere.
const ACTIVATABLE_TAGS = /^(BUTTON|A)$/;

export interface ListCursor {
  /** The key of the current row, or null when the cursor hasn't been placed yet. */
  cursorKey: string | null;
  /** Convenience for the render: is THIS key the current one? */
  isCursor: (key: string) => boolean;
  /** Place the cursor by hand — wire it to a row's onClick so mouse and keyboard never disagree about where you are. */
  setCursor: (key: string | null) => void;
  /** ref callback for a row's element, so the hook can scroll it into view. Stable per key (no detach/reattach each render). */
  itemRef: (key: string) => (el: HTMLElement | null) => void;
}

// Anything that has taken the keyboard over while it is open — a pop-over menu, a lightbox — marks itself with this. Two effects:
// a focused element inside one keeps the list out entirely (the `closest` test below), and while ANY of them is mounted the list
// leaves Escape alone, because Escape belongs to the thing on top. Without that, one Escape closes the overlay AND wipes the cursor,
// costing the operator the very place the cursor exists to hold.
const OWNS_KEYBOARD = '[data-list-cursor="off"]';

export function useListCursor(opts: {
  keys: string[];
  enabled?: boolean;
  onEnter?: (key: string) => void;
  /**
   * Fired whenever a KEYPRESS moves the cursor (not when a click places it — the click's own handler already knows). For dismissing
   * anything anchored to the row you are leaving: a pop-over pinned at the old click point would otherwise sit there while the list
   * scrolls under it, pointing at one style and floating over another.
   */
  onMove?: () => void;
  /**
   * How the current row is scrolled into view — the feel of the whole gesture, so it is a per-screen choice:
   *   'nearest' (default) the page only moves when the cursor would otherwise leave the viewport. Conventional, minimal movement,
   *              but arrowing through mid-screen rows moves the highlight and nothing else — some operators read that as "stuck".
   *   'center'   the list moves under a highlight that stays put mid-screen. Closer to the legacy PowerBuilder grid, and the next
   *              rows are always in view; costs a small scroll on nearly every keypress.
   */
  scrollBlock?: ScrollLogicalPosition;
}): ListCursor {
  const { keys, enabled = true, onEnter, onMove, scrollBlock = 'nearest' } = opts;

  const [cursorKey, setCursorKey] = useState<string | null>(null);

  // Everything the key handler reads lives in a ref, so the window listener binds ONCE and never goes stale. Re-binding on every
  // render (keys change on every keystroke in the filter box) would be a lot of add/removeEventListener churn for no gain.
  const keysRef = useRef(keys);
  const enabledRef = useRef(enabled);
  const onEnterRef = useRef(onEnter);
  const onMoveRef = useRef(onMove);
  const scrollBlockRef = useRef(scrollBlock);
  const cursorRef = useRef<string | null>(null);
  // Where the cursor sat last, so a row vanishing under a filter can fall back to the nearest position instead of jumping to the top.
  const lastIndexRef = useRef(0);
  // Set only by a keyboard move: a click already scrolled the row into view by definition, and scrolling under the click is jarring.
  const scrollPendingRef = useRef(false);
  // The rows' DOM elements, by key, so the cursor can scroll the current one into view.
  const elsRef = useRef(new Map<string, HTMLElement>());

  // No dependency array — this runs after EVERY render, which is exactly what "the refs hold the latest values" means.
  useEffect(() => {
    keysRef.current = keys;
    enabledRef.current = enabled;
    onEnterRef.current = onEnter;
    onMoveRef.current = onMove;
    scrollBlockRef.current = scrollBlock;
    cursorRef.current = cursorKey;
  });

  // The current row has dropped out of the list (filtered, sorted away, cut): re-seat the cursor at the nearest surviving position
  // rather than leaving it pointing at a row that is no longer on screen.
  useEffect(() => {
    if (cursorKey === null) return;
    if (keys.includes(cursorKey)) {
      lastIndexRef.current = keys.indexOf(cursorKey);
      return;
    }
    setCursorKey(keys.length === 0 ? null : keys[Math.min(lastIndexRef.current, keys.length - 1)]);
  }, [keys, cursorKey]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      // Leave shortcuts (Ctrl+Home, browser chords) to the browser.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || FIELD_TAGS.test(t.tagName))) return;
      if (t && e.key === 'Enter' && ACTIVATABLE_TAGS.test(t.tagName)) return;
      // Escape hatch for anything that takes over the keyboard while it is open — a modal, a lightbox. Without it, that thing's own
      // Escape-to-close ALSO clears the cursor, losing the operator the place the cursor exists to keep. Put the attribute on the
      // overlay and give it focus (see the zoom overlay in InvStyleCard).
      if (t?.closest(OWNS_KEYBOARD)) return;

      const list = keysRef.current;
      if (list.length === 0) return;

      const cur = cursorRef.current;
      const i = cur ? list.indexOf(cur) : -1;
      let next: string | undefined;

      switch (e.key) {
        // With no cursor yet, Down starts at the top and Up starts at the bottom — whichever way you reached for, you get the end
        // of the list you were reaching towards.
        case 'ArrowDown': next = i < 0 ? list[0] : list[Math.min(i + 1, list.length - 1)]; break;
        case 'ArrowUp': next = i < 0 ? list[list.length - 1] : list[Math.max(i - 1, 0)]; break;
        case 'Home': next = list[0]; break;
        case 'End': next = list[list.length - 1]; break;
        case 'Enter':
          if (cur && onEnterRef.current) {
            e.preventDefault();
            onEnterRef.current(cur);
          }
          return;
        case 'Escape':
          // Escape belongs to whatever is on top. If an overlay is mounted at all — focused or not, since a click-away backdrop takes
          // no focus — it gets this press to close itself, and the cursor stays where it is. A second Escape then clears the cursor.
          if (document.querySelector(OWNS_KEYBOARD)) return;
          if (cur) {
            e.preventDefault();
            setCursorKey(null);
          }
          return;
        default:
          return;
      }

      if (next === undefined) return;

      // AT THE ENDS, THE KEY GOES BACK TO THE BROWSER. The cursor clamps at the first/last row — so once it is there, pressing on in
      // the same direction would eat the keystroke and leave the screen dead still, which reads as a hang. Instead we return without
      // preventDefault and let the arrow do its ordinary thing: scroll the page on past the list (to the hero above it, or whatever
      // sits below). The cursor stays exactly where it was, so no place is lost by scrolling off it (owner, 2026-07-28).
      if (next === cur) return;

      // Otherwise the arrow belongs to us: it moves the cursor, and the cursor does the scrolling (below).
      e.preventDefault();

      // MOVING THE CURSOR TAKES THE KEYBOARD. A mouse click leaves focus sitting on whatever was clicked, and Enter on a focused
      // button belongs to that button (we skip it above, deliberately) — so without this, arrowing away from a card and pressing
      // Enter re-fired the chip clicked minutes ago and jumped back to it (owner, 2026-07-27). Dropping focus once the operator
      // starts arrowing means the next Enter is unambiguously the list's.
      const active = document.activeElement as HTMLElement | null;
      if (active && active !== document.body) active.blur();

      // Leaving the old row: anything anchored to it (the reprice pop-over, pinned at the click point) is now stale and must go.
      onMoveRef.current?.();

      scrollPendingRef.current = true;
      lastIndexRef.current = list.indexOf(next);
      setCursorKey(next);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Instant, never 'smooth': on a held-down arrow key a smooth scroll queues up behind itself and the list slides on after your finger
  // has stopped.
  useEffect(() => {
    if (!scrollPendingRef.current || cursorKey === null) return;
    scrollPendingRef.current = false;
    elsRef.current.get(cursorKey)?.scrollIntoView({ block: scrollBlockRef.current });
  }, [cursorKey]);

  // One cached callback per key: returning a fresh arrow each render would make React detach and reattach every row's ref every time.
  const refCbsRef = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const itemRef = useCallback((key: string) => {
    let cb = refCbsRef.current.get(key);
    if (!cb) {
      cb = (el: HTMLElement | null) => {
        if (el) elsRef.current.set(key, el);
        else elsRef.current.delete(key);
      };
      refCbsRef.current.set(key, cb);
    }
    return cb;
  }, []);

  const isCursor = useCallback((key: string) => key === cursorKey, [cursorKey]);
  const setCursor = useCallback((key: string | null) => setCursorKey(key), []);

  return { cursorKey, isCursor, setCursor, itemRef };
}
