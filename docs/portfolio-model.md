# The portfolio model — how this business scales

**Status: the operating thesis, 2026-09-22.** Written fresh after a full session working the live
numbers. Everything in here has been measured against `brookfield_prod` or the Shopify API; where a
thing is not known, it says so.

Replaces an earlier draft (`next-product-criteria.md`, deleted 2026-09-22) which was written
mid-session while the analysis was still moving and reached conclusions that later measurement
reversed — most importantly it read the falling profit-per-pound of advertising as diminishing
returns, when the campaign was in fact at 94% impression share and losing 0.00% to budget: the
business had run out of RANGE, not out of profitable spend. Recoverable from git history if the
reasoning trail is ever wanted.

---

## 1. The thesis, in one page

**This is a product-discovery business. The asset is the portfolio, not the customer base.**

The job is: find products, list them, trial them, keep the ones that work, drop the ones that don't,
and let the system price and reorder the survivors so the humans stay free to find more. That is the
owner's own description of the business and **the data supports it.**

Three measured facts make it work:

| | |
|---|---|
| **A winner persists** | 72% of styles earning >£200 in year 1 still earned >£200 in year 2 |
| **A trial is nearly free** | 37 loss-making styles over 12 months lost **£1,202 between them** — £32 each |
| **Range, not budget, is the limit** | At £5,675/month of ad spend the campaign held **93.7% impression share and lost 0.2% to budget** |

The third is the one that unlocks everything. **The business is not short of money to spend on
advertising. It is short of products to advertise.** Adding a product creates new impression surface;
adding money to a saturated range just raises your own click prices.

> ## More products is the growth lever. The constraint is throughput, not risk.

---

## 2. The scaling equation

Winners accumulate and decay. The portfolio settles where new winners equal lost ones:

> **Steady-state winners = (trials per year × hit rate) ÷ (1 − persistence)**

With the measured hit rate (15–25%) and persistence (72%):

| Trials/year | Hit rate | New winners/yr | **Steady-state portfolio** | At ~£500/winner |
|---|---|---|---|---|
| 125 *(2025 actual)* | 25% | 31 | ~111 | £56k |
| 250 | 25% | 63 | **~223** | **£112k** |
| 400 | 20% *(picks get thinner)* | 80 | **~286** | **£143k** |

**The ceiling is not fixed. It moves with trial count.** Current position: ~80 winners, heading to
~111 on 2025's trial rate. Everything above that has to be bought with more trials.

---

## 3. The evidence

### 3.1 Profit is concentrated, and that is normal for this model

| Band | Styles | Profit 12m | Share |
|---|---|---|---|
| Top 10 | 10 | £22,462 | **34.5%** |
| Top 11–20 | 10 | £8,676 | 13.3% |
| Top 21–100 | 80 | £24,834 | 38.2% |
| The other 203 | 203 | £9,173 | 14.1% |

303 styles sold in the year; **20 carry 47.8% of the profit.** This is the expected shape — the
portfolio is a small number of annuities sitting on a long tail that pays its own way.

### 3.2 Winners persist — 72%

Of 58 styles earning >£200 in year 1, **42 still earned >£200 in year 2.** 16 faded. 38 new winners
appeared, taking the winner count from 58 to 80.

**A winner found is an annuity.** This is the compounding asset in the business and it is the whole
justification for spending time on discovery.

### 3.3 The hit rate is 15–25% and stable

Anchored on **first actual sale** (see §8 — do not use `created_at` for this), profit in the first
180 days:

| Cohort | Styles that sold | Winners (>£200 in 180d) | **Hit rate** | Avg winner |
|---|---|---|---|---|
| 2024 | 69 | 17 | **24.6%** | £410 |
| 2025 | 125 | 19 | **15.2%** | £380 |
| 2026 *(mature only)* | 18 | 3 | **16.7%** | £514 |

No decline. Trebling the trial count from 2024 to 2026 did **not** degrade the strike rate.

