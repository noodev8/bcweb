-- =====================================================================================================================================
-- GOOGLE PRICE BENCHMARK — per-size history (owner, 2026-11-15; docs/shopify-cards/PLAN.md decision 5). Rules: utils/googleBenchmark.js.
-- =====================================================================================================================================
-- Google Merchant Center's price benchmark: the click-weighted average price other UK shops charge for the same product (GTIN match),
-- per Google offer = per SIZE for us. Google only ever gives TODAY's figure, so this keeps the past — for the Shopify price cards.
--
--   google_benchmark_history   CHANGE-ONLY: a size gets a row only on a day its benchmark differs from its previous row. A size's
--                              benchmark on a day = its latest row on or before that day. ONE ROW PER SIZE PER DAY (a second read the
--                              same day rewrites the day). benchmark NULL = Google stopped giving one from that day.
--                              Keyed by OUR code (skumap.code), matched from Google's offer id through skumap.googleid.
--                              12 MONTHS, trimmed by the nightly read (the row in force at the cut-off stays).
--   google_benchmark_run       one line per read DAY, so "nothing changed" and "no read" can be told apart.
-- =====================================================================================================================================

CREATE TABLE IF NOT EXISTS google_benchmark_history (
  code       text          NOT NULL,
  day        date          NOT NULL,
  benchmark  numeric(10,2),
  PRIMARY KEY (code, day)
);

CREATE TABLE IF NOT EXISTS google_benchmark_run (
  day      date        PRIMARY KEY,
  offers   integer     NOT NULL,   -- benchmarks Google gave
  sizes    integer     NOT NULL,   -- of those, matched to one of our sizes
  changed  integer     NOT NULL,   -- rows written (changes, incl. a benchmark that went away)
  read_at  timestamptz NOT NULL DEFAULT now()
);
