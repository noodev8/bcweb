# Amazon Pricing — Working Spec (DRAFT)

> Design spec for the **Amazon Pricing** module: a lean, SKU-grain review/apply screen that does for
> Amazon what the Shopify Pricing module does for Shopify — *"show me the Amazon SKUs that need attention,
> let me make a quick price change or dig deeper."* Same "throw away when done" scratch-spec style as
> `add-modify-spec.md` / `segments-spec.md`.
> **Nothing here is built yet** — this captures the agreed model so it doesn't evaporate.

The domain (the *why* of Amazon pricing — philosophy, the decision framework, carry-forward rules, per-segment
economics) is **not re-derived here**. It lives in `C:\scripts\amz-price\` (four docs: `README.md`,
`AMZ_PRICING.md` = the engine, `AMZ_FULL_REVIEW.md` = the classify-and-batch procedure, `AMZ_PRODUCTS.md` =
the per-segment registry). This spec is only about lifting that engine into a web screen. Read those four
first; treat them as the source of truth for *what a good price move is*.

---

## 0. STATUS & NEXT UP  (read this first)

**⛔ PARKED 2026-07-10 — decision tool shelved, not deployed, dashboard tile reverted to "coming soon".** After
building and *feeling* the whole thing (segments/list/drill/write/basket), the owner's call: **Amazon pricing is
better done as a conversational AI flow than as a rules screen.** It's judgment-dense (season vs price, returns =
fit, restock-in-flight, don't-round-trip — nuance the classifier can't hold), low-volume (no throughput pressure
a screen would relieve), and knowledge-compounding (the AI writes learnings back to the `C:\scripts\amz-price`
registry every session; a hard-coded classifier can't). The AI already produces the upload file and can be argued
with. **General lesson: screens win for high-volume, standardised, multi-operator execution; AI wins for
low-volume, judgment-dense, evolving work — sort future modules by that before building.** Code kept in the repo,
**unlinked** (no dashboard tile → `/amz`); `src/app/amz/page.tsx` still resolves if visited directly and the
server routes stay mounted. Salvage: `utils/amzSuggest.js` is a clean, tested codification of the playbook rules
(usable as a consistency check / first-pass classify *for the AI*); the drill queries (velocity/bands/history)
are reusable structured pulls. Everything below is the as-built record — **do not resume without a fresh decision.**

**Where we were (as-built):** **read side built end-to-end — server + page UI** (2026-07-09). This module is a
peer of Shopify Pricing but leaner: one page, **SKU-grain** (each size is its own Amazon price), no groupid drill,
no review-date/park concept.

**Built so far (server):** `GET /amz-segments` (chips: managed segments + 🟢/🟡 attention badge + 90d
units/profit/last-sold context) and `GET /amz-skus?segment` (the per-SKU list, each row carrying its signals +
a suggested move). Shared internals: `utils/amzSkuState.js` (the one per-SKU state query, used by both routes so
the list and the chip counts can't drift) and `utils/amzSuggest.js` (the 🟢/🟡/⚪ classifier port, running the
§6 *fallback* params — computed hard-floor + RRP, with a small `REGISTRY` override for IVES's discovered
floor/ceiling/step-band). Both mounted in `server.js`. Core SQL validated against the live DB (IVES-WHITE) —
suggestions trace correctly.

**Built so far (web):** the whole module is **one page** `src/app/amz/page.tsx` — a segment-chip strip (+ All,
summed client-side) with attention badges, an economics caption when a single segment is active, and the
SKU table (per-size row: price, suggested move = tier dot + action + target + why, FBA live/inbound, 7d/14d,
ret%, last sold), holds sinking to the bottom. Selected chip lives in `?segment=` (shareable/delegatable). A
**search box** (group id / code / name, across all segments — client-filters the cached full set) overrides the
chip view while a term is present. Sticky table header; sort = action, then most FBA stock first.
Client fns `getAmzSegments()`/`getAmzSkus()` + types in `src/lib/api.ts`; dashboard "Amazon Pricing" tile
flipped **live** → `/amz`. `tsc --noEmit` clean. **Not visually click-tested in the running app yet.**

**Drill built** (2026-07-10): `GET /amz-sku?code` (`routes/amz-sku.js`) returns three lazy datasets for one SKU —
6-week zero-filled velocity, recent `amz_price_log` history (with the reasoning notes), and 60-day sold-price
bands (the resistance guardrail). Client fn `getAmzSku()` + types in `src/lib/api.ts`. UI: a row **expands in
place** (chevron toggle) into a 3-column panel — velocity mini-bars, units-by-price bands (current price
highlighted; suggested target annotated), and price history with notes. `tsc` clean. Not yet click-tested live.

**Write side built** (2026-07-10) — a full loop to *feel*: `POST /amz-apply` (`routes/amz-apply.js`) records one
price to `amz_price_log` (blocks below cost+FBA floor, flags above RRP; **never** writes `amzfeed`; does **not**
change the live Amazon price by itself). UI: a one-click **Apply** on each green row (note defaults to the
suggestion "why", so rationale is auto-captured), a **"Set price"** box in the drill for custom/considered moves
(e.g. Frisco "try a little higher"), **"Accept all N greens"** batch, a **session upload basket** with a
**Download upload file** button (builds the one tab-separated Seller Central file client-side from the queued
rows), and an optimistic old→new "queued" overlay on applied rows. `applyAmzPrice()` + types in `api.ts`. `tsc`
clean. Not click-tested live.

**Design change — the phantom-diff basket was wrong (important).** Spec §3's "pending = latest log ≠ live
amzfeed price, no extra column" does NOT survive live data: it surfaces *months-old* mismatches (failed/superseded
historical logs), not just this session's changes — a file built from it would re-push 40+ stale prices.
`routes/amz-pending.js` + `routes/amz-upload-file.js` + `utils/amzPending.js` implement that model and are
**written but NOT mounted**. For now the basket is **session-scoped client-side** (matches today's ephemeral-file
workflow). A *persistent* basket needs an explicit **`amz_price_log.uploaded_at`** flag (pending = not-yet-stamped;
download/"mark uploaded" stamps them) — a deferred decision that needs a live-DB schema change.

**Not yet / next refinements:** (a) **round-trip guard** — teach the classifier to read a *soft ceiling from the
SKU's own recent history* (if a higher price recently sold much slower, demote a creep past it to 🟡) so a
bounced price isn't walked back into a level that just failed, without anyone having to remember it; (b) the
`uploaded_at` persistent-basket decision; (c) `amz_price_log.changed_by` column (who applied). The apply write is
safe to test — it only adds an audit row and never touches Amazon or `amzfeed`; the price moves only when the
generated file is uploaded to Seller Central.

**The two decisions that were made (2026-07-09):**
1. **Auto-suggest moves** — each SKU row shows a suggested CREEP / DROP / REVERT + a target price the operator
   can accept or override (not just raw signals). Ports the `🟢/🟡/⚪` engine from `AMZ_FULL_REVIEW.md`.
2. **One combined list with segment as a filter, not a navigation level** — a strip of segment chips (+ an
   **All** chip) across the top, each with a live "needs-attention" badge; the list below shows the selected
   chip. This gives *delegation* ("you take Rieker today" = the RIEKER chip / a shared `?segment=` URL bounds
   the whole screen to that segment) **and** an at-a-glance overview (the chip badges) **without** a separate
   segment landing page. Segment context is required anyway — the auto-suggest engine judges each row against
   its own segment's floor/ceiling/step-band.

**The one architectural thing that is genuinely new (see §3):** the Amazon apply path today is *Claude on the
operator's machine* appending rows to `%USERPROFILE%\Downloads\AMZ-Price-Upload.txt`. A web app (server on the
VPS, web on Vercel) **cannot write the operator's Downloads folder.** So the flat file stops being a file on
disk and becomes a **generated one-file download**, and "pending upload" is derived from a **phantom-diff**
(`amz_price_log.new_price ≠ amzfeed.amzprice`) rather than tracked with a new column. This resolves the
owner's "one file, not one-per-SKU" instinct cleanly.

**Next up / the one thing to resolve before the auto-suggest engine can be *exact*:** the per-segment
parameters (floor / ceiling / step-band) currently live in **markdown** (`AMZ_PRODUCTS.md`), which the web app
can't read. See §6 — proposal is a small `amz_segment_params` table seeded from the registry. Until that
exists, the engine can still run using the **economic hard-floor** it can compute from the DB
(`cost + fbafee + min margin`) and RRP as the only ceiling; the tidy working-floor / discovered-ceiling /
step-band refinements need the params table.

**Build order (suggested):**
1. ✅ **Read: segments + counts** — `GET /amz-segments` (managed segments that have `amzfeed` rows, each with
   90d units/profit, last-sold, and a needs-attention count for the chip badge). *Done.*
2. ✅ **Read: the SKU list** — `GET /amz-skus?segment` (one row per SKU with signals **and** the computed
   suggestion). This is the heart of the screen. *Done.*
3. **Read: the drill** — `GET /amz-sku?code` (lazy: 6-week velocity, this SKU's `amz_price_log` history, and
   the sold-price bands) for the expand-in-place panel.
4. **Write: apply** — `POST /amz-apply {code, newPrice, note?}` → `INSERT amz_price_log` only (§4). Never
   touches `amzfeed`.
5. **The upload file** — `GET /amz-upload-file` streams the single tab-separated `.txt` built from the pending
   set (§3), + a basket count (reuse the phantom-diff).
6. **Params table (can be step 0)** — `amz_segment_params` seeded from `AMZ_PRODUCTS.md` so the suggestions are
   exact (§6).

**Deploy (reminder, no action now):** web (Vercel) and server (VPS/PM2) deploy separately; the server step is
manual (`docs/deploy.txt`). If §6's params table is added, run its DDL on the prod DB as part of the deploy.

---

## 1. Purpose & the "why"

~95% of Shopify is Birkenstock, but **Amazon is a different business** — FBA only, different brands (Lunar/IVES
is the core, plus Rieker, Remonte, Strive, Skechers, …), different customers, priced completely separately.
Amazon's job is **"price follows performance, continuously"**: creep up on strong, well-stocked sizes; cut dead
stock; always hunting the best profit at a sustainable velocity. There is no "done" and no restock/park lever
in the Shopify sense — the signal is **velocity**, not a review clock.

Two hard rules from the engine that shape the whole UI:

- **SKU-grain, always.** On Amazon each **size is its own SKU with its own price**. A groupid can look healthy
  overall while individual sizes are dead. So the list is one row **per SKU**, never per groupid. (This is the
  single most common mistake the engine warns about — the UI must make the per-size view the *only* view.)
- **Both directions live in one list.** A single colour routinely has a dead-pile size to clear *and* a
  scarce-but-selling size to harvest up. So — unlike Shopify's WINNERS|LOSERS split — Amazon is **one list**;
  the suggestion column (CREEP vs DROP) carries the direction per row.

Today this is done conversationally: the operator says "full ives review" or asks an ad-hoc question, Claude
runs the SQL in `AMZ_PRICING.md`/`AMZ_FULL_REVIEW.md`, classifies, and applies. This module turns the routine
part of that into a screen the operator can drive without Claude in the loop — quick change or dig deeper —
while the conversational deep-dive stays available in Claude for the judgment cases.

---

## 2. Screen shape (one page, leaner than Shopify)

```
Amazon Pricing                                          [ ⬇ Upload file (3) ]
[ All 23 ] [ IVES-WHITE 8 ] [ IVES-COLOUR 5 ] [ RIEKER-SUM 4 ] [ REMONTE-WIN 3 ] …
                 ▲ selected
