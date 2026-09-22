'use client';
/*
=======================================================================================================================================
Component: ProductSearchBox
=======================================================================================================================================
Purpose: The dashboard's opening search box, because looking a product up is the single most common way a working day starts (owner,
         2026-08-27).

         Before this, searching cost two moves — find the Inventory tile, land on the page, THEN type. The box removes the middle
         step: whatever is typed here goes straight to a product list, already narrowed.

         IT LANDS ON /product, NOT /inventory (owner, 2026-09-22 — "we always start with PRODUCT"). It fed Inventory until then,
         and the swap is the one thing on this component worth understanding before changing it back.
           WHY IT MOVED. The box's job was never "open Inventory", it was "start from a product" — and Inventory answers only one of
           the questions that follow (have we got it, in my size, on which rack). The others — what is it priced at here and on
           Amazon, is it moving, does it need ordering, editing, a barcode — each meant going back to the dashboard and into another
           module, retyping the same groupid. /product answers the identifying question and then hands the style to whichever screen
           the answer turned out to need, with the groupid already filled in.
           WHAT IT COST, stated plainly because it is a real loss and not a rounding error: the dashboard has no Inventory card — this
           box WAS the Inventory tile, which is exactly why that card was deleted (see the /dashboard header) — so Inventory is now
           one click further away than it was. It is the first hand-off card on /product, and the header tab is untouched. If that
           proves to be the wrong trade, the fix is to put the Inventory CARD back on the dashboard, not to re-point this box: the box
           has stopped being a module shortcut and become the front door to a screen of its own.

         The term is still parsed at the far end, not here — /product hands it to the server, which matches it against groupid, the
         human title, the internal size code and the full Amazon Seller SKU. So a pasted SKU (0151183-ARIZONA-38) or a pasted Amazon
         SKU (17659-23-42-2607) finds its style without this box knowing anything about either shape.

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

         Input is force-uppercased to match the search boxes it hands off to (/product, Inventory's Contains box, both Find pages),
         so the term reads the same in every one and a round-trip (search here -> refine there) never changes case mid-hunt.
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
    // Push (not replace): Back from the product hub returns to the dashboard the search was run from.
    router.push('/product?q=' + encodeURIComponent(q));
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
