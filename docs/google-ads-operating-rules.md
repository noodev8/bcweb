# Google Ads — the operating rules

**One page. The rules for deciding which styles advertise, and why the numbers are what they are.**
Agreed 2026-09-07. Build detail lives in `google-ads-spec.md`; this is how the screen gets *used*.

---

## ⏳ OPEN EXPERIMENT — review from 5 Oct 2026. DELETE THIS SECTION once answered.

**Temporary. Not part of the rules.** Started 2026-09-07: campaign target raised **600% → 850%**.

**The question:** how much of the Shopify book actually depends on Google Ads? Attributed revenue hit
**94%** in Aug 2026 (41% in Jan), but attribution is an upper bound — more spend buys more touchpoints
and therefore more claimed credit. Winter says the floor is not zero: at ~£320/month of spend,
Nov 25–Feb 26 still moved 58–100 units/month and kept money every month.

**Watch units against SPEND, not ROAS:**

| What happens | What it means |
|---|---|
| Spend halves, units drop ~10% | Ads were largely buying sales that would have come anyway. Run lean all winter. |
| Spend halves, units halve | The dependency is real. Keep the higher target for cash, but now you know the trade. |

**Baseline to compare against** (as at 2026-09-07, before the change had any effect):

| | |
|---|---|
| Aug 2026 | £4,202 spend · 420 units · £4,562 profit · **£361 Kept** · ads = 92% of profit |
| 90d to 5 Sep | £14,411 spend · delivered ROAS **6.02** against a 600% target |
| Buckets | `standard` 231 · `pause` 48 · `new` 5 (OUT rule applied 2026-09-07, audited clean) |
| Last off-season (Sep 25–Feb 26) | £558/month spend → **£435/month Kept**, positive every month |

**Give it three weeks minimum.** Smart bidding re-learns after a target change and the first week
overshoots in both directions. Judging it early is how a correct change gets reverted.

⚠ **BOTH LEVERS MOVED ON THE SAME DAY**, against the sequencing advice further down this page: the OUT
pass (48 styles paused, ~£63/day of spend removed) and the target raise both landed on 2026-09-07. So a
fall in spend CANNOT be attributed to one or the other. That is survivable for the question actually
being asked — "do units hold when spend falls?" is about the aggregate relationship, not about which
lever caused the fall — but it does mean the target change cannot be scored on its own, and a second
target move should be made alone if one is wanted.

### ADS WENT FULLY OFF on 2026-09-07 — the target experiment is suspended, a better one replaced it

The campaign was **switched off entirely** on Mon 2026-09-07, the same day as the OUT pass and the
850% target raise. That kills the target experiment above (a target cannot be scored on days the
campaign did not run) but hands over a **cleaner** answer to the same question: a real blackout is a
far better dependency test than a spend reduction.

⚠ **BCWEB HAS NO RECORD OF THE OFF SWITCH.** `skusummary.googlecampaign` still reads 149 `standard`
/ 142 `pause` — those are OUR bucket labels, and the on/off lever lives in the Google Ads account.
Do not read the bucket counts as evidence the campaign is running. Nothing in this repo can tell you.

**Read the blackout with the SHOPIFY/AMAZON UNIT RATIO, not with Shopify units.** Amazon is the
control: same stock, same brand, same season, no Google Shopping. Anything that moves both channels
(weather, the end of sandal season) divides out; only what is specific to Shopify survives.

| Week | Shopify/day | Amazon/day | Ratio |
|---|---|---|---|
| Aug 10–16 | 23.0 | 23.0 | 1.00 |
| Aug 17–23 | 15.0 | 21.9 | 0.69 |
| Aug 24–30 | 9.9 | 22.1 | 0.45 |
| Aug 31–Sep 6 | 7.4 | 18.9 | 0.39 |
| **Sep 7–8 (ads off)** | **3.0** | **16.5** | **0.18** |

**The ratio was already falling steeply before the ads went off** — that is the trap in this data. A
raw "Shopify halved" reading is mostly the seasonal slide that was running through all of August.
The blackout's own contribution is the step from 0.39 to 0.18.

