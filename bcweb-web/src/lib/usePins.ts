'use client';
/*
=======================================================================================================================================
Hook: usePins
=======================================================================================================================================
Purpose: The header bar's pinned screens — read, toggle, and stay in step across the components that show them.

WHY PINS AND NOT THE OLD FIXED FOUR (owner, 2026-09-22). The header bar and the dashboard were answering the same question with two
different, unrelated groupings of the same screens, and after the dashboard was rebuilt around five intents the bar's four were a
sixth scheme with no logic behind them at all. The fix is NOT to mirror the five here: the bar exists for the mid-task hop — something
half-done, another screen needed — and a hop has a known destination, so wrapping it in a mindset-pick and a dropdown would add a
click to the one interaction the bar exists to remove. Pins sidestep the clash instead of resolving it: a pin isn't a category, so it
can't disagree with the dashboard's categories. And unlike "recents", pins HOLD THEIR POSITION, which is what makes the bar something
the hand learns rather than something the eye has to re-read every time.

DEFAULTS ARE THE OLD FOUR, on purpose: with nothing pinned the bar behaves exactly as it did before this change, so the feature costs
nobody a setup step and the first pin is an improvement on a working bar rather than a repair of an empty one. Note the difference
between "never chosen" (no key in storage -> defaults) and "chosen nothing" (an empty array stored -> an empty bar). Unpinning the
last tab must leave it empty rather than springing the defaults back, or the bar would look broken and unfixable.

STORAGE IS localStorage, PER BROWSER (owner's call, 2026-09-22) — no server work, ships today, and pins are a per-machine convenience
in the way a browser bookmark is. The trade accepted with it: they do NOT follow the login to another machine, and clearing site data
resets them to the defaults. If that ever bites, this hook is the only place that knows where pins live — swap the two storage calls
for an API round-trip and nothing else moves. Every read and write is wrapped, because storage throws outright in some privacy modes
and a header that can't render is worse than a header with the default tabs.

SSR. This runs inside AppShell, which is on every page, so the first render MUST match the server's: it starts on DEFAULTS and reads
storage in an effect. That means one frame of default tabs before your own appear. Accepted — the alternative is not rendering the bar
until storage is read, which flashes an empty header on every single navigation instead.

CROSS-COMPONENT SYNC. The header and the pin button on the page are siblings, not parent and child, so a toggle in one has to reach
the other. A window event is what does it: both mount a listener, and a pin lights up the moment it is clicked rather than on the next
navigation. (The browser's own `storage` event is no help — it only fires in OTHER tabs, never the one that made the change.)
=======================================================================================================================================
*/

import { useCallback, useEffect, useState } from 'react';

const KEY = 'bc.pins';
const EVENT = 'bc:pins';

// The bar shares one row with the brand and the account controls, so five is about what fits before the tabs start scrolling
// sideways. It is a cap on ADDING, not on what can be displayed: a stored list that is somehow longer still renders in full rather
// than silently hiding a tab someone chose.
export const MAX_PINS = 5;

// The header's four before pins existed. See the note above on defaults vs. a deliberately empty bar.
export const DEFAULT_PINS = ['/inventory', '/segments', '/customer-orders', '/analytics'];

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return DEFAULT_PINS;          // never chosen -> the old four
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PINS;
    return parsed.filter((h): h is string => typeof h === 'string');
  } catch {
    return DEFAULT_PINS;
  }
}

export function usePins() {
  const [pins, setPins] = useState<string[]>(DEFAULT_PINS);

  useEffect(() => {
    const sync = () => setPins(read());
    sync();
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);

  const toggle = useCallback((href: string) => {
    const current = read();
    const next = current.includes(href)
      ? current.filter((h) => h !== href)
      // A new pin goes on the END, so pinning something never shuffles the tabs already there — the positions the hand has learned
      // are the point of pins over recents, and they'd be worth nothing if each new pin reordered the row.
      : current.length >= MAX_PINS ? current : [...current, href];
    try {
      localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage unavailable (private mode, blocked site data). Still update this session's state below — the pin works until the
      // tab closes, which is better than a button that visibly does nothing.
    }
    setPins(next);
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return { pins, toggle, full: pins.length >= MAX_PINS };
}