### 3.4 Trials are cheap, and failure is cheaper

The 2025 cohort — 125 styles that first sold that year, full life to date:

| Outcome | Styles | Profit |
|---|---|---|
| Star (>£2,000) | 2 | £5,384 |
| Winner (£500–2,000) | 9 | £6,703 |
| Small winner (£200–500) | 31 | £9,552 |
| Marginal (£0–200) | 66 | £4,908 |
| **Loss** | **17** | **−£870** |
| **Total** | **125** | **£25,677** |

**86% of trials made money.** The 14% that failed cost £870 between them.

Across the whole book over 12 months: **37 loss-making styles, £1,202 of total loss, £32 average.**
Dead capital — stock held with no sale in 180 days — is **£4,257, or 6% of the £70,574 held.**

> A failed trial is not a write-off. The stock recycles and the loss is the price of a takeaway.
> **Risk is not what limits trial volume.**

### 3.5 The binding constraint is range — measured

| Month | Spend | Impression share | **Lost to budget** | Lost to rank |
|---|---|---|---|---|
| May 2026 | £3,488 | 68.3% | 13.9% | 8.0% |
| Jun 2026 | £5,625 | 91.5% | 6.3% | 2.2% |
| Jul 2026 | £5,675 | 93.7% | **0.2%** | 6.1% |
| Aug 2026 | £4,202 | 91.7% | **0.00%** | 8.3% |

By July the campaign was showing on **94% of every impression available to the range**, losing
**nothing** to budget. There was no more traffic to buy at any price.

This explains the profit-per-pound curve, which otherwise looks like advertising failing:

| Month | Shopify profit | Ad spend | Kept | **Kept per £1** |
|---|---|---|---|---|
| Apr 2026 | £3,106 | £1,393 | £1,713 | **1.23** |
| May | £5,515 | £3,488 | £2,027 | 0.58 |
| Jun | £8,184 | £5,625 | £2,559 | 0.45 |
| Jul | £8,305 | £5,675 | £2,630 | 0.46 |
| Aug | £5,520 | £4,202 | £1,318 | 0.31 |

**The ads did not stop working. The range ran out.** Spend kept climbing against a fixed, exhausted
set of searches, so each extra pound bought a more expensive version of the same click. Apr–Sep the
channel still kept **£10,998 after every penny of ad spend.**

**Operating rule:** when kept-per-pound falls, the first question is *"have we run out of range?"*,
not *"should we cut the budget?"* Check impression share and lost-to-budget before touching spend.

### 3.6 Why this is a product business and not a customer business

Two years of Shopify orders, emails hashed in memory, counts only:

| | |
|---|---|
| Orders | 8,507 |
| Distinct customers | 7,912 |
| Bought once | **93.4%** |
| Came back after 3+ months | **93 people — 1.2%** |

Footwear is structurally low-repeat: a durable good, bought occasionally, searched for by product
name. **The customer base does not accumulate. The portfolio does.** That is not a failure to fix —
it is the reason the product-discovery model is the right one for this business, and why effort
belongs in finding products rather than in CRM and loyalty work.

---

## 4. The three real constraints, in order

Not risk. Not dead stock. Not ad budget. These:

### 4.1 Labour per trial — the one to engineer away

Sourcing, listing, photography, data entry, pricing setup. 121 styles were introduced in 2026.
**Every hour cut from listing a product raises the ceiling in §2 directly**, because trials/year is
the multiplier on the whole equation.

**This is what the platform is for, and it is where build effort should now go.** Add/Modify, the
feed, the automated pricing and reorder loops already carry this — they are the reason two people can
run 300 styles. The next increment of that work is worth more than any new analytics screen.

### 4.2 Sourcing

Can 250–400 genuinely new styles a year be found? This is the owner's skill and his supplier
relationships, and it is not answerable from the database. **Owner's assessment 2026-09-22: scope for
10× the current range, comfortably.** Recorded as the working assumption.

### 4.3 Working capital

