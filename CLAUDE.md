# Brookfield Comfort — Internal Platform (CLAUDE.md)

Guidance for Claude working in this repo. Conventions live in `docs/API-RULES.md` (authoritative). The code is stable and shipped — **read the code for how a feature works**; this file is the domain "why" and the DB landmines that aren't obvious from code. Build specs were retired once modules shipped (recoverable in git history if a big new job needs one).

## What this is

A **modular internal platform** for Brookfield Comfort (UK footwear e-commerce — mostly Birkenstock, sold on Shopify & Amazon). Login → dashboard of modules. Shipped modules: **Shopify Pricing, Amazon Pricing, Inventory, Order Status**. The shell (auth, dashboard, nav, API envelope, DB pool) is module-agnostic.

## Structure — two apps in one repo

```
bcweb-server/   Express API — owns the Postgres connection and ALL SQL. Runs on a VPS (PM2).
bcweb-web/      Next.js 16 (App Router, src/app, TS, Tailwind 3) front end. Deploys to Vercel. Data fetching is SWR via
                src/lib/useApiQuery.ts — never in a useEffect (see docs/maintenance-notes.md).
docs/           API-RULES.md (authoritative conventions), deploy.txt (deployment procedure ONLY),
                maintenance-notes.md (dependency landmines, the no-fetching-in-effects rule, build gotchas),
                legacy PowerBuilder/DB reference.
```