**Do not call it yet: 0.18 is two days and n=6 units.** Sep 2025 shows the ratio decaying seasonally
anyway (1.17 → 0.71 → 0.72 → **0.33** → 0.61 across September) and reaching 0.33 unaided, so a single
low reading is inside the historical noise. 0.18 is below anything in that series, which is why it
looks real — but a fortnight is the minimum honest read, and the review date above still applies.

**What the sold styles say — and why it does NOT answer the question.** Of the 8 Shopify units sold
in the blackout, 7 were styles that had been advertised, 5 of them at £20–46 of 30d spend. Tempting to
read as "ads are not needed for these". It is not: the mix by ad-spend band is **unchanged** by the
blackout (63/25/13 off vs 64/33/3 the week before, and ~66/32/2 all August). Advertised styles are
simply the popular styles, so the mix cannot separate advertising from demand. **The volume-against-
control test is the only one that carries information here.** Don't rebuild the mix cut.

Aug-on-Aug for context — the reason the target moved at all: units +77% (237 → 420) and profit +£2,625,
but ad spend +£3,164, so **Kept fell £900 → £361**. Growth and cash were pulling opposite ways.

### The winter plan (owner, 2026-09-09) — and the one number in it that the data contradicts

The intent: stay off through the tail of the sandal season, bank the saved spend, then restart the main
campaign at **£20/day instead of £200/day** and work the winter lines through to spring. The shape of
that is well supported — the seasonal slide is real and it was visible in Sep 2025 too.

**£20/day is not "back to last winter", it is DOUBLE it.** Worth knowing before it is set. Actual
delivered spend Nov 25 – Feb 26 was **£9–13/day** (£341 / £265 / £305 / £374 a month) — and that ran
positive every month. The "£558/month off-season" figure quoted in the baseline above is a Sep–Feb
average pulled up by Sep (£28/day) and Oct (£39/day); it is not the deep-winter rate. So £20/day is a
deliberate step up on a period that already worked, not a retreat to it. Fine if intended — but it is
roughly £600/month, and the winter book it is buying into is small.

**⚠ "Push the boots" points at the wrong category. Shopify's winter seller is SLIPPERS.**
Nov 25 – Feb 26 on Shopify, by category:

| | Units | Profit |
|---|---|---|
| Sandals (still, in deep winter) | 159 | £1,663 |
| Shoes / trainers | 91 | £578 |
| Boots | **10** | **£132** |

Boots did **ten units in four months**. Inside the top winter sellers, **six of the top fourteen styles
were Birkenstock Zermatt slippers** — 52 units, £572 profit, roughly 5x the entire boot category. The
stock backs the same conclusion: **264 slipper units across 12 styles in hand today, against 70 boot
units** (and boots are ~3% of the 2,157 units held). Sandals outsell boots 16:1 even in November.

So the seasonal pivot is right and the target is wrong. **The winter campaign should carry the Zermatt
slippers and the winter-surviving sandals/trainers, not a boot push.** Boots are a 15-style, thin-stock
corner that has never earned advertising here.

**Restart bidding — a LEANING, not a decision (owner, 2026-09-09).** The relaunched campaign will
*probably* open on **Maximise conversion value** rather than Maximise clicks, on the reasoning that the
account carries enough conversion history to bid on. **The owner has explicitly reserved the right to
change their mind, so do not treat this as settled and do not build anything that assumes it.** If the
campaign comes back on a different strategy, that is a change of plan, not a mistake to flag.

---

## The shape of it

Three buckets, one lifecycle:

```
   product-create.js
          |
          v
       [ new ] --- proven (>= £50 spent, Kept >= 0, shelf ok) ---> [ standard ]
          |                                                          |    ^
          |                                                          |    |
          '------------- didn't work ---------> [ pause ] <-- 2a/2b -'    |
                                                    |                     |
                                                    '----- Rule 3 --------'
```

`standard` is the only campaign that is trying to make money. `new` buys data (Rule 4). `pause` is
excluded from Google entirely. **Not** a set of margin-segmented campaigns — see "Why not segment".

**Ad-hoc spin-off campaigns happen** — a product line pulled out into its own bucket and campaign to test
an opportunity (e.g. IVES once its Amazon-matched price moved break-even from 7.4x to ~5x). Always MOVE
the bucket, never duplicate: a style in two campaigns bids against itself in the same auction.

