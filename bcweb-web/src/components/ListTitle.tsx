/*
=======================================================================================================================================
Component: ListTitle
=======================================================================================================================================
Purpose: THE TITLE of the style-row list screens that share one layout: New Additions, Range's two lists (No sale 91 days – 9 months
         / 9 months+) and Deep sellers. Owner, 2026-11-06: "I'm starting to get confused which one I'm looking at", so each gets a
         title AND colour, on all four: the screen's name large, its one-line rule under it, and the colour as ONE SOLID DOT before
         the name. A full solid band in the colour was tried the same day and dropped (owner: "Maybe the colour is too much. yuk"); a thin
         edge with a faint tint was already rejected on Range's cards ("looks unfinished").
         These screens are the exception to the 2026-09-24 "no title that only repeats the menu card" rule: the layout is the same on
         all four, so the name is the only way to tell them apart.

THE COLOURS = Range's cards (app/analytics/slow-sizes/page.tsx → PART_TONE; keep the two in step), so a list wears the colour of
         the card that opened it: grey = not sold yet (New Additions), orange = no sale 91 days – 9 months, red = 9 months+.
         Deep sellers has no Range card (it branches off the green one, which stays as it is) and takes its own violet. NOT green: it
         is a problem list. NOT blue: Range's size run uses blue for MORE selling.
=======================================================================================================================================
*/

export type ListTone = 'new' | 'mid' | 'cl' | 'deep';

const TONE: Record<ListTone, string> = {
  new: 'bg-slate-500',     // Range: Not sold yet · first 90 days
  mid: 'bg-orange-500',    // Range: No sale 91 days – 9 months
  cl: 'bg-red-600',        // Range: No sale 9 months+
  deep: 'bg-violet-600',   // Deep sellers (its own)
};

export default function ListTitle({ tone, title, rule }: { tone: ListTone; title: string; rule: string }) {
  return (
    <div className="mb-4">
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight text-slate-900">
        <span aria-hidden className={`inline-block h-3.5 w-3.5 shrink-0 rounded-full ${TONE[tone]}`} />
        {title}
      </h1>
      <p className="mt-1 pl-6 text-sm text-slate-500">{rule}</p>
    </div>
  );
}
