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
    <form onSubmit={onSubmit} className="relative">
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
      <input
        value={term}
        onChange={(e) => setTerm(e.target.value.toUpperCase())}
        placeholder="Search a product — title, groupid or SKU…"
        aria-label="Search a product"
        className={
          'w-full rounded-lg border border-slate-200 bg-white py-3.5 pl-11 pr-4 text-base text-slate-900 shadow-sm ' +
          'placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20'
        }
      />
    </form>
  );
}
