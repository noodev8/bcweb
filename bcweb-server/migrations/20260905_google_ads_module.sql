-- =====================================================================================================================================
-- Migration: google_ads_module  (Google Ads — campaign assignment screen)
-- =====================================================================================================================================
-- Purpose: Everything the Google Ads module needs. Spec: docs/google-ads-spec.md (authoritative).
--
--          The module lets the owner decide which STYLES sit in which Google Ads campaign bucket. The bucket is written to
--          skusummary.googlecampaign, which merchant_feed.py ships as Google's custom_label_0, which is what scopes a Shopping
--          campaign. NOTE: skusummary.custom_label_0 is a DIFFERENT, DEAD column — see its COMMENT, applied 2026-09-05.
--
--          Three new tables + two columns on an existing one. Everything here is ADDITIVE: no existing table is altered destructively,
--          no existing row is rewritten, and nothing already running can break by applying this.
--
-- Apply in pgAdmin against brookfield_prod. Safe to re-run (IF NOT EXISTS throughout).
-- =====================================================================================================================================


-- -------------------------------------------------------------------------------------------------------------------------------
-- 1. google_product_daily — the per-style Google Ads report (bcweb_product_30)
-- -------------------------------------------------------------------------------------------------------------------------------
-- One row per (day, style, campaign). Daily grain is the whole point: it lets the owner re-download at any time over any window and
-- have it merge rather than overwrite, and it is what makes a 7d/30d/90d switch on the screen a client-side change with no re-import.
--
-- WHY groupid IS NOT A FOREIGN KEY: a Google row we cannot match to skusummary must still be STORED, so the import reconciliation can
-- report it by name rather than silently dropping it (the lesson from utils/amzImport.js — the legacy Amazon import discarded
-- unmatched rows invisibly and nobody knew for years). A style later deleted from skusummary also keeps its history here.
--
-- WHY google_label IS SEPARATE FROM skusummary.googlecampaign: it records what GOOGLE thought the bucket was, which is not always what
-- we think it is. The gap between the two is the screen's "Google says" column and the import's mismatch count. Collapsing them into
-- one column would hide exactly the breakage they exist to surface — 23 styles sat on a dead 'birk-winner' label for four months and
-- nothing announced it (spec §0).
--
-- ⚠ THE PRIMARY KEY BELOW IS WRONG AND IS REPLACED BY 20260905b_google_product_daily_label_key.sql. google_label IS part of the grain:
-- on the day a style's label changes, Google splits that day's activity across both labels and reports two rows. Read 20260905b for
-- the evidence. This file is left as applied; do not follow the reasoning in the note attached to the key.
CREATE TABLE IF NOT EXISTS google_product_daily (
  snapshot_date   DATE          NOT NULL,          -- the report's `Day`
  groupid         VARCHAR(100)  NOT NULL,          -- UPPER(custom_label_1). Google lowercases labels; see the import util.
  google_label    VARCHAR(100),                    -- custom_label_0 AS GOOGLE REPORTED IT. NULL when the report said " --".
  campaign        VARCHAR(255)  NOT NULL,          -- the Google Ads campaign name (NOT our bucket)
  impressions     INTEGER       NOT NULL DEFAULT 0,
  clicks          INTEGER       NOT NULL DEFAULT 0,
  cost            NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversions     NUMERIC(12,2),                   -- nullable: Google revises these upward for weeks after the click
  conv_value      NUMERIC(12,2),                   -- Google's ATTRIBUTED revenue. Never tie this to sales.profit — different things.
  imported_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
  imported_by     VARCHAR(100),                    -- app user's display_name, resolved server-side from the JWT
  -- google_label is deliberately NOT in the key: a style serves in one campaign per day, and keying on a value Google may restate
  -- would let the same day insert twice under two labels and double-count the spend.
  CONSTRAINT google_product_daily_pkey PRIMARY KEY (snapshot_date, groupid, campaign)
);

-- The screen's main read: one style's history, newest first (the drill), and the windowed roll-up per style (the grid).
CREATE INDEX IF NOT EXISTS google_product_daily_groupid_idx
  ON google_product_daily (groupid, snapshot_date DESC);

-- The freshness banner and the gap detector both scan by date alone.
CREATE INDEX IF NOT EXISTS google_product_daily_date_idx
  ON google_product_daily (snapshot_date);


-- -------------------------------------------------------------------------------------------------------------------------------
-- 2. google_campaign — the controlled list of bucket names
-- -------------------------------------------------------------------------------------------------------------------------------
-- Campaign names are created deliberately, not by typing into a free-text box. A typo ('Zermat') would go into the feed, reach
-- Google, match nothing in the Ads UI, and never announce itself — the same class of silent failure as the stale labels above.
--
-- varchar(20) MATCHES skusummary.googlecampaign EXACTLY. That column is varchar(20) and is not being widened (spec §2.2), so a name
-- that fits here is guaranteed to fit there. Keep these two widths in step if either ever changes.
--
-- archived RATHER THAN DELETE: a campaign that once held products still appears in google_product_daily history and in the
-- assignment log. A hard delete would orphan both. Archiving hides it from the assign picker and does nothing else.
CREATE TABLE IF NOT EXISTS google_campaign (
  name        VARCHAR(20)  PRIMARY KEY,
  notes       TEXT,
  archived    BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_by  VARCHAR(100)
);

