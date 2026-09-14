'use client';
/*
=======================================================================================================================================
Page: /birk-tracker  (Birk Tracker — the Birkenstock order book: requested, invoiced, arrived)
=======================================================================================================================================
Purpose: Where a Birkenstock order lives between being placed and being on the shelf. One row per ordered SKU, carrying the three
         numbers that describe its progress — requested / invoiced / arrived — plus the invoice number and date that moved it, and
         the month Birkenstock quoted for the rest. Port of the legacy PowerBuilder "Birk Tracker" screen, reading the same legacy
         `birktracker` table that screen still writes.

WHY IT IS ITS OWN MODULE rather than a view inside Order Status or Goods In. Those two work `orderstatus`, which is our own procurement
queue at one row per physical unit, and their horizon is days: place it, chase it, book it in. Birkenstock is bought ~6 months ahead
and cannot be topped up (CLAUDE.md), so its order book is a different object with a different clock — a season's commitment that
arrives in instalments, against invoices from the supplier, over months. The two never join up: a line here can sit invoiced and
un-arrived for weeks, which is not a state the receiving screens have a word for.

NEW 2026-09-14 (owner) — SCREEN AND READ ONLY, writes to follow. The route is live and reads production; nothing on this page writes.

IT IS NOT THE LEGACY GRID REDRAWN, deliberately (owner). The PowerBuilder screen's shape — one row per size, twelve columns, two
standing filter rails — is wrong for the question rather than merely old, and copying it produced a screen that needed scrolling in
both directions to answer "what is still to come?". BirkTrackerBook opens with what was kept, what was dropped and why; read that
before reshaping this screen against the old one again.

THE NAME IS NOW THIS SCREEN'S ALONE. Reports used to carry a second "Birk Tracker" — the daily core-size availability gauge — which
was renamed to Birk Availability (/analytics/birk-availability) in Sep 2026. Unrelated screen, unrelated data; if you are looking for
the Full / Styles / Full% trend, that is where it went.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import BirkTrackerBook from '@/components/BirkTrackerBook';

export default function BirkTrackerPage() {
  return (
    <AppShell title="Birk Tracker" backHref="/dashboard" backLabel="Dashboard">
      <BirkTrackerBook />
    </AppShell>
  );
}
