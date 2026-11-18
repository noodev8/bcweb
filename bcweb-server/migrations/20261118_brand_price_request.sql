-- =====================================================================================================================================
-- BRAND PRICE REQUESTS (owner, 2026-11-18). Rules: utils/brandPriceRequest.js (THE copy).
-- =====================================================================================================================================
-- A brand that has asked us to sell at RRP on one channel (Strive on Amazon, Free Spirit on Shopify). BRAND-WIDE, per CHANNEL.
-- A REMINDER, NEVER A RULE: the cards, the pricing lists and the size-price screens show a note (amber when the price isn't the RRP);
-- nothing blocks or changes a price. Set by hand — the owner says, Claude adds or removes a row (no screen).
--   brand    matches skusummary.brand exactly ('Free Spirit')
--   channel  'SHP' | 'AMZ'
--   request  'RRP' — the only kind so far
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS brand_price_request (
  brand       text        NOT NULL,
  channel     text        NOT NULL CHECK (channel IN ('SHP', 'AMZ')),
  request     text        NOT NULL DEFAULT 'RRP' CHECK (request IN ('RRP')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand, channel)
);

INSERT INTO brand_price_request (brand, channel, request, note) VALUES
  ('Strive',      'AMZ', 'RRP', 'Brand asks for RRP on Amazon (owner, 2026-11-18)'),
  ('Free Spirit', 'SHP', 'RRP', 'Brand asks for RRP on Shopify (owner, 2026-11-18)')
ON CONFLICT (brand, channel) DO NOTHING;
