-- =====================================================================================================================================
-- PRICING SLIDER — step a group's prices down until each product sells (owner, 2026-10-17).
-- =====================================================================================================================================
-- Why: dropping NEW stock straight to the bottom found some "diamonds" but sold others at a loss, and gave the diamonds away below the
-- price they would have sold at. A slider walks the price down a step at a time (a % of RRP, every N days) and HOLDS it at the first
-- price that sells, so it finds the highest price that moves the stock before the season is over.
--
-- NO CRON (owner): every price move is a button press on the Slider screen, the same way the team prices today. These tables are the
-- slider's own record; the prices themselves are still written through W1 (skusummary + price_change_log) and W-A1 (amz_price_log), so
-- the Shopify push, the Google sweep and the Amazon upload basket all work unchanged.
--
--   slider_group   one channel + its rules. Shopify groups work per STYLE (groupid), Amazon groups per SKU (code), so a group is
--                  one channel only — want both, make two groups.
--   slider_member  one product's time in one group. A product leaves by moving to another group, being repriced by hand, removed,
--                  reset to RRP or the group ending; the row stays as history (state says how it left). The partial unique index is the
--                  rule "one live slider per product per channel" — sliding, found and at-floor are all still IN the slider (found and
--                  floor hold their price and keep their badge on the pricing screens).
--   slider_event   the slider's log — DROPPED 2026-10-20 (migrations/20261020_slider_event_drop.sql).
--
-- No foreign key to skusummary / amzfeed on purpose — a style deleted there must not be blocked by its slider history.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS slider_group (
  id                serial PRIMARY KEY,
  name              varchar(80)  NOT NULL,
  channel           varchar(3)   NOT NULL CHECK (channel IN ('SHP', 'AMZ')),
  step_pct          numeric(5,2) NOT NULL CHECK (step_pct > 0 AND step_pct <= 50),          -- each step = this % of the product's RRP
  every_days        smallint     NOT NULL CHECK (every_days BETWEEN 1 AND 60),               -- a step is due this many days after the last
  floor_pct         numeric(5,2) NOT NULL CHECK (floor_pct >= 1 AND floor_pct < 100),        -- never below this % of RRP
  floor_breakeven   boolean      NOT NULL DEFAULT false,                                     -- also never below break-even (opt-in)
  stop_after_sales  smallint     NOT NULL DEFAULT 1 CHECK (stop_after_sales BETWEEN 1 AND 3), -- Found after this many sales
  due_date          date,                                                                    -- optional; the screen suggests one
  state             varchar(10)  NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'paused', 'ended')),
  notes             varchar(500),
  created_by        text,
  created_at        timestamptz  NOT NULL DEFAULT now(),
  updated_by        text,
  updated_at        timestamptz,
  ended_at          timestamptz
);

CREATE TABLE IF NOT EXISTS slider_member (
  id            serial PRIMARY KEY,
  group_id      integer       NOT NULL REFERENCES slider_group(id) ON DELETE CASCADE,
  channel       varchar(3)    NOT NULL CHECK (channel IN ('SHP', 'AMZ')),  -- the group's, copied here so the unique index can see it
  item_key      varchar(60)   NOT NULL,                                     -- groupid (SHP) or code (AMZ)
  groupid       varchar(50)   NOT NULL,                                     -- the style (= item_key on SHP)
  rrp           numeric(10,2) NOT NULL,                                     -- RRP when it joined: steps and floor are % of THIS
  start_from    varchar(7)    NOT NULL CHECK (start_from IN ('current', 'rrp')),  -- 'rrp' = the first move lifts it to RRP
  start_price   numeric(10,2) NOT NULL,                                     -- its price when it joined
  last_price    numeric(10,2) NOT NULL,                                     -- the price the slider last set (= start_price until it moves)
  last_log_id   integer,                                                    -- price_change_log.id / amz_price_log.id of that move
  last_move_at  timestamptz,                                                -- when the slider last moved it (Amazon: phase 2 dates from upload)
  steps         smallint      NOT NULL DEFAULT 0,
  state         varchar(10)   NOT NULL DEFAULT 'sliding'
                CHECK (state IN ('sliding', 'found', 'floor', 'repriced', 'moved', 'removed', 'reset', 'ended')),
  found_price   numeric(10,2),
  found_at      timestamptz,
  joined_by     text,
  joined_at     timestamptz   NOT NULL DEFAULT now(),
  ended_by      text,
  ended_at      timestamptz
);

-- One live slider per product per channel. "Live" = still in the slider: sliding, or holding at a found / floor price.
CREATE UNIQUE INDEX IF NOT EXISTS slider_member_live_uq ON slider_member (channel, item_key)
  WHERE state IN ('sliding', 'found', 'floor');
CREATE INDEX IF NOT EXISTS slider_member_group_idx ON slider_member (group_id);

CREATE TABLE IF NOT EXISTS slider_event (
  id          serial PRIMARY KEY,
  group_id    integer      NOT NULL REFERENCES slider_group(id) ON DELETE CASCADE,
  member_id   integer      REFERENCES slider_member(id) ON DELETE CASCADE,   -- null for a group-level event
  event       varchar(20)  NOT NULL,
  old_price   numeric(10,2),
  new_price   numeric(10,2),
  detail      varchar(250),
  created_by  text,
  created_at  timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS slider_event_group_idx ON slider_event (group_id, created_at DESC);
