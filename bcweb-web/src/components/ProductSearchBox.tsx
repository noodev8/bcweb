'use client';
/*
=======================================================================================================================================
Component: ProductSearchBox
=======================================================================================================================================
Purpose: The dashboard's opening search box, because looking a product up is the single most common way a working day starts (owner,
         2026-08-27).

         Before this, searching cost two moves — find the Inventory tile, land on the page, THEN type. The box removes the middle
         step: whatever is typed here is handed to /inventory as ?q=, and Inventory opens already narrowed to it (see that page's
         `seed` note). It is deliberately the SAME entry point as Inventory's own Contains box, not a second search with its own
         rules — the term is parsed there by the one parser, so a pasted SKU (0151183-ARIZONA-38) splits its size off here exactly
         as it would if typed on the page itself.

         DASHBOARD ONLY (owner, 2026-08-27). A compact copy rode in the AppShell header for a while, so a hunt could start from any
         screen. It came out: the owner returns to the dashboard to search anyway, so the trip isn't a detour, and a search box on
         every screen was one more thing to look past on all of them. If it ever goes back in the header, it wants a compact variant
         here rather than a second component.

         IT HAS TO CARRY ITS OWN WEIGHT (owner, 2026-08-27 — "it has to be looked for"). It didn't at first: a white box with a grey
         icon and a grey placeholder, sitting above four ringed panels of white tiles with coloured icons. It was the most-used
         control on the page and the only element with no colour, no edge and no frame, so the eye slid off it onto the tiles.
         Three changes, in order of how much work each does:
           - THE BOX carries the emphasis, not the button (owner, 2026-08-27). A heavier 2px border is what makes the control hold
             its own line against a page of ringed panels — the box is the thing being looked for, so the box is the thing that
             should be findable.
           - The Search button is WHITE with the same 2px slate-300 border as the input (owner, 2026-08-27), so the pair reads as one
             control rather than a box with something bolted on the end. It is the tile treatment — white on a slate page, with a
             real edge — which is what everything clickable on this screen looks like, so it reads as a button without having to
             shout. It replaced a slate-200 fill that was quiet enough to look DISABLED: on a page where grey panels are the inert
             background and white is what you click, a grey button had the affordance exactly backwards.
             FIVE FILLS WERE TRIED BEFORE THIS ONE (owner, 2026-08-27), so don't re-tint it without reading this.
               `brand` indigo   — read as a stock framework default.
               a leather tan    — read WORSE, actively bad, for the reason the owner named: it was the only warm thing on an
                                  otherwise cold page, and a colour used exactly once reads as a mistake rather than an accent. An
                                  accent needs a system behind it and there isn't one here.
               slate-900        — belonged to the palette, but a near-black slab on a page of slate-100/200 was too heavy; the button
                                  ended up shouting louder than the search it belongs to.
               slate-500        — same fault, quieter: still a dark block pulling attention past the input.
               slate-200        — panel-coloured, and it went too far the other way: it read as disabled (see above).
             The pattern in those five is worth keeping: every attempt to make the search findable BY THE BUTTON overshot, and the one
             that finally stopped overshooting undershot into looking dead. Emphasis belongs on the input; the button just needs to
             look like the other clickable things on the page.
           - A brand-coloured magnifier instead of the slate one, so the left end reads as part of the same control.
           - A heavier resting border (slate-300) and a wider box, so it holds its own line rather than melting into the background.
         Deliberately NOT given a band heading: it isn't a group of things, and a label above it would just be a word to read past.

         Input is force-uppercased to match Inventory's Contains box, so the term reads the same in both places and a round-trip
         (search here -> refine there) never changes case mid-hunt.
=======================================================================================================================================
*/

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';

export default function ProductSearchBox() {
  const router = useRouter();
  const [term, setTerm] = useState('');

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    // Push (not replace): Back from Inventory returns to the dashboard the search was run from.
    router.push('/inventory?q=' + encodeURIComponent(q));
  }

  return (
    <form onSubmit={onSubmit} className="flex items-stretch gap-2">
      <div className="relative flex-1">
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-brand-600" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value.toUpperCase())}
          placeholder="Search a product — title, groupid or SKU…"
          aria-label="Search a product"
          className={
            'w-full rounded-lg border-2 border-slate-300 bg-white py-3.5 pl-12 pr-4 text-base text-slate-900 shadow-sm ' +
            'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
          }
        />
      </div>
      <button
        type="submit"
        className={
          'inline-flex shrink-0 items-center gap-2 rounded-lg border-2 border-slate-300 bg-white px-6 text-base font-medium ' +
          'text-slate-700 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus:outline-none ' +
          'focus:ring-2 focus:ring-brand-500/30'
        }
      >
        <MagnifyingGlassIcon className="h-5 w-5 text-brand-600" />
        Search
      </button>
    </form>
  );
}
