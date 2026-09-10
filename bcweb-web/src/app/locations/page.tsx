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

UI FIRST (2026-09-10, owner). The screen is built and worked-through; the routes behind it are the next job, so LocationsBoard holds
its racks in component state off a placeholder fixture and says so on its face. When the data lands it comes off the two sources
utils/locations.js already separates — the `location` table for the racks that EXIST (including the empty
ones, which is exactly where a box gets put), `localstock` for what is currently ON them (`ordernum='#FREE' AND COALESCE(deleted,0)=0
AND qty>0`, per the CLAUDE.md landmine — never skusummary.stockvariants). Writes go through withTransaction like every other write,
and 'C3-Amazon' stays the staging bay that Goods In and Pick already treat as special rather than a shelf like any other.
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
