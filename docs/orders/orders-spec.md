# Orders (Supplier Restock) — Working Spec (DRAFT)

> Design spec for the **Orders** module: placing restock orders with suppliers. Modernises the legacy
> PowerBuilder "Amazon Order" screen into a web screen that helps the operator *decide what to order*
> — for a chosen supplier, see what's selling and what's most profitable on Amazon, net off everything
> already in the pipeline (so we don't over-order), pick a cover target, and read out suggested
> quantities. Same throw-away scratch-spec style as `amz-pricing-spec.md` / `add-modify-spec.md`.
> **Nothing here is built yet.** This captures the agreed model + the legacy landmines so they don't evaporate.
> This module is **big** — expect to build it across several sessions. Phased hard (see §2).

---

## 0. STATUS & NEXT UP  (read this first)

**⛔ PARKED 2026-07-10 — spec only, nothing built, no build scheduled.** Owner's call: the legacy order screen works
and ordering (~weekly) **isn't a pain point**, so the effort is better spent on other areas of the business. This is
option **(B)** in the scope decision below. The spec + all legacy reference are saved here so it can be **revived
anytime** with full context. If revived, the agreed shape is option **(A)**: a read-only decision front-end that
mirrors the legacy stock math and never writes (which sidesteps every messy-flow problem). Do **not** resume building
without a fresh owner decision.

**🟡 SPEC DRAFT (as-researched) — 2026-07-10.** All reference material lives in this folder: `legacy/` holds the legacy
screen (`legacy-order-screen.png`) and five PowerBuilder sources — `filter-amz-stock-powerbuilder-code.txt` (what the
order screen shows when you filter), `update-amz-data-powerbuilder-code.txt` (the every-morning data refresh — **out
of scope**), the two helper functions `wf_getorderstatusstock.txt` + `of_localamazon.txt` (how legacy reads inbound +
local-earmarked stock), and **`order-request.txt`** (the legacy "Request" step — the actual write into `orderstatus`).
Written also from live-DB inspection of `orderstatus` / `stockorder` / `supplier` / `amzfeed`. Nothing built. Next
session: confirm the §9 open questions, then build **Phase 1** (read-only decide screen) only.

**The real ordering lifecycle (owner, 2026-07-10) — 3 stages, not one "save":** the operator works an order up over
the day in stages, which maps onto our phases and the eventual write model:
1. **Save (draft)** — build/adjust order quantities through the day, coming back to it. In legacy the pending qty
   lives on `skumap` (`amzrequest`/`amzpickrequest`); nothing is in `orderstatus` yet. *→ this is Phase 1's on-screen order list.*
2. **Request** — commit the draft into `orderstatus`: **one `qty=1` row per unit** (`order-request.txt`), `ordertype=3`,
   `arrived=0`, `createddate=today`, **`orderdate` left blank**. Now it counts as incoming pipeline stock, but it is
   *not yet actually ordered from the supplier*. *→ Phase 3, step 1.*
3. **Confirm** — when the operator has actually placed it with the supplier, **stamp a date into `orderstatus.orderdate`**.
   That field is the "I've really ordered this" marker. *→ Phase 3, step 2.*

**`qty` is a dud — always 1, duplicated lines (owner confirmed).** Every ordered unit is its own row so it can be
**marked off one-by-one at Goods In**. So an order of 6 = 6 rows. Do **not** collapse to `qty>1`. (This resolves §9's
old qty question — locked.)

**Two owner decisions locked in (2026-07-10):**
- **Amazon-only to start.** Local/Shopify ordering (`ordertype=2`) is a *different process* and rare — it's ~6-month-
  ahead Birkenstock, not weekly restock. Phase 1 is **FBA restock only**. (§9 Q1 resolved.)
- **Do NOT rely on `stockorder`.** The owner doesn't recognise/use it (likely a retired legacy report); it's only
  ever appended to. It's **small and not a runaway** (see note) but we won't read or write it — if Phase 3 needs an
  order-history ledger we create **our own new table** instead.

> **`stockorder` health check (for the owner's separate review):** 3,580 rows total, earliest `2025-07-06`, latest
> `2026-07-07` — i.e. it holds **almost exactly one rolling year** and adds only a few thousand rows/year (~30–800 a
> month, one row per unit ordered). Either something already prunes it to ~1yr or it simply started a year ago; **not
> a runaway** (trivial size). Nothing here depends on it; safe for the owner to prune/drop on their own schedule.

**The one hard constraint the owner flagged:** do **not** replace or restructure `orderstatus`. It is a legacy
mega-table that many other modules read/write — **Goods In** (marking stock as arrived) and **customer shipping
label printing** both depend on its exact shape. We may use our own tables, **but any order we place must be
mirrored into `orderstatus`** so the legacy inbound-stock counts + Goods In keep working. Safest early stance:
**write nothing** in Phase 1 (decide-only), and when we do write (Phase 3), mirror `orderstatus` faithfully.

**Scope of this project (owner's framing):** *"Let the user read from the screen and enter manually into the
supplier system for now."* So Phase 1 is a **decision aid only** — no file, no DB write. The file export and the
DB write are explicitly **later phases**. Goods In / arrival-marking **stays in the legacy app** — we only do the
*placing* of the order here.

**⚖️ THE SCOPE DECISION (open, owner deliberating 2026-07-10).** Three realistic end-states, not a ladder:
- **(A) Read-only decision front-end, and stop there — RECOMMENDED if we do anything.** Build Phase 1 only (a nicer,
  faster, browser-accessible "what should I order this week" screen), **mirror the legacy stock math verbatim**, and
  keep *placing* the order in the legacy app / by hand. **Reads only → zero risk** to Goods In, Shopify labels, or
  `orderstatus` integrity, and it **sidesteps every messy-flow problem** (the double-count landmine, the pick/allocate/
  goods-in tangle, `ordernum`) *because we never write*. Effort is comparable to the already-built Amazon-Pricing
  winners/losers screens. The write-back (Phases 2–3) is explicitly **treated as out of scope, maybe forever** — that's
  where "big" lives.
- **(B) Do nothing / park.** The legacy screen *works* and the original was "pretty good". Ordering is ~weekly and
  judgment-dense — a screen relieves less throughput pressure than a high-volume flow would. Other business areas may
  simply pay off more. **A legitimate, even good, answer.**
- **(C) Complete rebuild** (ordering **+** pick/allocate/goods-in/labels). Only this forces us to clean up the
  double-count/location flow and own the write path end-to-end. **Big, high-risk, touches many legacy modules — not
  recommended now** (and not what this project set out to do).

**The deciding question for (A) vs (B):** is the *decision itself* (what/how many to order) currently slow, error-prone,
or chained to one PowerBuilder workstation? If yes → (A) is cheap and genuinely useful. If the current screen is fine and
ordering isn't a pain point → (B). The Amazon-Pricing lesson applies: *screens win for high-volume standardised execution;
for low-volume judgment-dense work, only build the screen if it makes the judgment materially faster.* Everything below
specs the full picture, but **if we proceed, build (A) and hold the line there.**

---

## 1. Purpose & the "why"

**Weekly restock (not a hard cadence).** The owner normally orders once a week, per supplier, but that's an
internal rhythm, not a rule — the screen must let you order any supplier any time. Ordering is done **per
supplier** (you sit down and do "today's Lunar order") and mostly **Amazon-first** (FBA restock), though Shopify/
local ordering exists too and isn't always separate.

**Why this is a different job from Shopify Pricing.** The Pricing modules assume Birkenstock **can't be
re-ordered on demand** (ordered ~6 months ahead — squeeze margin from stock in hand). Ordering is the *opposite*
lever and mostly a *different supplier base*: Lunar (the IVES core), Rieker, Remonte, Skechers, Crocs, etc. **can**
be re-ordered. So here the job is genuinely *"how many more should we buy?"* — a forward supply decision, not a
harvest. (Birkenstock still appears as a supplier but is largely order-ahead; treat it like the others mechanically,
the human knows when it's re-orderable.)

**The core decision (Amazon focus).** For a chosen supplier: look at what's **selling** on Amazon and what's
**making the most profit**, then estimate **how many new units to buy** to hit a chosen **cover** target — with a
toggle of **0.5 / 1 / 2 / 3 months** of cover. The essential discipline is **don't over-order**: before suggesting
a quantity, net off *everything already in the pipeline* — live FBA stock, stock already **on the way to Amazon**,
stock **on the way to us**, and local stock. (This netting is the whole point of the legacy screen's stock columns.)

**What this module does NOT do:** it does not decide *range* (which styles/colours to stock or drop — a separate
job), it does not price (that's the Pricing modules), and in Phase 1 it does not place the order anywhere — it
tells you *what* to order so you type it into the supplier's own system.

---

## 2. Phases (build strictly in this order)

**Phase 1 — Decide (this project, first & only for now). READ-ONLY.**
Pick a supplier → a modern table of that supplier's Amazon SKUs with sales/profit/stock signals → a **cover
toggle (0.5/1/2/3 mo)** that computes a **suggested order qty per SKU** → operator tweaks quantities → builds up
an on-screen **order list** they can read/print and type into the supplier's system by hand. **No DB write, no
file.** The screen is the deliverable.

**Phase 2 — Export file.** Produce a **simple download file** from the order list — a generic sheet first, then
per-supplier formats (some suppliers accept an upload file). Still no DB write; the file is for the operator to
type/upload into the supplier system. (Mirror the Amazon-Pricing "one file, built client-side, lands in Downloads"
mechanism.)

**Phase 3 — Persist the order (mirror `orderstatus`).** Two sub-steps mirroring the legacy lifecycle (§0/§7):
**Request** inserts the "on order, not arrived" rows into `orderstatus` (one `qty=1` row per unit, `orderdate` blank)
so inbound counts + Goods In + labels keep working; **Confirm** later stamps `orderstatus.orderdate` = "really placed
with supplier". No `stockorder` (owner's call — our own ledger only if needed, §7). Goods In / arrival marking **stays
legacy**. This is the only phase that touches live product data; treat with the same care as the Pricing W1/W2 writes
(test via `BEGIN … ROLLBACK`).

Everything below describes the full picture; **build only Phase 1 first.**

---

## 3. The stock model — the four+ buckets (avoid over-ordering)

This is the heart of the screen and the thing the legacy code spends most effort computing. To know if we need to
order a SKU we need its **true available position on Amazon**, which is spread across several places:

| Bucket | Meaning | Source (modern) |
|---|---|---|
| **FBA live** | Sellable now at Amazon (`afnfulfillable`) | `amzfeed.amzlive` (already buffer-adjusted by the morning refresh — see note) |
| **FBA total** | At/aimed-at Amazon incl. Amazon-side inbound/processing (`afntotal`) | `amzfeed.amztotal` (`amztotal − amzlive` ≈ Amazon-side inbound) |
| **On the way to Amazon** | Units **ordered from the supplier** destined for FBA, not yet arrived | `orderstatus` `ordertype=3`, summed **`qty − arrived`** by `shopifysku`(=code) — see arrived note |
| **On the way to us (local)** | Supplier restock heading to our warehouse, not yet arrived | `orderstatus` `ordertype=2`, `qty − arrived` (out of scope Phase 1) |
| **Local sellable** | In-hand warehouse stock | `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0` (per CLAUDE.md) |
| **Local earmarked for Amazon** | Local units explicitly allocated to send to FBA | `localstock` where `ordernum='#FREE' AND allocated='amz' AND deleted=0`, summed `qty` (legacy `of_localamazon`) — **not** `skumap.localreserve` |

> **`arrived` is a QUANTITY, not a 0/1 flag** (confirmed in `wf_getorderstatusstock`): "still incoming" for a row =
> `qty − arrived`, summed across rows. On the current per-unit rows (qty=1) this is effectively 0/1, but the model
> supports partial receipts. Net with `qty − arrived`, never `WHERE arrived=0`.
>
> **`orderdate` = "really placed with the supplier"** (blank until the Confirm step, §0/§7). Legacy's stock netting
> counts **all** `ordertype=3` rows with `qty > arrived` regardless of `orderdate` — so a *Requested-but-not-yet-
> Confirmed* unit already reduces the suggested order (it's committed intent). Keep that behaviour: incoming =
> requested **or** confirmed. `orderdate` is for the operator's "have I actually ordered this yet?" view, not the netting.
>
> **Full `ordertype` map** (from `wf_getorderstatusstock`, richer than the live data shows): `1`=customer order,
> `2`=local order (to us), `3`=amazon order (to FBA), `4`=local pick/transfer, `5`=amazon pick/transfer. Legacy's
> "amazon" bucket = `ordertype IN (3,5)` and "local" = `IN (2,4)`. For Phase 1 the on-the-way-to-Amazon bucket is
> **`ordertype=3`** (a fresh supplier order); `5` (amzpick) is an internal local→FBA transfer — confirm whether to
> include it in "available".

Legacy composition (from `filter-amz-stock`):
```
localstock = wf_localcountwithoutamz(code)        // ← LOCAL column EXCLUDES allocated='amz' (key!)
amztotal   = fbatotal(afntotal) + amzorder(on-way-to-amazon) + localamazon(local earmarked, allocated='amz')
totalstock = amztotal + localstock + birkstock + localorder(on-way-to-us)
```
So the legacy **AMZ TOTAL** column already folds in *on-the-way-to-Amazon + local-earmarked*, and **TOTAL** adds
local + on-the-way-to-us. **Available-for-Amazon-cover** (what the order calc nets against) is the AMZ TOTAL side;
local stock is a secondary source the human may choose to send in rather than buy new.

> **⚠️ Double-count landmine (owner, 2026-07-10) — this is a chunk of *why this is bigger than it looked*.** A
> `localstock` row keeps `allocated='amz'` **both** while it's still sat in the unit (e.g. location `C1-row1`) **and**
> after it's physically picked and moved to the Amazon packing area (`C3-Amazon`) ready to ship to FBA. Physically
> those are two different states — "earmarked, still here" vs "on its way to Amazon" — but they carry the *same*
> `allocated` flag, distinguished only by **location**. So any code that tries to count "on the way to Amazon from
> local" *separately* (by C3-Amazon location) **on top of** `of_localamazon` (all allocated='amz') would **double-count**
> the staged units. **Good news for us:** the legacy screen does **not** double-count — it uses `allocated='amz'` as
> one combined bucket (`of_localamazon`) and its LOCAL column deliberately *excludes* amz-allocated
> (`wf_localcountwithoutamz`). **So a read-only screen that mirrors the legacy composition verbatim is already
> correct** — we do **not** need to untangle the C1-vs-C3 location semantics. We'd only hit this wall if we tried to
> *rebuild* the pick/allocation/goods-in flow (which we're not). If we ever want the finer "in unit vs staged" split,
> it comes from `localstock.location`, and the earmarked bucket would have to be split, not summed twice.

> **Buffer note:** the morning refresh (`update-amz-data`, out of scope) already subtracts `gi_amzstockbuffer`
> from `afntotal`/`afnfulfillable` before storing `amzfeed.amztotal`/`amzlive`. So `amzfeed` values are
> **conservative already** — don't double-subtract. (Reason: keep a safety cushion so we never oversell FBA.)

---

## 4. The order calculation (cover toggle)

Goal: suggested order qty per SKU to reach the chosen **cover months**, netting off the pipeline.

Sketch (to refine with the owner — legacy has extra knobs):
```
monthly_rate   = AMZ units sold over window ÷ window_months      (window default 30d? confirm — legacy uses "sold" + "sold7")
target_units   = cover_months × monthly_rate                     (cover_months ∈ {0.5, 1, 2, 3})
available      = FBA live + on-the-way-to-Amazon + local-earmarked-for-Amazon   (§3 "AMZ TOTAL" side)
suggested      = max(0, round(target_units − available))
```
Then apply the legacy controls (top-left of the screen), which we should carry across (confirm semantics, §9):
- **Pick Keep** — a minimum to always keep/hold (floor on stock, so we top up to at least this).
- **Rate** — a rounding/multiplier step (e.g. order in packs / round up to a rate).
- **Max** — a cap per SKU ("No Max" default) so a spike doesn't blow the order out.
- **Cost / Refresh Cost** — pulls current supplier cost (for the order value + ROI display; `stockorder.cost` /
  `skusummary.cost`).

**Velocity source:** use the same clean source as Amazon Pricing — `sales WHERE channel='AMZ'` (units, returns,
last-sold), **not** the unreliable `amzfeed` sold columns. Net of returns. Returns matter here too (a high-return
SKU shouldn't be over-bought). "Sold 7" (last-7-day pace) vs 30-day is a seasonality tell — show both, like legacy.

**Honest caveat (carry the Pricing-module discipline):** for seasonal styles a rising 7-day pace can be the season
arriving, not durable demand — so the suggestion is *advice*, always operator-editable, never auto-committed.

---

## 5. Screen shape (Phase 1)

Modernise the legacy screen (`lagacy-order-screen.png`), keep what works, drop the clutter. The legacy grid columns
were: `CODE · STS · LOCAL · AMZ LIVE · AMZ TOTAL · NET SOLD · SOLD7 · AMZ ORDER · AMZ PICK · PROFIT · SOLD PRICE ·
LAST SOLD · AMZ PRICE · RRP · SKU · BARCODE`, with a summary box (Items / Sold / Returns / Return Rate / Revenue /
Live %) and controls (Pick Keep, Rate, Max, Cost, Calculate Order, Display Order, Load Pick, Request, Export, SAVE…).

```
Orders                                              [ supplier ▾ Lunar ]   cover: [0.5][1]•[2][3] mo
Search ______   [Any stock▾] [In Amazon▾] [Sold▾]                     ⬇ later: export / save
Items 59 · Sold 493 · Returns 110 (22.3%) · Revenue £18,490 · FBA live 97%
────────────────────────────────────────────────────────────────────────────────────────────────
 SKU (size)  Title            FBA  →AMZ  →Us  Local | Avail  30d 7d  /mo  Cover  Profit ROI | Order
 IVES-STONE-06                  4    2     0    0   |   6     13  4   ~11  0.5mo  £3.53  22% |  [ 6 ]
 IVES-STONE-07                  0    2     0    1   |   3      9   3   ~8   0.4mo  £2.39  15% |  [ 9 ]
 …                                                                                              Σ 148 units · £2,367
   ▸ dig deeper → per-size velocity · on-order now (orderstatus ot3) · price bands   (expand in place)
```

- **Supplier picker** (required, drives everything) — from the `supplier` table (UKD, Rieker, Birkenstock, Bloch,
  Lunar, Crocs, Hotter, Skechers, Remonte). Selecting a supplier bounds the whole screen; shareable via `?supplier=`.
- **Cover toggle** 0.5 / 1 / 2 / 3 mo — recomputes the **Order** column live (client-side; the per-SKU inputs are
  already loaded).
- **Stock columns** = the §3 buckets, culminating in **Avail** and a **Cover** readout (weeks/months the current
  Avail lasts at the monthly rate). This is the over-ordering guard made visible.
- **Order column** — pre-filled with the suggested qty, **editable**; a running **Σ units / Σ cost** footer = the
  order value. This *is* the order list the operator reads out / (Phase 2) exports.
- **Dig deeper** (expand in place, lazy) — per-size velocity (6-wk), this SKU's **recent inbound**
  from `orderstatus` (`ordertype=3` rows — what's already on order, arrived vs outstanding — stops double-ordering
  week to week), and sold-price bands. Mirrors the Amazon-Pricing drill. (No `stockorder`.)
- **Filters** carried from legacy (nice-to-have): In-Amazon / Not, Sold 1+/2+/none, Local-stock 0 / 1+, Season,
  Status. Text search over code/sku/supplier/season. Don't build all in v1 — supplier + cover + editable order is
  the minimum useful screen.

**Reuse:** `AppShell`, the `{ success, return_code }` envelope, `utils/sql.js → safeNumeric` (price cols are junky
`varchar`), the money/date helpers, the `src/lib/api.ts` client pattern, the Amazon-Pricing drill query shapes.

---

## 6. Data model — reads (all existing tables)

- **`amzfeed`** (FBA only, refreshed every morning, **READ ONLY** — never write, clobbered nightly): `code`, `sku`
  (Amazon SKU), `fnsku`, `asin`, `amzprice`, `amzlive`, `amztotal`, `fbafee`, `amzsold7`. (Buffer already applied.)
- **`sales` WHERE `channel='AMZ'`**: `solddate, code, groupid, qty` (negative = return), `soldprice`, `profit` —
  velocity / returns / last-sold / profit-per-unit. (Same source Amazon Pricing uses.)
- **`skusummary`**: `supplier` (join key for the supplier filter), `cost`, `rrp` (both `varchar` → `safeNumeric`),
  `season`, `shopify`, `tax`; `title.shopifytitle` for a human name.
- **`skumap`**: one row per variant — `code`, `sku`, `fnsku`, size = `RIGHT(code,2)`, `minstock`, `localreserve`,
  `fbafee`, `amzorderdate2` (last AMZ sale date, maintained by the morning refresh), `notes`, `status`.
- **`localstock`**: sellable = `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0` (per CLAUDE.md landmine).
  Amazon-earmarked = same but `allocated='amz'` (the `of_localamazon` rule).
- **`orderstatus`**: the pipeline buckets (§3) — on-the-way-to-Amazon = `ordertype=3`, netted `qty − arrived`.
  **Read for buckets in Phase 1; write only in Phase 3.**
- **`supplier`**: single-column list of supplier names — the picker's source of truth.
- **`stockorder`** — ⛔ **do not use** (owner's call; retired legacy report, appended-to only). If Phase 3 wants an
  order-history/analytics ledger, create **our own new table** (e.g. `order_line_log`) instead of reading/writing this.

---

## 7. Writes — Phase 3 only (mirror the legacy `order-request.txt`)

**Not built until Phase 3.** Documented now from the confirmed legacy code so the shape is agreed. Two writes, matching
the lifecycle in §0.

### 7a. Request — insert the on-order rows (`POST /order-request`)

For each SKU's requested quantity, loop `1 … qty` and **insert one `orderstatus` row per unit** (all in one
`withTransaction`). Legacy `order-request.txt` sets exactly these fields — mirror them:

| Field | Value |
|---|---|
| `ordernum` | `"AMZ-O-" + <workstation/source> + "-" + <seq>` — a generated unique id (see counter note) |
| `shopifysku` | our `code` (NOT NULL) |
| `qty` | **1** (always; one row per unit) |
| `supplier` | the chosen supplier |
| `batch` | `"0"` |
| `fnsku` | from `skumap`/`amzfeed` |
| `channel` | `"MANUAL"` |
| `ordertype` | **3** (FBA order) |
| `createddate` | today |
| `arrived` | `0` |
| `orderdate` | **left blank** (stamped later at Confirm) |
| `ukd` / `othersupplier` | **UKD supplier → `ukd=1, othersupplier=0`; else → `ukd=0, othersupplier=1`** (confirmed). `amz` stays `0`. |
| all shipping/customer fields (`title, shippingname, postcode, address*, …`) | blanked — legacy calls `wf_blankorderstatus()` first; we replicate (set the dummy/NOT-NULL columns so the row is valid; legacy stores `'x'` placeholders) |

Legacy also clears the draft marker on `skumap` (`amzrequest = NULL`) once requested — our draft store (§ below) does
the equivalent.

**`ordernum` is just a free unique field (owner, 2026-07-10) — not a real constraint.** The `AMZ-O-`/`BC-` prefixes
were an old readability convention from when legacy code *branched on the prefix*; that logic was later replaced by
`ordertype` codes, and the prefix kept only for looks. **So we can mint whatever unique value we like** — a Postgres
`SEQUENCE` / `gen_random_uuid()` / a counter row, optionally with an `AMZ-O-WEB-<n>` prefix purely for readability.
Only hard rule: **unique** (it's the PK) and it **must not collide** with legacy-generated ids (a distinct prefix or a
disjoint number range does it). No need to replicate the INI counter.

### 7b. Confirm — stamp the order as really placed (`POST /order-confirm`)

When the operator has actually put the order into the supplier's system: `UPDATE orderstatus SET orderdate=<today/date>`
for the requested rows (by `ordernum` set, or by supplier + a session/batch id). No new rows, no stock change. This is
the "I've ordered it" marker (§3 note).

### 7c. Our own draft/ledger (optional)

- **Draft (Save stage):** where the in-progress quantities live before Request. Could be client session (like the
  Amazon-Pricing basket) **or** a small owned table if drafts must survive across days/devices (owner works an order up
  over a day). Legacy parks it on `skumap.amzrequest`; prefer **our own table** over reusing that column.
- **History ledger:** only if the drill's "what did we order before" needs more than the live `orderstatus` rows —
  then a **new owned table** (`order_line_log`), never legacy `stockorder`.

**Goods In stays legacy:** we insert `arrived=0`; the legacy app increments `arrived` (+ `arriveddate`) as units land.
We never touch arrival. **No FBA/`amzfeed` write** (nightly-clobbered). **No Amazon/supplier API** in scope.

> **Not our path — `amzpick` (`order-request.txt` second half):** the "AMZ PICK" branch does **not** place a supplier
> order — it re-allocates *existing local stock* to Amazon by splitting `localstock` rows to `allocated='amz'` (that's
> how the §3 local-earmarked bucket gets filled; `ordertype=5`). It's a stock-transfer action, separate from ordering.
> Out of scope here, but noted so the code isn't misread as part of the buy flow.

---

## 8. Out of scope

- **Range decisions** (what to stock/drop) — separate job.
- **Pricing** — the Pricing modules own it.
- **Goods In / arrival marking / shipping labels** — stays in the legacy PowerBuilder app (we must not break its
  `orderstatus` dependency, but we don't reimplement it).
- **Supplier APIs / EDI** — Phase 1 is manual entry; Phase 2 is at most a file to type/upload.
- **The morning data refresh** (`update-amz-data`) — continues as-is externally; we just consume `amzfeed`/`sales`.
- **Birkenstock true re-ordering logic** — mechanically the same screen; the human knows its order-ahead cadence.

---

## 9. Open questions to confirm before/while building

1. ~~Amazon-only first?~~ **Resolved: Amazon-only** (local is different/rare Birkenstock process). *(kept for record)*
2. ~~Rely on `stockorder`?~~ **Resolved: no** — use our own table if a ledger is needed (§6/§7). *(kept for record)*
3. **Cover-calc details:** velocity window (30d? blend 7d/30d?), and exact semantics of **Pick Keep / Rate / Max**
   from the legacy screen — carry them across or simplify?
4. **"Available" definition:** which buckets count toward cover? Legacy `amztotal = afntotal + amzorder(ot3) +
   localamazon(localstock allocated='amz')`. Confirm we net against that (and whether **amzpick `ordertype=5`**
   local→FBA transfers also count).
5. ~~qty>1 vs per-unit?~~ **Resolved: one `qty=1` row per unit** (mark-off at Goods In). *(kept for record)*
6. ~~supplier flag rule?~~ **Resolved from `order-request.txt`:** UKD→`ukd=1`; else→`othersupplier=1`; `amz=0`.
   *(kept for record)*
7. ~~`ordernum` scheme?~~ **Resolved: free choice** — any unique value (SEQUENCE/uuid/counter), just don't collide
   with legacy ids (distinct prefix/range). *(kept for record)*
8. **Draft storage (Save stage):** client session vs an owned table — must a half-built order survive across days/
   devices? (Owner works an order up over a day → leans to an owned draft table.)
9. **PO number:** the live rows share a `ponumber` (e.g. `083060`) — who allocates it (supplier / generated /
   operator-entered), and is it set at Request or Confirm?
10. **Cover-calc details:** velocity window (30d? blend 7d/30d?), and semantics of **Pick Keep / Rate / Max**.
11. **"Available" definition:** confirm we net against `afntotal + amzorder(ot3) + local-earmarked` (and whether
    `amzpick`/`ordertype=5` transfers count).
12. **Buffer:** confirm `amzfeed` is already buffer-adjusted (don't re-subtract) — verify current `gi_amzstockbuffer`.
13. **Summary tiles / return-rate window** — over what period (legacy box: Items/Sold/Returns/Rate/Revenue/Live %)?

---

## 10. Endpoints (proposed — Phase 1)

All require `verifyToken`; HTTP-200 + `return_code` envelope.

- `GET /order-suppliers` — the picker: supplier names (from `supplier`), optionally with a managed/has-Amazon flag
  and a headline count.
- `GET /order-list?supplier&days?` — the grid: one row per Amazon SKU for the supplier, carrying every §3 stock
  bucket + velocity (30d/7d, returns, last-sold) + profit/ROI + the per-SKU inputs the cover toggle needs. The
  cover math + suggested qty can be computed client-side from these inputs (so the toggle is instant), or
  server-side with a `cover=` param — **decide when building** (client-side preferred, mirrors Pricing).
- `GET /order-drill?code` — lazy: per-size 6-wk velocity, recent `orderstatus` inbound for the code (on order /
  arrived), sold-price bands.
- `GET /order-find?term` — SKU/supplier search (fast-follow).

*(Phase 2 adds `GET /order-file` — the export download. Phase 3 adds `POST /order-request` — insert the on-order
`orderstatus` rows, §7a — and `POST /order-confirm` — stamp `orderdate`, §7b.)*
