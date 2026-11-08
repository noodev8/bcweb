-- =====================================================================================================================================
-- SHOPIFY SIZE PRICES — a dead size of a selling style gets its own price on the SAME Shopify product (owner, 2026-11-08).
-- =====================================================================================================================================
-- Shopify is priced per STYLE (skusummary.shopifyprice). A selling style often has one size that never sells (Milano 35: 5 pairs, the
-- style sold 101 in a year) and cutting the style to clear it gives the margin away on every other size. So a size can carry its own
-- price, set BY HAND on the Shopify pricing drill (50% of RRP filled in), shown on Shopify with the style price crossed out.
-- Rules in utils/sizePrice.js (THE copy). In short:
--   - a size price is USED only while it is below the style price AND the size has stock (local free + FBA live) — so nothing can leave
--     a "clearance" size dearer than the rest, or carry it into a later delivery;
--   - it ENDS by itself when the size sells out (Update Orders), when the style price goes to or below it (W1 / Add-Modify, same
--     transaction), or by hand ("Back to style price"). An ended price is DELETED from shopify_size_price and logged.
--
-- ITS OWN LOG, never price_change_log: ~10 screens read that as the STYLE's price history (a size row would show Milano £85 → £45).
-- google_pushed_at: the Google sweep (scripts/google-price-sweep.js) re-sends the style of every un-sent row — a size price that ENDS
-- must reach Google too, or the supplemental sale-price override would keep the old clearance price there.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS shopify_size_price (
  code     varchar       PRIMARY KEY,                 -- skumap.code — one size of one style
  groupid  varchar       NOT NULL,
  price    numeric(10,2) NOT NULL CHECK (price > 0),
  set_at   timestamptz   NOT NULL DEFAULT now(),
  set_by   text,
  note     text
);
CREATE INDEX IF NOT EXISTS shopify_size_price_groupid ON shopify_size_price (groupid);

CREATE TABLE IF NOT EXISTS shopify_size_price_log (
  id               bigserial     PRIMARY KEY,
  code             varchar       NOT NULL,
  groupid          varchar       NOT NULL,
  old_price        numeric(10,2),                     -- the size's own price before; NULL = it was at the style price
  new_price        numeric(10,2),                     -- NULL = back to the style price
  style_price      numeric(10,2),                     -- the style price at the time
  reason           text          NOT NULL CHECK (reason IN ('set', 'back', 'style', 'soldout', 'tidy')),
  note             text,
  changed_by       text,
  changed_at       timestamptz   NOT NULL DEFAULT now(),
  google_pushed_at timestamptz
);
CREATE INDEX IF NOT EXISTS shopify_size_price_log_groupid ON shopify_size_price_log (groupid, changed_at);
CREATE INDEX IF NOT EXISTS shopify_size_price_log_unsent ON shopify_size_price_log (groupid) WHERE google_pushed_at IS NULL;
