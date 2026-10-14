-- =====================================================================================================================================
-- COLLECTIONS — the Shopify collection tags, stored here (owner, 2026-10-14).
-- =====================================================================================================================================
-- Why: "A simple screen where I can tag/untag based on a set of criteria or filters. Allow up to 3 tags per style so I can put them in
-- multiple collections. Store in database and I will manage tags from here only." Until now the `clearance` tag lived ONLY on Shopify
-- (utils/clearanceTag.js read it live, no column). From here the DATABASE is the record of who is in which collection and Shopify carries
-- a copy: every add / remove writes the row and sends tagsAdd / tagsRemove for that one tag (utils/collectionTags.js). The owner builds
-- each smart collection in Shopify admin ("Product tag is equal to <tag>"); this app only manages the tags.
--
--   collection         the tags the owner has created. Tags are PICKED from here, never typed per row — a typo would otherwise make a
--                      new, silent Shopify tag that no collection matches.
--   collection_member  one row per style per tag. At most 3 tags per style — enforced by the server (utils/collectionTags.js), not a
--                      constraint. No dates on purpose (owner: "No need for dates"); bclog section 'Collections' records who did what.
--
-- groupid has NO foreign key to skusummary: a style deleted from skusummary must not be blocked by its tags, and its row must stay
-- visible on the Collections screen so the tag can still be taken off Shopify.
--
-- ORDER (each step depends on the one before):
--   1. run this file;
--   2. node scripts/collection-import-clearance.js --apply   (copies today's Shopify `clearance` tags into collection_member);
--   3. then the server code that reads these tables can go live — until step 2 runs, Slow would show nothing in the collection.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS collection (
  tag         varchar(40) PRIMARY KEY,                -- the Shopify tag, lower-case a-z 0-9 and '-' (checked by the server)
  created_by  varchar(50),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_member (
  groupid  varchar(50) NOT NULL,
  tag      varchar(40) NOT NULL REFERENCES collection(tag) ON UPDATE CASCADE,
  PRIMARY KEY (groupid, tag)
);

-- "Who is in clearance" is the common read; the primary key already serves "what tags has this style".
CREATE INDEX IF NOT EXISTS collection_member_tag_idx ON collection_member (tag);

-- The collection Slow has always used. Same name as the tag on Shopify today, so the existing smart collection and email campaign keep
-- working untouched.
INSERT INTO collection (tag, created_by) VALUES ('clearance', 'migration') ON CONFLICT (tag) DO NOTHING;
