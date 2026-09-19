# DAWNS concession — decision note

Status: **pre-approach**, 2026-09-19. Owner's plan, with the numbers behind it.
Nothing built. This is the reference sheet for the conversation with Dawn and for the BCWEB work that follows.

---

## 1. What this replaces

The plan on the table was to invest in CM3: one member of staff at **£1,000/month** plus **£6,000**
promotional, originally a year, cut back to a 3-month trial. That is **£9,000 of fixed spend**.

**CM3's entire trade, last 12 months: 87 units, £4,924 revenue, £1,332 profit — about £111/month.**

For the 3-month test to wash its own face the shop had to go from ~7 units/month to roughly 60-70 and
hold it. Not grow — decuple. The spend was the wrong instrument, not the shop.

The concession does the same job — units through a door — at **zero fixed cost**.

---

## 2. Why a door beats a screen (12 months, all brands)

| Channel | Net units | Revenue | Profit | Margin | **Profit/unit** | Returns |
|---|---|---|---|---|---|---|
| Amazon | 4,935 | £202,571 | £20,767 | 10.3% | **£4.21** | 15.2% |
| Shopify | 3,725 | £219,553 | £33,639 | 15.3% | **£9.03** | 12.7% |
| **CM3 (shop)** | 87 | £4,924 | £1,332 | **27.1%** | **£15.32** | **0.0%** |

A unit through a door is worth **3.6x an Amazon unit and 1.7x a Shopify unit**, and the shop took
**zero returns in twelve months**. No referral fee, no postage, no ad click, no comeback.

---

## 3. Why these brands

| Brand | Amazon £/unit | Shopify £/unit | **Shop £/unit** |
|---|---|---|---|
| **Rieker** | £3.59 | £3.52 | **£17.52** |
| **Remonte** | £9.12 | £6.79 | **£30.77** |
| **Lunar** | £4.25 | £3.85 | **£12.54** |
| Caprice | — | — | — (no sales on any channel, 12m) |

**Rieker nets five times more through a door than online.** All of Rieker on Shopify earned £105 of
profit in a year across 30 units. Eighteen pairs through the shop earned £315.

Rieker/Remonte is a known name in the town and it is the brand Shopify has never worked for. That is
the whole thesis in one line.

**Caprice is the sleeper**: 53 units, 6 styles, £1,607 of cash, £4,305 at retail, and not one sale on
any channel in 12 months. A brand-new range with no online track record to cannibalise — her shop is a
far cheaper way to find out if it sells than buying traffic for it.

Side benefit: none of these brands carries Birkenstock's selective-distribution question. The brand
choice sidesteps it entirely.

---

## 4. Do NOT give her the online prices

| Brand | Avg realised price online | Avg realised price in shop |
|---|---|---|
| Rieker | £47.09 (Shopify) | **£60.06** |
| Lunar | £30.93 (Shopify) | **£39.64** |

**Same brand, same stock, £13 more per pair through a door.**

The online price is not "the price" — it is a **competed-down** price, set by a Shopify/Amazon fight with
sellers who will always undercut on a commodity brand. Putting it on a high-street rack imports that
price war into the one place it does not exist.

**Shop prices on the rack.** If she asks for parity, the honest answer is that the online price exists
because of a fight she is not in.

---

## 5. The deal (owner's terms)

- **Her stock position:** none. My stock, my title, my risk.
- **Pricing:** I set the prices. She may flex **±10%** where a customer negotiates.
- **Commission:** **10% of the till up to £1,000/month, 15% on anything above.**
- **Stock control:** I manage what goes over and what comes back.
- **Rent:** none. **Wages:** none. **Minimum:** none.
- **Trial:** 3 months. **Survival bar: 15 units/month.**
- **Till:** BCWEB screen (see §7). SumUp on our account, so the money is our turnover.
- **Dual use:** DAWNS doubles as a pick location for online orders.

### What 10% actually leaves (Rieker, at its real shop average of £60.06 / £17.52 net)

