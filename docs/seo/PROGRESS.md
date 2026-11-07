# SEO Experiments — Progress Tracking

**2026-11-07 — the size-6 read is done: it WORKED on position** (5 → 1 on the question
searches, ~4 weeks after the 08-11 rewrite, held since; clicks short of target). Full
outcome in `CHANGELOG.md`. No experiment is live now. Track any new one with
`node scripts/seo/page-history.js --page <url> --compare <control>` — the weekly
table below is what that script prints.

---

*Everything below is the 2026-07 / 08 record, kept as history.*

Three experiments launched 2026-07-17. **Status at 2026-08-11 (data to 2026-08-08):
Arizona failed, Madrid failed, size-6 blog works.** Arizona and Madrid are closed
and the whole area is deprioritised by the owner — outcomes are written up in
`CHANGELOG.md` and the standing conclusion is in README, "The real problem —
collections stopped doing their job". Do not open new collection experiments until
this is picked back up.

**Size-6 fold-back call (was due 2026-08-14) is POSTPONED to 2026-09-08.** The
content was rewritten and republished 2026-08-11 (~72 words → 490, real answer,
conversion table, one H1; size guide contradiction fixed and now links to it).
The original test ran on a stub and proved nothing either way, so there is nothing
to fold back *from* yet. **Do not read the result before 2026-09-08** — this
experiment has already been misread twice by reading early.

Track with the commands below.

## Quick Check (run weekly — copy & paste these commands)

```bash
# Arizona: keyword cluster + collection page
node scripts/seo/queries.js --contains arizona | grep "^\"arizona\""
node scripts/seo/queries.js --page /collections/birkenstock-arizona | head -2

# Madrid: keyword cluster + collection page
node scripts/seo/queries.js --contains madrid | grep "^\"madrid\""
node scripts/seo/queries.js --page /collections/birkenstock-madrid | head -2

# Size Guide: overall page + specific size-6 term
node scripts/seo/queries.js --page /pages/birkenstock-size-guide | head -2
node scripts/seo/queries.js --query "why don't birkenstock do size 6" | grep "size-guide"
```

**For Size Guide size-6 section:** Run the second command, look for the size-guide row and copy clicks/position.

## Tracking Table

**For each experiment, run TWO queries and log BOTH:**
1. The keyword cluster (e.g., `--contains arizona`)
2. The collection page itself (e.g., `--page /collections/birkenstock-arizona`)

### Arizona Collection
**Baseline (before change):** Collection rank 4, **5 impr/28d**  
**What:** Linked to menu + Sandals. Watch for impressions to consolidate FROM scattered products TO the collection.

| Date | Keyword "arizona" (cluster) | /collections/arizona (page itself) | Direction |
|---|---|---|---|
| 2026-07-27 | 13 clicks, 2,457 impr | 0 clicks, 1 impr | ❌ Collection lost ground (5→1) |
| 2026-07-30 | 13 clicks, 2,457 impr | 0 clicks, 1 impr | ❌ Still flat |
| 2026-08-08 | 13 clicks, 2,457 impr | 0 clicks, 2 impr | ❌ **CLOSED — failed.** Cluster identical 3 checks running. `arizona birkenstock` pos 4.0 / 549 impr / 0 clicks; the product page `arizona-synthetic-sand` takes it instead at 40.91% CTR, pos 2.1 |

### Madrid Collection
**Baseline (before change):** "Crawled, not indexed" in Shopify URL Inspection  
**What:** Same linking as Arizona. Watch for crawl-status flip + position improvement.

| Date | Keyword "madrid" (cluster) | /collections/madrid (page) | Direction |
|---|---|---|---|
| 2026-07-27 | 6 clicks, 733 impr | 0 clicks, 16 impr | ⚠️ Keyword cluster has clicks; page buried |
| 2026-07-30 | 6 clicks, 733 impr | 0 clicks, 16 impr | ⚠️ No movement |
| 2026-08-08 | 5 clicks, 620 impr | 0 clicks, 34 impr | ❌ **CLOSED — Gate 1 passed, Gate 2 failed.** Page now served (16→34 impr) but still 0 clicks, and the cluster *shrank*. `birkenstock women's madrid` pos 3.2 / 135 impr / 0 clicks |

### Size Guide — Size-6 Content
**Baseline (before change):** Size guide ranks top-7 on size-6 queries; content mentions it but title doesn't match.  
**What:** Added size-6 specific content to /pages/birkenstock-size-guide on 2026-07-17. Watch CTR on size-6 queries cluster.

| Date | /pages/birkenstock-size-guide overall | Size-6 queries only (CTR trend) | Direction |
|---|---|---|---|
| 2026-07-27 | 26 clicks, 7,602 impr (0.34% CTR) | ~6 clicks on size-6 queries, pos 5-11 | ✅ Size-6 content helping? |
| 2026-07-30 | — | — | — |
| 2026-08-08 | 72 clicks, 19,908 impr (0.36% CTR), pos 11.8 | Blog now a top-15 site page: 10 clicks, 1,008 impr, pos 5.4. Cluster 9 clicks, 1,088 impr | ✅ Working — ⚠️ but fold-back question open |

**Size-6 detail, 2026-08-08.** The blog is earning from a standing start, but the
kill criterion is **not** met — on the top phrasing the size guide has retaken it:

| `why don't birkenstock do size 6` | clicks | impr | pos |
|---|---|---|---|
| /pages/birkenstock-size-guide | 1 | 102 | **5.1** |
| /blogs/…-uk-size-6-brookfield-comfort | 0 | 73 | **5.9** |

**Daily trend, blog only (2026-07-18 first day live → 2026-08-08).** Impressions
held flat at ~50/day for three weeks — the page is being served consistently. But
**position is drifting the wrong way** and clicks are thinning with it:

| Week live | avg impr/day | clicks | avg pos |
|---|---|---|---|
| 1 (07-18→07-24) | 46 | 5 | **4.9** |
| 2 (07-25→07-31) | 48 | 3 | **4.8** |
| 3 (08-01→08-06) | 58 | 2 | **6.4** |

10 clicks in 22 days live ≈ **12.7 clicks/28d run-rate, against a 30–45 target**,
and down from the ~19 run-rate at the day-10 interim. Impressions are *rising*
while position falls, so this is not a demand problem — it is slipping down the
page. (Ignore 08-07/08-08, 1–2 impr: GSC's last days are incomplete, not a cliff.)

**⚠️ Everything above is the STUB's performance (07-18 → 08-08).** Content
rewritten 2026-08-11 — treat 2026-08-11 as a new baseline and do not compare
post-rewrite numbers to the interim run-rates. Next read **2026-09-08**, on
**position** first.

At the day-10 interim the blog led 3.7 vs 5.7; it has since slipped behind. Both
pages still surface on the same queries, so they are **splitting the cluster, not
replacing it** — which is the condition the CHANGELOG says triggers folding the
content back into the size guide and retiring the blog. Call due **2026-08-14**.

## Decision Rule

- **Arizona/Madrid:** If clicks flat for 3+ weeks after Gate 1 (indexing) succeeds, pause.
  → *Both triggered 2026-08-08 and are closed.*
- **Size-6:** If page doesn't appear by week 2 (by ~Aug 14), check indexing status in GSC.
  → *It appeared immediately; the open question is fold-back, not indexing.*