~£800 of COGS per trial on average. 250 trials ≈ £200k of COGS a year; at the current ~4× stock turn
that needs roughly £50k of working capital on top of holding the winners, against £70,574 deployed
today.

**This is a fundable proposition, and it is the right thing to borrow against** — 86% of trials make
money, failure costs £32, and the capital recycles. Funding *more trials* is a different and far
better bet than funding *more ad spend against a saturated range*, which is what a growth loan would
have bought in 2026.

**Sequence:** cut labour per trial first, prove it over one season, then borrow to fill the range.

---

## 5. The margin multiplier

Trial volume and product quality **stack** — they are not alternatives.

- More trials → more winners → more impression surface → more £500 winners.
- Better products → the same number of winners, each worth more.

250 trials at £500 a winner is £112k. **250 trials at £1,500 a winner is £335k.** Same engine, same
labour, same sourcing.

So when choosing *which* products to trial, bias toward the traits that make a winner worth more.
**These are a bias, not a gate — they must never stop a trial happening, because a trial costs £32.**

| Trait | Why it raises the value of a winner |
|---|---|
| **Repeat purchase / consumable** | A returning buyer costs £0 to acquire; the same unit is worth ~2.7× |
| **Order value ≥£40, or multi-unit** | £4.44 of packing and postage is fixed per order. 94.4% of orders are single-unit, which is why a £12 sock loses money |
| **No size matrix** | Fit drives the 12.7% (Shopify) / 15.3% (Amazon) return rate, and a 7-size run ties up ~4× the capital of a one-size product |
| **Supply others cannot list** | Exclusive or controlled supply is the only escape from the price auction |
| **Sells twelve months** | Nov–Feb earns ~£3k against ~£15.7k of fixed cost. Seasonality is the hole in the year |
| **Cash cycle under 90 days** | Six-months-ahead allocation traps capital and makes a mistake cost a year |

---

## 6. What to build

### 6.1 The Winners screen — a birds-eye view of the portfolio

**Owner's call, 2026-09-22.** There is no TRIAL / WINNER / LOSER dashboard, and this is **not** an
exception or action list either. It is the **bird's-eye view of the business**: every product that
earns, shown as what it is — *a mini asset.*

> *"Each product is a tiny asset that is earning for me. I want as many as I can get.
> That 20 should be 30 next year."*

**The hero number is the WINNER COUNT.** Per the house rule on headline hierarchy, one tracked metric
is the visual hero and everything else is supporting detail. The count is the thing being grown, it
is the direct output of the scaling equation in §2, and it is currently **79**.

**Window: rolling 12 months.** Not 30 days, not a season — this is a portfolio view and an asset is
judged over a year.

**Out-of-stock winners STAY ON THE LIST.** This is deliberate and it is the opposite of an exception
screen: a winner that is out of stock is still an asset, and the owner wants to see **what it earned**,
not be nagged about it. Keeping winners in stock is already handled by dedicated processes
(Birkenstock ordering, St Ives), and duplicating that here would turn a strategic view into a chore
list. **Do not filter the list by stock, and do not badge it red.**

What the screen shows:

- **Winner count, as the hero** — with last year's count beside it, because the whole thesis is that
  this number climbs. 58 → 80 over the last year measured.
- **Every winner**, 12-month profit, units, and **direction against the prior 12 months** — growing,
  flat, shrinking. Direction is what tells you an asset is maturing or dying.
- **Joined this year** — new entrants to the portfolio. This is the discovery engine's output made
  visible, and it is the number the hunting work is judged by.
- **Left this year** — winners that dropped below the bar. The churn side of §2's equation; 28% a
  year is normal and expected, so this is context, not an alarm.
- **Total portfolio profit**, so the count always reads alongside what it is worth.

A winner is a style earning **over £200 in the rolling 12 months.** Styles with under 180 days of
selling life are not eligible yet — they simply are not on it.

**No hit-rate or persistence widgets.** Those numbers (§2) steer an annual decision about how many
trials to fund. Recompute them into this document when the buying plan is set; keep them out of the
UI.

