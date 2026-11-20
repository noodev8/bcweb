# Brookfield Comfort — Internal Platform (CLAUDE.md)

Guidance for Claude in this repo. Conventions live in `docs/API-RULES.md` (authoritative). The code is shipped and stable — **read the code, and the header of the util marked "THE copy", for how a feature works.** This file holds only the domain "why", the owner's standing decisions the code can't show, the guards against plausible wrong fixes, and the DB landmines. Keep entries short: the rule, the reason, where it lives. History and detail belong in git or the util headers (the long version of this file is at commit `ec67ced`).

## What this is

A **modular internal platform** for Brookfield Comfort (UK footwear e-commerce, mostly Birkenstock — Shopify, Amazon, eBay and the shop, CM3). Login → dashboard of module tiles (`bcweb-web/src/app/dashboard/page.tsx`). The shell (auth, dashboard, nav, API envelope, DB pool) is module-agnostic.

**Dashboard:** a **Daily** hero first, then every other screen **once** in six group tiles. Never put a screen in two groups or repeat a Daily screen in the menu.

**Admin vs not admin** (`app_users.is_admin`, switched on Admin → Users): not admin sees only Customer Orders, Goods In, AMZ Shipment, Pick and Location — their dashboard is those five buttons. The list is `bcweb-web/src/lib/userAccess.ts` (THE copy). Hidden on screen only (owner's call) — don't add route-level refusals; only `/user-set-admin` checks it.

## Structure — two apps in one repo

```
bcweb-server/   Express API — owns the Postgres connection and ALL SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 16 (App Router, src/app, TS, Tailwind 3), deploys to Vercel. Data fetching is SWR via
                src/lib/useApiQuery.ts — never in a useEffect (docs/maintenance-notes.md).
docs/           API-RULES.md (conventions), deploy.txt, maintenance-notes.md (dependency landmines, build gotchas),
                shopify-theme-edits.txt (THE record of every Shopify theme change — add new ones there), crontab.txt, plans.
```

The web app **never** connects to Postgres — web → HTTP (axios) → server → PostgreSQL (`brookfield_prod`, shared with the owner's Python scripts).

`docs/crontab.txt` is an **exact copy** of the VPS crontab and the only schedule record — add nothing to it. Pull in UTF-8: `ssh root@vps "crontab -l" | Out-File -Encoding utf8 docs/crontab.txt`.

## Run locally (Windows)

```
cd bcweb-server && npm run dev   # API on :3020 — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-web    && npm run dev   # Web on :3000 — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
```
Start the API first. Seed/reset a user: `node scripts/seed-user.js <username> <password> Andreas`. Deployment: `docs/deploy.txt`.

## Pricing — the ground rules

- **~95% of Shopify sales are Birkenstock, ordered ~6 months ahead and not re-orderable.** The job is to squeeze maximum margin from stock held: a fast seller with thin stock is a **price-up / harvest** candidate, not a restock flag.
- **Grain:** Shopify prices per STYLE (`groupid`), Amazon and eBay per SIZE (`code`). **Never cut a style to clear its dead sizes** — use a Shopify size price, or the size's own Amazon / eBay price.
- **Shopify and Amazon prices are independent.** Amazon is shown, never obeyed. The match-Amazon autopilot is retired, not deleted (UI behind `bcweb-web/src/lib/features.ts → AMZ_MATCH_UI`) — don't "fix" its dead badges or re-point Shopify at Amazon. Why: Amazon has no single price (it varies by size), and the same price nets ~2× on Shopify (no referral fee), which funds Google Shopping.
- **Shopify vs Amazon** (`/pricing/vs-amazon`, rules in `routes/pricing-vs-amazon.js` + the page header): the owner's floor is Shopify never under Amazon's DEAREST live size — a manual W1, not the autopilot.
- **Nothing blocks a price.** Below cost, over RRP, a brand's RRP request (`utils/brandPriceRequest.js`) — all flagged only, never blocked or changed.
- **Review dates** (`next_shopify_price_review`, `next_amz_price_review`) hide a style/size from Due until then. The periods are ONE list, `bcweb-web/src/lib/reviewPeriods.ts`. Other dates (`next_amz_load_review`, `list_decision`) are never price reviews.
- **UI words:** "Winners" on screen means ONLY the portfolio WINNERS status. The winners/losers lists are **Selling | Stuck** (code and routes keep the old words). `/segments` is **Portfolio**. "Can't get / Release" is ordering — never park/unpark; "parked" means a pricing review date. Range is never "Slow movers" on screen.
- **Portfolio status** (`utils/portfolioStatus.js`): the WINNER bar is FIXED, re-measured only on request (`node scripts/winner-bar-review.js`). No season test, no HARVEST status, no status trend — don't add them back without the owner. No cross-channel total anywhere. Portfolio does not link to the order screens.
- **Selling | Stuck:** a style that sells 1 unit or on thin margin is on neither — deliberate, don't loosen a bar. The old LOSERS machinery was removed knowingly — read the route headers before reinstating any of it. `limit` is only a safety cap (`utils/listLimit.js`).
- **Shopify size prices** (`utils/sizePrice.js`): own tables, **never `price_change_log`**. Rejected: splitting a size into its own product, basket discounts.
- Amazon "Due" means `utils/amzDue.js` and nothing else. Buy Box: read `docs/amz-buybox/PLAN.md` first. The staff guide is a PDF in the owner's Downloads — don't make an artifact.

## Stock, ordering, prospects — guards

- **Can't get it** (`utils/noSupply.js`): one store, per SIZE (`no_supply_size`). The old `skusummary.no_supply_*` columns are gone.
- **Birkenstock is left out** of Shopify Order (both views), AMZ loaded, the stock-ladder step lists (for now — the Clearance screen takes any brand) and eBay (never).
- Both order screens always open on everything. Losses are never ordered.
- **New stuff and Range stay apart.** New stuff's % is pulled down by new stock on purpose — don't add a maturity window.
- Owner's standing rules: one question per screen; qty is shown, never a rule.
- **Prospects:** no links to pricing or ordering, no sales figures, no scraping — the only link to our stock is the DUPLICATE warning.
- **Size gaps:** ranges are a brand setting set by hand in `size_gap_range` — never inferred from sister colours.
- **Seasons** feed only Inventory's WINTER/SUMMER commands and the Google Ads season filter.

## Amazon

- **Grain is the SKU.** `amzfeed` is FBA-only; BCWEB writes it only through the stock sync and the price push. `utils/amzSpApi.js` is THE one place BCWEB calls SP-API (no AWS / IAM / signing). Incident plan: `docs/security/incident-response-plan.md` (review every 6 months).
- A refused price push stores nothing. Nothing is uploaded any more (old upload routes remain, unused).
- The AMZ listed tag reads bclog 'Amazon Listing' — **never `skumap.status '1'`** (the old .xlsm stamps it whether uploaded or not).
- The `/amz-pricing` skill sets prices only via `scripts/amz-price-set.js` (dry run by default).

## eBay, SEO, swatches

- **eBay** (`utils/ebayListingRules.js`): fixed price only, no Birkenstock. The stock sync compares with `qty_sent`, never eBay's own count. Nothing ends by itself. `EBAY_REFRESH_TOKEN` is quoted in `.env` (contains `#`).
- **SEO** (`docs/seo/PLAN.md` first): the score is organic clicks, trailing 12 months. **Store nothing from Search Console**; don't propose a history table. Log every change in `docs/seo/CHANGELOG.md` with its expectation before the result.
- **Birkenstock swatches** (`utils/birkSwatches.js`): each colour stays its own Shopify product (SEO). Family from `title.shopifytitle`, never the handle. Don't write colour / width links back into descriptions.

## Writes (wrap each in `withTransaction`)

- **W1 Shopify price / W-A1 Amazon price:** `utils/priceWrite.js` (THE copy). **Do NOT set `shopifychange`.** Pushes happen after commit and never roll back. BCWEB's push is the only Shopify price path; drift is checked monthly with `node scripts/shopify-price-check.js`. Google is decoupled (`scripts/google-jobs.js`).
- **W-C1 collection tags** (`utils/collectionTags.js`): the DB is the record; never read tags back from Shopify.
- **W-O1 Update Orders** (`utils/orderSync.js`, the only copy of the order rules): the button shows one total of new orders, nothing per channel. Shopify stock edited in Shopify admin is overwritten — change stock in BCWEB. New channel: `docs/order-sync.md`. New Shopify permissions go on the Dev Dashboard app, never the legacy `shpat_` apps.

## Schema landmines (legacy DB — respect these)

- **Price columns on `skusummary` (`shopifyprice`, `cost`, `rrp`, `minshopifyprice`, `maxshopifyprice`) are `character varying`** and can hold junk (`maxshopifyprice='RRP'`). Read via `utils/sql.js → safeNumeric(col)`, never a bare `::numeric` (throws). **Write `shopifyprice` as a 2dp STRING** (`'36.95'`).
- **Never read stock from `skusummary.stockvariants`/`variants`** (stale). Sellable stock = `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. For the full size range use **`skumap`** LEFT JOIN stock, default 0.
- **Size = the code's suffix after the last `-`** — `SUBSTRING(code FROM '[^-]*$')`, **not `RIGHT(code,2)`** (half sizes like `-37.5`, UK sizes like `-8`). Sort numerically with `~ '^[0-9]+([.][0-9]+)?$'` → `::numeric` (write `[.]`, not `\.`, in a JS template string).
- **`skusummary.colour` is an overloaded segmentation tag.** Use `title.shopifytitle` for a human name (and for Birkenstock width — never the handle).
- **`skumap.fba` is the FBA FEE, not an FNSKU.**
- **VAT is per size** (`utils/vat.js`, THE copy): `skumap.tax` when set, else `skusummary.tax`. Every style is VAT on (`skusummary.tax = 1`); a zero-rated (children's) size is `skumap.tax = 0`, set by hand from the invoice — never a style set to 0, never copies of the style flag. Every VAT read (month end, till, Amazon / Shopify / eBay profit) goes through it; no screen sets it.
- **Dates:** legacy `created`/`updated` are TEXT (`'YYYYMMDD HH24:MI:SS'`, Europe/London). Prefer `created_at` / `changed_at` timestamptz but keep writing the text stamps. Never hand a pg `DATE` to `toISOString()` (BST shifts the day back); cast to text in SQL.
- **Order Status:** `orderstatus.orderdate` is varchar; un-placed = `''` **or NULL** — test `COALESCE(orderdate,'')=''`. One row per physical unit (`qty` always 1; count rows, insert/archive whole rows). Order cost = `skusummary.cost` via `safeNumeric`, never `skumap.cost`. Barcode = `skumap.ean` with the trailing `B` stripped. Predicates in `utils/orderStatus.js`. Supplier orders only (`ordertype` 2 local, 3 Amazon); never touch customer orders (`ordertype=1`). Amazon sales sync writes `sales` rows only, never `orderstatus`.

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
- Removed on purpose — don't bring back without the owner: the Pricing Slider, the Winners screen, Today (`/process`), Fast sellers, the match-Amazon autopilot, the HARVEST status, the status trend, Portfolio's Segment / Campaign tabs.
- Don't invent pricing logic — the notes above and the code are the source of truth.
