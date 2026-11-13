-- =====================================================================================================================================
-- AMAZON BUY BOX — GO THROUGH'S SET / LEAVE RECORD (owner, 2026-11-12; docs/amz-buybox/PLAN.md decision 17). Rules in
-- utils/amzBuyBoxDeck.js (recordPress, readDeck).
-- =====================================================================================================================================
-- One row per press on Go through: who, when, the mood, the tab (new | raise | cut), the price the card suggested, and what was done
-- (set = the price sent, leave = nothing sent, undo = a Set put back). Purpose: the AGREE RATE per answer, read later — an answer that
-- is nearly always Set, whose Sets nearly always work, could one day be made differently (a batch or Auto is a separate idea).
--
--   Leave asks nothing (no reason) and the returning card shows no earlier Leave. A LEFT card comes back when the price it would now
--   suggest differs from the one left (compared to the penny), or after 7 days, whichever first — read from this table.
--   KEPT 12 MONTHS (the same as the Buy Box readings a press is judged against), purged by the write itself (recordPress) — no cron,
--   no table that grows for ever (owner: "I dont like indefinite table growing").
--   The price write itself is the normal W-A1 / W-A2 (amz_price_log); this table never decides a price.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS amz_buybox_press (
  id          bigserial    PRIMARY KEY,
  code        varchar      NOT NULL,                 -- our code (amzfeed.code)
  pressed_at  timestamptz  NOT NULL DEFAULT now(),
  pressed_by  text,                                  -- the person (verifyToken display_name)
  mood        varchar(8)   NOT NULL,                 -- fierce | chilled | climb (the New tab is recorded with the mood on screen)
  tab         varchar(8)   NOT NULL,                 -- new | raise | cut
  action      varchar(8)   NOT NULL,                 -- set | leave | undo
  our_price   numeric(8,2),                          -- our price at the reading the card was built from
  suggested   numeric(8,2),                          -- the price the card suggested
  price       numeric(8,2),                          -- the price sent (set / undo); NULL on a leave
  CONSTRAINT amz_buybox_press_mood   CHECK (mood   IN ('fierce', 'chilled', 'climb')),
  CONSTRAINT amz_buybox_press_tab    CHECK (tab    IN ('new', 'raise', 'cut')),
  CONSTRAINT amz_buybox_press_action CHECK (action IN ('set', 'leave', 'undo'))
);

CREATE INDEX IF NOT EXISTS amz_buybox_press_code_at ON amz_buybox_press (code, pressed_at DESC);
CREATE INDEX IF NOT EXISTS amz_buybox_press_at ON amz_buybox_press (pressed_at);