Everything is read on the **90-day window** of the Google Ads screen. 30 days is too noisy at this
volume; every threshold here was measured on 90.

---

## Rule 1 — ignore the small stuff

> **Anything under £20 of ad spend in 90 days is out of scope.**

68 styles, about **£321 a quarter between them**. It is noise, and working it is where the time goes.

## Rule 2 — OUT (monthly)

Two passes. **2a is the money; 2b is the early warning.** Run both.

### 2a — the losers (90-day window)

> Sort **Kept** ascending → anything with **spend ≥ £50 AND Kept negative** → `pause`.

One number. As at 2026-09-07 that was **46 styles**, £5,640 of spend returning **−£2,443**.

Kept is profit after ad spend, so a negative Kept means exactly what it says: this style cost more to
advertise than it made. No interpretation needed.

**On the screen:** window `90 days` → filter `KEPT LESS 0` → filter `SPEND MORE 50` → select all → `pause`.

### 2b — the running-out (30-day window)

> **Thin shelf AND Kept negative** → `pause`.
>
> **Thin shelf = under 5 buyable sizes AND under 50% of the run in stock.** Both, not either.

**Why this is not covered by 2a.** Kept looks BACKWARDS 90 days; Sizes is TODAY. A style that sold well
in July on a full size run and is now down to two sizes still shows positive 90-day Kept — it will start
losing money over the coming month and 2a will not catch it until it already has. 2b catches the decay
on the way down. That is also why it reads the 30-day window and 2a reads 90: the whole point is to be
early.

**On the screen:** window `30 days` → **Thin shelf** button → filter `KEPT LESS 0` → select all → `pause`.

(The button applies the compound rule. `SIZES LESS 5` typed by hand is the raw COUNT only — no longer the
same narrowing.)

**WHY BOTH CONDITIONS, AND NOT JUST A COUNT.** The count alone was the original rule and it was wrong —
3/4 and 4/6 are nearly a full run but never reach 5. Re-scored over 90 days:

| count | share of run | styles | conv. | Kept |
|---|---|---|---|---|
| 1–4 | **<50%** | 101 | **3.43%** | **−£1,299** |
| 1–4 | ≥50% | 45 | 5.65% | +£447 |
| ≥5 | <50% | 3 | 6.40% | +£519 |
| ≥5 | ≥50% | 81 | 7.25% | +£3,228 |

**Exactly one cell loses money, and it needs both conditions.** The count alone flags all 146 rows in the
top two bands, sweeping up 45 profitable styles worth +£447 — a short run mostly in stock converts at
5.65%, nowhere near the 3.43% of a deep run picked over to the same absolute number. Requiring both
narrows the flag to 101 styles carrying −£1,299 and leaves a retained set keeping £4,194 against the count
rule's £3,747: better on both sides of the line at once.

