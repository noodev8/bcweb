# Inventory Management — Working Spec (DRAFT)

> Design spec for the **Inventory Management** module: a read-only stock-lookup screen. Filter the style
> list down by successive text terms, pick a groupid, and see *every* place a unit of that style can
> physically be — at size grain, with warehouse locations. Same "throw away when done" scratch-spec style
> as `add-modify-spec.md` / `amz-pricing-spec.md`.
> **Nothing here is built yet** — this captures the agreed model so it doesn't evaporate.

The source of truth for *where stock can be* is `docs/order-status-lifecycle.pdf` (pages 6 "Stock Position"
and 7 "Amazon Total Calculation"). Pages 1–5 describe the order lifecycle and belong to a **different,
later screen** (order status management). This spec does not re-derive them.

---

## 0. STATUS & NEXT UP  (read this first)

**Slices 1 + 2 BUILT 2026-07-19** (`tsc` clean, SQL validated against live prod, **not yet click-tested**).
Agreed with owner 2026-07-19; scope deliberately cut back twice during that conversation (see §7 for what
was cut and why — don't re-propose those).

- **Slice 1 — list + filter.** `GET /inv-styles` (whole list, one query, five CTEs; no `term` param — the
  client filters). Page `src/app/inventory/page.tsx`: Contains / Does-not-contain / FIND / Reset, breadcrumb
  and row count **at the top** (owner: don't make me scroll to see if I've narrowed enough). Both boxes force
  UPPERCASE. **Segment and Order are "hidden truths"** — fetched, and segment IS searchable, but neither is
  shown as a column (owner). Dashboard tile + header nav are live.
- **Slice 2 — size grid + image.** `GET /inv-stock?groupid`, component `src/components/InvStockPanel.tsx`.
  Grid is `Size (EU / UK) | Order | Total | Local` with an all-sizes total row; panel renders **above** the
  list; clicking the selected row again collapses it.

**Validation against the legacy screen:** `1005292-ARIZONA` returns sizes 35–41 as **3/10/5/5/3/7/5** and a
style total of **42**, matching `docs/inventory-powerbuilder.png` exactly. Size 36 is the proof of the
`SUM(qty)` rule — 9 rows, one carrying `qty=2`, so `COUNT(*)` would render 9 and be wrong.

- **Slice 3 — locations panel.** `GET /inv-stock` gained a `locations[]` array (every physical `localstock`
  row: size, location, qty, state, ordernum, plus `id` for phase 2). Component
  `src/components/InvLocations.tsx`, rendered under the size grid. Area buttons (C1 / C3 / C3 Front / C3
  **Driven by a chosen SIZE, not the whole style** (owner): click a size row in the grid, and the panel
  shows which racks hold that size. Until a size is picked it prompts. Clicking the size again clears it;
  picking a different style resets it (parent passes `key={groupid}`). No size column in the table — every
  row is the same size, named once in the header. Unit count, not row count, since `qty` can exceed 1.
  **Duplicate shelf lines are collapsed for the user view**: `localstock` stores two pairs on one shelf
  either as one row with `qty=2` or as two rows with `qty=1`, depending how they were scanned in, so the raw
  rows show the same location twice. Grouped by **location AND state** (never location alone — a shelf
  holding one free and one picked pair must stay as two lines, or the screen reads as 2 available when only
  1 is takeable). The underlying `localstock.id`s are kept on each grouped line for phase 2.
  **No area filter**: the PowerBuilder
  C1/C3/Front/Back/Shop buttons are for **assigning** a location when adding stock, which is phase 2 — not a
  filter on this read-only view (owner, corrected during build). Do not add filtering buttons here.

- **Slice 4 — Show Detail.** The grid's twelve buckets (§3b) plus the two derived rows, as extra COLUMNS
  appended to the right of Total/Local, grouped Here / Incoming / At Amazon. Off by default; scrolls inside
  its own container so the page body never scrolls sideways. Column headers carry `title=` tooltips.
  **The compact Local / Order / Total figures are DERIVED from the buckets server-side**, never computed
  independently — so the collapsed and expanded views are arithmetically incapable of disagreeing.

- **Birkenstock pre-order book (added 2026-07-19).** `GET /inv-stock` also reads **`birktracker`** — the
  ~6-months-ahead seasonal POs. This is a **separate notion of incoming from `orderstatus`**, which holds
  warehouse order lines and knows nothing about these; without it the screen cannot see what is coming from
  Birkenstock at all. Shown as its own **Birk PO → On order** column under Show Detail **and INCLUDED IN
  `Total`** (owner: "I know it's coming" — Birk is ordered ~6 months ahead and a placed PO is the brand's
  only replenishment, so the operator already counts it as stock they have). Never folded into **Incoming**
  (an `orderstatus` line lands shortly; a Birk PO may be months away), and never into **`Local`**, which
  stays strictly "what is in the building". **`/inv-styles` and `/inv-stock` must apply this identically** —
  the list Total and the drill Total have to agree.
  - Figure is **`requested − arrived`** (owner): an arrived unit is already booked into `localstock`, so the
    raw `requested` would double-count it against Local. `GREATEST(…, 0)` guards over-delivery.
  - **INNER JOIN** to `skumap`. `birktracker.code` is *Birkenstock's* naming
    (`0044701-Ramses Birko-Flor Unisex-35`), and only ~77% of the 382 lines match a code we carry; the rest
    are new-season styles not set up in `skumap` yet, which have no Inventory presence anyway (owner: "we
    don't care about items that are new").
  - **Do not use `invoiced`, and do not use the dates.** `due` is a bare month name with no year, and
    `placedate` is TEXT in *mixed* formats (`03/02/2026` alongside `2025-09-15`) — unusable without cleaning.

**Owner trims during build (already applied — don't reinstate):**
- The style list shows only `# / Groupid / Title / Total / Local`. **Segment and Order are "hidden truths"**:
  fetched, segment still searchable, but no column.
- The size grid shows only `Size / Total / Local` — no Order column. "Will see the rest at the next drill
  down." `onOrder` still ships on the API for later slices.
- **Reset clears the size grid too**, not just the filter, **and re-reads the list from the DB** — it is the
  refresh, mirroring what the owner does in PowerBuilder. No separate Refresh button. (The in-browser list
  is a snapshot taken at load; the size grid and locations are always fetched live per style click.)
- **The list starts blank.** All ~280 styles are fetched and held in memory — that is still what gets
  filtered — but nothing is rendered until the first FIND. Reset returns to blank.
- **The open stock panel closes when its style drops out of the filtered list** (search ARIZONA, open a
  style, search IVES → panel goes). A style that survives the new filter keeps its panel open.
- Search boxes force UPPERCASE; row count sits at the **top**, not under the table.

**Next:** slice 4 = Show Detail → the 12 buckets. Then phase 2 (localstock adjustments) on top of slice 3's
table (each row already carries `localstock.id` as a stable key).

Phase 1 = **read-only**. Phase 2 = localstock adjustments, edited in place in the locations panel (§4).
Design phase 1 so the locations table is the natural place to bolt editing on later.

---

## 1. Purpose & the "why"

The warehouse operator needs to answer two questions fast:

1. **"Have we got this, and in what size?"** — a stock position across every bucket a unit can sit in.
2. **"Where is it physically?"** — the rack location, so they can go and get it.

Existing pricing modules answer *what should this cost*. This one answers *what have we got and where*.
It is a **lookup/diagnostic view**, not a workflow — it does not change order state, does not clean up
stale rows, does not push anywhere.

**Crucially it must not lie by aggregation.** A unit flagged `allocated='amz'` sitting on a shelf is
counted in the Amazon Total *and* is physically in the building *and* (per PDF page 5) can still be picked
for a Shopify customer. There is no single honest "total stock" number. The screen shows the buckets side
by side and lets the human read them.

---

## 2. Screen shape (one page, two panes)

```
┌─ FILTER ─────────────────────────────────────────────────────────────┐
│  Contains [____________]   Does not contain [____________]  [FIND]   │
│  Arizona  ›  ¬EVA  ›  black                    14 styles   [Reset]    │
└──────────────────────────────────────────────────────────────────────┘
┌─ STOCK POSITION: <groupid> ──────────────┐ ┌─ IMAGE ─────────┐
│  Size             Order  Total  Local    │ │                 │
│  35 EU / 2.5 UK       0      3      3    │ │  product shot   │
│  36 EU / 3.5 UK       0     10     10    │ │                 │
│  ...                                     │ └─────────────────┘
│  [ ] Show Detail → expands to 12 buckets │
├─ LOCATIONS ──────────────────────────────┤
│  [C1][C3][C3 Front][C3 Back][C3 Shop]    │
│  size / location / qty / state / order   │
└──────────────────────────────────────────┘
┌─ STYLES ─────────────────────────────────────────────────────┐
│  #  groupid            title              segment            │
│  ...selectable rows...                          Rows: 13     │
└──────────────────────────────────────────────────────────────┘
```

Layout is **list first, stock position below it** — the detail appears directly under the row you clicked.

*(This was originally the other way up, copying PowerBuilder, on the reasoning that the grid should not
slide down the page as the list grows. That reasoning died once the list started blank and typically shows
a handful of filtered rows; clicking a row and having its detail appear above, out of view, read as
backwards and confused the owner in testing. Don't flip it back without a better reason than PB parity.)*

### 2a. The filter (deliberately dumb)

Two text boxes and a FIND button. Enter in either box = FIND.

- **Contains** — keep rows whose haystack contains the term (case-insensitive substring).
- **Does not contain** — drop rows whose haystack contains the term.
- Either box may be filled, or both. On FIND: apply to the **currently displayed** list, then **clear both
  boxes**. Successive FINDs narrow further — this is the drill-down.
- **Reset** restores the full list and clears the breadcrumb.
- The breadcrumb (`Arizona › ¬EVA › black`) is **display-only**. It exists so the operator can see where
  they are after four steps. It is not editable, chips are not individually removable — if you got it
  wrong, Reset and start again. (Owner explicitly rejected a chip-builder as too complex.)

**Haystack** = `title.shopifytitle` + `skusummary.groupid` + `skusummary.segment`, concatenated. Note:
**`skusummary.colour` is deliberately excluded** — it is an overloaded segmentation tag (Mocha filed under
Brown, per CLAUDE.md), so matching "black" against it would produce confusing results. `shopifytitle`
carries the human-readable colour anyway.

**NULL landmine:** a "does not contain" filter must use `COALESCE(col,'')` — a NULL `segment` under a bare
`NOT ILIKE` evaluates to NULL, so the row silently disappears, which is the *opposite* of what the operator
asked for. Since the haystack is built by concatenation, use `CONCAT_WS(' ', COALESCE(...), ...)`.

**Where the filtering happens:** the candidate set is a few hundred styles. Fetch the full list **once**
on page load and filter **client-side** on FIND. No round-trip per term. This also makes Reset instant and
keeps the drill-down feeling immediate.

### 2b. The style list

One row per **groupid** (style grain). Columns: `groupid`, `shopifytitle`, `segment`, then compact totals
pulled from §3 — **Free**, **Picked**, **On order**, **At Amazon**. Enough to triage at a glance without
opening the drill. Clicking a row loads the stock position.

---

## 2c. Lessons from the PowerBuilder screen (`docs/inventory-powerbuilder.png`)

The owner's existing PowerBuilder Inventory screen is used heavily in practice ("customer in the shop",
"looking for something generally"). Reviewed 2026-07-19; it corrected several things in this spec and the
corrections are recorded here so they don't get re-litigated.

**Taken:**
- **Compact-by-default size grid.** PowerBuilder shows only `Size | Order | Total | Local` — three numbers.
  That is what you look at with a customer waiting. The 12-bucket breakdown (§3) answers a different, rarer
  question ("why is that number what it is"). PowerBuilder already has a **Show Detail** toggle; we mirror
  it — compact by default, Show Detail expands the same grid to the 12 buckets.
- **Dual size display: `35 EU / 2.5 UK`.** A shop customer says "five and a half", not "39". `skumap.uksize`
  is **100% populated** (2034/2034 variants) and already stores the `"2.5 UK"` suffix, so display is
  `RIGHT(code,2) || ' EU / ' || uksize`.
- **Location buttons** — `C1 / C3 / C3 Front / C3 Back / C3 Shop`. **NOT a filter** (a misreading of the
  screenshot, corrected by the owner 2026-07-19): they are for **assigning** a location when adding stock,
  i.e. **phase 2**. The read-only locations panel has no area filter.
- **Large product image.** Thirteen near-identical black Arizonas is the *normal* result set — the image is
  how the operator confirms they have the right one. Not decoration.
- **Row count** ("Rows: 13") under the list, confirming the filter did what you expected.

**Deliberately not taken into phase 1** (PowerBuilder is one screen because PowerBuilder made one screen
cheap; we already have better homes for these):
- `CARD` / `cash` / amount / `Current` — an in-shop till sale. Real workflow, but it is a **sale** and it
  writes. Separate screen.
- `Get Image` / `Image HTML` / `Product Link` / `Birk Label` / `Export` / `Catalogue IN-OUT` / `SAVE` —
  product-content jobs that belong with **Add/Modify**.
- `Order` (parked orders module), `Log Stock`, `Cut`, `Sort Created` / `Sort Updated` — watch these in use
  before copying.

---

## 3. Stock position — the 12 buckets (from PDF p6/p7)

All at **size grain**. Sizes come from **`skumap`** (one row per variant, `size = RIGHT(code,2)`), LEFT
JOINed to each source, defaulting to **0** — so sold-out and never-stocked sizes still show a column.
Buckets are **never merged and never annotated with parentheticals**: one row = one rule, so when the
downstream logic changes we change exactly one row.

### 3a. The compact default (what PowerBuilder shows)

Three numbers per size, and these are the **primary** view:

| Column | Meaning | Rule |
|---|---|---|
| **Local** | Physically in the building | `SUM(qty)` over **all** `localstock` rows for the code, `COALESCE(deleted,0)=0` — **regardless of `ordernum`** |
| **Order** | On the way | `COUNT(*)` of `orderstatus` rows, `arrived=0`, `ordertype IN (2,3)` |
| **Total** | Everything we have **or have coming** | `Local` + buckets 9–12 + **Birk pre-order book** (`requested − arrived`) |

**`Local` deliberately includes stock already picked for an order.** Verified against the PowerBuilder
screen for `1005292-ARIZONA`: size 37 = 4 `#FREE` + 1 picked (`BC18410`) = **5**, size 38 = 3 `#FREE` + 2
picked = **5**. Both match. The semantics are *"is it on the shelf"*, not *"is it sellable"* — a picked unit
is still physically there until it is packed, which is what matters when you are looking for it. The
free/picked split is still available under Show Detail (buckets 1 and 2).

### 3b. The Show Detail breakdown — 12 buckets

| # | Row label | Source | Rule |
|---|---|---|---|
| 1 | Free | `localstock` | `ordernum='#FREE'` AND `allocated='unallocated'` AND `COALESCE(deleted,0)=0` AND `qty>0` |
| 2 | Picked for order | `localstock` | `ordernum<>'#FREE'` AND `COALESCE(deleted,0)=0` AND `qty>0` |
| 3 | Amazon reserved | `localstock` | `ordernum='#FREE'` AND `allocated='amz'` AND `location<>'C3-Amazon'` |
| 4 | Amazon bay | `localstock` | `ordernum='#FREE'` AND `allocated='amz'` AND `location='C3-Amazon'` |
| 5 | On order — local | `orderstatus` | `ordertype=2` AND `arrived=0` |
| 6 | On order — Amazon | `orderstatus` | `ordertype=3` AND `arrived=0` |
| 7 | Arrived — local | `orderstatus` | `ordertype=2` AND `arrived=1` |
| 8 | Arrived — Amazon | `orderstatus` | `ordertype=3` AND `arrived=1` |
| 9 | Live at Amazon | `amzfeed` | `amzlive` |
| 10 | Inbound to Amazon | `amzfeed` | `amztotal - amzlive` |
| 11 | Boxed | `amzshipment` | `qty` |
| 12 | In transit | `amzshipment_archive` | `qty` WHERE `created_at >= now() - interval '2 days'` |

Grouped in the UI as **HERE** (1–4), **INCOMING** (5–8), **AT AMAZON** (9–12).

Plus two **DERIVED** rows, shown below a rule:

- **Amazon Total** = 9 + 10 + 11 + 12 + 6 + 3 + 4 — verbatim from PDF page 7 ("amzfeed total, amzshipment,
  amzshipment_archive if within 2 days, orderstatus ordertype 3 not arrived, localstock allocated 'amz'").
  This is the figure that drives Amazon re-ordering, so it is worth showing even though it overlaps HERE.
- **Customer demand** = `orderstatus` `ordertype=1`. This is a *claim on* stock, not stock. Kept visually
  separate for that reason.

### Data facts verified against live prod (2026-07-19)

- **The two tables need OPPOSITE aggregation rules. This is the single easiest bug to ship.**
  - **`orderstatus` → `COUNT(*)`.** One row per SKU, `qty` always 1 — confirmed across all 162 live rows
    (`rows` = `sum(qty)` for every ordertype/arrived combination).
  - **`localstock` → `SUM(qty)`.** `qty` is **NOT** always 1: **106 of 2250** non-deleted rows have `qty>1`
    (max **9**). Counting rows gives 2250 units; summing gives **2410** — a 7% under-report. Caught by
    reconciling against the PowerBuilder screen, where size 36 of `1005292-ARIZONA` shows 10 from 9 rows
    (one row carries `qty=2`).
- **`orderstatus.shopifysku` = `skumap.code`** — 100% match on all 162 live rows. Clean join to size.
- **`amztotal >= amzlive` always** (474 rows, 57 where they differ, 0 where total < live) — so
  `amztotal - amzlive` is a safe non-negative inbound figure.
- `localstock.allocated` only ever holds `'unallocated'` or `'amz'` on live rows.
- `location` values are `C3-Front-NN` / `C3-Back-NN` / `C1-Rack-NN` / `C3-Shop` / `C3-Amazon`, plus a
  stray `C3-SHOP` and `Ordered` (1 row each). **`C3-SHOP` is a known data error the owner is fixing at
  source** — but compare case-insensitively anyway, since nothing constrains this column.
- **`segment` and `shopifytitle` are 100% populated** — all 280 styles have both, across 29 distinct
  segments. So the haystack has no NULL holes in practice; `COALESCE` stays in as defence, not necessity.
- **`skumap.uksize` is 100% populated** (2034/2034) and stores the suffix (`"2.5 UK"`), so the dual size
  display never needs a fallback.

### The filter validated end-to-end on live data

The owner's worked example, run as consecutive haystack filters: **280 styles → 72** (contains `Arizona`)
**→ 53** (does not contain `EVA`) **→ 11** (contains `black`). Behaves exactly as specified with no special
handling.

Worth noting *why* the haystack is concatenated rather than segment-only: the single style whose title
contains "eva" but whose segment is not `EVA-SEG` is `1015471-ARIZONA` — *"Birkenstock Arizona EVA Sandals
Betroot Purple Narrow Fit"*, filed under `ARIZONA-GENERAL`. The "does not contain EVA" step removes it
**because the title is in the haystack**. A segment-only filter would have wrongly kept it.

### Incoming is taken at face value

`orderstatus` retains not-arrived rows for up to 30 days before `clean_sales.sql` (weekly, Mon 4am) removes
them, so "On order" can include units that will never arrive. **This screen does not care.** No age column,
no greying, no staleness heuristic. If it is in `orderstatus` and not arrived, it is coming. Cleanup is a
human job on the future order-status screen — owner was explicit that it is not this screen's logic.

---

## 4. Locations panel

Finding physical stock is half the point of the screen, so locations get their own table under the size
grid — every non-deleted `localstock` row for the selected groupid:

```
Size  Location        Qty  State         Order
 38   C3-Front-19      1   Free          —
 38   C3-Back-04       1   Free          —
 38   C3-Amazon        1   Amazon bay    —
 39   C3-Front-19      1   Picked        #1043
```

- **State** is derived by the same rules as buckets 1–4, so the panel and the grid can never disagree.
- Sorted by size, then location.
- **Phase 2** turns each row into an in-place edit (qty / location / delete). Build the table now with that
  in mind — stable row identity (`localstock.id`), no aggregation that would have to be unpicked.

---

## 5. Endpoints (proposed)

Two, following the house conventions (one route file per endpoint, HTTP 200 + `return_code`, `verifyToken`):

- **`GET /inv-styles`** — the whole filterable list, one row per groupid: `groupid`, `shopifytitle`,
  `segment`, and the four summary totals. Fetched once; the client does all the FIND filtering. Must not
  N+1 — build the totals as grouped subqueries/CTEs joined onto the style list in one query.
- **`GET /inv-stock?groupid`** — the full size grid (all 12 buckets + 2 derived, all sizes from `skumap`)
  plus the locations rows. One response, one round-trip.

No write endpoints in phase 1.

---

## 6. Out of scope for phase 1

- **All writes.** Read-only. Localstock adjustments are phase 2.
- **Order status management** (PDF pages 1–5) — a separate screen entirely.
- **Fixed search terms** like `"Size 38"` → "show groupids that actually have size 38 in stock". Agreed as
  a good idea, explicitly **deferred to phase 2**; get plain filtering working first. When it lands it will
  be a small set of recognised fixed terms, not a general size-search grammar.
- Anything that mutates `amzfeed` (READ ONLY, refreshed nightly from Amazon) or `orderstatus`.

---

## 7. Rejected during design (don't re-propose)

- **Chip-builder filter** with a field selector (`title` / `groupid` / `segment` / `any`) and per-chip
  removal — rejected as too complex. Two boxes, FIND, Reset.
- **Server-side filtering per FIND** — unnecessary for a few hundred styles.
- **Parenthetical annotations in the grid** (e.g. "Amazon reserved 3 *(1 in C3-Amazon bay)*") — rejected in
  favour of standardised one-rule-per-row buckets, so display stays aligned if the logic changes.
- **Stale-row detection on incoming** — rejected as scope creep; see §3.
- **Hiding the AT AMAZON block for non-FBA styles** — show zeros instead.

---

## 8. Open items to confirm before/while building

*(none outstanding — see Closed.)*
- Phase 2: which localstock fields are actually editable (qty only? location? soft-delete?) and does an
  adjustment need an audit row like `price_change_log`?

**Closed:**
- ~~Is `segment` populated widely enough for the haystack?~~ Yes — 280/280 styles, 29 segments. Confirmed
  2026-07-19.
- ~~Should colour be searchable?~~ Via `shopifytitle` only; `skusummary.colour` stays out (owner, 2026-07-19).
- ~~Does the style list default to all styles or only those with stock?~~ **All styles** (owner, 2026-07-19).
- ~~Is `localstock.qty` always 1?~~ **No** — 106/2250 rows exceed 1. Must `SUM(qty)`. See §3 data facts.
- ~~What is the `Total` column?~~ **"The total we have of that SKU regardless of where it is"** (owner,
  2026-07-19, clarifying an earlier answer). `Total` = `Local` + buckets 9–12 and **includes `amzlive`**.
  `Local` = what is in `localstock`. Exact numbers to be reconciled against PowerBuilder during testing.
- ~~Where does the product image come from?~~ `skusummary.imagename` (bare filename); the web builds
  `https://images.brookfieldcomfort.com/<imagename>`, exactly as `product-get` / Add-Modify already do.
