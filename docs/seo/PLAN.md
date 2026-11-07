# SEO — the plan (how we operate)

The operating doc. Read this to know **what we do and what to work on next**.
`README.md` is the background reference (the goal, the scoreboard, what we know,
what's ruled out). `CHANGELOG.md` logs every change + expectation + outcome. The
current work lists are the auto-generated `collection-priorities.md` /
`product-priorities.md`.

## The goal, in one line

More **free** clicks from Google, so we lean less on paid. It's free, it compounds,
and it doesn't stop when you stop paying. (Full philosophy: README.)

## The framework — the grid

Every opportunity is a **page type × a search intent**. The wins are on the diagonal:

| | Browse intent ("birkenstock milano") | Product intent ("milano dark brown") |
|---|---|---|
| **Collection** | ✅ **traffic play** — build/rank the collection | — mismatch |
| **Product page** | ❌ **the Bend mirage** — don't | ✅ **value play** — improve the product page |

**Match the page to the intent.** Browse demand → a collection. Product demand → a
product page. The classic mistake is aiming a product page at browse demand (the
Bend: 728 impressions of "birkenstock trainers", zero sales).

## Two lists (they rank differently on purpose)

Collections are **traffic-constrained** (lots of browse search — are we capturing
it?). Products are **value-constrained** (product search is uniformly low — so a
page built once earns for years, and we build them for the products worth it).

| | Collections | Products |
|---|---|---|
| Script | `collection-priorities.js` | `product-priorities.js` |
| Output file | `collection-priorities.md` | `product-priorities.md` |
| Ranked by | browse **demand** not captured | **value** (proven organic £, then units×margin) |
| Scope | all collections | Birkenstock only (Shopify-win; parked brands excluded) |

**You decide what's worth working** — the list ranks demand/value, it does not judge
a collection out (e.g. high-traffic low-margin Goor stays on it; that's your call).

**Review cooldown** — mark something worked or dismissed and it drops off for a period:
```
node scripts/seo/collection-priorities.js --review <handle> --days 90 --note "why"
node scripts/seo/product-priorities.js    --review <handle> --days 90 --note "why"
```
`--all` shows snoozed rows. State lives in `collections-reviews.json` / `products-reviews.json` (in the repo, so it
syncs across both machines).

## The two recipes (what "the work" actually is)

**Collection work** (browse demand → capture it):
1. If no page exists, build it. If it exists but is stuck ("crawled – not indexed"),
   the fix is discovery, not content.
2. Link it from the **menu + parent collection + a high-authority page** (the size
   guide is the most-linked page on the site).
3. Title + description match the browse terms — find them with
   `node scripts/seo/queries.js --page /collections/<handle>`, or size a specific term with
   `--query "<term>"` / `--contains <word>`.
4. Request re-indexing in GSC (URL Inspection → Request Indexing).

**Product work** (product demand → capture + convert):
1. **Find the terms:** `node scripts/seo/queries.js --page /products/<handle>` — it lists
   every term the page already ranks for, with impressions and position. Target the
   ones with real impressions but a **poor position (page 2)**. The top query also
   shows the *language people actually use* (e.g. "two strap", not "Arizona"). Note:
   GSC only shows terms you already appear for — greenfield keywords are the parked
   Keyword Planner job.
2. Weave those terms into the **description** — natural copy, not stuffing. Keep the
   **title clean** (it's what shoppers see; the ranking lever is content + links, not
   a stuffed title).
3. Link to it from its **own collection** (highest-authority, most relevant link),
   then related-product blocks.
4. Log it + measure against an untouched **control** (sandals are seasonal — a
   control separates your work from July).

## How to run it (the loop)

1. **Monthly:** run both reports, open the two `.md` lists.
2. **Weekly hour:** take the top *unreviewed* row (alternate collection / product so
   products aren't starved by bigger collection numbers), do the recipe, mark it reviewed.
3. **Log** each in `CHANGELOG.md` with the expected result *before* you know it.
4. **Read the result at 4–8 weeks** vs the control:
   `node scripts/seo/page-history.js --page <url> --compare <control url>`.

## What we measure (the scoreboard)

- **Monthly:** trailing-12 organic clicks (`weekly.js`) + organic revenue (`organic-pages.js --channels`).
- **Per changed page:** impressions → position → clicks, in that order (that's the
  order they move; a new page shows impressions weeks before clicks).
- **Two scoreboards, never merged:** SEO = free clicks; the business = the P&L. Free
  clicks don't have to prove ROI — that's a paid problem.

## Hygiene — thin collections

Empty or near-empty collections are bad pages regardless of clicks: thin content,
they look broken, and they waste crawl budget. `collections.js --thin` finds the
delete candidates, sorted fewest-products-first.

    node scripts/seo/collections.js --thin           # all, thinnest first
    node scripts/seo/collections.js --thin --max 3   # only those with <= 3 products

Two flags exist so we don't delete something worth keeping: SMART collections can
be empty now and refill seasonally (an empty MANUAL collection is the real dead
page), and `seo` marks a page where a custom SEO title was set. Deleting still
needs the link check and a 301 — this only finds candidates.

## Where we are (2026-11-07) — the next plan, being agreed

SEO was picked back up on 2026-11-07 and moved into bcweb. **Nothing below is decided
yet** — it is the starting point for the plan, one decision at a time.

**What we learned that we can repeat.** The size-6 blog went from ~5 to #1 in ~4 weeks
after the 2026-08-11 rewrite (CHANGELOG). What changed: (1) it answered the searcher's
exact question in their words, straight away; (2) it gave facts no one else has (EU
lasts, 250 / 260mm, the conversion table, "most of our size 6 customers go for the
39"); (3) it covered the neighbouring searches it already appeared for; (4) one H1 and a
new meta description; (5) one internal link from a page Google trusts (the size guide).
In short: **a clear, complete, specific answer in the buyer's words, linked from a
trusted page.** All five changed at once, so which one did it is unknown; and it was an
uncontested question — sales searches are contested by birkenstock.com, Schuh and the
Shopping grid.

**The owner's aim:** apply that to pages that SELL — collections or product pages —
and pick the best approach first, because each change costs effort and time.

**Proposal on the table (not decided):** product pages, written once per STYLE.
- Google already sends Birkenstock style searches to product pages (Arizona, 2026-08).
- Products convert better (GA4: £2.59 vs £2.14 a session, 90d to Nov; was £3.20 vs £1.81
  in July).
- The product description also feeds the Google Merchant feed and eBay (the approved
  `shopify_description`, `/descriptions-review`), so the work pays three ways.
- One strong block per style (fit, narrow vs regular, sizing incl. size 6, materials,
  footbed, care, our own lines) + one line per colour; ~8–10 styles cover most of the range.
- Trial one style (Madrid suggested: pages at 6–10 with real demand), untouched styles as
  the control, judged on POSITION (season-light) with `page-history.js --compare`, read at
  4–8 weeks.
- Against it: product pages each get little search (10–200 impressions / 28d), so the
  win is the total, not one page.

**The screen (2026-11-07):** bcweb **SEO work list** (`/seo`, dashboard → Google) — one
row per Birkenstock style (owner's pick): pages, description words, Google searches /
clicks / position (28d), 12-month profit; click a style for its pages and searches.

**Answered 2026-11-07 — the descriptions ARE mostly Birkenstock's own copy.** 165 live
Birkenstock pages, median 87 words (max 146, none 150+), of which the delivery line,
"Width Options" and "Stock Code" take a chunk — often 40–60 words about the shoe. The
core paragraph is Birkenstock's marketing text: the Madrid one ("the oldest member of the
family of models… a 'gymnastics sandal'") is word-for-word on birkenstock.in, other
retailers and copy sites. No sizing, fit advice or first-party lines — the things the
size-6 page won on. Google has no reason to prefer our copy of the same sentences.

**Season note:** November figures differ from July's. Madrid's pages sit ~22 now (6–10
in July's priority list) — compare a trial with its control over the SAME weeks, never
with the summer.

**Open questions to settle:**
1. Collections or product pages (or the cheap collection tidy first)? — the description
   finding points to product pages.
2. ~~Are the descriptions supplier copy?~~ Yes (above).
3. Which style for the trial, and which styles are the control?
4. Where the text is written and approved (Shopify directly, or through the
   descriptions-review flow so the feed and eBay take it too)?

**Closed experiments:** Arizona and Madrid collections (failed, 2026-08) and the size-6
blog (worked on position, 2026-11-07) — outcomes in CHANGELOG.md.

## Settled — don't re-litigate

- **Both types earn independently.** Collections win browse traffic; product pages win
  a smaller, high-converting product-intent stream (GA4: Milano products sold £442/90d
  from their *own* direct organic landings — the collection did **not** feed them).
- **Head terms aren't ours** — Milano ranks 17, Gizeh 23 on the bare brand terms. That's
  competition, not a fixable page. We win the specific and the long tail.
- **Indexed ≠ trafficked** (gizeh is indexed, earns ~0). **Visibility ≠ value** (the size
  guide is max-linked, ranks, and is hollow — 0.49% CTR).
- **Rank by value, not impressions** — Goor was a high-traffic, low-margin trap.
- **Google Ads** — parked. Light UI exports (Keyword Planner / Auction Insights) when we
  need to triage a term; wire the API only if it becomes frequent.

## Decision rule

Prove on the pilot, then invest more **targeted** time. Getting a page indexed is cheap;
earning clicks is the bar. Never scale an unproven fix.