IVES-WHITE · cost £15.99 · FBA £3.06 · floor £35.99 · ceiling £40.00 · RRP £45.00   (shown only when one chip active)
──────────────────────────────────────────────────────────────────────────────────
 SKU (size)   Price    →  Suggest   Why                       FBA(+in)  7d 14d ret%  dead
 -04 (48)     37.99    →  38.29     🟢 creep .30 (4u/24h)      96        4   9   11%   —     ✎
 -05 (49)     39.69    →  —         ⚪ just changed             41        0   1   0%    9d    ✎
 -08 (52)     38.49    →  37.99     🟡 drop .50 (16d dead)     22        0   0   0%    16d   ✎
   ▸ dig deeper → 6-wk velocity · price history · size/price bands   (expands in place)
```

**Level structure:** effectively one level. Segment chips are a **filter**, not a route. The list is the page.
The "drill" is a **row that expands in place** (no separate `/style/[…]` route like Shopify has).

- **Chips** — the managed segments that have live `amzfeed` rows, each with a needs-attention badge (count of
  🟢+🟡 rows in that segment), plus **All**. Default lands on **All** (or the last-used chip — nice-to-have).
  Selecting a chip is the delegation primitive: it bounds the whole screen to that segment and is shareable via
  `?segment=`.
- **Economics caption** — visible only when a single chip is active (not on All): the segment's
  cost/FBA/floor/ceiling/RRP from the params table (§6). Frames every suggestion in the list below.
- **The list** — one row per SKU. Columns: SKU + size, current price, **suggested move + target price + a
  one-line why**, FBA live (+inbound), sold 7d, sold 14d, return% (14d), days-since-sale. Sorted so the
  actionable rows (🟢 then 🟡) sit at the top, ⚪ holds collapsed/greyed at the bottom.
- **Quick change** — the `✎` on a row opens an inline price field pre-filled with the suggested target. Accept
  or type your own → Apply → the row updates and drops into the upload basket (badge on the Upload button
  increments). No navigation.
- **Dig deeper** — expanding a row lazily loads the drill panel: 6-week velocity sparkline (units/returns/avg
  price per week), this SKU's `amz_price_log` history, and the sold-price bands (units at each distinct sold
  price, last 60d — the stalling-creep guardrail). Same data the engine's 🟡 blocks pull.

**Reuse from the Shopify module:** `AppShell`, the `{ success, return_code }` envelope, `withTransaction`,
`utils/sql.js → safeNumeric`, the money/date helpers, the `src/lib/api.ts` client pattern. **Not** reused: the
WINNERS|LOSERS switch, the review-date/park concept, the Shopify/Google price push.

---

## 3. The upload file — the one genuinely new mechanism

**Problem:** the manual process appends a row per change to `%USERPROFILE%\Downloads\AMZ-Price-Upload.txt` on
the operator's own machine. The web server (VPS) and web app (Vercel) can't write that folder. And the owner
explicitly does **not** want one file per SKU.

**Model:** the app never writes a file to disk. Instead:

1. **Apply = log only.** A price change writes **only** `amz_price_log` (§4). It never touches `amzfeed`
   (`amzfeed` is refreshed every morning from real Amazon data — any write is clobbered next day; this is a
   hard rule from `AMZ_PRICING.md`).
2. **"Pending upload" is derived, not stored.** A change is pending exactly when
   `amz_price_log.new_price ≠ amzfeed.amzprice` (the live price), for the latest log row per `code`. This is the
   same **phantom-diff** `AMZ_FULL_REVIEW.md` step C already uses for reconciliation. Once the operator uploads
   the file to Seller Central and the next-morning `amzfeed` refresh runs, `amzprice` catches up and the row
   silently stops being pending. A genuinely **failed** upload stays mismatched → stays in the basket → appears
   in the next generated file. No `uploaded_at` column, no "mark uploaded" button needed.
   - *Caveat (acceptable, matches today's process):* between a change and the next-morning refresh, everything
     changed today reads as pending — correct, that's what should be in the file. Multiple changes to one SKU
     in a day resolve to the latest log row.
3. **Download one file, on demand.** The **Upload file (N)** button streams a single tab-separated `.txt` built
   from the whole pending set — lands in Downloads, operator uploads to Seller Central when it suits, exactly
   as today. Format (from `AMZ_PRICING.md`):
   ```
   sku	price	minimum-seller-allowed-price	maximum-seller-allowed-price
   ```
   - `sku` = **`amzfeed.sku`** (the Amazon SKU, e.g. `AD-0XF8D-48L`) — **not** our `code`. The generator joins
     `amz_price_log.code → amzfeed.code` to get `sku`.
   - `price` = the pending `new_price`.
   - `minimum-seller-allowed-price` = blank.
   - `maximum-seller-allowed-price` = the segment's **RRP** (params table §6, or `skusummary.rrp` via
     `safeNumeric` as the fallback).

The badge count on the button = size of the pending set (one cheap query). This is the whole "basket."

---

## 4. Writes (must be exact)

**Only one write, and it is deliberately smaller than the Shopify W1.** No transaction spanning two tables is
strictly required (single INSERT), but wrap it in `withTransaction` for consistency and future-proofing.

**W-A1 — apply price (`POST /amz-apply {code, newPrice, note?}`):**

- **Bounds (server-side, never trust client):** block `newPrice < hard-floor` (`cost + fbafee`, both read via
  `safeNumeric` from `skusummary.cost` + `amzfeed.fbafee` for that `code`); allow-but-flag `newPrice > RRP`.
  (The tidy working-floor and discovered-ceiling are *guidance in the suggestion*, not hard write bounds — the
  engine explicitly clears dead piles below the tidy floor.)
- **Round to 2dp.** Amazon prices are plain numbers here (not the `character varying` junk problem Shopify has),
  but keep 2dp discipline.
- Resolve `changed_by` server-side from the JWT (as everywhere). *(Note: `amz_price_log` currently has no
  `changed_by` column — see §6/schema note; add one, or carry the operator name into `notes`.)*
- **INSERT `amz_price_log (code, old_price, new_price, notes)`** where `old_price` = current `amzfeed.amzprice`
  (via `safeNumeric`), `new_price` = the applied price, `notes` = the operator's optional free-text rationale
  (blank if none). `log_date` defaults to today. **Do NOT UPDATE `amzfeed`.**

There is **no W2 / park** — Amazon has no review-date/cooldown concept. The equivalent of "leave it alone" is
simply not changing the price.

---

## 5. The auto-suggest engine (port of `🟢/🟡/⚪`)

Compute per SKU, server-side, in `GET /amz-skus`. This is the `AMZ_FULL_REVIEW.md` Step 2 classifier, lifted
verbatim; read that doc for the exact thresholds and rationale. Summary of what each row's **suggestion** is:

- **🟢 ROUTINE** (auto-suggested move the operator can accept in one click):
  - **CREEP** if `sold_7d ≥ 3` AND `return_rate_14d < 20%` AND `fba_live ≥ 3`. Step **£0.30** if price in the
    segment's step-band or last move was a creep, else **£0.50**. If the target would cross the segment ceiling
    without prior sales ≥ ceiling → demote to 🟡.
  - **DROP** if `days_since_sale ≥ 8` AND `fba_live ≥ 3`. Step **£0.50** (8–13d dead) or **£1.00** (≥14d,
    aggressive). If target < working-floor → demote to 🟡.
  - **REVERT** if last move was a creep, `sold_since_change = 0`, `days_since_change ≥ 2` → target =
    `pre_change_price` (undo the failed creep).
- **🟡 JUDGMENT CALL** (suggested but flagged — operator should look): returns ≥ 40%, contradictory signals,
  ceiling-cross without prior sales above, drop below floor, creep into thin stock (`fba_live ≤ 2`),
  stalling-creep pattern, dead tail ≥ 14d. Row shows the suggestion **and** a "why it's a call" note; expanding
  it shows the price-band history.
- **⚪ HOLD** (no suggestion, greyed, collapsed to the bottom): OOS, stock-thin with inbound, just-changed
  (`days_since_change < 3`), at-floor with velocity, steady 1–2/wk no trigger, settling, elevated-but-sub-40%
  returns (watch).

The per-row **inputs** all come from the `GET /amz-skus` query — it is essentially `AMZ_FULL_REVIEW.md` Step 1
query A (per-SKU state: current price, FBA live/total/inbound, sold 7d/14d, returns 14d, return rate,
last-sold, days-since-sale, last change + direction, sold-since-change, pre-change price). The **thresholds
that vary by segment** (floor, ceiling, step-band) come from §6.

> Design note: the suggestion is *advice*, never auto-applied. Nothing is written until the operator hits
> Apply on a row. "Accept all 🟢" as a batch action is a **nice-to-have fast-follow**, not v1 — v1 is
> row-by-row Apply, mirroring how lean the owner wants this.

---

## 6. Data model & the params question

**Reads (all existing tables):**
- **`amzfeed`** (FBA only, refreshed every morning — READ ONLY, never write): `code` (our SKU), `sku` (Amazon
  SKU for the upload file), `amzprice` (current live price), `fbafee`, `amzlive` (FBA sellable), `amztotal`
  (inc. inbound; `amztotal − amzlive` = inbound), `amzsold7`. Ignore `buybox`, `amzsoldprice`, `amzsolddate`.
- **`sales`** where `channel='AMZ'`: `solddate, code, groupid, qty` (negative = return), `soldprice`, `profit`.
  Velocity, returns, last-sold, sold-price bands all come from here (not from `amzfeed`'s unreliable sold cols).
- **`skusummary`**: `segment` (the chip / delegation unit), `cost`, `rrp` (both `character varying` → read via
  `safeNumeric`), `brand`, `title.shopifytitle` for a human name if wanted.

**Write:** `amz_price_log (id, log_date, code, old_price, new_price, notes)`.
> **Schema gap to close:** `amz_price_log` has **no `changed_by`** column. The platform convention is that
> `changed_by` is resolved server-side from the JWT and recorded. Add a `changed_by text` column (preferred), or
> — minimal — prefix it into `notes`. Decide when building W-A1.

**The params question (the one real open item):** the engine's segment thresholds — **working-floor, discovered
ceiling, step-band** — live in `AMZ_PRODUCTS.md` (markdown), which the web app can't read. Two ways:

- **(preferred) A small `amz_segment_params` table**, one row per managed segment: `segment, hard_floor,
  working_floor, ceiling, step_band_low, step_band_high, rrp, cadence`, seeded once from `AMZ_PRODUCTS.md`
  (idempotent setup script, same pattern as `scripts/setup-segments.js`). Gives exact suggestions and a single
  source the web app + the Claude engine can both read. Downside: two homes for the numbers — keep the markdown
  registry as the human-editable prose, treat the table as its machine mirror (or migrate the numbers to the
  table and have the doc point at it).
- **(fallback, v1-lite) Compute what's computable, default the rest:** hard-floor = `cost + fbafee` (from the
  DB), ceiling = RRP (until discovered), no step-band refinement (use the £0.30/£0.50 rule off "last move was a
  creep" only). Suggestions are then slightly cruder for segments with a *discovered* ceiling/floor (mainly
  IVES), fine for the many segments whose ceiling is "not discovered yet" anyway.

Recommend building the fallback first (unblocks the whole screen with zero new schema) and adding the params
table as the immediately-following refinement.

---

## 7. Endpoints (proposed)

All require `verifyToken`; all follow the HTTP-200 + `return_code` envelope.

- `GET /amz-segments` — chips: managed segments with `amzfeed` rows, each `{ segment, units_90d, profit_90d,
  last_sold, attention_count }`.
- `GET /amz-skus?segment` — the list: one row per SKU with the per-SKU state (§5 query A) **and** the computed
  suggestion `{ tier: green|amber|white, action: creep|drop|revert|hold, target_price, why }`. `segment=all`
  (or omitted) returns every managed SKU.
- `GET /amz-sku?code` — the drill (lazy): 6-week velocity, `amz_price_log` history for the code, sold-price
  bands (60d).
- `POST /amz-apply {code, newPrice, note?}` — W-A1 (§4).
- `GET /amz-upload-file` — streams the single tab-separated `.txt` from the pending set (§3); also expose the
  pending **count** (either a field on `/amz-segments`/a tiny `GET /amz-pending`, or a `HEAD`-style count) for
  the button badge.

---

## 8. Out of scope for v1

- **"Accept all 🟢" batch apply** — fast-follow; v1 is row-by-row Apply.
- **Writing `amzfeed`** — never (hard rule).
- **A review-date / park concept** — Amazon doesn't have one.
- **Shopify / Google price push** — Amazon's channel is the flat-file upload only.
- **Range decisions** (which colours/styles to stock or drop) — a separate job from pricing, per the engine.
- **The conversational deep-dive** — stays in Claude via the `amz-price` docs; this screen is the routine
  quick-change surface, not a replacement for judgment-heavy investigations.

---

## 9. Open items to confirm before/while building

1. **Params table vs. compute-and-default** (§6) — recommend: ship the fallback, add the table right after.
2. **`amz_price_log.changed_by`** (§4/§6) — add the column (preferred) or fold into `notes`.
3. **Default chip on load** — All, or last-used? (nice-to-have; default All is fine for v1.)
4. **Attention badge definition** — count of 🟢+🟡 per segment (proposed) vs. 🟢 only.
