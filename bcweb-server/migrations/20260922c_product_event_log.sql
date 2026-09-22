-- =====================================================================================================================================
-- Migration: product_event_log — an append-only record of product CREATION and DELETION
-- Date: 2026-09-22
-- =====================================================================================================================================
-- Why this table exists:
--   skusummary.created_at answers "what is in the catalogue and when did it arrive" — it does NOT answer "how much new product did we
--   make". product-delete HARD-deletes the skusummary row, so a style built in March and killed in June disappears from every
--   creation-date query as if the work had never happened. That is precisely the wrong denominator for a production read: the killed
--   line still cost an afternoon, and it is the most interesting one.
--
--   So: one row per product EVENT, written at the moment it happens, never updated, never deleted. The log is the record of work done;
--   skusummary is the record of what currently exists. They are different questions and they now have different tables.
--
-- Design notes (each of these is load-bearing — don't "tidy" them):
--   - NO foreign key to skusummary. The entire point is that the row outlives the product.
--   - title and brand are SNAPSHOT COPIES, not joins, for the same reason: the moment a report has to join skusummary to render a name,
--     a deleted product vanishes from it again and we are back where we started.
--   - product_created_at carries the product's BIRTH date on both event types. On a DELETED row that gives lifespan (event_at minus
--     product_created_at) without needing the matching CREATED row to exist — it won't, for anything born before this table did.
--   - source separates 'NEW' (built from scratch) from 'COPY' (cloned colourway). They are not the same unit of work and a throughput
--     chart that blends them overstates a month of copies.
--   - actioned_by is the operator's display_name, resolved server-side from the JWT (house rule: never sent by the client).
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS product_event_log (
  id                 serial PRIMARY KEY,
  groupid            varchar     NOT NULL,
  event              varchar     NOT NULL,                  -- 'CREATED' | 'DELETED'
  source             varchar,                               -- CREATED: 'NEW' | 'COPY' | 'BACKFILL'   DELETED: 'UI'
  title              varchar,                               -- snapshot at event time (the product may be long gone)
  brand              varchar,                               -- snapshot at event time
  actioned_by        varchar,                               -- operator display_name (NULL for backfilled rows — nobody did it today)
  product_created_at timestamptz,                           -- the product's birth date; = event_at on a CREATED row
  event_at           timestamptz NOT NULL DEFAULT now()
);

-- Every report off this table is windowed by date, then grouped.
CREATE INDEX IF NOT EXISTS product_event_log_event_at_idx ON product_event_log (event_at);
CREATE INDEX IF NOT EXISTS product_event_log_groupid_idx  ON product_event_log (groupid);

-- =====================================================================================================================================
-- One-off backfill of CREATED events from the catalogue as it stands today.
-- =====================================================================================================================================
-- This gives the chart history on day one instead of an empty screen until December. It is HONEST BUT INCOMPLETE and the reports must
-- say so: it can only see products that still exist, so every month before today is a FLOOR, not a true count. Anything created and
-- deleted before this migration ran is gone for good. From this table's install date forward, the count is true.
--
-- Rows created on or before 2020-01-01 are deliberately EXCLUDED: 23 styles carry an identical '2020-01-01 11:00' stamp (the
-- pre-history seed from when the legacy DB was first loaded) and one carries '2000-01-01'. Neither is a creation event — importing them
-- would put a fake spike of 23 products-in-one-morning at the start of the series.
INSERT INTO product_event_log (groupid, event, source, title, brand, actioned_by, product_created_at, event_at)
SELECT ss.groupid,
       'CREATED',
       'BACKFILL',
       t.shopifytitle,
       ss.brand,
       NULL,
       ss.created_at,
       ss.created_at
  FROM skusummary ss
  LEFT JOIN title t ON t.groupid = ss.groupid
 WHERE ss.created_at IS NOT NULL
   AND ss.created_at > timestamptz '2020-01-02'
   AND NOT EXISTS (SELECT 1 FROM product_event_log l WHERE l.groupid = ss.groupid AND l.event = 'CREATED');