**Second tab: CONTENDERS — spotting a winner at 30 days instead of 180.** Profit in a style's first
30 days on sale predicts whether it becomes a winner, sharply:

| Profit in first 30 days | Styles | **Conversion to winner** |
|---|---|---|
| £0 or less | 10 | **0%** |
| £1–49 | 138 | 8% |
| £50–99 | 43 | 28% |
| **£100–199** | 18 | **72%** |
| **£200+** | 3 | **100%** |

Only 25% of a winner's 180-day profit lands in its first 30 days (45% by day 60), so **over half the
value is still ahead when the signal fires.** At the time of writing there are 99 young styles in the
building, ~20 of them future winners, and **14 already identifiable — three of which are out of
stock.** The action is reorder and advertise, early.

**Full build detail: the route headers in `bcweb-server/routes/portfolio-*.js` and `utils/portfolio.js`.**
(The separate build spec was deleted 2026-09-22 — it had become double work for every small change.)

### 6.2 Throughput work

Per §4.1, this outranks reporting. Anything that reduces the minutes between "found a product" and
"live on both channels with a price and a feed entry" raises the ceiling directly.

---

## 7. What is NOT known

Stated plainly so nobody treats these as settled:

1. **What a lean-ad season actually earns.** Ads went off 2026-09-07. Whether contribution holds
   when spend is cut has never been measured across a season. This is the single most valuable
   measurement available in 2027.
2. **Whether the hit rate holds at 250–400 trials.** It held from 15 → 40 → 121. It has not been
   tested above that, and thinner picks should be expected at some point.
3. **Seasonality of introduction.** Whether a product launched into winter converts worse is
   genuinely unresolved and is confounded (a September launch spends its first 180 days in the low
   season by construction). **Do not discourage a winter buy on the strength of it.**
4. **The 2026 cohort is mostly unread.** 97 of 121 styles introduced in 2026 have not had 180 days.
   At a 15–25% strike rate that is plausibly **15–24 winners already in the building** and not yet
   visible in any number above.
5. **Whether higher-margin categories convert at the same hit rate.** §5 assumes the discovery
   process transfers. Untested.

---

## 8. Data-integrity notes — read before running any analysis

- **`skusummary.created_at` is a RECORD date, not a go-live date.** Mean gap to first actual sale:
  **261 days** (2024 cohort), 134 days (2025), 18 days (2026). It was backfilled from the legacy text
  stamp on 2026-07-28 and is faithful to it — but the legacy stamp recorded when the record was made,
  often long before the product went on sale. **Anchor all cohort and lifecycle analysis on
  `MIN(sales.solddate)`.** Using `created_at` during this session produced a fictitious collapse in
  the hit rate.
- **`sales.profit` does NOT include advertising.** Any "profit" figure that has not had ad spend
  subtracted is contribution, not profit.
- **BCWEB holds no Google Ads data before 2026-04-03** (`google_campaign_daily`). Pre-April figures
  exist only in the Google Ads account and must not be quoted as measured here.
- **Returns convention:** filter `qty > 0` for ad and profit analysis (returns live in the haircut,
  owner's decision 2026-09-10, `utils/shopifyProfit.js`). Analytics → Sales deliberately sums every
  row and will read lower.
- **Cohort maturity:** exclude anything with under 180 days of selling life from hit-rate maths.

---

## 9. Sources

Live `brookfield_prod`, read-only, 2026-09-21/22. `sales` (`qty > 0`), `localstock` / `skumap` /
`skusummary` for stock at cost, `google_campaign_daily` for spend and impression share. Repeat-purchase
analysis from the Shopify Orders API over 730 days (8,507 orders); customer emails were SHA-256 hashed
in memory, never written to disk or printed, and only aggregate counts retained. Overheads supplied by
the owner: rent £800/mo, wages £3,000/mo, accountancy £120/mo, insurance £200/yr.