| Her cut | To her | **You keep** | vs Rieker on Shopify (£3.52) |
|---|---|---|---|
| **10%** | £6.01 | **£11.51** | **3.3x** |
| 15% | £9.01 | £8.51 | 2.4x |

10% is the right call. Even the 15% band beats Shopify on Rieker by 2.4x, so the tier is safe at both ends.

### The tier and the survival bar are the same number — by accident, usefully

15 units at ~£60 is **~£900/month**, just under the £1,000 tier threshold. So in practice the 15% band
only opens at roughly **17+ units/month** — i.e. only once she has comfortably cleared the bar that keeps
the arrangement alive. The tier is mostly a **motivator, not a cost**.

---

## 6. Points to settle before or during the approach

These are the things that quietly cost money later. None is a reason not to do it.

### 6.1 Make the 15% band MARGINAL, and say so in the agreement

15% on **the excess over £1,000**, not on everything once she crosses it. Otherwise there is a cliff:
£999 of sales pays her £99.90, and £1,001 would pay her £150.15 — £50 earned from £1 of trade. Marginal
removes the cliff and removes any incentive to push a sale into next month or this one.

### 6.2 The ±10% leeway is the biggest quiet leak

A 10% discount on a £60.06 Rieker takes £6.01 off the till but **£5.00 off the ex-VAT profit** — net
falls from £17.52 to £12.52. After her commission you keep **£7.11 instead of £11.51**.

**A 10% discount costs you 38% of your margin on that pair.**

It self-corrects a little (her cut falls with the price too, so she is not incentivised to discount), but
it is not a small lever. Options: allow it freely only on the **dead/seasonal stock** in §8, hold a hard
floor price per style, or allow the full 10% only above a price threshold. Decide which, don't leave it open.

### 6.3 Double-sell is the real technical risk

If her till decrements and Shopify syncs hourly, the same pair can sell in the shop and online inside the
same hour. **The till screen must write `localstock` immediately** — the hourly cron is only the push to
Shopify, never the source of truth. Same discipline as the Pick module.

### 6.4 VAT and her position

Keeping it off her books is the right instinct and the concession structure supports it: **the sale is our
turnover, not hers** — her income is the 10% commission only. That is exactly the protection you are
after. SumUp on our account rather than her till is what makes it true in practice, so do it that way.
Worth one confirming line from the accountant, since her commission is still her taxable income.

### 6.5 Insurance and shrinkage

Whose policy covers our stock while it sits in her shop, and who carries a loss if a pair walks? Agree it
up front. It is an awkward conversation at month two and a non-conversation now.

### 6.6 Plan the exit, not just the entry

The rack stock in §8 is winter. It comes back in spring. Agree now how stock is recalled and how a season
change is handled, so it is a routine, not a renegotiation.

### 6.7 On sending customers over

Sending CM3 walk-ins to DAWNS is right **because CM3 will not be staffed** — 90% of a sale beats 100% of a
customer who leaves. That logic does not extend to online or phone customers you already own; routing
those through her rack just pays 10% for a customer you already had. The rack's job is people who would
never have found you.

### 6.8 Seasonality on the 15-unit bar

The trial starts in September, into the best season for this stock. A bar cleared in November may not hold
in February. Judge the trial on the **3-month average**, not each month, and expect the spring number to be
lower than the autumn one.

---

## 7. BCWEB build — the till screen

Sketch only, not a spec.

- **New sales channel code.** Do **not** book her sales as `CM3`. A separate code (`DWN`) keeps
  `brand-overview` and Analytics honest and makes the 3-month trial measurable on its own terms.
- **DAWNS as a location.** The `location` table already supports this, and a name only `localstock` knows is
  allowed, so DAWNS can be a rack like any other. `pickorder` sorts it last, which is right — it is the
  location you walk to only when nothing else has the pair.
- **Till screen:** scan or search, show the set price, allow the ±10% flex within a server-side bound,
  take payment on SumUp, write the sale and decrement `localstock` **in one transaction**.
- **Commission is derived, never typed.** Compute the 10%/15% marginal split from the logged sales for the
  month. Do not store a per-sale commission figure that can drift out of step with the rule.