-- The two names that already had meaning when this shipped. Neither is special to the code: nothing reads these literals, and as of
-- 2026-09-07 neither is protected from rename or delete.
--
-- ⚠ THE ORIGINAL 'standard' NOTE HERE WAS "The default bucket. Every new style starts here (product-create.js)." That was true when
-- written and is not now — product-create.js seeds 'new'. The note stayed wrong in the live row until 2026-09-07 because notes are
-- display-only in the panel and nothing ever re-read this file. Corrected below and in the live row; if you change where new
-- products land, this text is one of the places that will not follow on its own.
INSERT INTO google_campaign (name, notes, created_by) VALUES
  ('standard', 'A general advertising bucket. NOT the seed for new products — product-create.js writes ''new''.', 'system'),
  ('pause',  'Excluded from Google Ads. Used instead of switching googlestatus off — reversible.', 'system')
ON CONFLICT (name) DO NOTHING;


-- -------------------------------------------------------------------------------------------------------------------------------
-- 3. google_campaign_assignment_log — who moved what, when
-- -------------------------------------------------------------------------------------------------------------------------------
-- BUILT EVEN THOUGH STAFF DELEGATION IS OUT OF SCOPE (spec §1), because it is load-bearing for a different reason.
--
-- Google's product report stamps a label value across a whole reporting window; whether it carries true per-day history is unproven
-- (spec §2.4.6). So Google cannot reliably tell us what a product's bucket was last October when we ask in March. Without this table,
-- moving a style silently re-attributes all of its past spend and sales to its new campaign, and "was the split better than the big
-- bucket?" — the question this whole module exists to answer — becomes unanswerable.
--
-- IT CANNOT BE BACKFILLED LATER. Every day it does not exist is a day of history that is simply gone. That is why it ships in v1 with
-- no UI beyond a history line on the drill.
--
-- from_campaign IS NULLABLE: the first time a style is touched its previous value may be NULL (never set), and recording that
-- honestly is better than inventing 'standard'.
CREATE TABLE IF NOT EXISTS google_campaign_assignment_log (
  id            BIGSERIAL    PRIMARY KEY,
  groupid       VARCHAR(100) NOT NULL,
  from_campaign VARCHAR(20),
  to_campaign   VARCHAR(20)  NOT NULL,
  changed_by    VARCHAR(100) NOT NULL,   -- resolved server-side from the JWT, never sent by the client (CLAUDE.md)
  changed_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- The drill reads one style's history newest-first. No other read pattern exists yet.
CREATE INDEX IF NOT EXISTS google_campaign_assignment_log_groupid_idx
  ON google_campaign_assignment_log (groupid, changed_at DESC);


-- -------------------------------------------------------------------------------------------------------------------------------
-- 4. google_campaign_daily — two new columns
-- -------------------------------------------------------------------------------------------------------------------------------
-- The existing per-campaign table (181 rows, 4 Apr - 4 Sep 2026, no gaps as of 2026-09-05) has spend but no revenue, so no ROAS can
-- be computed from it. Adding Conversions and Conv. value to the adcost_summary_30 export gives an AUTHORITATIVE campaign-level total
-- to reconcile the per-style product report against.
--
-- BOTH NULLABLE, so every one of the 181 existing rows stays valid and C:\scripts\google-ads\update_google_stock_track.py — which
-- reads that CSV by column POSITION — keeps working untouched. This is also why the two new columns must be appended at the END of
-- the Google Ads report's column list, never inserted in the middle.
ALTER TABLE google_campaign_daily
  ADD COLUMN IF NOT EXISTS conversions NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS conv_value  NUMERIC(12,2);


-- -------------------------------------------------------------------------------------------------------------------------------
-- 5. Documentation on the tables themselves
-- -------------------------------------------------------------------------------------------------------------------------------
-- The skusummary.custom_label_0 / googlecampaign comments were applied separately on 2026-09-05. These do the same job for the new
-- tables: anyone who opens them in pgAdmin without this repo to hand still learns what they are and what feeds them.
COMMENT ON TABLE google_product_daily IS
  'Per-style Google Ads performance, one row per (day, style, campaign). Imported from the bcweb_product_30 Report editor export via '
  'the Google Ads screen. Upserted on the primary key, so re-importing the same window is safe and takes the later figures '
  '(Google revises conversions upward for weeks). See docs/google-ads-spec.md.';

COMMENT ON COLUMN google_product_daily.google_label IS
  'custom_label_0 AS GOOGLE REPORTED IT, NOT our skusummary.googlecampaign. The gap between the two is the point: it is how a feed '
  'that has stopped landing becomes visible. NULL where the report said " --" (no label).';

COMMENT ON TABLE google_campaign IS
  'The controlled list of Google Ads campaign bucket names. varchar(20) to match skusummary.googlecampaign exactly. Archive rather '
  'than delete — history in google_product_daily and google_campaign_assignment_log still references old names.';

COMMENT ON TABLE google_campaign_assignment_log IS
  'Every change to skusummary.googlecampaign: style, from, to, who, when. The ONLY record of historical campaign membership — '
  'Google does not reliably provide it. Cannot be backfilled. Do not prune.';
