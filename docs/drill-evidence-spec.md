# Drill Evidence — Working Spec (DRAFT)

> Design spec for **aligning the two price-drill "evidence" panels** — Shopify (`/pricing/style/[groupid]`) and
> Amazon (`/amz/sku/[code]`) — so both answer one question with the same set of read-only artefacts:
> *"is this selling fast enough to price **up**, or stalling so I should price **down** — and what's the best price?"*
> Same "throw away when done" scratch-spec style as `segments-spec.md` / `amz-pricing-spec.md`.
> **Nothing here is built yet** — this captures the agreed model so it doesn't evaporate.

---

## 0. STATUS & NEXT UP  (read this first)

**Where we are:** both drills exist and work. This spec is about making the **evidence they show** consistent — not
the actions. Two live reference reads today:
- Shopify `GET /pricing-drill` → `header` + `timeline` (per-price-era pace) + `sizes`. UI: PriceSetter · **Pricing
  timeline** · Recent sales · Size curve · Price history.
- Amazon `GET /amz-drill` → `header` + `weeks` (6-week velocity) + `bands` (units-by-price). UI: AmzPriceSetter ·
  **Velocity + Units-by-price** · Recent sales · Price history.

**The gap:** each screen has an artefact the other lacks, and both miss **profit-per-week** — the number that most
directly answers "what's the best price". Neither is a different *model* — see §1.

**BUILT 2026-07-11 (uncommitted):**
- **profit/wk in the Shopify timeline** (step 2) — see §2.4. Server + UI + types + validated on prod (Arizona: £65 →
  £45/wk vs £57.87 → £12/wk). `docs`/memory updated.
- **units-by-price (+profit) on Shopify + profit/unit on Amazon** (step 3) — see §4/§6. `pricing-drill` now returns
  `bands[]` (60d, ascending price, NET `profit_per_unit`); `amz-drill` bands gained `profit_per_unit` for parity. New
  shared `PriceBands` component renders the block identically on both drills (Amazon's local `Bands` deleted so they
  can't drift); `AmzBand` is now `= PriceBand` (one shared shape). Rendered above the timeline on Shopify. NOT yet
  click-tested against the two worked screens.

**DROPPED 2026-07-11 (owner decision) — stock cover on the pricing drill.** Cover (weeks-to-clear) was built into both
headers (step 1) then removed: the operator already holds the season / stock / weather context a cover number would
proxy, so on the *pricing* screen it's noise (and it's fiddly — a 4-week window lags a just-repriced style, a 2-week
window is jumpy). Cover stays where it earns its keep — the **losers list** (slow/dead stock to cut) and, if ever built,
a **restock** module. The pricing question is served by **profit/wk** (best price) and, next, the resistance/ceiling
view (§3). Do **not** re-add cover to the drill headers.

**Build order (updated):** §6. **Done:** profit/wk (Shopify timeline). **Next, best-price-focused:** port
**units-by-price (+profit) to Shopify** (the ceiling/"how high can I go" view — the owner already rates this Amazon
block highly), then the velocity trend for parity.

