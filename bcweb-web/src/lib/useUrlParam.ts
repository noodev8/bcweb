'use client';
/*
=======================================================================================================================================
Hook: useUrlParam
=======================================================================================================================================
Purpose: Read one query-string parameter from window.location, without useSearchParams and without setState in an effect.

WHY NOT useSearchParams: it opts the page out of static rendering (or forces a Suspense boundary), and AppShell wraps every page.
WHY NOT useEffect + setState: that is what AppShell and the dashboard used to do, and the react-hooks/set-state-in-effect lint rule
rejects it (an extra render for every read).

useSyncExternalStore does the same job cleanly: the server snapshot is null, so hydration matches the server HTML, and the client
snapshot is read straight from window.location on every render. There is nothing to subscribe to — a client-side navigation
re-renders the page anyway (usePathname changes), and that re-render re-reads the snapshot.
=======================================================================================================================================
*/

import { useSyncExternalStore } from 'react';

const noSubscribe = () => () => {};

export function useUrlParam(name: string): string | null {
  return useSyncExternalStore(
    noSubscribe,
    () => new URLSearchParams(window.location.search).get(name),
    () => null,
  );
}
