# Brookfield Comfort — Internal Platform (CLAUDE.md)

Guidance for Claude in this repo. Conventions live in `docs/API-RULES.md` (authoritative). The code is shipped and stable — **read the code, and the header of the util marked "THE copy", for how a feature works.** This file holds only the domain "why", the owner's standing decisions the code can't show, and the DB landmines. Keep entries short: the rule, the reason, where it lives. History and detail belong in git or `docs/` (the long version of this file is at commit `8a0e375`).

## What this is

A **modular internal platform** for Brookfield Comfort (UK footwear e-commerce, mostly Birkenstock — Shopify, Amazon, eBay and the shop, CM3). Login → dashboard of module tiles (`bcweb-web/src/app/dashboard/page.tsx`). The shell (auth, dashboard, nav, API envelope, DB pool) is module-agnostic.

**Dashboard:** a **Daily** hero first (Sales · Pricing due · Ordering · Selling · Prospects · AMZ loaded), then every other screen **once** in six group tiles (Operations, Pricing, Products & stock, Birkenstock, Google, Admin). Never put a screen in two groups or repeat a Daily screen in the menu. `/daily` redirects to the dashboard.

## Structure — two apps in one repo

```
bcweb-server/   Express API — owns the Postgres connection and ALL SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 16 (App Router, src/app, TS, Tailwind 3), deploys to Vercel. Data fetching is SWR via
                src/lib/useApiQuery.ts — never in a useEffect (docs/maintenance-notes.md).
docs/           API-RULES.md (conventions), deploy.txt (deployment only), maintenance-notes.md (dependency landmines,
                build gotchas), shopify-theme-edits.txt (THE record of every Shopify theme change — re-apply after a
                Dawn update; add new ones there), crontab.txt (see below), legacy PowerBuilder/DB reference.
```

