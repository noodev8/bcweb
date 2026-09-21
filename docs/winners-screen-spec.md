# Winners screen — build spec

**Status: ready to build, 2026-09-22.** Nothing written yet.
Strategy and evidence: `portfolio-model.md`. This is the build detail.

---

## 1. Purpose

The bird's-eye view of the business as a portfolio of earning assets.

> *"Each product is a tiny asset that is earning for me. I want as many as I can get.
> That 20 should be 30 next year."* — owner, 2026-09-22

**Two tabs, and the second one is the reason this is worth building.**

| Tab | Question it answers | Grain |
|---|---|---|
| **WINNERS** | What do I own, and is it growing? | Shopify style (`groupid`), rolling 12 months |
| **CONTENDERS** | **Which of my young products are about to become winners?** | Shopify style, under 180 days old |

WINNERS is the scoreboard. **CONTENDERS is the job** — it turns a 180-day wait into a 30-day answer,
and it is the only part of this screen that produces an action.

---

## 2. Definitions — the whole spec in five lines

| Term | Rule |
|---|---|
| **Age** | Days since `MIN(sales.solddate)` for that `groupid`. **Never `skusummary.created_at`** — see §7 |
| **WINNER** | Age ≥ 180 days **and** profit > £200 in the rolling 12 months |
| **YOUNG** | Age < 180 days. Not eligible to be a winner yet; appears on CONTENDERS instead |
| **Contender score** | Profit in the style's **first 30 days on sale** |
| **Profit** | `SUM(sales.profit * qty)` with `qty > 0` — returns live in the haircut, not the rows |

A style that is neither (age ≥ 180, profit ≤ £200) appears on **neither tab**. That is deliberate:
a losers list is not a job — 37 of them lost £1,202 between them last year, £32 each.

---

## 3. The CONTENDERS evidence — why 30 days is enough

Measured across all styles with a first sale between 2023-09 and 2026-03 (mature enough to score),
comparing profit in the **first 30 days** against whether the style cleared £200 in its first 180:

| Profit in first 30 days | Styles | Became winners | **Conversion** |
|---|---|---|---|
| £0 or less | 10 | 0 | **0%** |
| £1–49 | 138 | 11 | 8% |
| £50–99 | 43 | 12 | 28% |
| **£100–199** | 18 | 13 | **72%** |
| **£200+** | 3 | 3 | **100%** |

Units work too but less sharply (11+ units in 30d → 52%). **Profit is the better signal; use it.**

**Why acting on it is worth something:** only **25%** of a winner's 180-day profit lands in its first
30 days, and **45%** by day 60. **Over half the value is still ahead when the signal fires.**

**Live position at time of writing** — 99 young styles, and the model says ~20 winners are already in
the building:

| Band | Styles now | Expected to convert | Out of stock |
|---|---|---|---|
| £200+ | 1 | 1 | 0 |
| £100–199 | 13 | ~9 | **3** |
| £50–99 | 18 | ~5 | 9 |
| £1–49 | 64 | ~5 | 27 |
| ≤ £0 | 3 | 0 | 3 |

**Three high-confidence contenders are already out of stock.** That is the expensive failure this
screen exists to stop.

### 3.1 The actions a contender triggers

Stated here because a band with no action attached is decoration:

1. **Reorder it now, before it sells out.** 116 styles sold out entirely last year and 24 ran out in
   May–July with a third of the season left. A 72%-likely winner with 4 units left is the single
   most valuable thing on this screen.
2. **Get it into the ad feed.** Range is the binding constraint on the whole business
   (`portfolio-model.md` §3.5) — an earning product not being advertised is wasted surface.
3. **Nothing, for the ≤£49 bands.** Do not kill them: a trial costs £32 and 8% still convert. The
   action is simply *do not reorder*, which is an absence of action, not a task.

---

## 4. API

Two routes, per the one-route-one-endpoint convention. Both GET, both auth-required, both returning
HTTP 200 + `return_code`.

### 4.1 `GET /portfolio-winners`

