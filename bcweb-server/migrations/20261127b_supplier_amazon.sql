-- =====================================================================================================================================
-- SUPPLIER STYLES ON AMAZON (owner, 2026-11-27: "Start with what we can get and then see if it is worth it").
-- Written by scripts/supplier-amazon-scan.js, read by routes/supplier-prospects.js (Prospects → Rieker list).
-- =====================================================================================================================================
-- One row per supplier style the scan looked for on Amazon: a style on the supplier's stock list WITH stock that we don't stock
-- (no skusummary row). The Amazon listing kept is the style's best-ranked size (overall Fashion rank — utils/amzProspectRead.js).
--   asin NULL   = not found on Amazon (no listing carries the code + colour)
--   group_rank  = the overall (Fashion) rank of that size; NULL = Amazon gives none
--   buybox / lowest / fba / fbm = that size's offers, as Search Amazon reads them
--   list_date   = the supplier list the scan ran against; scanned_at = when
-- A scan REPLACES the supplier's rows. Nothing else reads or writes it.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS supplier_amazon (
  supplier        text        NOT NULL,
  style           text        NOT NULL,
  asin            text,
  title           text,
  group_rank      integer,
  rank_category   text,
  size            text,
  buybox          numeric(10,2),
  lowest          numeric(10,2),
  fba             integer,
  fbm             integer,
  list_date       date        NOT NULL,
  scanned_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, style)
);
