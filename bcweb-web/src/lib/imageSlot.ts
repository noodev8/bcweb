/*
=======================================================================================================================================
Lib: imageSlot — a shared, app-wide cap on how many optimized images load at once
=======================================================================================================================================
Why this exists (owner, 2026-07-28): the /inventory browse paints a stack of picture cards, and every card face is a remote image
served through Next's image optimizer (/_next/image). Scroll the list quickly and a whole screen of lazy images mount and request in
the same instant. The optimizer has real concurrency limits, and a burst that overruns them comes back as ERRORS — the card lands on
"Image not found" for a file that is present and loads perfectly on its own a second later.

Retrying (see InvStyleCard) softens that; it does not stop it, because a retry fires straight back into the same jam. This is the
other half: a LANE. Only MAX_IN_FLIGHT images may be loading at any moment across the whole app; the rest queue and start as slots free
up. Nothing is dropped and nothing is deferred indefinitely — the same images load, just in an orderly line instead of a stampede.

Module-level state on purpose. The cap is a property of the browser tab's connection to the optimizer, not of any one list, so a queue
per component would defeat it the moment two lists shared a screen.

WHO SHOULD USE IT: components that mount MANY images at once (list/browse cards). A screen with one or two images should not bother —
it would just be queueing behind itself. Callers must release: on load, on error, and on unmount. A slot that is never released is a
lane closed for the rest of the session, so `useImageSlot` also releases on a timeout as a backstop.
=======================================================================================================================================
*/

import { useCallback, useEffect, useRef, useState } from 'react';

// How many images may be loading at once. Chosen to sit at the browser's own per-host connection limit for HTTP/1.1 (6) rather than
// above it: past that point the requests are queued by the browser anyway, but the optimizer has already been asked for all of them.
const MAX_IN_FLIGHT = 5;

// A slot held this long is assumed stuck (a request that will never settle) and is taken back, so one bad image cannot close a lane
// for the rest of the session. Generous — a slow optimizer cold-start on a big JPEG is legitimately a few seconds.
const SLOT_TIMEOUT_MS = 12000;

let inFlight = 0;
const waiting: Array<() => void> = [];

// Hand slots to whoever is next in line, up to the cap. Called after every acquire and every release.
function pump(): void {
  while (inFlight < MAX_IN_FLIGHT && waiting.length > 0) {
    const grant = waiting.shift();
    if (!grant) return;
    inFlight += 1;
    grant();
  }
}

/**
 * Ask for permission to load an image. `onGranted` fires when a slot is free (never synchronously — see below). Returns the release
 * function, which is safe to call more than once and must be called when the image settles or the caller goes away.
 *
 * The grant is always asynchronous even when a slot is free right now. That keeps the caller's shape simple — "granted" only ever
 * arrives as an event, never as a side effect of asking — which is what lets the React hook below subscribe to it cleanly.
 */
export function acquireImageSlot(onGranted: () => void): () => void {
  let state: 'waiting' | 'granted' | 'released' = 'waiting';

  const grant = () => {
    if (state !== 'waiting') return;
    state = 'granted';
    onGranted();
  };

  waiting.push(grant);
  queueMicrotask(pump);

  return () => {
    if (state === 'released') return;
    if (state === 'granted') {
      inFlight -= 1;
      state = 'released';
      queueMicrotask(pump);
      return;
    }
    // Still queued: leave the line without ever having taken a slot.
    const i = waiting.indexOf(grant);
    if (i >= 0) waiting.splice(i, 1);
    state = 'released';
  };
}

/**
 * React wrapper. Pass `want = true` once the image is actually wanted (in practice: the card is near the viewport — asking on mount
 * would put a card 150 rows down in the queue ahead of the one on screen). Render the <Image> only when `granted`, and call `done()`
 * from both onLoad and onError so the next image in the queue can start.
 */
export function useImageSlot(want: boolean): { granted: boolean; done: () => void } {
  const [granted, setGranted] = useState(false);
  const releaseRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!want) return;
    // setGranted is called from the queue's callback (a microtask), never synchronously in this effect body — this is a subscription
    // to an external system, not a cascading render.
    const release = acquireImageSlot(() => setGranted(true));
    releaseRef.current = release;
    const timer = window.setTimeout(release, SLOT_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timer);
      release();
    };
  }, [want]);

  // Settled: give the slot back. `granted` deliberately STAYS true — the slot governs the load, not whether the image is rendered.
  const done = useCallback(() => {
    releaseRef.current?.();
  }, []);

  return { granted, done };
}
