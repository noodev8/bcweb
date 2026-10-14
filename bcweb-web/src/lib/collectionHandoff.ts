/*
=======================================================================================================================================
Module: lib/collectionHandoff
=======================================================================================================================================
Purpose: Collections → Google Ads WITH THE LIST INTACT (owner, 2026-10-14: "I want to navigate from here to Google Ads with the list
         intact"). The Collections screen writes the exact groupids on screen — after every step, chip and cut — and opens
         /google-ads?list=1; Google Ads reads them back as a base chip ("Collections · 37"), the same way it treats ?sitting=1.

         THE IDS, NOT THE SEARCH. Google Ads searches different fields, so re-running the steps there could give a different list, and
         a cut can't be re-run at all. So the hand-off is the list itself.

         sessionStorage, not the URL: a few hundred groupids don't belong in an address bar. It is this tab's own, and it is NOT
         consumed on read — a refresh of Google Ads (still on ?list=1) must find it again; the chip's ✕ drops ?list= so it is no longer
         looked at, and the next hand-off overwrites it. Every access is wrapped: storage can be blocked, and then Google Ads simply
         opens on its full list.
=======================================================================================================================================
*/

const KEY = 'bc_collections_handoff';

export function writeCollectionHandoff(ids: string[]): void {
  try { window.sessionStorage.setItem(KEY, JSON.stringify({ ids })); } catch { /* storage blocked: Google Ads opens unfiltered */ }
}

export function readCollectionHandoff(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { ids?: unknown };
    return Array.isArray(v.ids) ? v.ids.filter((x): x is string => typeof x === 'string') : null;
  } catch {
    return null;
  }
}
