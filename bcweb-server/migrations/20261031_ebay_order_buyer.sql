-- =====================================================================================================================================
-- EBAY — which eBay buyer placed which EB order (2026-10-31).
-- =====================================================================================================================================
-- eBay's Marketplace Account Deletion rule: when an eBay user closes their account, eBay notifies us (username / userId) and we must
-- delete what we hold about them. The EB order rows in orderstatus / orderstatus_archive carry the buyer's name, address, phone and
-- relay email, but nothing that says WHO the buyer is on eBay — so this table is the link. The eBay order import (getOrders, buyer.username)
-- writes one row per EB order; routes/ebay-account-deletion.js reads it to find that buyer's orders, blanks their delivery details
-- and deletes the row. Nothing else reads it.
-- ordernum is ours (EB + eBay's order number, e.g. 'EB22-15343-31982'). Usernames are matched case-insensitively.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS ebay_order_buyer (
  ordernum        text PRIMARY KEY,
  buyer_username  text NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ebay_order_buyer_username ON ebay_order_buyer (LOWER(buyer_username));
