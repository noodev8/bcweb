-- =====================================================================================================================================
-- AMZ SHIPMENT — LOCKED BOXES (owner, 2026-10-15: "let users 'lock' boxes. so if a box is done they lock whats in it and its values").
-- =====================================================================================================================================
-- A column on the existing table, not a new one (owner's call). One amzshipment row per box + SKU, so the flag is written on EVERY row
-- of the box and read as "any row locked". While set, the box's contents and measurements can't change: the AMZ Shipment write routes
-- (line, dims, box-empty, box-delete) refuse it, and Goods In starts a new box rather than adding to it (utils/amzShipment.js).
-- Mark shipped empties amzshipment, so locks go with the shipment. The archive doesn't carry it. PowerBuilder ignores the column; a row
-- it inserts takes the default (unlocked).
-- =====================================================================================================================================

ALTER TABLE amzshipment ADD COLUMN IF NOT EXISTS locked boolean NOT NULL DEFAULT false;
