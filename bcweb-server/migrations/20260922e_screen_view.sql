-- =====================================================================================================================================
-- Migration: screen_view — an append-only record of which screens get OPENED, by whom
-- Date: 2026-09-22
-- =====================================================================================================================================
-- Why this table exists (owner, 2026-09-22): "I will one day wonder which screens are being used and which are ignored, and perhaps
-- by who." That question cannot be answered retrospectively — there is no trace of a page being opened anywhere in the DB — so the
-- collection has to start before the question is asked. It is deliberately being gathered with NO report built on it yet.
--
-- WHY NOT bclog, which is the obvious home. bclog is an audit of things that CHANGED, shared with PowerBuilder, read by a human
-- searching it, and its value rests on every row being a real event. Screen opens are the opposite kind of data: ambient, an order of
-- magnitude higher in volume (a working day is a few hundred navigations against a couple of dozen actions), and interesting only in
-- aggregate. Putting them in bclog would drown the ledger in a table another application also reads. Telemetry and audit want
-- different tables; this is the telemetry one.
--
-- Design notes (each is load-bearing — don't "tidy" them):
--   - PATH IS NORMALISED BEFORE IT IS STORED (utils/screenPath.js): /pricing/style/ABC123 lands as /pricing/style/:id. Store the raw
--     path and every drill-down is its own unique string, there is nothing to GROUP BY, and the table answers no question at all. This
--     is the single decision that makes or breaks the whole thing, and it is painful to retrofit — a backfill would have to re-parse
--     every row against route patterns that have since moved on.
--   - NO QUERY STRING is kept. It carries filters, search terms and the ?from= return ticket — none of it is "which screen", and some
--     of it is a customer's name typed into a search box. Dropping it at the door means it can never be in here to leak.
--   - username, not a user id. Same reasoning as bclog.workstation: the report is about a person, and resolving an id back to a name
--     later means a join to a table where the row may since have been renamed or removed.
--   - NO foreign key to the users table, for that same outliving reason.
--   - viewed_at is timestamptz (UTC). Format to Europe/London at read time; do NOT store London-local. The legacy date/time split in
--     bclog exists to satisfy PowerBuilder, which will never read this table, so it is not copied here.
--   - NO session or sequence column. "How did they get here" is a different and much bigger question than "what gets opened", and
--     guessing now at what a journey report would need is how you end up with three columns nothing ever reads.
--
-- PER-PERSON IS IN SCOPE, AND WHAT IT IS FOR (owner, 2026-09-22): "because of training. If one person is using a single screen and we
-- feel there is a better screen, then we know what discussion to have." That is the whole brief, and it is worth holding to, because
-- the same numbers support a very different use. The question this answers is WHICH SCREEN SOMEONE IS DOING A JOB ON — somebody
-- working from Inventory all day when the product hub would answer it in one hop is a training prompt, and the only way to spot it is
-- per person. It is NOT an activity measure: nothing here should ever be read as how much work somebody did, and a report that ranks
-- people by row count would be measuring how chatty their navigation is, not their output.
-- So: break down by person, by all means. Rank screens within a person. Do not rank people.
--
-- WHAT THIS DATA CANNOT TELL YOU, recorded here because the table will outlive the conversation: a low count does NOT mean a screen is
-- ignored. Finance is once a month BY DESIGN and Birkenstock a few times a year; both will sit at the bottom of any ranking while
-- working exactly as intended. The honest read is "nothing has opened this in 90 days" as a prompt to go and ask why — never a league
-- table, and never on its own a reason to remove a screen.
-- Nor does a high count mean a screen is GOOD: re-opening the same screen twenty times can equally mean it does not hold the answer,
-- and that reading is often the more interesting one.
--
-- Volume: a few hundred rows a day, so ~70k a year. Small enough to leave raw and un-pruned; if it ever needs trimming, roll up into
-- daily counts per (username, path) and delete the raw rows behind it rather than dropping history outright.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS screen_view (
  id         serial      PRIMARY KEY,
  username   varchar     NOT NULL,          -- display_name, resolved server-side from the JWT (house rule: never sent by the client)
  path       varchar     NOT NULL,          -- NORMALISED route, no query string (see notes above)
  viewed_at  timestamptz NOT NULL DEFAULT now()
);

-- The two reads this table exists for: "what got opened, how often" (path) and "when was this last opened at all" (viewed_at).
-- Both want the same index, newest first.
CREATE INDEX IF NOT EXISTS idx_screen_view_path_at ON screen_view (path, viewed_at DESC);

-- "What has this person been using" — the per-person read. Confirmed in scope (owner, 2026-09-22, for training; see the note above on
-- what that does and does not license), so this index earns its place rather than sitting speculative.
CREATE INDEX IF NOT EXISTS idx_screen_view_user_at ON screen_view (username, viewed_at DESC);