**Not doing (owner decision):** **no net-margin figure in the header** on either screen — it reads as a second,
conflicting margin number next to the gross one and confuses at a glance. All *net* profit reasoning stays **further
down** (the timeline's profit/wk, the bands, the per-sale profit column), where there's room to read it properly. The
header keeps the existing quick **gross** margin gauge (price − cost). See §2.2.

---

## 1. Purpose & the "why"

The two channels *feel* like different pricing jobs — Shopify moves in discrete seasonal steps with a review/park
cooldown and a live push; Amazon micro-creeps (+10–70p) around the buy-box with no review and an upload basket. But
that difference is all **execution cadence**. The underlying **decision** is identical on both:

> **What price maximises `per-unit profit × velocity`, given my stock cover and where demand starts to resist?**

Every input to that decision is the same on both channels — velocity, price-response (the ceiling), per-unit profit,
weeks-of-cover. So the **evidence panel should be one shared model**; only the **action panel** (the price setter)
should differ. That's the seam this spec draws: **unify the read, keep the write divergent.**

**Two worked reads that motivated this (real screens, 2026-07-11):**
- *Arizona Two-Strap (Shopify, £65):* price rose £57.87→£65 and pace rose 2.3→4.5/wk — the clean "raise it" signal —
  but the timeline can't show that the £65 era is *peak season* while the £57.87 era was shoulder, and it can't show
  that **£66 has stalled twice** (that lives only in the price-log notes, because a price that *didn't* sell leaves no
  timeline row). The decision evidence is real but scattered.
- *IVES-WHITE-04 (Amazon, £39.29):* the **units-by-price** chart shows the current (highest) price is also the biggest
  bar — no ceiling found, still the best seller — a confident "keep creeping" green light. That single artefact is the
  best thing on either screen, and **Shopify doesn't have it.**

**What "still selling well" actually needs (a subtlety this spec bakes in):** units-by-price is a *cumulative 60-day
total*, so "biggest bar" ≠ "still selling" — a price could have sold hard early then died and still show a fat bar.
*"Still"* is only confirmed by the **velocity trend** (recent weeks) or a recency signal on the band. So the two charts
are complementary and must ship together; a rate-based framing (profit/wk) is inherently "still"-aware where a
cumulative bar isn't.

Out of scope: the action/setter controls (review pills, basket, live push — deliberately channel-specific), and any
new *write* behaviour. This is a read-only evidence alignment.

## 2. Design decisions (all AGREED)

1. **Unify the evidence, diverge the actions.** The read-only "evidence panel" (header stats + velocity + price-response
   + timeline + recent sales + price history) becomes one canonical set both drills render in the same order (§3). The
   **setter** stays channel-specific (Shopify = price + review/park pills + live-push messaging; Amazon = nudges +
   basket queue, no review). Prefer a **shared presentational component per block** where the data shape allows, so the
   two screens can't drift again.
2. **No net-margin number in the header** (owner). The header keeps the existing quick **gross** gauge (price − cost, £
   and %) — a "am I safely above cost" glance, nothing more. A *second* margin number (net-of-fees) next to it reads as
   a contradiction (Arizona: 46% gross vs ~15% net) and confuses. **All net-profit reasoning lives further down**, in
   the timeline's **profit/wk**, the bands, and the per-sale **profit** column — where it's labelled and has room to be
   read correctly. Intentional consequence: the header margin (gross) and the timeline profit/wk (net) describe different
   things **on purpose**; the spec does not try to reconcile them.
3. ~~**Add stock cover (weeks-to-clear) to both headers.**~~ **DROPPED 2026-07-11 (owner)** — see §0. Cover is context
   the operator already holds (season / stock / weather) and is noise on the *pricing* screen; it belongs to the losers
   list / a future restock module, not the drill header. Do not re-add. (Kept the numbered slot so §4/§5/§6 references
   don't shift.)
4. **Add profit-per-week to the pricing timeline.** The timeline ranks price eras by *pace*, but pace isn't the
   objective — `per-unit profit × pace` is, and per-unit profit moves **non-linearly** with price because fixed
   per-order costs (fees/shipping/VAT on Shopify, the FBA fee on Amazon) don't scale. A **£/wk** column collapses
   price+pace+profit into one comparable number and *directly* answers "best price". Computed from the **`profit`
   column already on every sales row** — the shared backbone (§4).
5. **Velocity trend on both.** Amazon has 6-week velocity bars; Shopify has only a per-era average. Port the recent
   weekly-pace bars to Shopify so "is it slowing *this* week?" is answerable there too.
6. **Units-by-price (resistance) on both, with a profit dimension.** Amazon has units-by-price; Shopify has nothing
   equivalent (its timeline shows only prices that *sold*, hiding tried-but-stalled prices). Port it to Shopify, and add
   per-band **profit** so the band reads as reward-vs-resistance, not raw units.
7. **`sales.profit` is the shared unifier.** Both channels carry a net `profit` per sale row (SHP and AMZ). Everything
   in 4/6 derives from it, which is *why* the two screens can share one model.

## 3. The aligned evidence panel

Canonical block order, top to bottom, **identical on both drills** (action panel sits above it, unchanged):

```
  [ SETTER — channel-specific, unchanged ]
  1. Header strip .......... price · cost · gross margin(£/%) · RRP · stock · COVER            (+ Amazon: floor, FBA live/inbound)
  2. Velocity trend ........ recent weekly pace (bars)
  3. Units-by-price ........ resistance bands, with profit
  4. Pricing timeline ...... per price era: price · period · units · pace · PROFIT/WK
  5. Recent sales .......... individual lines incl. per-sale profit          (lazy)
  6. Price history ......... price-change log incl. note                     (lazy)
```

**Have / Add, per channel:**

| Block | Shopify now | Amazon now | Change |
|-------|-------------|------------|--------|
| 1. Header + **cover** | header, no cover | header, no cover | **add cover both**; keep gross margin; no net |
| 2. Velocity trend | — | ✅ `weeks[]` bars | **add to Shopify** |
| 3. Units-by-price (+profit) | — | ✅ `bands[]` (units) | **add to Shopify; add profit both** |
| 4. Timeline + **profit/wk** | ✅ pace only | — (bands/log serve it) | **add profit/wk to Shopify timeline**; Amazon timeline = open (§7) |
| 5. Recent sales (+profit) | ✅ | ✅ | none |
| 6. Price history | ✅ | ✅ | none |

Order note: on Shopify the setter currently sits above the timeline (good — action reachable first); Amazon's setter
sits above velocity/bands (same principle). Keep the setter first; the evidence blocks follow in the order above.

## 4. Data & computations (must be exact)

Shared landmines (from CLAUDE.md — respect): price columns on `skusummary`/`amzfeed` are junk-prone VARCHARs → read via
`safeNumeric` (never bare `::numeric`). Shopify sellable stock = `localstock` `#FREE`, not deleted, qty>0 (never
`stockvariants`). Amazon is **SKU-grain** (`code`, one size) — velocity/bands/cover are all for that one SKU, against
its own FBA stock. Dates rendered from **local components** (avoid the BST UTC day-shift — see `isoDate`).

- **`profit` (the backbone).** Every `sales` row carries a net `profit` (SHP and AMZ) — already net of fees/shipping
  (this is why Arizona shows £10.10/sale against a £29.58 gross margin). Use it as-is; do **not** recompute from price −
  cost (that's the gross figure the header already shows).

- **Profit-per-week (timeline) — BUILT.** Per price era already grouped in `pricing-drill`:
  `profit_wk = SUM(profit for that era) / weeks`, reusing the existing `weeks = max(span_days,7)/7` floor. Rendered as a
  **Profit** column next to Pace, whole £/wk; `null` when the era has no profit data. NET (from `sales.profit`, not
  price−cost — so it reads below the header's gross margin, on purpose). (Amazon: only if we add a timeline — §7.)

- ~~**Cover / weeks-to-clear (header).**~~ **DROPPED (owner)** — see §0/§2.3. Not on the pricing drill. (The losers list
  keeps its own `cover_weeks` for the slow/dead-stock cut decision — that's the right home for cover.)

- **Velocity trend (block 2).** Recent weekly units (pace). Amazon already returns `weeks[]` (6 weeks, zero-filled,
  oldest→newest, from `date_trunc('week', solddate)`). Shopify: mirror that query for `channel='SHP'` grouped by
  `groupid`. Same zero-fill so a gap week reads 0, not a hole. Keep oldest→newest left-to-right (a trend is read that
  way; this is *not* the "latest on top" table rule).

- **Units-by-price (block 3).** Amazon already returns `bands[]` (`price, units, first, last` over 60d, ascending
  price). Shopify: mirror for `channel='SHP'` (SUM units grouped by `soldprice`). **Add profit per band** — minimum:
  `profit_per_unit` at that band (`SUM(profit)/SUM(qty)`), so the band shows reward as well as volume; the bar can stay
  units-length with the £/unit as a label. Mark the current price's band (as Amazon does). Ascending price so the
  ceiling reads top-down. (Profit/wk-per-band is a possible refinement but bands are cumulative/non-contiguous — §7.)

## 5. Endpoints (changes — CLAUDE.md envelope unchanged: HTTP 200 + return_code, verifyToken)

No new routes; extend the two drill reads (additive fields — existing clients keep working):

- **`GET /pricing-drill`** (Shopify) —
  - `header`: add `cover` (number weeks, or null/"no recent sales") + the `pace_now` it's based on.
  - `timeline[]`: add `profit_wk` per era (and `profit` total per era if cheap).
  - add `weeks[]` (velocity trend, mirror of amz-drill's) and `bands[]` (units-by-price **+ profit**), so Shopify
    returns the same evidence arrays Amazon does.
- **`GET /amz-drill`** (Amazon) —
  - `header`: add `cover` (FBA live / pace_now) + `pace_now`; optionally `inbound_cover`.
  - `bands[]`: add `profit_per_unit` per band.
  - timeline with `profit_wk`: **open** (§7) — Amazon's micro-creep may make an era timeline noisy; bands+log may
    already cover it.

Client (`src/lib/api.ts`): extend `DrillData`/`AmzDrillData` types with the new fields; add shared presentational
components for the ported blocks (a `VelocityBars` and a `PriceBands` reused by both screens).

## 6. Build order (small, high-value first)

1. ~~**Cover in both headers.**~~ **DROPPED (owner)** — §0/§2.3.
2. ✅ **Profit/wk in the Shopify timeline** — BUILT 2026-07-11. `pricing-drill` adds `profit`/`profit_wk` per era from
   `sales.profit`; `Timeline.tsx` renders a `£/wk` column next to Pace. Directly answers "best price".
3. ✅ **Units-by-price (+profit) → Shopify** — BUILT 2026-07-11. `pricing-drill` returns `bands[]` (60d, NET
   `profit_per_unit`); `amz-drill` bands gained `profit_per_unit`; shared `PriceBands` component renders both. The
   ceiling / "how high can I go before demand resists" view. Not yet click-tested.
4. **Velocity trend → Shopify** (NEXT — parity). Add `weeks[]` to `pricing-drill`; shared `VelocityBars`; render on both.
5. **(Optional / later)** profit/wk framing on the Amazon bands; decide the Amazon era-timeline question (§7).

## 7. Open decisions (resolve when building the relevant piece)

- ~~cover window / thresholds / inbound~~ — moot; **cover dropped from the pricing drill** (§0/§2.3). If cover is ever
  wanted for a restock module, resolve `pace_now` window (trailing weeks vs current-era) there.
- **Amazon pricing timeline** — add a per-era timeline with profit/wk (full parity), or accept that bands + price-log
  already serve resistance/history for a micro-creep channel and skip it. Lean: skip for now, revisit.
- **Bands profit metric** — profit/unit per band (simple, recommended) vs profit/wk per band (needs per-band span; bands
  are cumulative/possibly non-contiguous over 60d, so pace-per-band can mislead).
- **Season baseline (the big one, deferred)** — the largest confound is that a pace figure has no seasonal reference
  (Arizona 4.5/wk in July: fast or slow?). A same-period-prior-year pace, or a demand index, would make velocity
  interpretable. Real research; explicitly **not** in this alignment pass, noted so it isn't forgotten.

## 8. Testing note

All read-only (safe on the LIVE prod DB per CLAUDE.md) — no writes in this spec. Validate the new computations against
the two worked screens: Arizona (Shopify) should show the £65 era out-earning £57.87 on £/wk (validated on prod:
£45/wk vs £12/wk); IVES-WHITE-04 (Amazon) the £39.29 band leading on both units and profit. Verify the BST date handling
on any new date-bearing field (velocity week starts, band first/last) via the local-component formatter, not
`toISOString()`.