The web app **never** connects to Postgres — only the server does. Web → HTTP (axios) → server → PostgreSQL (`brookfield_prod`, the same DB the owner's Python scripts use).

## Run locally (Windows)

```
cd bcweb-server && npm run dev   # API on :3020 — reads bcweb-server/.env (DB_* + JWT_SECRET)
cd bcweb-web    && npm run dev   # Web on :3000 — reads bcweb-web/.env (NEXT_PUBLIC_API_URL)
```
Start the API first. Seed/reset a user: `node scripts/seed-user.js <username> <password> Andreas`.
Deployment: `docs/deploy.txt` (server → VPS/PM2 rsync; web → Vercel, behind the app login).

## Domain "why" — Shopify/Amazon Pricing

**Business context:** ~95% of Shopify sales are Birkenstock, which **cannot be re-ordered on demand** (ordered ~6 months ahead; stock in hand is all there is). There is no "sold out → restock" lever — **the job is to squeeze maximum margin from stock already held.** A fast-selling style with thin stock is a **price-up / harvest** candidate, NOT a restock flag.

Work always starts from a **group** — a **segment**, or (Shopify only, 2026-09-23) a **Google campaign** bucket (`skusummary.googlecampaign`; the Segments screen's Segment | Campaign switch, `pause`/blank hidden; `utils/pricingGroup.js`), or **Top earners** (Shopify AND Amazon, 2026-09-23 — styles whose revenue on *that channel alone* cleared the Winners screen's bar over 12 months, `utils/portfolio.js → topEarnerGroupidsSql`; the FIRST and DEFAULT tab on the Repricing screen, Top earners | Segment | Campaign, shown as two channel cards (due count split Selling/Stuck, per-channel revenue) — bare `/segments` opens it, the segment view is `?by=segment`; was a pinned row until the owner made it their priority). Same styles, bars, drill and writes — only the slice differs. Then a **WINNERS | LOSERS** switch:

> **UI names (owner, 2026-09-23):** on screen, WINNERS | LOSERS are **Selling | Stuck** (| Both), and the `/segments` screen is **Repricing** (nav, tile, title, back links). Labels only — routes, `?mode=winners|losers|all`, API/route names and code identifiers keep the old words. "Winners" in the UI now means ONLY the portfolio Winners screen (`/analytics/winners`); don't reintroduce it for these lists.
- **WINNERS** — in-stock, un-parked styles that sold **≥2 units in 30d AND averaged ≥£2 realised net profit per unit** (`AVG(sales.profit)`), best sellers first → price **up** / harvest. Drop 0-stock and "parked" styles.
- **LOSERS** — in-stock, un-parked stock that sold **nothing in 30d**; most stock first → price **down**. That single test is the whole membership rule.
- Both bars are **identical on Shopify and Amazon** (owner's call — one team-wide definition), differing only in grain. They are named constants in the route files, **not** query params yet. The old LOSERS machinery (90d window, `cover ≥ coverWeeks`, `cover_weeks`/`is_dead`/`u90`/`u14` fields) was removed in the 2026-07-29 simplification — the route headers record the accuracy trade-off that was knowingly accepted, read those before reinstating any of it.
- A style/SKU that sells 1 unit, or sells well on thin margin, is now on **neither** list. That gap is known and deliberate; it is another module's job, not something to "fix" here by loosening a bar.
- **Lists are the whole qualifying set, not a top-N** (the tab count IS the job; it shrinks as cleared). `limit` survives only as a safety cap (`utils/listLimit.js`, default 100 / max 500); routes return `total` + `truncated`.
- **Drill-down** shows header + pricing timeline (one row per distinct price, with pace `/wk`) + size curve. Pace = `units / max(span_days,7)/7 weeks`, computed app-side. Size curve shows ALL sizes (0 for sold-out) as a guardrail before a cut.

**Review cooldown (`next_shopify_price_review`, a date):** while future, the style is hidden from triage. A review period is **optional** on a price change (a "None" chip leaves the review date untouched). Suggested review defaults: raise ~7d, cut ~14d, hold ~30d (suggestions, editable).

**Shopify and Amazon prices are INDEPENDENT (2026-09-15, owner).** The old "match Amazon price" autopilot — `skusummary.match_amazon_price` + the `C:\scripts\amz-match` cron, which pinned a flagged style's `shopifyprice` to Amazon's cheapest in-stock size — is **retired, not deleted**: the crontab line is rem'd out, `migrations/20260915_amz_match_disable.sql` set the column back to `false` on every row, and the UI is hidden behind `bcweb-web/src/lib/features.ts → AMZ_MATCH_UI`. The panel, `pricing-match-toggle`, the `MATCH_LOCKED` branch in W1 and the list badges all stay and revive by flipping that flag. **Don't "fix" the dead badges or re-point Shopify at Amazon.** Why: Amazon prices per SIZE (IVES WHITE ran £37.30–£41.09), so there is no single Amazon price and the rule let one thin size set the style's price; and the same price is worth ~2× more on Shopify (no referral fee — £39.29 nets £9.06 there vs £4.86 booked on Amazon), so matching down gave away the margin that funds Google Shopping. Amazon is now **shown, never obeyed** — `pricing-drill` returns the live spread (`amazon_lowest`/`amazon_highest`/`amazon_live_total`) plus per-size `amz_price`/`amz_live` on `sizes[]`; the setter carries the spread and a note when you go under Amazon's lowest. **All advisory — nothing blocks.**

**Amazon** mirrors Shopify but at **SKU grain** (`code`, not `groupid`); reads `amzfeed` (FBA-only, **READ ONLY**) for live price/stock. **No live push** — apply only logs to `amz_price_log`; the price reaches Amazon via a client-built Seller Central upload file (rolling 12h team-wide basket, rebuilt from the log). Amazon "margin" is net (price − cost − FBA fee).

## Writes (exact — wrap each in `withTransaction`)

- **W1 — apply Shopify price** (`POST /pricing-apply`): `reviewDays` optional (integer ≥ 1, or omitted = leave review date untouched). Server-side bounds: **block `< cost`**, **allow-but-flag `> rrp`**. Atomically `UPDATE skusummary SET shopifyprice=$price_string[, next_shopify_price_review=CURRENT_DATE+$reviewDays]` + `INSERT price_change_log (groupid,'SHP',old,new,NULL,$note,changed_by)`. **Do NOT set `shopifychange`.** After commit, W1 pushes to **Shopify immediately** (`utils/shopify.js → pushIfLive`, best-effort, never rolls back the DB; on failure `shopify:{pushed:false}` and operator re-Applies — `productSet` is idempotent). **Google is DECOUPLED** — W1 does not push Google; a periodic sweep (`scripts/google-price-sweep.js`; `crontab.txt` is the definitive source for its schedule — don't restate it) finds un-sent SHP changes (`price_change_log.google_pushed_at IS NULL`, Google-live styles) and pushes each style's current price once via in-process Node (`utils/googleMerchant.js`, `utils/googleAuth.js`). It writes a **`salePrice`-only supplemental override** (Merchant API `products/v1`) so the primary feed's `price`/RRP is preserved. Nightly `merchant_feed.py --upload` (3:30am BST) is the ultimate backstop. Add/Modify (`product-price`) still pushes Google inline.
- **W2 — park only** (`POST /pricing-park`): `UPDATE skusummary SET next_shopify_price_review=CURRENT_DATE+$reviewDays`. No price change, no log row.
- **Bulk** on WINNERS/LOSERS lists (`BulkActionBar`): a bulk price move **loops W1 per row client-side** (so each live push fires and per-item bounds apply); bulk review-only uses `/pricing-park-bulk`. Amazon bulk loops `/amz-apply` and reuses `/amz-review`.
- **W-A1 — apply Amazon price** (`POST /amz-apply`): logs to `amz_price_log` only (blocks `< cost+fbafee`, flags `> rrp`); optional `reviewDays` parks via `next_amz_price_review`. Never writes `amzfeed`.
- **W-O1 — sync Shopify orders** (`POST /order-sync`, the **"Update orders"** button — legacy terminology, on both Analytics → Sales and Customer Orders, via the shared `bcweb-web/src/components/UpdateOrdersButton.tsx`; the route/util keep the `order-sync` naming): fetch outside the transaction, then all six phases inside one — orders → `orderstatus`, sales booked to `sales` (`SHP`, per-unit profit from `utils/shopifyProfit.js`), shipped orders → `orderstatus_archive`, pick allocation over `localstock`, then housekeeping. **⚠️ THIS LOGIC IS DUPLICATED IN `C:\scripts\orders\update_orders.py`, WHICH IS STILL IN CRON.** Both are live and write the same rows; a change to one and not the other leaves the DB written under two sets of rules with nothing recording which. Read the banner at the top of `utils/orderSync.js` before changing what a run does — and see `docs/order-sync-port.md` for the behaviour inventory. Needs `SHOPIFY_ORDERS_ACCESS_TOKEN` (a **different** token from `SHOPIFY_ACCESS_TOKEN` — `read_orders`, not `write_products`).

## Schema landmines (legacy DB — respect these)

- **Price columns on `skusummary` (`shopifyprice`, `cost`, `rrp`, `minshopifyprice`, `maxshopifyprice`) are `character varying`, not numbers** and can hold junk (e.g. `maxshopifyprice='RRP'`). Read via `utils/sql.js → safeNumeric(col)` (NULL on non-numeric), never a bare `::numeric` (throws). **Write `shopifyprice` as a 2dp STRING** (e.g. `'36.95'`).
- **Never read stock from `skusummary.stockvariants`/`variants`** (stale). Current sellable stock = `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. `localstock` holds in-stock rows only — for the full size range use **`skumap`** (one row per variant), LEFT JOIN sellable stock, default 0.
- **Size = `RIGHT(code,2)`** (EU size, by design).
- **`skusummary.colour` is an overloaded segmentation tag** (ambiguous). Use `title.shopifytitle` for a human name.
- **Dates:** legacy `created`/`updated` are TEXT (`'YYYYMMDD HH24:MI:SS'`, Europe/London). Prefer the newer `created_at timestamptz` / `changed_at timestamptz` for real date logic but keep writing the legacy text stamps too. Never hand a pg `DATE` to `toISOString()` (parsed as local midnight → BST shifts the day back one); cast to text in SQL.
- **Order Status:** `orderstatus.orderdate` is `character varying`; an un-placed row is `''` **or NULL** — always test `COALESCE(orderdate,'')=''`. `orderstatus` has **one row per physical unit** (`qty` always 1); quantities are `COUNT(*)`, +/− means insert/archive whole rows. Order cost = `skusummary.cost` via `safeNumeric`, never `skumap.cost` (blank/placeholder on many rows). Barcode = `skumap.ean` with the trailing `B` stripped. The module is two stages split on the `orderdate` marker: TO PLACE (`orderdate=''`, chosen, not yet bought) → ON ORDER (`orderdate<>''`, with the supplier). `utils/orderStatus.js` owns the predicates. Scope = supplier orders only (`ordertype` 2 local, 3 Amazon); customer orders (`ordertype=1`) never touched.

## Conventions (full detail in docs/API-RULES.md)

- **Every API response is HTTP 200 + a `return_code`** (`SUCCESS` or an error code). **Never** 4xx/5xx for API-level errors.
- **One route file per endpoint** in `routes/` (kebab verb-noun), structured header block, heavily commented (explain *why*). `utils/apiLogger.js` logs every route.
- **JWT carries only `{ id }`.** `middleware/verifyToken.js` → `req.user = { id, display_name }`. `changed_by` is resolved server-side, never sent by the client.
- **DB:** central pool in `database.js`; `utils/transaction.js → withTransaction` for writes; parameterised queries only; no N+1.
- **Frontend client (`src/lib/api.ts`) never throws on API-level errors** — returns `{ success, data?, error?, return_code? }`; only network failures throw. Auth in `src/contexts/AuthContext.tsx`.
- **No hard-coded secrets** — everything via `.env`; flag if a new var is needed.

## Working notes

- The API points at the **LIVE production DB.** Reads are safe; writes touch real product rows. When testing writes, wrap in a manual `BEGIN … ROLLBACK` unless the owner OKs a live apply-and-restore.
- Single `.gitignore` at repo root.
- Don't invent pricing logic — the domain notes above and the code are the source of truth.