The web app **never** connects to Postgres — web → HTTP (axios) → server → PostgreSQL (`brookfield_prod`, shared with the owner's Python scripts).

`docs/crontab.txt` is an **exact copy** of the VPS crontab and the only schedule record — overwritten whole by each pull, so add nothing to it. Pull in UTF-8: `ssh root@vps "crontab -l" | Out-File -Encoding utf8 docs/crontab.txt`.

## Run locally (Windows)

```
cd bcweb-server && npm run dev   # API on :3020 — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-web    && npm run dev   # Web on :3000 — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
```
Start the API first. Seed/reset a user: `node scripts/seed-user.js <username> <password> Andreas`. Deployment: `docs/deploy.txt`.

## Pricing — the ground rules

- **~95% of Shopify sales are Birkenstock, ordered ~6 months ahead and not re-orderable.** The job is to squeeze maximum margin from stock held: a fast seller with thin stock is a **price-up / harvest** candidate, not a restock flag.
- **Grain:** Shopify prices per STYLE (`groupid`), Amazon and eBay per SIZE (`code`). **Never cut a style to clear its dead sizes** — use a Shopify size price, or the size's own Amazon / eBay price.
- **Shopify and Amazon prices are independent.** Amazon is shown, never obeyed. The old "match Amazon" autopilot is retired, not deleted (`skusummary.match_amazon_price` all false, cron rem'd, UI behind `bcweb-web/src/lib/features.ts → AMZ_MATCH_UI`) — don't "fix" its dead badges or re-point Shopify at Amazon. Why: Amazon has no single price (it varies by size), and the same price nets ~2× on Shopify (no referral fee), which funds Google Shopping.
- **Shopify vs Amazon** (`/pricing/vs-amazon`) is the manual tool: the owner's floor is Shopify never under Amazon's DEAREST live size (Amazon can pull the Buy Box). Apply = a plain W1, note "Amazon Match", 10-day review unless the style already has a later one (kept). Ignores the review cooldown on purpose.
- **Nothing blocks a price.** Below cost (Amazon: cost + FBA fee) and over RRP are flagged only.
- **Review dates** (`next_shopify_price_review`, `next_amz_price_review`) hide a style/size from Due until then; optional on every change. The periods are ONE list, `bcweb-web/src/lib/reviewPeriods.ts` (3 · 7 · 14 · 30 + a Season chip, `seasonPark()`). AMZ loaded and New Additions keep their own lists.
- **UI words:** "Winners" on screen means ONLY the portfolio WINNERS status. The `/segments` screen is **Repricing**; the winners/losers lists are **Selling | Stuck** (code, routes and `?mode=` keep the old words). "Can't get / Release" is ordering; never call it park/unpark — "parked" means a pricing review date.

## Shopify pricing

- **Home** `/pricing` → `/pricing/all?by=all` (`routes/pricing-all-list.js`): ONE list of every Shopify-live style in stock, plus every row of the status lists (0-stock included), with a Due switch. No segment pickers.
- **Repricing** (`/segments`): tabs **Status** (default) | Segment | Campaign (`utils/pricingGroup.js`).
  - Status = stored `skusummary.portfolio_status` WINNERS | STEADY | NEW | LOSERS, stamped by "Update now", rules `utils/portfolioStatus.js`. A WINNER = 12-month revenue **net of returns** > £1,500 — a FIXED bar, re-measured only on request (`node scripts/winner-bar-review.js`). **No season test and no HARVEST status** — don't add them back without the owner. An Amazon SKU takes its style's status.
  - Lead channel `skusummary.portfolio_channel` SHP | AMZ | BOTH (≥80% of 12m revenue on one channel; NULL = BOTH); a channel's lists show its own + BOTH (`channelFilterSql`, the one predicate).
  - Status lists are ONE unsplit list, **out of stock included** (prices set ahead of arrival). Segment / campaign lists need stock.
  - Tiles count STYLES (Amazon too); **no cross-channel total anywhere**. The tier toggle (`?bar=`) narrows only the WINNERS tiles. No status trend (removed — it charted the calendar).
  - Repricing does **not** link to the order screens.
- **Selling | Stuck**: Selling = in stock, un-parked, ≥2 units in 30d AND ≥£2 avg net profit/unit → price up. Stuck = in stock, un-parked, nothing sold in 30d → price down. Same bars on both channels, named constants in the route files. A style that sells 1 unit or sells on thin margin is on neither — deliberate, don't loosen a bar. The old LOSERS machinery was removed knowingly — read the route headers before reinstating any of it. Lists are the whole set; `limit` is only a safety cap (`utils/listLimit.js`).
- **Drill:** header + pricing timeline (one row per price, pace `/wk` computed app-side) + size curve showing ALL sizes.
- **Seasons** (`/seasons`) now feed only Inventory's WINTER/SUMMER commands and the Google Ads season filter.

## Shopify size prices (`utils/sizePrice.js`, THE copy)

A dead size of a selling style gets its own price on the SAME Shopify product. Set by hand on the drill's Size prices panel; must be below the style price and in stock; no review date. Used only while below the style price AND in stock (`ACTIVE_SQL`); ends by hand, when the style price drops to it (same transaction as W1 / `product-price`), or when the size sells out (Update Orders). Shown against the RRP via `utils/shopify.js → variantPrice` inside `upsertProduct` (the one push choke point). Own tables `shopify_size_price` / `_log` — **never `price_change_log`**. Google: `sale_price`, left out of paid Shopping. Theme edits in `docs/shopify-theme-edits.txt`. Rejected: splitting the size into its own product, basket discounts.

## Ordering

- **Can't get it** (`utils/noSupply.js`, THE copy): **one store, per SIZE** — `no_supply_size` (owner 2026-11-13, "single system"). Off both order screens for 3 months, then lapses. Amazon Order marks sizes; Shopify Order's style view and Seasons mark a whole style = a row on every size (a shortcut, not a second mark). A style reads as can't-get only when every live size is marked; partly marked stays on Shopify Order with those sizes locked. `skusummary.no_supply_*` is emptied and unread — never write it again. On Amazon Order a marked size stays visible while it has local stock (it can still be picked to FBA).
- **Shopify Order:** default **Sellers** view (`routes/shopify-sellers-list.js`) — one row per non-Birkenstock size sold on Shopify in 30d; **Sold out** = no local stock, nothing on order, none at/heading to FBA (FBA counts as cover). A size can be marked **Don't order** (`shopify_dont_order`) until it sells again on Shopify. `?view=sizes` = the style view. Birkenstock left out of both.
- **Amazon Order** presets **Hot | Warm | Simmer** (bars in `utils/portfolio.js`): Hot = top 20% of sizes sold in 30d by profit; Warm = > £3/unit, sold in 6 months; Simmer = ≤ £3/unit, sold in 30d net, FBA total 0 — price up toward £3 and try 1 unit. Losses are never ordered.
- Both order screens always open on everything (no Repricing arrival).

## Amazon

- **Grain is the SKU.** `amzfeed` is FBA-only; BCWEB writes it only through the stock sync (`amzlive`/`amztotal`) and the price push (`amzprice`, once Amazon accepts).
- **SP-API** (connected 2026-11-09): a private app on the Solution Provider Portal — **no AWS / IAM / request signing needed**. Keys in `.env` (`AMZ_SP_*`; the client secret must be rotated when SPP warns). `utils/amzSpApi.js` is THE one place BCWEB calls it; reports `utils/amzSpReports.js`. Incident plan: `docs/security/incident-response-plan.md` (review every 6 months).
  - **Fast things in Update Orders:** FBA stock (`utils/amzStockSync.js`, before Shopify stock), Amazon sales (`utils/amzOrderSync.js` — `sales` rows only, never `orderstatus`; not in the button's count). Pending orders are re-read each run into `amz_pending_order` and shown on Sales at an estimated price.
  - **Report things nightly** (`scripts/amz-inventory-nightly.js --commit`): inventory report (prices; "changed in Seller Central" → `amz_price_log` 'Manual'), returns, fees (only when 28+ days old), dead listings (`utils/amzDeadListings.js`: unknown SKU, 0 FBA, no style match → deleted; more than 10 in a night deletes none).
  - **Nothing is uploaded any more.** `/update-amazon` is "Amazon status"; the old upload routes remain, unused. Red dashboard warning `AmzReadWarning` on a failed read or 36h without the nightly job.
  - **Prices go live** through `utils/amzPricePush.js` (patches `our_price` only — keeps min/max and any Sale price). A refusal is shown, **nothing stored**; the basket = prices not yet on Amazon ("Send to Amazon"). Update Orders retries anything unsent.
  - **List on Amazon** (`utils/amzListing.js`, `POST /amz-list`): one press lists every barcoded size on the existing ASIN at RRP, FBA. The AMZ tag reads bclog 'Amazon Listing' — **never `skumap.status '1'`** (the old .xlsm stamps it when the file is made, uploaded or not).
- **Size history** (`utils/amzSizeHistory.js`): price + FBA stock per size over time, because `amzfeed` only knows today and pricing couldn't tell "out of stock" from "didn't sell". Change-only rows, one per size per day, 3 years, written behind a SAVEPOINT with every stock write. The past was rebuilt from the Inventory Ledger (`scripts/amz-ledger-backfill.js`, total only).
- **Buy Box** (`/amz` is the Amazon Pricing home; `docs/amz-buybox/PLAN.md` is the record — read it first). **"Due" means `utils/amzDue.js` and nothing else:** a size the Buy Box answers is never due (its cards are Buy Box moves); every list tests `dueSql(...)`. Rules in `utils/amzBuyBox.js` / `amzBuyBoxDeck.js` / `amzBuyBoxTeam.js`. Staff guide is a PDF in the owner's Downloads — don't make an artifact.
- **Pricing standard** (`/amz-pricing` skill, rules `utils/amzPricingStandard.js`): each size judged against its sister sizes; never below the £3-a-pair walk-away; follows the Due list (`--due`). Writes only via `scripts/amz-price-set.js` (dry run by default).

## Stock screens — New stuff, Range, Deep sellers, Clearance

- **New stuff / New Additions** (`GET /process-overview`, `utils/processMap.js → NEW_SKUS_SQL`): prospect performance per SKU — every SKU whose **earliest-ever Goods In** is in the last 90 days, and the % that netted a sale on any channel since. Once sold it's ticked off. New stock pulls the % down on purpose (the signal to slow buying) — don't add a maturity window. Today (`/process`) was removed; Daily carries its numbers.
- **Range** (`/analytics/slow-sizes`, code keeps `slow-sizes`; don't call it "Slow movers" on screen): what share of the SKUs we hold sold in 90 days. Parts: not sold yet · first 90 days (→ New Additions) | no sale 91 days – 9 months | 9 months+ (Clearance) | sold in 90 days. The unit on screen is **SKUs**; the size run counts SIZES, never qty. No item / stock-health figure on it (that's Sell-through, `utils/unitAge.js`). Keep New stuff and Range apart.
- **Deep sellers** (`/analytics/deep-sizes`, `utils/deepSizes.js`): sizes on Range's green card holding 3+ beyond 90 days at their 12-month pace. Opened only from that card.
- **Decisions** for Deep sellers and Clearance share one layer: `list_decision`, `utils/listDecision.js`, `components/ListDecision.tsx`. Choosing an action records it and nothing else; its own table, **never the pricing review dates**.
- Owner's standing rules: one question per screen; qty is shown, never a rule.

## Prospects, Size gaps, AMZ loaded

- **Prospects** (`/prospects`, `utils/prospect.js`): the team's notepad for new Amazon finds. Rank / price typed by hand — no scraping, no API, no rank comparison. Delete asks why (Ordered | Dropped archive; Delete for good is a real delete). Archive kept 6 months (purged on add / archive). **No links to pricing or ordering, no sales figures**; the only link to our stock is the DUPLICATE warning. Return on cost = `returnOnCost`.
- **Size gaps** (`/prospects/size-gaps`, `utils/sizeGaps.js`): sizes missing from styles we sell. Ranges are a BRAND + Womens/Mens setting set by hand in `size_gap_range` (never inferred from sister colours). Size = the whole number at the end of the code. Sorted by the best size's 12-month online profit a pair. Marks are per size, in their own table, and every mark ends when the size arrives.
- **AMZ loaded** (`/amz-loaded`): styles held locally with no `amzfeed` row (Birkenstock left out). Its review is `skusummary.next_amz_load_review` — never a price review.

## eBay (`/ebay`)

Fixed price only. One listing per style, sizes as variations, **free postage**, each size at its Amazon price (else Shopify + £4.50); clearance sizes (9+ months, `utils/slowSizes.js`) start at 50% of RRP. **No Birkenstock.** Rules `utils/ebayListingRules.js` (THE copy), readiness `utils/ebayCandidates.js`, publish `utils/ebayPublish.js`, profit `utils/ebayProfit.js` (always Royal Mail costs, even when sent by MCF). The stock sync is the last step of Update Orders (`utils/ebayStockSync.js`): compares with `qty_sent`, never eBay's own count; new in-stock sizes are added to the same listing. Dud sizes get a hand-set lower price inside the listing. Nothing ends by itself. Policies are found by name (`utils/ebayPolicies.js`). `EBAY_REFRESH_TOKEN` is quoted in `.env` (contains `#`).

## SEO (`docs/seo/` — read `PLAN.md` first)

Reports plus read-only screens (`/seo` tracker, `/seo/styles`). The score is **organic clicks, trailing 12 months** — never average position or 7/28-day figures. **Store nothing from Search Console** and don't propose a history table. Judge a page change on position at 4–8 weeks. GSC / GA4 use the merchant-feed service account (`utils/googleAuth.js`). Log every change in `docs/seo/CHANGELOG.md` with its expectation before the result.

## Birkenstock colour swatches (`utils/birkSwatches.js`)

Each colour stays its own Shopify product (SEO). Metafields + a theme block (`docs/shopify-swatches.liquid.txt`); family = model + material from `title.shopifytitle`, never the handle. Sold out is hidden by the theme, never by the sync. Don't write colour / width links back into descriptions.

## Writes (exact — wrap each in `withTransaction`)

- **W1 — Shopify price** (`POST /pricing-apply`, core `utils/priceWrite.js → writeShopifyPrice`): `UPDATE skusummary SET shopifyprice=$string[, next_shopify_price_review=CURRENT_DATE+$reviewDays]` + `INSERT price_change_log (groupid,'SHP',old,new,NULL,$note,changed_by)`; trims that style's log to 3 years. **Do NOT set `shopifychange`.** After commit, push to Shopify (`utils/shopify.js → pushIfLive`, best-effort, never rolls back; a same-price Apply pushes only if Shopify differs, `pushIfStale`). **Google is decoupled**: `scripts/google-price-sweep.js` pushes un-sent changes as a `salePrice`-only supplemental override; the nightly feed `scripts/merchant-feed.js --upload` is the backstop. BCWEB's push is the only Shopify price path (the Python price scripts are retired); drift is checked monthly with `node scripts/shopify-price-check.js`.
- **W-S1 — Shopify size price** (`/pricing-size-price-set` / `-clear`): `utils/sizePrice.js`, then `pushIfLive`.
- **W2 — park only** (`POST /pricing-park`): sets the review date; no price change, no log row.
- **Bulk** price moves loop W1 / W-A1 per row client-side (each push and bound applies); bulk review-only uses `/pricing-park-bulk` / `/amz-review`.
- **W-A1 — Amazon price** (`POST /amz-apply`, core `writeAmzPrice`): logs to `amz_price_log`, optional `next_amz_price_review`, then sends to Amazon after commit (a failure never undoes the save).
- **W-C1 — collection tags** (`POST /collection-tag-set`, `utils/collectionTags.js`): the **DB is the record** (`collection`, `collection_member`, max 3 tags per style), Shopify carries a copy; a Shopify failure rolls the row back. Add needs `shopify = 1`; Remove always works. Never read tags back from Shopify.
- **W-O1 — Update Orders** (`POST /order-sync` and the cron both call `utils/orderSync.js → runOrderSync`): reads every channel in `utils/orderChannels.js`, writes in ONE transaction under an advisory lock, then after commit: Amazon FBA stock → Shopify stock (`utils/shopifyStockSync.js` — stock edited in Shopify admin is overwritten; change stock in BCWEB) → eBay stock → order sources / sessions. A channel that can't be read is skipped. **The button shows one total of new orders, nothing per channel.** This is the only copy of the order rules (Python `update_orders.py` retired). A new channel = one `utils/<name>OrderSync.js` + one line in `orderChannels.js` (`docs/order-sync.md`). Shopify orders need `SHOPIFY_ORDERS_ACCESS_TOKEN`; new Shopify permissions go on the Dev Dashboard app, never the legacy `shpat_` apps.

## Schema landmines (legacy DB — respect these)

- **Price columns on `skusummary` (`shopifyprice`, `cost`, `rrp`, `minshopifyprice`, `maxshopifyprice`) are `character varying`** and can hold junk (`maxshopifyprice='RRP'`). Read via `utils/sql.js → safeNumeric(col)`, never a bare `::numeric` (throws). **Write `shopifyprice` as a 2dp STRING** (`'36.95'`).
- **Never read stock from `skusummary.stockvariants`/`variants`** (stale). Sellable stock = `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. For the full size range use **`skumap`** LEFT JOIN stock, default 0.
- **Size = the code's suffix after the last `-`** — `SUBSTRING(code FROM '[^-]*$')`, **not `RIGHT(code,2)`** (half sizes like `-37.5`, UK sizes like `-8`). Sort numerically with `~ '^[0-9]+([.][0-9]+)?$'` → `::numeric` (write `[.]`, not `\.`, in a JS template string).
- **`skusummary.colour` is an overloaded segmentation tag.** Use `title.shopifytitle` for a human name (and for Birkenstock width — never the handle).
- **`skumap.fba` is the FBA FEE, not an FNSKU.**
- **Dates:** legacy `created`/`updated` are TEXT (`'YYYYMMDD HH24:MI:SS'`, Europe/London). Prefer `created_at` / `changed_at` timestamptz but keep writing the text stamps. Never hand a pg `DATE` to `toISOString()` (BST shifts the day back); cast to text in SQL.
- **Order Status:** `orderstatus.orderdate` is varchar; un-placed = `''` **or NULL** — test `COALESCE(orderdate,'')=''`. One row per physical unit (`qty` always 1; count rows, insert/archive whole rows). Order cost = `skusummary.cost` via `safeNumeric`, never `skumap.cost`. Barcode = `skumap.ean` with the trailing `B` stripped. Predicates in `utils/orderStatus.js`. Supplier orders only (`ordertype` 2 local, 3 Amazon); never touch customer orders (`ordertype=1`).

## Conventions (full detail in docs/API-RULES.md)

- **Every API response is HTTP 200 + a `return_code`** (`SUCCESS` or an error code). Never 4xx/5xx for API-level errors.
- **One route file per endpoint** in `routes/` (kebab verb-noun), structured header block, comments explain *why*. `utils/apiLogger.js` logs every route.
- **JWT carries only `{ id }`.** `middleware/verifyToken.js` → `req.user = { id, display_name }`. `changed_by` is resolved server-side, never sent by the client.
- **DB:** central pool in `database.js`; `utils/transaction.js → withTransaction` for writes; parameterised queries only; no N+1.
- **Frontend client (`src/lib/api.ts`) never throws on API-level errors** — returns `{ success, data?, error?, return_code? }`; only network failures throw. Auth in `src/contexts/AuthContext.tsx`.
- **No hard-coded secrets** — everything via `.env`; flag if a new var is needed.
- A rule has ONE home (the util marked THE copy); screens and scripts call it rather than restate it.

## Working notes

- The API points at the **LIVE production DB.** Reads are safe; when testing writes, wrap in `BEGIN … ROLLBACK` unless the owner OKs a live apply-and-restore.
- Single `.gitignore` at repo root.
- Removed on purpose — don't bring back without the owner: the Pricing Slider, the Winners screen, Today (`/process`), Fast sellers, the match-Amazon autopilot, the HARVEST status, the status trend.
- The nightly DB backup writes a bclog row ('Backup'); `GET /backup-last` drives the dashboard's red `BackupWarning`.
- Don't invent pricing logic — the notes above and the code are the source of truth.
