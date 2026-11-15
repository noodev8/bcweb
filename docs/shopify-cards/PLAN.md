# Shopify price cards — plan and decisions

The record for the Shopify price cards: Shopify pricing walked one card at a time, like the Amazon cards
(`components/AmzCardFrame.tsx`, `components/AmzPriceCards.tsx`). Decisions are numbered and dated and are not re-opened without the owner.

## Why

The owner wants to price Shopify the way Amazon is priced, from cards. Amazon has the Buy Box as its outside price; Shopify's equivalent is
Google Merchant Center's **price benchmark** (below).

## What Google gives us (probed live 2026-11-15, read only)

Merchant API **Reports v1** — `POST https://merchantapi.googleapis.com/reports/v1/accounts/<merchantId>/reports:search` with an MCQL
`query`. The existing service account and the `/auth/content` scope work as they are (`utils/googleAuth.js`). v1beta is gone (404).
Each view insists on certain fields in the SELECT (the error names them).

| View | What | For us |
|---|---|---|
| `price_competitiveness_product_view` | `benchmark_price` per offer: the click-weighted average price other UK shops charge for the same product (GTIN match). Must select `id`, `report_country_code`. | **1,445 of our 2,030 Google sizes (279 of 306 styles)**, 862 Birkenstock. Per SIZE (our offers are per size) and it varies by size (Milano Dark Brown at £87.99: size 43 £83.57, 44 £107.34, 46 £89.67). Today only — no history from Google. On 2026-11-15: 708 sizes more than 3% under the benchmark, 255 within 3%, 482 more than 3% over. |
| `price_insights_product_view` | Google's `suggested_price` + predicted change in impressions / clicks / conversions. Must select `id`. | **Empty for our account** — not enough data or not eligible. Don't plan on it. |
| `best_sellers_product_cluster_view` | Weekly UK best-seller rank of a MODEL across all shops and colours (`rank`, `previous_rank`, `relative_demand`, `inventory_status`). Must select `report_country_code`, `report_category_id`. | Not a pricing signal: model-level, and only 6 clusters show as in stock with us (Arizona best, #141). Useful for finding lines (Boston #52, Naples #78, not stocked). The unfiltered GB list is huge — always filter. |

## Decisions

1. **Where the cards open (owner, 2026-11-15):** a "Price cards" button on the Shopify pricing list (`/pricing/all?by=all`, top right
   beside Find and Shopify vs Amazon). The cards walk what the list is showing (Due on = the due styles). The Due system is unchanged —
   a card's Set is the normal W1 with the review chips, so a priced style leaves Due exactly as from the list. No new Daily number, no
   new menu entry. A tile home for `/pricing` like `/amz` is a later step, only once the cards have earned it.

2. **The basic card (owner, 2026-11-15):** the AmzCardFrame order, with Google's benchmark where the Buy Box goes:
   who (picture, groupid, name, n of N, links to the style drill + Shopify) · price box with nudges · profit now → at the box price
   (`utils/shopifyProfit.js`; only a loss is coloured, red — no Amazon £3 line) · Google line: the benchmark spread across the sizes that
   have one, and how many sizes we're under / level / over; tapping it opens the sizes one per line (size, our price, the benchmark,
   stock) · Amazon line: the dearest live size (the floor — shown, never obeyed) · stock + 30-day sales · last price change · review chips
   (THE list) · ← · Leave · Set. No "Match Google" and no suggested price on the basic card.

3. **Bigger nudge steps (owner, 2026-11-15):** −£5 −£2 −£1 [box] +£1 +£2 +£5 — Shopify prices are mostly £50–£100.

4. **One card per STYLE, size prices always shown (owner, 2026-11-15):** Set changes the style price (W1); the sizes are inside the card
   (the Google line's size list). Owner's concern was a style price overriding the clearance size prices. Raising the style price never
   touches a size price; lowering it TO OR BELOW one ends that size price (by design, `utils/sizePrice.js → styleDrop`). So the card
   always shows the size prices in force ("Size price: 35 at £45.00 (2 in stock)"). When the box would end one, there's a SMALL, quiet
   note on the note line, not red and not a confirm: "at this price the size 35 price ends". Set is never blocked. (On 2026-11-15 only
   one size price existed — 0034791-MILANO-35 at £45.00, style £82.49 — and `scripts/shopify-price-check.js` found Shopify matching
   BCWEB on all 2,107 live sizes.)

5. **Benchmark history (owner, 2026-11-15):** read nightly from Google and stored per size, change-only rows (a row only on a day the
   benchmark moved), kept **12 months** and trimmed by the same job. The basic card shows today's figure only; a "was £x a month ago"
   line is a later decision. It runs in the SAME nightly script as the Google Ads sweep — no second cron line (owner).

6. **All scheduled Google work in one script, done first as its own step (owner, 2026-11-15):** `scripts/google-jobs.js` replaced
   merchant-feed.js, google-ads-sweep.js and google-price-sweep.js. `--nightly` = feed then ads (02:30 UTC); `--prices` = the 2-hourly
   sweep; `--only <part>`, `--dry`. Each part stands alone and keeps its bclog section. The benchmark read goes in as a third nightly
   part once this move is live.

## Open
- How the size benchmarks roll up to one style price (needed before any "Match Google" button).
- Benchmark storage and history (with a limit).
