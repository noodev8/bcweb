-- =====================================================================================================================================
-- AMAZON BUY BOX READINGS — who holds the Buy Box on each of our Amazon sizes, over time (owner, 2026-11-12; docs/amz-buybox/PLAN.md).
-- =====================================================================================================================================
-- Why: BCWEB could send Amazon prices but could not see the competition. A read (the Buy Box screen's button, later a cron) asks
-- Amazon's Product Pricing API who holds the Buy Box on each size, at what price, and who the rivals are. Rules in utils/amzBuyBox.js.
--
-- Owner decisions (2026-11-12):
--   - Read BY HAND (the screen's button) until the team is used to it; the frequency (hourly?) is decided later — the same read then
--     runs from cron (scripts/amz-buybox-read.js). No AWS push notifications.
--   - KEEP 12 MONTHS of history (one season round), purged by the read itself as it writes — no cron to forget. The row in force at
--     the cut-off survives, so every moment inside the 12 months can still be read. Bounded at roughly 20–70 MB (the whole DB was
--     87 MB on 2026-11-12).
--
--   amz_buybox_now      the LATEST reading, one row per size, replaced by each read (the screen opens on it instantly). Never grows.
--   amz_buybox_history  CHANGE-ONLY: a row only when the holder, Buy Box price, our price, cheapest rival (seller + price) or rival
--                       count changed since the size's previous row. A size's state at any moment = its latest row at or before it.
--                       Not the full offer list (that lives only in _now).
--   amz_buybox_run      one line per read — who pressed it (or 'cron'), what it read, progress while it runs, and its error.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS amz_buybox_now (
  code               varchar      PRIMARY KEY,       -- our code (amzfeed.code)
  read_at            timestamptz  NOT NULL,
  run_id             integer,
  asin               varchar,
  our_price          numeric(8,2),                   -- our offer as Amazon showed it, postage included (NULL = our offer not shown)
  holder             varchar(12)  NOT NULL,          -- US | US_SHARED | OTHER_FBA | OTHER_MFN | AMAZON | NONE
  bb_price           numeric(8,2),                   -- Buy Box price incl. postage: ours if we hold it, else the cheapest rival holding it
  rival_seller       varchar(20),                    -- the cheapest rival offer's seller id
  rival_price        numeric(8,2),                   -- and its price incl. postage
  next_up            numeric(8,2),                   -- the cheapest rival priced ABOVE us
  rivals             integer      NOT NULL,          -- other offers on the size
  rival_at_our_price boolean      NOT NULL DEFAULT false,  -- a rival at our exact price, to the penny (a repricer following us?)
  amazon_retail      boolean      NOT NULL DEFAULT false,  -- Amazon itself sells the size
  foep               numeric(8,2),                   -- Amazon's "featured offer expected price" — SHOWN, never a target (PLAN.md)
  foep_status        varchar(40),                    -- VALID_FOEP | NO_COMPETING_OFFER | OFFER_NOT_ELIGIBLE | …
  competitive_price  numeric(8,2),                   -- itemOffers Summary.CompetitivePriceThreshold
  offers             jsonb,                          -- every offer: [{ seller, fba, price, bb }]
  error              text                            -- Amazon's error for this size, if the read failed for it
);

CREATE TABLE IF NOT EXISTS amz_buybox_history (
  code          varchar      NOT NULL,
  read_at       timestamptz  NOT NULL,
  our_price     numeric(8,2),
  holder        varchar(12)  NOT NULL,
  bb_price      numeric(8,2),
  rival_seller  varchar(20),
  rival_price   numeric(8,2),
  rivals        integer      NOT NULL,
  PRIMARY KEY (code, read_at)
);
CREATE INDEX IF NOT EXISTS amz_buybox_history_read_at ON amz_buybox_history (read_at);

CREATE TABLE IF NOT EXISTS amz_buybox_run (
  id           serial       PRIMARY KEY,
  started_at   timestamptz  NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  by_name      text         NOT NULL,              -- display name of who pressed it, or 'cron'
  scope        text         NOT NULL,              -- 'all' or the groupid read
  total        integer      NOT NULL DEFAULT 0,    -- sizes to read
  done         integer      NOT NULL DEFAULT 0,    -- sizes read so far (progress)
  changed      integer,                            -- history rows written
  status       varchar(10)  NOT NULL DEFAULT 'running',  -- running | ok | error
  error        text
);