- **Hourly cron:** push stock to Shopify. Source of truth stays `localstock`. See 6.3.
- **Statement screen:** what she sold, what she earned this month, marginal tier shown. She should be able
  to see her own number without asking — it removes every argument before it starts.
- **Prices are VAT-inclusive** and profit is ex-VAT, consistent with `utils/shopifyProfit.js`. Commission is
  a percentage of the **gross till**, so it is ~18% of net revenue at a 15% rate — priced in above.

---

## 8. What goes over first

**19 styles, 126 units, £3,720 of cash, £9,222 at retail** — target brands with zero sales anywhere in 90 days.

Read that carefully: the 90-day window is **June to September**, and most of the list is fleece-lined
winter boots. **That stock is not dead, it is out of season and about to come into it.** Which makes it
close to ideal rack stock right now.

| Style | Brand | Units | Cost | Price | Cash tied |
|---|---|---|---|---|---|
| L7514-15 | Rieker | 12 | £34.20 | £75.99 | £410.40 |
| 25511-41-022 | Caprice | 10 | £49.95 | £130.00 | £499.50 |
| 22503-42-311 | Caprice | 10 | £23.50 | £65.00 | £235.00 |
| 72581-00 | Rieker | 9 | £30.05 | £65.00 | £270.45 |
| 22152-42-019 | Caprice | 9 | £23.50 | £65.00 | £211.50 |
| 25547-41-306 | Caprice | 9 | £32.50 | £85.00 | £292.50 |
| 22503-42-199 | Caprice | 9 | £23.50 | £65.00 | £211.50 |
| M9502-42-019 | Caprice | 6 | £26.25 | £70.00 | £157.50 |
| 45973-24 | Rieker | 6 | £32.10 | £72.00 | £192.60 |
| 72617-00 | Rieker | 6 | £32.95 | £77.00 | £197.70 |
| D0772-14 | Remonte | 6 | £38.40 | £82.00 | £230.40 |
| D0772-16 | Remonte | 6 | £38.40 | £85.00 | £230.40 |
| GLW030-BURG | Lunar | 5 | £18.99 | £57.00 | £94.95 |
| GLW030-NAVY | Lunar | 5 | £18.99 | £57.00 | £94.95 |
| JLY219-BRONWYN-WT | Lunar | 5 | £10.99 | £15.00 | £54.95 |
| L7500-35 | Rieker | 4 | £34.20 | £79.99 | £136.80 |
| GLB123-TAN | Lunar | 4 | £22.99 | £65.00 | £91.96 |
| GLB216-TAUPE | Lunar | 3 | £23.99 | £70.00 | £71.97 |
| ELZ006-LAKE-BL | Lunar | 2 | £17.50 | £44.50 | £35.00 |

Total sellable stock across the four brands: **273 units, £6,685 at cost, £15,580 at retail.**

---

## 9. What success looks like — write it down before the conversation

At ~£11.50 net per Rieker pair this is **a few hundred pounds a month, not thousands**. Be honest about
the scale. What makes it a good trade is not the size of the prize:

- it costs **nothing fixed** — the £9,000 never leaves the account
- it liquidates **£9,222 of seasonal retail at full price** instead of at a markdown
- it opens a channel that nets **1.7x Shopify and 3.6x Amazon**, with **zero returns**
- it tests **Caprice** for free
- it gives DAWNS footfall a reason to convert, and gives Dawn a cut of a category she does not stock

**The bar, agreed in advance:**

> Continues if the rack averages **>=15 units/month over the three months**, at **>=£9 net per unit after
> commission**.

That is ~£135-170/month of profit, which would **more than double the entire shop channel's current
annual run rate**, for £0 of fixed cost — against a CM3 plan that needed £9,000 just to start.

---

## 10. Sources

All figures: live `brookfield_prod`, read-only, 2026-09-19. 12-month windows to date.
Channel economics and brand splits from `sales` (`profit` per unit, returns netted).
Stock from `localstock` (`ordernum='#FREE'`, `deleted=0`, `qty>0`) joined through `skumap` to `skusummary`.
Prices via `safeNumeric` semantics on the varchar price columns.
