-- =====================================================================================================================================
-- AMAZON SP-API SYNC STATE — detail (2026-11-09). The nightly FBA Inventory report (scripts/amz-inventory-nightly.js) keeps its
-- RECONCILIATION here (unknown SKUs + the de-listable zero-stock ones, Amazon bundles, gone from Amazon — utils/amzImportShape.js), so
-- Update Amazon can still show the panel and its Delete file button now the inventory file is no longer uploaded (owner: de-listing
-- dead SKUs is rare but still done). Replaced each night; only the last report is kept.
-- =====================================================================================================================================

BEGIN;

ALTER TABLE amz_api_sync ADD COLUMN IF NOT EXISTS detail jsonb;

COMMIT;
