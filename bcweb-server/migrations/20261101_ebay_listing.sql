-- =====================================================================================================================================
-- EBAY LISTINGS made by BCWEB (Add build, step 2 — owner, 2026-11-01).
-- =====================================================================================================================================
-- What BCWEB put on eBay: one ebay_listing row per STYLE listed (one listing per style, its sizes as variations), and one
-- ebay_listing_size row per size on it, with the eBay offer that carries that size and the quantity last sent. The first eBay data we
-- STORE (the Checking screen reads eBay live): the stock sync (step 3, at the end of every Update Orders run) needs to know which of our
-- codes are on which eBay offer, and what it last told eBay.
--
-- Written by POST /ebay-list after eBay has published the listing (routes/ebay-list.js), in one transaction with the material saved
-- back to skusummary and a bclog row. ended_at / ended_by are for the Remove build (step 5) — a live listing has ended_at NULL, and a
-- style can have only ONE live listing (uq_ebay_listing_live). An ended row is kept, so a style can be listed again later.
--
-- item_id   eBay's listing number (www.ebay.co.uk/itm/<item_id>)
-- group_key the Inventory API item group key (= our groupid) the listing was published from
-- price     the price it was listed at (£, item only — £4.50 postage on top, like Shopify)
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS ebay_listing (
  id           serial PRIMARY KEY,
  groupid      text NOT NULL,
  item_id      text NOT NULL,
  group_key    text NOT NULL,
  category_id  integer,
  price        numeric(10,2) NOT NULL,
  style        text,
  material     text,
  listed_at    timestamptz NOT NULL DEFAULT now(),
  listed_by    text NOT NULL,
  ended_at     timestamptz,
  ended_by     text
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ebay_listing_live ON ebay_listing (groupid) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ebay_listing_item ON ebay_listing (item_id);

CREATE TABLE IF NOT EXISTS ebay_listing_size (
  ebay_listing_id  integer NOT NULL REFERENCES ebay_listing (id) ON DELETE CASCADE,
  code             text NOT NULL,                       -- our code = the eBay SKU (Custom label)
  offer_id         text NOT NULL,
  qty_sent         integer NOT NULL,                    -- the quantity last sent to eBay
  qty_sent_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ebay_listing_id, code)
);

CREATE INDEX IF NOT EXISTS idx_ebay_listing_size_code ON ebay_listing_size (code);
