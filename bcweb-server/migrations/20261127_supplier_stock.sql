-- =====================================================================================================================================
-- SUPPLIER STOCK (owner, 2026-11-27). Rules: utils/supplierStock.js (THE copy). Loaded by scripts/supplier-stock-load.js.
-- =====================================================================================================================================
-- What a supplier says it has IN STOCK to sell us, from the list it sends. Read by the Prospects "Search Amazon" panel only, so a find
-- on Amazon shows at once whether the supplier can supply it and at what cost (owner: "most importantly rank … If all good, we check
-- the supplier stock B2B").
--   supplier   'rieker' — the Rieker Available Stock List PDF (Rieker, Remonte … all one list). GRS (Lunar) sends no list.
--   style      the supplier's style + colour code as printed ('44650-02', 'D0Q52-31')
--   season     as printed ('Autumn/Winter')
--   cost       our cost a pair, as printed on the list (£)
--   sizes      { "38": "limited", "40": "substantial" } — ONLY sizes with stock; a style with none in stock has {}
--   list_date  the date printed on the list (the stock is as of then)
-- A load REPLACES the supplier's rows (one list = the whole truth for that day). Nothing else reads or writes it.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS supplier_stock (
  supplier   text        NOT NULL,
  style      text        NOT NULL,
  season     text,
  cost       numeric(10,2),
  sizes      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  list_date  date        NOT NULL,
  loaded_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, style)
);