No params in v1 (12 months is the window; the owner's call).

```
{
  "return_code": "SUCCESS",
  "summary": {
    "winner_count": 79,
    "winner_count_prior_year": 58,
    "joined_this_year": 38,
    "left_this_year": 16,
    "total_profit_12m": 62430.00
  },
  "winners": [
    {
      "groupid": "...",
      "title": "...",                  // title.shopifytitle, never skusummary.colour
      "brand": "...",
      "profit_12m": 2841.55,
      "units_12m": 210,
      "profit_prior_12m": 1980.10,
      "direction": "GROWING",          // GROWING | FLAT | SHRINKING, see below
      "first_sale": "2024-03-14",
      "stock_units": 0                 // shown, NEVER filtered on — see §5
    }
  ]
}
```

`direction`: compare `profit_12m` against `profit_prior_12m`. **FLAT is a band, not equality** —
within ±15% is FLAT, so normal noise does not read as a trend. Styles younger than 24 months have no
prior-year figure; return `direction: "NEW"` and `profit_prior_12m: null` rather than a fake 0.

Default sort: `profit_12m` descending. The biggest asset is at the top.

### 4.2 `GET /portfolio-contenders`

```
{
  "return_code": "SUCCESS",
  "summary": {
    "young_styles": 99,
    "expected_winners": 20,            // sum of band_count x band_conversion, rounded
    "high_confidence_count": 14        // the two top bands
  },
  "contenders": [
    {
      "groupid": "...",
      "title": "...",
      "brand": "...",
      "first_sale": "2026-07-02",
      "days_on_sale": 82,
      "profit_first_30d": 148.20,
      "band": "STRONG",                // see constants below
      "conversion_pct": 72,
      "profit_so_far": 205.40,
      "units_so_far": 31,
      "stock_units": 4,
      "out_of_stock": false
    }
  ]
}
```

**Default sort: band descending, then `profit_first_30d` descending.** Out-of-stock contenders in the
top two bands sort to the very top regardless — that is the reorder queue.

A style with fewer than 30 days on sale **cannot be scored yet**. Return it with
`band: "TOO_EARLY"`, `conversion_pct: null`, and exclude it from `expected_winners`. Do not score a
partial window — scoring a censored cohort is the mistake that produced a fictitious hit-rate
collapse during the analysis session.

### 4.3 Named constants (route file, not query params)

```js
const WINNER_PROFIT_BAR   = 200;   // GBP, rolling 12m
const MATURITY_DAYS       = 180;   // below this a style is YOUNG, not a loser
const CONTENDER_WINDOW    = 30;    // days from first sale that the score is measured over
const DIRECTION_FLAT_PCT  = 15;    // +/- this against prior year reads as FLAT

// Bands, measured 2026-09-22. RECALIBRATE ANNUALLY against fresh cohorts - see section 8.
const BANDS = [
  { name: 'STRONG',   min: 200, conversion: 100 },
  { name: 'LIKELY',   min: 100, conversion: 72  },
  { name: 'POSSIBLE', min: 50,  conversion: 28  },
  { name: 'WEAK',     min: 1,   conversion: 8   },
  { name: 'DEAD',     min: null, conversion: 0  },   // profit <= 0 in first 30d
];
```

Same pattern as the pricing WINNERS/LOSERS bars: constants in the route file, documented, not yet
exposed as params.

---

## 5. UI

**Hero metric: the WINNER COUNT.** One tracked number, visually dominant, with last year's count
beside it. Per the house rule on headline hierarchy, everything else is supporting detail — do not
let total profit or the contender count compete with it visually.

```
   ┌──────────────────────────────────────────────┐
   │                                              │
   │        79        winners                     │
   │        ▲ 58 last year                        │
   │                                              │
   │   £62,430 earned · 38 joined · 16 left       │   <- supporting, small
   └──────────────────────────────────────────────┘

   [ WINNERS 79 ]  [ CONTENDERS 14 ]                  <- tab counts ARE the job
```

**WINNERS tab:** one row per winner — title, brand, 12m profit, units, direction arrow, first sale.
Stock shown as a quiet column.

> ⚠ **OUT-OF-STOCK WINNERS STAY ON THE LIST, UNBADGED AND UNFILTERED.** This is an owner decision
> and the opposite of an exception screen: a winner out of stock is still an asset and he wants to
> see **what it earned**. Keeping winners in stock is already handled by dedicated processes
> (Birkenstock ordering, St Ives). Do not add a red badge, a filter, or a "needs attention" tab to
> the WINNERS side — it turns a strategic view into a chore list.

**CONTENDERS tab:** grouped by band, strongest first, with the conversion percentage shown as plain
text on the band header (*"LIKELY — 72% of these became winners"*). Out-of-stock rows in STRONG and
LIKELY carry the one badge on this screen, because there the stock fact **is** the action.

Row click → existing `pricing/style/[groupid]` drill. **Do not build a new drill.**

---

## 6. What is explicitly NOT in this screen

Recorded so it does not get added later by good intentions:

- **No losers tab.** 37 styles, £1,202, £32 each. Not a job.
- **No trials tab** separate from CONTENDERS. A young style with no signal needs no action.
- **No hit-rate / persistence / steady-state widgets.** Those steer an annual buying decision, not a
  daily one. They live in `portfolio-model.md` §2 and get recomputed when the buying plan is set.
- **No stock-management features on the WINNERS tab.** See the warning in §5.
- **No new drill.** Reuse `pricing/style/[groupid]`.

---

## 7. Landmines

- **`skusummary.created_at` is a RECORD date, not a go-live date.** Mean gap to first sale: 261 days
  (2024 cohort), 134 (2025), 18 (2026). **Anchor every age and cohort calculation on
  `MIN(sales.solddate)`.** Using created_at produced a fictitious hit-rate collapse during analysis.
- **`sales.profit` excludes advertising.** Everything on this screen is contribution, not profit
  after ad cost. Label it honestly in the UI ("earned"), and do not let it be read as net profit.
- **Returns:** filter `qty > 0`. Returns live in the haircut, not the rows (owner, 2026-09-10).
- **Stock:** `localstock` where `ordernum='#FREE' AND COALESCE(deleted,0)=0 AND qty>0`. **Never**
  `skusummary.stockvariants`.
- **Prices/costs are VARCHAR** and can hold junk — `utils/sql.js → safeNumeric`, never bare
  `::numeric`.
- **Name** from `title.shopifytitle`. `skusummary.colour` is an overloaded segmentation tag.
- **Dates:** cast to text in SQL. Never hand a pg `DATE` to `toISOString()`.
- **No N+1.** Both routes are one grouped query each plus one summary query.

---

## 8. Open questions

1. **Seasonality of the contender signal.** A style whose first 30 days fall in June is scored
   against a very different demand backdrop to one starting in December. The bands in §4.3 are
   blended across all seasons. **Whether they need a seasonal adjustment is unmeasured** — worth
   checking once there are enough winter cohorts, and worth a note on the screen until then.
2. **Recalibration cadence.** The bands were fitted on 212 mature styles. They should be refitted
   annually as cohorts mature, and the fit is a five-minute query. Who owns that, and when?
3. **Amazon.** This is Shopify-style grain. Amazon is SKU grain with no birth date in `amzfeed`, so
   an Amazon equivalent needs a different anchor. Out of scope for v1; note it rather than bolt it on.
4. **Does the £200 winner bar want to move** as the portfolio grows? At 250 winners the bar that
   defines the hero number matters more than it does at 79. Leave at £200 for v1.
