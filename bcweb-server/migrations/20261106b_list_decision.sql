-- =====================================================================================================================================
-- LIST DECISIONS — an action chosen BY HAND for a style on Deep sellers or Clearance (owner, 2026-11-06).
-- =====================================================================================================================================
-- Two screens, one decision layer (owner: "Should it be its own screen? maybe so just to reduce the list of each and help us focus ...
-- go ahead with your suggestion of shared"). Each list stays its own screen; a style's decision on one never shows on the other.
--
-- A decision = the action picked for the style's sizes on that list (Harvest, Shopify price, Job lot ...; keys in utils/listDecision.js),
-- a LOOK-AGAIN date, and the style's MEASURE when it was decided (Deep sellers: its qty over; Clearance: its qty in stock in its 9-month+
-- sizes). The style goes back to the list's To decide view when EITHER the look-again date arrives OR the measure grows past the saved
-- one (owner chose both, option c) — selling some off never brings it back, more arriving does. Changing your mind overwrites the row;
-- clearing deletes it. Each set / clear also writes a bclog row.
--
-- ITS OWN TABLE, never the pricing review dates (next_shopify_price_review / next_amz_price_review): a Harvest decision must not hide
-- the style from Repricing or the Due lists. Choosing an action records it and does nothing else — a price move is its own step.
-- Written by /list-decision-set and /list-decision-clear.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS list_decision (
  list        text        NOT NULL CHECK (list IN ('deep', 'clearance')),
  groupid     text        NOT NULL,
  action      text        NOT NULL,
  look_again  date        NOT NULL,
  measure     integer     NOT NULL,
  decided_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  text,
  PRIMARY KEY (list, groupid)
);