Share alone is not the answer either — the 5+/<50% cell still converts at 6.40% and earns. Depth carries
information at the top of the range, share at the bottom. (Only 3 styles, so that rescue arm is weakly
evidenced — and only 3 styles' worth of risk.)

⚠ **DO NOT pause on a thin shelf alone.** At the end of a season most of the book is thin. Of the 146
under-5 styles on 2026-09-07, **31 were EARNING (+£478/month)**. A thin shelf that still converts is a
style whose remaining sizes happen to be the ones people want — `1031620-MAYARI` kept £86 last month on
4 of 7. **The losing test is what makes 2b safe.**

**This does not contradict Rule 1's £20 floor.** That floor exists so no individual row is worth
*investigating*; 2b is a filter-and-select sweep where no row is examined individually, so it costs no
attention per style. In aggregate the 60 rows are ~£5,300/year, which is not noise.

**Sizes counts local stock AND FBA**, because an FBA unit fulfils a Shopify order the same as the shelf
does. Trust the screen's Sizes column over any hand-rolled count — a local-stock-only query said 75
styles had zero sizes when the true figure was 46.

## Rule 3 — BACK IN (monthly)

> Both must be true:
> 1. **B/E ROAS is below what the campaign is currently delivering**
> 2. **Not a thin shelf** — i.e. 5+ buyable sizes, OR at least half the run in stock

The bar in (1) maintains itself — it is whatever the campaign delivers, so it moves when the target
moves. At a 600% target that was ~6x. Nothing to remember or update.

**Expect `pause` to grow through the season and empty when stock lands.** Anything removed by 2b fails
condition (2) by definition, and Birkenstock cannot be re-ordered on demand — so those styles stay out
until the next season's delivery puts sizes back on the shelf, at which point Rule 3 readmits them
automatically. A swelling `pause` bucket in August is the system working, not a backlog.

**Why these two survive a pause and Kept does not.** The moment a style stops advertising its spend is
zero, so Kept becomes just its product profit — positive. Sort by Kept and every paused style says
"bring me back", forever. B/E ROAS and Sizes are properties of the product, not of the advertising, so
they still mean something with no traffic running. That is the whole reason the B/E ROAS column exists.

**The two conditions catch different faults**, and a style can fail either alone:

| | B/E ROAS | Sizes | Diagnosis |
|---|---|---|---|
| `0051753-ARIZONA` | 6.4x — fine | **2/12** | Empty shelf. 172 clicks, 1 sale. |
| `1005292-ARIZONA` | **14.6x** | 7/8 — fine | Margin. No bid target saves it. |

Same symptom, opposite causes, opposite fixes.

## Rule 4 — NEW (the intake)

`routes/product-create.js` seeds **`new`** on every style it creates. It is a TRANSIT bucket, not a home:
without an exit rule products rot in it. Before this was set up, the five styles sitting in `new` had
taken **7 clicks and £1.48 in 90 days** — effectively invisible, because `standard`'s campaign does not
include the label.

### It needs its own Google campaign

| Setting | Value | Why |
|---|---|---|
| Bid strategy | **Maximise clicks**, max CPC ~£0.50 | See below. NOT max conversion value. |
| Budget | **shared daily**, see formula | One campaign budget, not per product. |
| Scope | `custom_label_0 = new` | |

> **daily budget = (styles in `new` × £50) ÷ 56 days**

5 styles → **£5/day**; 30 styles → **£27/day**. The £50 comes from what it costs to LEARN about one
style: at £0.429 CPC and 4.65% conversion, 100 clicks ≈ £43 ≈ 5 conversions, which is enough to form a
view — and it lines up with Rule 2a's £50 floor, so "judgeable" means the same thing everywhere.

**NOT max conversion value** (the first instinct, and wrong here). It predicts conversions from history,
and a cold campaign has none — it will either not spend or spend erratically, and you will lose weeks not
knowing which. This campaign's job is to buy INFORMATION, and maximise clicks buys the most samples per
pound. Profit-seeking is `standard`'s job; a style inherits that target when it graduates.

### Exit rule

> **At £50 of spend, judge it on the normal rules:**
> - **Kept ≥ 0 AND not a thin shelf** → `standard`
> - otherwise → `pause`

**A style that cannot reach £50 in 90 days is NOT a failed product.** It means Google is declining to show
it — a feed or price fault (missing `skumap.uksize`, weak title, priced far off market). Investigate it;
do not bucket it. Bucketing it records a verdict that was never actually reached.

### Two things about a shared budget

**It is not an even split.** Google spends where the auction takes it, so "£50 each" is an average, not an
allocation. The first five in `new` went 3 / 2 / 2 / 0 / 0 clicks — two got nothing at all. Check the
zero-click stragglers as the feed problem above rather than waiting on them.

**Admit them in batches when intake spikes**, because intake is violently seasonal:

| | Mar | May | Jun | Jul | Aug | Sep |
|---|---|---|---|---|---|---|
| new styles (2026) | 22 | 15 | **30** | 22 | 3 | 3 |

Thirty products on one budget means each gets a thirtieth of the attention, none reach £50 for months, and
Google concentrates spend on a handful anyway — so you would learn about 5 and nothing about 25. Run 8–10
at a time and hold the rest, or raise the budget to match. Drip-feeding is cheaper.

⚠ **Re-check the budget against intake every spring.** At £5/day a June cohort of 30 takes 300 days to
become judgeable and would still be sitting there the following summer. Nothing will warn you.

---

## The column glossary (the only three that matter)

- **Kept** — our net Shopify profit minus Google's spend. Decides who goes OUT.
- **B/E ROAS** — revenue ÷ net profit. Contains no Google figure. The revenue ROAS this style must earn
  before its advertising pays for itself; equivalently the tROAS a bucket of styles like it would need.
  `—` means it loses money before any ad spend at all — reprice or drop, no ad setting helps.
- **Sizes** — buyable sizes / listed sizes, **today**, not the window's.

Conv % and Kept / sale are hidden (`SHOW_CONV` / `SHOW_KEPT_PER_SALE` in `google-ads/page.tsx`). They
explain *why* a row is bad once you know it is — drill work, not list work.

---

## The thresholds, and where they came from

| Threshold | Value | Evidence |
|---|---|---|
| Ignore below | £20 spend / 90d | 68 styles total −£321/quarter |
| OUT floor | £50 spend / 90d | Below it the losses are under £250/quarter combined |
| Thin shelf | **<5 sizes AND <50% of run** | The only loss-making combination: 3.43% conversion and −£1,299, against 5.65–7.25% and profit in every other cell. Count alone mis-flags 45 profitable short-run styles |
| B/E amber | **10x** | Blended delivered ROAS 6.0; best spend decile 6.3; no margin band ever above 7.6 |

The original count-only cliff, measured over 30 days to 5 Sep 2026 — still the reason depth matters at
all, but superseded as a RULE by the count-and-share pair above:

```
sizes in stock   styles   clicks   spend    sold   conv.    kept
0                    32      652    £185      36    5.5%    -£17
1-2                  59    2,841    £972      83    2.9%   -£514
3-4                  41    1,640    £674      60    3.7%    -£73
5-7                  55    2,192  £1,136     219   10.0%   +£448
8+                   16    1,077    £570     114   10.6%   +£677
```

It is a cliff between 4 and 5, not a slope — and it is a **count**, not a share.

---

## Why not segment into several campaigns

Considered and rejected 2026-09-07, on the data:

- **Not budget-constrained.** Impression share ran 90–94% with **lost-to-budget at 0.00% every day in
  August**. The textbook reason to tier Shopping campaigns — stop losers eating winners' budget — has
  nothing to do here.
- **No waste tail.** 85 styles produced zero conversions and cost **£308 over a full year**.
- **Splitting costs data.** ~1,563 conversions/90d fractured across campaigns, each needing its own
  learning period and its own target to babysit.

Revisit if lost-to-budget ever climbs off zero. That is the signal that changes the answer.

**`new` (Rule 4) is not an exception to this.** Segmenting `standard` by margin band would be the SAME job
— make profit — divided across campaigns, which loses data and gains nothing when there is no budget to
reallocate. `new` does a DIFFERENT job: spending deliberately at a loss to buy data. One campaign cannot
hold both a profit target and a discovery budget — an 850% target starves every unproven style before it
gets a sample. Different purpose, not the same purpose subdivided. That is the test for any future split.

---

## The thing that matters more than any of this

**The campaign target.**

| Month | Spend | ROAS delivered |
|---|---|---|
| Mar 2026 | £507 | 10.95 |
| Jun | £5,625 | 6.21 |
| Aug | £4,202 | **5.76** |

The target was **600%** and Google was hitting it almost exactly. Blended break-even is **8.4x**. As
spend scaled, delivered ROAS fell straight to the target and stopped — a tROAS campaign spends more
until efficiency drops to target, so the account had been growing into a loss by design.

**Raise the target before doing a removal pass.** The OUT list is computed under whatever target is
running; raise it and some rows fix themselves. Do both at once and neither is readable.

Sequence: target first, alone → wait 3–4 weeks → then the OUT rule on fresh data.

**Seasonality closes the window.** Conversions run 659 in June and 23 in January. A change made in
November cannot be read.

---

## Health check, in case any of this rots

Every number above is re-derivable from `google_product_daily` + `sales` (channel `SHP`) + `localstock`.
If the rules stop matching reality, the things to re-measure first are the **sizes cliff** (stock depth
changes with the season) and **blended break-even** (it moves with cost prices and discounting).

`skusummary.googlecampaign` is the bucket. It ships as `custom_label_0` via the nightly merchant feed,
so a move takes about a day to reach Google — the screen shows both what we say and what Google last
reported, and they disagree during that lag.
