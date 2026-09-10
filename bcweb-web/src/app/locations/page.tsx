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

LIVE END TO END (2026-09-10, owner — the screen first, then the data, then the writes). GET /locations-racks and POST
/locations-stock are real: the racks come off the two sources utils/locations.js separates, FULL JOINed so that neither an empty rack
nor stock parked somewhere that isn't a shelf can go missing, and a rack's contents come off `localstock` (`COALESCE(deleted,0)=0 AND
qty>0`, per the CLAUDE.md landmine — never skusummary.stockvariants) collapsed by code and state. POST /locations-empty clears a whole
rack, soft-deleting every unit on it (picked and Amazon-allocated included, with the warning that entails) inside one withTransaction
and logging a bclog line per code. The per-unit +/- goes through the EXISTING /inv-adjust — the Inventory panel's write, shared rather
than reimplemented — with /locations-find-sku resolving a scanned barcode to a code first, since inv-adjust takes a SKU and a gun
fires a barcode. 'C3-Amazon' is a shelf like any other here: inv-adjust deliberately locks nothing (the operator is in control), and
the panel shows the state on every chip so they can see what they are touching.
STILL TO COME: the transfer. The screen can already work one — pick a chip, press Transfer, choose the rack it goes on — but the last
step only reports what it would do. The write is a MOVE (the row changes shelf and keeps its ordernum/allocated), never a remove and
an add, which would hand back a free pair and un-pick the order waiting for it; audit follows the legacy PowerBuilder phrasing,
`Transfer <code> from <SRC> >> to <DEST>` in bclog section 'Transfer', which that screen has been writing since May.
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
