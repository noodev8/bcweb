'use client';
/*
=======================================================================================================================================
Page: /locations  (Locations — what is on each shelf, and moving stock on and off it)
=======================================================================================================================================
Purpose: The warehouse read the other way round. Every existing screen starts from a PRODUCT and mentions where it happens to be;
         this one starts from a PLACE and asks what is on it — then adds to it and takes off it.

WHY IT IS ITS OWN MODULE and not a view inside Inventory: Inventory's "add to a location" flow (routes/inv-locations.js) is reached
with a style already in hand, so it only ever has to offer the racks that style is already on. Standing at a rack with a box in your
hands is the opposite errand — the shelf is the thing you know and the stock is what you are looking up — and the two need different
first screens even though they end up writing the same `localstock` rows.

READS ARE LIVE, AND THE FIRST WRITE HAS LANDED (2026-09-10, owner — the screen first, then the data, then the write). GET /locations-racks and POST
/locations-stock are real: the racks come off the two sources utils/locations.js separates, FULL JOINed so that neither an empty rack
nor stock parked somewhere that isn't a shelf can go missing, and a rack's contents come off `localstock` (`COALESCE(deleted,0)=0 AND
qty>0`, per the CLAUDE.md landmine — never skusummary.stockvariants) collapsed by code and state. POST /locations-empty clears a whole
rack, soft-deleting every unit on it (picked and Amazon-allocated included, with the warning that entails) inside one withTransaction
and logging a bclog line per code. What is still to come is the per-unit +/-, which is inv-adjust's existing contract; until it is
wired LocationsBoard holds those edits in an overlay and says so.
=======================================================================================================================================
*/

import AppShell from '@/components/AppShell';
import LocationsBoard from '@/components/LocationsBoard';

export default function LocationsPage() {
  return (
    <AppShell title="Locations" backHref="/dashboard" backLabel="Dashboard">
      <LocationsBoard />
    </AppShell>
  );
}
