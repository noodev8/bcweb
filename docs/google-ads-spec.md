# Google Ads — campaign assignment module spec (v1)

**Status: BUILT 2026-09-05, uncommitted, not click-tested.** Two migrations (applied),
two utils, nine routes, the `/google-ads` screen and its dashboard tile. Server lint,
web tsc and `next build` all clean. `google_product_daily` holds 68,722 real rows
(1 Aug 2025 - 5 Sep 2026). The one thing not done is a human clicking it.

The bucket originally specced as `dropped` is named **`pause`** (owner, 2026-09-05).

**This document is authoritative** for how Brookfield assigns products to Google Ads
campaigns and how Ads performance data reaches the database. Where it disagrees with
anything in `C:\scripts\google-ads\`, `C:\scripts\scale\SCALE_PLAN.md` or an older
note, **this wins**. See §9 for the documents it supersedes and what to do with them.

---

## 0. The label chain — checked, and it works

The module writes `skusummary.googlecampaign`, which the nightly merchant feed ships
as Google's `custom_label_0`, which is what scopes a Shopping campaign. That chain is
the module's whole premise, so it was verified before specifying anything.

**It works.** Confirmed by the owner in the Google Ads UI, 2026-09-05: since the reset
to `standard`, the campaign is picking up `standard` for every product.

The first `bcweb_product_30` export (6 Aug – 4 Sep 2026, 5,855 rows, 226 styles) looks
alarming and is not:

| What Google Ads reported for that window | Styles |
|---|---|
| *(no label)* | 141 |
| `standard` | 62 |
| `birk-winner` — from an experiment that ended 13 May | 23 |

That is **pre-reset history**. Until recently the campaign did not filter on
`custom_label_0` at all — everything went in one campaign and the label was never
maintained, so items carried whatever they happened to be stamped with (or nothing).
The reset landed after that window closed.

The cohort split confirms it rather than contradicting it: all 62 `standard` styles
were created on or after 2026-04-29, and not one of the 23 `birk-winner` styles was
created in 2026. Labels were being set at first indexing and never revisited, because
nothing depended on them.

**Nothing here blocks the build.** Two things do survive from the investigation and are
carried into the design:

1. **A stale label is invisible until something looks for it.** Those 23 stranded
   `birk-winner` styles sat there for four months. §7.4's "Google says" column exists
   so that state is visible on the screen from day one.
2. **The first import will report a large label mismatch** (164 of 226 styles on the
   file above) and that is correct behaviour, not a fault. Once a post-reset window is
   imported it should fall to near zero — and if it ever climbs again, the feed has
   stopped landing and the screen will say so.

---

## 1. What v1 is

A **Google Ads** tile → one screen. Its job is to let the owner decide **which
products sit in which Google Ads campaign bucket**, with enough evidence on screen to
make that decision, and to get Google's own performance data into the database
without a scheduled job.

Three things happen on it:

1. **Assign.** Filter the range down (Inventory's Contains / Does-not-contain engine,
   verbatim), select rows, assign them to a campaign name. Writes
   `skusummary.googlecampaign`. Nothing else.
2. **See.** Per style: stock, sales, net profit, and — once a report is imported —
   Google spend, clicks, conversions, conversion value, and **profit after ad spend**.
   Per campaign: impression share, lost-to-budget, lost-to-rank.
3. **Import.** Upload either Google Ads report on the screen; preview what it will
   write; commit. No folder, no waiting for a cron job.

The actual campaigns are still built and managed in the Google Ads UI. This screen
decides membership and tells you whether the decision worked.

### Deliberately out of scope

- **Turning products off.** Owner's call: a `pause` campaign name does the job,
  is reversible, and keeps everything on one lever. The screen never writes
  `googlestatus` or `shopify`.
- **Staff delegation.** Two or three people, everyone knows who did what. Revisit when
  there are many campaigns and many staff. The assignment log (§4.3) is still built —
  see why there.
- **Bid, budget or tROAS management.** Those live in the Google Ads UI. This screen
  reports impression share and lost-IS so you know *what* to change there; it does not
  change it.
- **Fixing `skusummary.season`.** Known to be wrong (only 1 Birkenstock style is
  tagged `Winter`; all 12 Zermatts are `Any`). Separate job. This screen reuses
  Inventory's season behaviour as-is and improves for free when the tags are fixed.
- **`skusummary.troas` and `cmpbudget`.** Dead columns from an older per-style scheme
  (owner, 2026-09-05). Not read, not written, not shown.

---

## 2. The data

### 2.1 The field is `googlecampaign`, not `custom_label_0`

`merchant_feed.py:217-218`:

```python
"custom_label_0": row["googlecampaign"],
"custom_label_1": row["groupid"]
```

`skusummary.custom_label_0` is a **different, unused column**. It was written by a
now-defunct PowerBuilder screen (`'L1'`, and `'L4'` for Crocs — see
`docs/add-modify-save-powerbuilder.txt:301`) and read by nothing, ever.

**Marked in the database, 2026-09-05** (applied): all 291 rows set to
`'UNUSED-see-googlecampaign'`, and `COMMENT ON COLUMN` on both columns. The column
stays — dropping it gains nothing and PowerBuilder is being retired anyway.

That `custom_label_1 = groupid` line is quietly the most useful thing in the file: it
means Google's own reports come back keyed on our style id, with no matching to do.

### 2.2 `googlecampaign` is `varchar(20)` — enforce it in the UI

Twenty characters. `BIRK-SUMMER-CLEARANCE` is 21 and would be truncated or rejected.
Decision: **enforce 20 in the UI with a live counter**, do not widen the column —
20 is genuinely enough (`BIRK-SUM-HARVEST` = 16, `ZERMATT-WINTER` = 14) and widening
touches a column other PowerBuilder screens may still display.

A name that won't fit must be refused at the point of typing. Discovering the limit by
finding a truncated label in the Ads UI is exactly the failure this screen exists to
prevent.

### 2.3 Two reports, two grains, both needed

| | `bcweb_product_30` (new) | `adcost_summary_30` (exists) |
|---|---|---|
| Grain | Day × style × label × campaign | Day × campaign |
| Gives | spend, clicks, impressions, conversions, conv. value **per style** | **impression share, lost-IS (rank), lost-IS (budget)** |
| Why it can't be merged | — | impression share does not exist at product grain in Google Ads |

**`bcweb_product_30` — Report editor recipe**

- Rows: `Day`, `Custom label 1`, `Custom label 0`, `Campaign`
- Columns: `Impr.`, `Clicks`, `Cost`, `Conversions`, `Conv. value`
- Date range: Last 30 days (see §6.1 — the importer reads the window from the file)
- Do **not** add Item ID. It drops to size grain and multiplies rows ~7× for insight
  that does not affect a campaign assignment.

**`adcost_summary_30` — unchanged**, except: append `Conversions` and `Conv. value`
**at the end** of the column list. Appending at the end matters — the existing Python
reads by column position and will keep working untouched.

### 2.4 What the real product CSV taught us (parser facts)

From the live 6 Aug – 4 Sep export. Every one of these will silently corrupt an import
if missed.

1. **Three junk lines before the header.** Line 1 report name, line 2 quoted date
   range, line 3 headers. Same shape as `adcost_summary_30`.
2. **Google lowercases custom labels.** The file says `0043693-gizeh`; our groupid is
   `0043693-GIZEH`. **Join on `UPPER(custom_label_1) = skusummary.groupid`.** A
   case-sensitive join matches zero rows and looks like an empty report.
3. **`" --"` is Google's null**, with a leading space. Trim, then treat as NULL — not
   as a campaign named `--`.
4. **Column order differs from `adcost_summary_30`**: this file is `Impr.` then
   `Clicks`; the campaign file is `Clicks` then `Impr.`. **Parse by header name, never
   by position.** (The existing Python parses positionally. Ours will not.)
5. **`Currency code` sits between `Cost` and `Clicks`** and is always `GBP`. Ignore it,
   but do not assume it is absent.
6. **Google DOES keep true per-day label history — SETTLED 2026-09-05** by the
   13-month export (1 Aug 2025 – 5 Sep 2026, 68,730 rows). 222 of 399 styles carry more
   than one `Custom label 0` across the window, with clean date boundaries:

   ```
   1005299-GIZEH   C00          2025-08-01 -> 2026-04-13
                   (none)       2026-04-01 -> 2026-05-15
                   BIRK-WINNER  2026-04-29 -> 2026-09-05
                   STANDARD     2026-09-05 -> 2026-09-05
   ```

   Note the last line: `STANDARD` appears on 5 September only. That is the owner's reset
   propagating, visible in Google's own data — independent confirmation of §0.

   Five historical buckets nobody had recorded turn up this way: `C00` (30,417 rows, the
   dominant label until 17 Jul 2026), `RIEKER AW25`, `CX`, `BIRK-WINNER`, `IVES`.

7. **On the day a label changes, Google splits the day across BOTH labels.** Two rows,
   same day, same style, same campaign, each with its own share:

   ```
   2025-08-21  0034793-MILANO  (none)  impr 167  clicks 5  cost 1.11
   2025-08-21  0034793-MILANO  C00     impr   5  clicks 0  cost 0.00
   ```

   2,371 such collisions across 4,743 rows in the 13-month file. **The label is part of
   the grain**, which is why the primary key includes it (§4.1). The first key design
   did not, and the import aborted outright on the first real backfill — see
   `migrations/20260905b`.

   The assignment log (§4.3) is still built: Google records *what* the label was, never
   *who* changed it or *when they decided to*, and it is the only thing that covers the
   ~day between an assignment and the feed propagating.
7. **Size**: 5,855 data rows for 30 days, one campaign. Comfortable. A three-campaign
   split at 90 days would be ~50k rows — still fine.

### 2.5 Existing plumbing, unchanged

- `google_campaign_daily` — 159 rows, 3 Apr – 3 Sep 2026, 3 campaigns ever
  (`STANDARD`, `BIRK-WINNER`, `IVES`). Already upserts idempotently on
  `(snapshot_date, campaign)`.
- `google_stock_track` — daily stock/sales/ad snapshot. Written by
  `update_google_stock_track.py`. **We do not touch this table.**
- `C:\scripts\seo\weekly.py` reads `google_campaign_daily.clicks` for paid-vs-organic.
  Our writes are the same shape, so it is unaffected.

---

## 3. Findings that shape the design

These came out of the data while specifying, and they change what the screen should
show. They are recorded here because they are the *reasons* behind the layout in §7.

### 3.1 The account is not budget-constrained — so splitting won't buy volume

| Month | Campaign | Impr. share | Lost to rank | Lost to **budget** | Spend |
|---|---|---|---|---|---|
| May | STANDARD | 85.2% | 0.1% | 14.1% | £3,051 |
| May | IVES | 21.8% | 2.8% | **78.4%** | £45 |
| May | BIRK-WINNER | 50.7% | **40.2%** | 2.5% | £391 |
| Jun | STANDARD | 91.5% | 2.2% | 6.3% | £5,625 |
| Jul | STANDARD | 94.2% | 5.0% | 0.9% | £2,477 |
| **Aug** | **STANDARD** | **91.9%** | **8.1%** | **0.0%** | £4,082 |

August lost **0.0%** of impressions to budget. STANDARD is taking ~92% of what is
available and losing the rest to ad rank. **Moving budget between campaigns cannot buy
impressions that are already being won.**

What a split *does* buy is **separate tROAS control** — a high floor to harvest dying
summer stock, a low floor to buy Zermatt growth. That is the honest reason to split,
and it is a different reason from budget allocation.

It also explains why the earlier splits failed. IVES lost 78% of its impressions to
budget — starved, not bad. BIRK-WINNER lost 40% to rank — a bid/quality problem that a
small campaign made worse. Neither was a fair test. The "big bucket works better"
instinct was right, for reasons that are now visible and controllable.

**Design consequence:** impression share, lost-to-budget and lost-to-rank must be on
the campaign panel. They are the three numbers that say *why* a campaign is doing what
it is doing, and nothing at product grain substitutes for them.

### 3.2 Ad spend is ~89% of Shopify net profit — so the headline is profit, not ROAS

| Month | Spend | Shopify revenue | Shopify **net profit** | Revenue ROAS |
|---|---|---|---|---|
| Apr | £1,393 | £23,829 | £3,093 | 17.1× |
| May | £3,488 | £43,983 | £5,081 | 12.6× |
| Jun | £5,625 | £60,504 | £7,134 | 10.8× |
| Jul | £2,477 | £59,580 | £6,553 | 24.1× |
| **Aug** | **£4,082** | £36,747 | **£4,562** | 9.0× |

A tROAS floor of 400–650% is a **revenue** target. August cleared it at 9× while the
channel earned almost nothing after ad cost. (Blunt ratio — not all Shopify sales are
Google-attributed — but blunt in the direction that matters.)

**Design consequence:** the hero number is **profit after ad spend**, not ROAS. ROAS
is shown as a supporting figure because it is what the Ads UI bids on, not because it
is what the business earns.

### 3.3 95 live styles sold nothing in 90 days

95 of the 278 Google-live styles have had zero Shopify/CM3 sales in 90 days, with 307
units of stock behind them. They are drawing impressions now. That is the winter cut,
and it is the first job the screen should make easy: filter to it, select all, assign
`pause`.

### 3.4 Twenty styles are half the profit

20 styles = 47% of the last 90 days' Shopify net profit; 186 of 278 sold anything at
all. Whatever campaign structure gets chosen, it has to keep those 20 fed.

**Design consequence:** the grid sorts by net profit descending by default, so the
styles that carry the account are the first thing on screen.

---

## 4. Schema

Three new tables, two new columns. All additive; nothing existing is altered.

### 4.1 `google_product_daily` — the product report

```sql
CREATE TABLE google_product_daily (
  snapshot_date   date          NOT NULL,
  groupid         varchar(100)  NOT NULL,   -- UPPER(custom_label_1); may not exist in skusummary
  google_label    varchar(100),             -- custom_label_0 AS GOOGLE SAW IT; NULL for " --"
  campaign        varchar(255)  NOT NULL,   -- the Ads campaign name, not our bucket
  impressions     integer       NOT NULL DEFAULT 0,
  clicks          integer       NOT NULL DEFAULT 0,
  cost            numeric(12,2) NOT NULL DEFAULT 0,
  conversions     numeric(12,2),
  conv_value      numeric(12,2),
  imported_at     timestamptz   NOT NULL DEFAULT now(),
  imported_by     varchar(100),
  PRIMARY KEY (snapshot_date, groupid, campaign)
);
CREATE INDEX google_product_daily_groupid_idx ON google_product_daily (groupid, snapshot_date);
```

- `groupid` is **not** a foreign key. A style deleted from `skusummary` still has
  history here, and a Google row we cannot match must still be stored so the import
  reconciliation can report it rather than silently dropping it (the lesson from
  `utils/amzImport.js`). **115 of the 399 styles** in the 13-month backfill are no
  longer in `skusummary` — over a year that is normal, not a fault.
- `google_label` records **what Google thought the bucket was**. Kept separate from our
  `googlecampaign` on purpose — the gap between the two is the §0 diagnostic, and
  collapsing them into one column would hide it.
- **PK INCLUDES `google_label`, and the column is `NOT NULL DEFAULT ''`** (`''` = Google
  reported no label). Corrected by `migrations/20260905b` after the original three-column
  key aborted the first real backfill: see §2.4.7 — Google splits a label-change day
  across both labels, so the label is part of the grain. A NULL cannot be used because
  NULLs never compare equal in a key and unlabelled rows would insert endlessly.

### 4.2 `google_campaign` — the controlled name list

```sql
CREATE TABLE google_campaign (
  name        varchar(20)  PRIMARY KEY,     -- matches skusummary.googlecampaign width
  notes       text,
  archived    boolean      NOT NULL DEFAULT false,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  varchar(100)
);
INSERT INTO google_campaign (name, notes, created_by) VALUES
  ('standard', 'The default bucket. Everything starts here.', 'system'),
  ('pause',  'Excluded from Google Ads. Replaces switching googlestatus off.', 'system');
```

Names are created deliberately, not by typing. A typo (`Zermat`) would sit in the
feed forever, match nothing in the Ads UI, and never announce itself.

`archived` rather than delete: a campaign that once held products still appears in
`google_product_daily` history and in the assignment log, and a hard delete would
orphan both. Archiving hides it from the assign picker and nothing else.

### 4.3 `google_campaign_assignment_log` — who moved what, when

```sql
CREATE TABLE google_campaign_assignment_log (
  id            serial       PRIMARY KEY,
  groupid       varchar(100) NOT NULL,
  from_campaign varchar(20),
  to_campaign   varchar(20)  NOT NULL,
  changed_by    varchar(100) NOT NULL,      -- resolved server-side from the JWT
  changed_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX google_campaign_assignment_log_groupid_idx
  ON google_campaign_assignment_log (groupid, changed_at DESC);
```

**Built despite staff delegation being out of scope**, because §2.4 finding 6 makes it
load-bearing: Google reports one current label across a whole window, so it cannot tell
us what a product's bucket was in October when we ask in March. Without this table,
moving a style silently re-attributes all its history to its new campaign and
"was the split better than the bucket?" becomes unanswerable. It cannot be backfilled
later. It is one small table and no UI beyond a history line on the drill.

### 4.3b Growth and retention — no prune, deliberately

Measured on the real 13-month backfill (owner asked, 2026-09-05):

| | |
|---|---|
| 68,722 rows for 401 days | **~171 rows/day, ~62k rows/year** |
| On disk | **16 MB total** (6.8 MB heap + 9.2 MB indexes) for the whole 13 months |
| Projected | **~15 MB/year**. Ten years ≈ 150 MB. |

**There is no cleanup routine and there should not be one.** At 15 MB/year this never
becomes a size problem, and pruning would destroy the one thing the table exists for:
year-on-year comparison. Deleting last winter is exactly what makes "is the Zermatt
pivot working?" unanswerable next February.

It is also **not recoverable** — Google Ads' own retention will drop the old windows
eventually, and once it has, a pruned row is gone for good. Contrast `clean_sales.py`,
which prunes `sales` past 900 days: that table takes thousands of rows a week and its
old rows are reconstructible from order history. Neither is true here.

What the screen does instead is make the size *visible* — `/google-ads-import-last`
already reports row count and date range, so if it ever does grow strangely (a campaign
split multiplying rows per style-day, say) it is on screen rather than discovered in a
disk alert. Revisit if it ever passes ~5M rows; on current numbers that is 2100.

### 4.4 Two columns on `google_campaign_daily`

```sql
ALTER TABLE google_campaign_daily
  ADD COLUMN conversions numeric(12,2),
  ADD COLUMN conv_value  numeric(12,2);
```

Nullable, so every existing row stays valid and the current Python keeps working.

---

## 5. Routes

House rules apply throughout: HTTP 200 + `return_code`, one route file per endpoint,
structured header block, `withTransaction` on every write, `changed_by` resolved
server-side from the JWT.

| Route | Method | Does |
|---|---|---|
| `google-ads-styles` | GET | The whole payload — every Google-live style with its campaign, stock, sales, profit and (if imported) ad metrics. One call, ~278 rows, client filters. |
| `google-ads-campaigns` | GET | Campaign list with member counts, stock, sales, profit, spend, impression share and lost-IS for the chosen window. |
| `google-ads-assign` | POST | Set `googlecampaign` on 1..n styles. Writes the assignment log in the same transaction. |
| `google-ads-campaign-create` | POST | Add a name to `google_campaign`. Validates ≤20 chars, uniqueness, charset. |
| `google-ads-campaign-update` | POST | Rename (rewrites members + log) or archive. |
| `google-ads-drill` | GET | One style: assignment history, daily spend/clicks/conversions, price and sales timeline. |
| `google-ads-import-preview` | POST | multipart. Fingerprint by header, parse, return exactly what a commit would write. **Writes nothing.** |
| `google-ads-import-commit` | POST | multipart. Re-derives the plan inside its transaction and executes it. |
| `google-ads-import-last` | GET | When each report was last imported and through what date. Drives the staleness banner. |

Preview and commit **share one plan builder** (`utils/googleAdsImport.js`), the same
way `utils/amzImport.js` is shared. Two implementations would drift and the operator
would approve one thing and get another.

---

## 6. The importer

### 6.1 The file defines the window — never assume 30 days

The importer reads the distinct `Day` values out of the file and works on those. Change
the saved report to Last 7, Last 90 or a custom range and it just imports what is
there. This is what "run it whenever I want" actually requires, and it is the reason
the grain is daily rather than a 30-day total.

**The 30-day window is a recovery limit, and it has already cost us data.**
`google_campaign_daily` has exactly one hole: **12 July – 2 August 2026, 22 days
missing.** Imports are sporadic (owner — done when the account is being looked at, not
on a routine), and the gap is the fingerprint of that: a run around 11 July, then
nothing until ~1 September, whose Last-30-days window could only reach back to 3 August.
The 22 days in between fell off the back of the window and were never collected.

Two consequences, both operational rather than architectural:

- **The screen must show how far back the data goes and where the holes are**, not just
  the last import date. A silent gap reads as a quiet month, which in August would have
  read as a seasonal slowdown rather than a missing import.
- **Holes are recoverable.** Google Ads still holds the data; only our copy is missing.
  A custom-range export over the gap dates, imported like any other file, fills it. The
  importer must therefore never assume the file is recent or contiguous.

### 6.2 Upsert, don't replace

`ON CONFLICT (snapshot_date, groupid, campaign) DO UPDATE`. Re-import the same window
ten times and nothing duplicates.

This matters more than it sounds: **Google revises conversions upward for weeks after
the click.** A day imported today and re-imported next week will legitimately show more
conversions the second time, and we want the later figure. Upsert always takes the
newer number.

Why not delete-then-insert per day: a report accidentally filtered to one campaign
would wipe every other campaign's rows for those days. Upsert cannot lose data it was
not shown. The trade is that a row Google later drops entirely stays behind — which is
correct anyway, since Google omits zero-impression rows and absence never means zero.

### 6.3 The last two days are provisional

Impression share and conversions lag 2–3 days (noted in
`update_google_stock_track.py`'s own header). The screen marks the two most recent days
rather than letting a half-reported day look like a collapse.

### 6.4 Every row is accounted for

Same discipline as the Amazon import: `rows in file = written + unchanged + skipped`,
with a reason on every skip. The reasons that will actually occur:

| Reason | Meaning |
|---|---|
| `NO_MATCHING_STYLE` | `UPPER(custom_label_1)` is not in `skusummary`. Stored anyway; reported. |
| `NO_LABEL` | `custom_label_0` was `" --"`. Row is fine; `google_label` is NULL. |
| `LABEL_MISMATCH` | Google's label ≠ our `googlecampaign`. **Not an error** — it is the §0 signal. Counted and surfaced, never suppressed. |
| `BAD_DATE` / `BAD_NUMBER` | Unparseable. Reported with the raw row. |

On the current file, `LABEL_MISMATCH` would fire on 164 of 226 styles. The preview
saying so out loud, on the first import, is the whole point.

### 6.5 Column-drift guard

Match headers by **name**, case- and whitespace-insensitive. Required columns missing →
reject the file by name with the reason. Unrecognised extra columns → accept, list them
in the preview. A report is a thing a human edits in a UI; it will drift.

### 6.6 `update_google_stock_track.py` — KEEP IT. Remove only its CSV half.

**Do not delete this script or its cron entry.** It does two unrelated jobs and only
one of them is being replaced.

**Job 1 — the nightly stock snapshot. Irreplaceable, keep.**
One row a day in `google_stock_track`: live stock units and value, total stock,
Shopify sales, Birkenstock ad-readiness. **325 rows, 13 Oct 2025 → 3 Sep 2026, no gaps
in the last 30 days.** It has nothing to do with the CSV, runs on the VPS at 2:45am,
and is the only record of what stock was held on a given day. It cannot be rebuilt
retrospectively — miss a day and that day is gone forever. Deleting the cron entry
would silently end an eleven-month series.

**Job 2 — the CSV ad import. This is what bcweb takes over.**
Reads `adcost_summary_30.csv`, upserts `google_campaign_daily`, and sums the result
into `google_stock_track`'s ad columns.

**And it is still running.** The owner believed this had been abandoned; the log says
otherwise:

```
2026-09-05 10:22:19 BST  Found CSV in Downloads: C:\Users\UserPC\Downloads\adcost_summary_30.csv
2026-09-05 10:22:19 BST  Moved to: C:\scripts\google-ads\adcost_summary_30.csv
2026-09-05 10:22:20 BST  Upserted 30 per-campaign rows into google_campaign_daily
2026-09-05 10:22:21 BST  Deleted processed CSV
```

The script **sweeps `~/Downloads` on every run**, moves any `adcost_summary_30.csv` it
finds into its own folder, imports it, and deletes it. That is why
`google_campaign_daily` is current to 3 Sep despite nobody consciously feeding it, and
why the file was not in Downloads when this spec's author looked three hours later.

**⚠ That sweep collides with the new upload panel.** A file downloaded ready to upload
through bcweb can be moved and deleted out from under the operator before they get to
it. The sweep must be removed as part of this change, not left as a race.

**The change, in full:**

1. Delete the Downloads sweep, the file read, and the delete-after-import.
2. Change `aggregate_by_date()` to read its per-date totals **from
   `google_campaign_daily`** instead of from parsed CSV rows. It already sums
   per-campaign rows by date; it just sums them from the table now.
3. Leave job 1 and the 2:45am cron entry completely alone.

**Result:** bcweb owns getting ad data in. The Python owns the daily rollup and the
stock snapshot. One writer each, no duplicated logic, no file sweeping, and no
eleven-month series quietly ending. This is a deliberate contrast with the
`update_orders.py` situation in `CLAUDE.md`, where the same logic genuinely does live
in two places.

**Open question for the owner (§9):** nothing in bcweb reads `google_stock_track`.
Its only consumers are `scale/SCALE_PLAN.md` as a documented source and
`seo/weekly.py` (which reads `google_campaign_daily`, not this). Worth confirming it is
still wanted before another year accumulates — but the answer is "keep collecting"
unless the owner says otherwise, because the cost is nil and the data cannot be
recovered later.

---

## 7. The screen

`/google-ads`, tile in the **Reports & marketing** band on the dashboard.

One payload, ~278 styles, all filtering and sorting client-side — same as Inventory and
Birkenstock, no round-trips. SWR via `useApiQuery`, never a `useEffect`.

### 7.1 Account strip (top)

Chosen window (7 / 30 / 90 days), then: **profit after ad spend** as the hero number,
with spend, Shopify revenue, Shopify net profit, clicks and conversion value demoted
around it. Per `docs`-recorded house preference, one tracked metric is the visual hero
and the rest is supporting detail.

Plus a **freshness line**: "Product data to 4 Sep · imported 5 Sep · 1 day old." If it
is more than a week old it says so loudly, because every number below it is then stale.

### 7.2 Campaign panel

One row per campaign in `google_campaign`, plus any label Google reports that we do not
have a name for (which is itself a finding).

Per campaign: styles, stock units, 30d units / revenue / net profit, spend, **profit
after spend**, and — from `google_campaign_daily` — **impression share, lost to budget,
lost to rank**. Those last three are the §3.1 story and they belong here, not buried.

Actions: create a name, rename, archive.

### 7.3 Filter bar

Inventory's engine, verbatim: **Contains** / **Does not contain**, stacked ordered
steps with a breadcrumb, each removable. Typed commands in the Contains box
(`SOLD LESS 5`, `STOCK MORE 10`), `SUMMER` / `WINTER` behaving exactly as they do on
Inventory — including the known blind spot where `RIEKER-WIN` / `REMONTE-WIN` are
caught by segment name rather than the `season` column.

Standing chips beside it, each clearable on its own: **Campaign**, **Brand**,
**Has spend / No spend**.

Reusing the engine is not laziness — it is the point. The owner already has the muscle
memory, and a second dialect of the same idea would be worse than either.

### 7.4 The grid

Birkenstock's table: sticky headings, scrolls inside its own box, sortable columns,
default sort **net profit descending** (§3.4).

| Group | Columns |
|---|---|
| Identity | Groupid · Title · Segment |
| Assignment | **Campaign** · *pending* marker · **Google says** (`google_label`, only when it differs) |
| Ours | Stock · Sold 30 · Sold 365 · Revenue · Net profit · Profit/unit |
| Google's | Impressions · Clicks · Spend · Conversions · Conv. value |
| The answer | **Profit after spend** |

**The two assignment columns are the reconciliation panel.** "Campaign" is what we
say; "Google says" is what Google last reported. When they disagree the row is marked.
Had this existed in May, the 23 stranded `birk-winner` styles would have shown up the
week it happened rather than four months later.

**The *pending* marker** is honest about the lag. An assignment made now reaches
Google via the 3:30am feed, an SFTP upload, and a Google recrawl — tomorrow at the
earliest. The screen says "pending" until an import comes back agreeing.

### 7.5 Bulk assign

The existing `BulkActionBar`. Select rows → **Assign to campaign** → pick an existing
name or create one (≤20 chars, live counter). One transactional write per batch plus
the log rows; no per-row loop, because unlike a price apply there is no external push
to fire per item.

### 7.6 Import panel

Collapsed by default. Drop either report on it; it fingerprints by header and routes
it. Preview shows the §6.4 arithmetic and the label-mismatch count. Commit writes.

### 7.7 Drill

Click a style: assignment history from the log, daily spend / clicks / conversions,
price and sales timeline. Enough to answer "did moving this style change anything?"

---

## 7.8 What the owner actually has to do

The whole operating routine, once built:

**When you want to work the screen** — download both saved reports from the Google Ads
Report editor, drop them on the import panel, commit. Then use the screen. That is it.
No folder, no schedule, no cron.

**The one rule:** if it has been more than 30 days since the last import, widen the
report's date range to cover the gap before downloading. Otherwise the missed days fall
off the back of the window and are lost — which is exactly how 12 July – 2 August went
missing (§6.1).

**Two one-off jobs at build time**, both worth doing and both recoverable only until
someone forgets:

1. **Fill the campaign gap.** A custom-range `adcost_summary_30` export for
   12 July – 2 August 2026. This can be done *today*, before anything is built — the
   existing Python upserts by the dates in the file, so dropping that export in
   `~/Downloads` and running the script fills both `google_campaign_daily` and
   `google_stock_track`'s ad columns for those days.
2. **Seed product history.** `bcweb_product_30` currently exists only as a 30-day
   export. Google Ads holds far more. A one-off run over the last **12 months** at
   build time (~70k rows, well within limits) gives the screen a full year of per-style
   ad economics on day one — including **last winter**, which is precisely the
   comparison the winter pivot needs and which cannot be obtained later if the retention
   window closes.

---

## 8. Automation — the honest phasing

The owner asked whether the upload can be automated away. It can, but not in v1.

**Phase 1 (this spec).** Manual download from the Report editor, upload on the screen.
Immediate, no external approvals, and the parser is written as a pure function over
parsed rows — deliberately, so phase 2 is a swap and not a rewrite.

**Phase 2 (later).** Google Ads API pull on a cron sweep, no upload at all. Shape:
`scripts/google-ads-sweep.js`, same pattern as `scripts/google-price-sweep.js`.

What phase 2 requires, so it is not a surprise:

- A **developer token**, applied for through a Google Ads Manager (MCC) account. Basic
  access is usually granted in a few days but it is an application, not a setting.
- An **OAuth2 client and refresh token**. The existing `merchant-feed-api` service
  account **cannot be reused** — the Google Ads API rejects service accounts without
  Workspace domain-wide delegation, and `brookfieldcomfort@gmail.com` is a consumer
  account. This needs the installed-app OAuth flow, like `drive_token.json`.
- A new `.env` var set on the VPS **by hand** — the deploy rsync excludes `.env`.

Not hard, but it is a week of waiting on Google that should not hold up a screen that
is useful the day it ships.

---

## 9. Documents this supersedes

The owner's instruction: nothing older should be left to confuse or duplicate this.

| Document | Action |
|---|---|
| `C:\scripts\google-ads\how-to-run.md` | **Superseded.** Its two-step "download to a folder, run the script" process is replaced by the upload panel. Replace its body with a pointer to this spec, keeping only the `adcost_summary_30` report definition. |
| `C:\scripts\google-ads\update_google_stock_track.py` (header) | **Amend** when §6.6 lands: it no longer reads the CSV, it reads `google_campaign_daily`. The header currently describes the CSV path in detail and would become actively misleading. |
| `C:\scripts\INDEX.md` line 28 | **Amend** — the `google-ads/` row's description and entry point change. |
| `C:\scripts\scale\SCALE_PLAN.md` line 139 | **Flag, do not silently overwrite.** It sets a "Google Ads ROAS 10× → 7×" target. That is a *revenue* ROAS; §3.2 shows August cleared 9× while earning almost nothing after ad cost. Add a line pointing here and noting the measure is being reconsidered — this spec does not have the authority to reset a business target on its own. |
| `C:\bcweb\CLAUDE.md` | **Add** — the module, the `googlecampaign` vs `custom_label_0` landmine, the `varchar(20)` limit, and the lowercase-join landmine. |
| `docs/add-modify-save-powerbuilder.txt` | **Leave.** It is a historical record of what PowerBuilder did, not guidance. The `custom_label_0` comment in the database now says it is dead. |

---

## 10. Build order

Each step leaves the tree working.

1. **Migration** — three tables, two columns (§4). Applied by the owner in pgAdmin.
2. **`utils/googleAdsImport.js`** — parse and plan both report shapes, all of §2.4's
   traps, no DB writes. This is where the risk is; it goes first.
3. **Import routes** — preview, commit, last. Testable against the real CSV before any
   UI exists.
4. **Read routes** — styles, campaigns, drill.
5. **Write routes** — assign, campaign create/update.
6. **The screen** — strip, campaign panel, filter bar, grid, bulk bar, import panel,
   drill.
7. **`update_google_stock_track.py`** — §6.6: strip the Downloads sweep and the CSV
   read, source the rollup from `google_campaign_daily`. The stock snapshot and its
   cron entry stay.
8. **Docs** — §9.

Steps 1–4 are useful on their own: once the import works, the data is in the database
and queryable even without a screen.

---

## 11. Honest risks

1. **Stale labels are silent.** The chain works (§0), but 23 styles sat on a dead
   `birk-winner` label for four months and nothing announced it. The "Google says"
   column and the import's mismatch count are the guard; they must not be trimmed as
   clutter later.
2. ~~Google's product report may give no label history~~ — **resolved 2026-09-05**: it
   does (§2.4.6), and 13 months of it are loaded. The assignment log still earns its
   place for *who* and *when*, which Google never records.
3. **The one-day propagation lag is real** and will feel like the screen is broken the
   first time. Hence the *pending* marker; it must not be dropped as clutter.
4. **`google_campaign_daily` gains a second writer.** Much safer than the
   `update_orders.py` case — identical source, idempotent upsert, no derived state, and
   §6.6 removes the Python's CSV path entirely so only one route into the table
   remains. But it is worth stating plainly rather than discovering.
5. **Conversion value is Google's attribution, not ours.** It will not tie to
   `sales.profit` and should never be presented as if it does. Both are shown; the
   profit column is ours and the ROAS column is Google's.
6. **`skusummary.season` is wrong** and this screen reuses Inventory's imperfect
   handling of it. Known, accepted, fixed elsewhere.
