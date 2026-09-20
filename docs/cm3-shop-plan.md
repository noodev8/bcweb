# CM3 shop — investment plan

Status: **agreed target, not yet built**, 2026-09-20. The owner's decision to pay himself £1,000/month and
run CM3 as a real sales channel rather than a room that happens to have shoes in it.
Nothing built. This is the reference sheet for the floor, the pricing rule and the BCWEB work that follows.

Supersedes the CM3 half of `dawns-concession.md`. The DAWNS concession is **not** being run in parallel —
the owner dropped it on 2026-09-20. Keep that note for its channel economics, which still hold.

---

## 1. What changed

The earlier CM3 plan was £1,000/month of staff plus £6,000 promotional — £9,000 of fixed spend against a
shop trading at ~£111/month. That plan is dead. Two things replace it:

- **The £1,000/month is a draw to the owner, not a wage to a third party.** If it fails the money is still
  in the family; a staff wage would be gone. The true cost of the draw is the profit that £12,000 of stock
  would otherwise earn — order of £2,000–£3,000/year — not £12,000.
- **The marketing budget is deferred**, because the shop has never actually been stocked or displayed.
  There is no point advertising 20 broken styles.

---

## 2. The shop has never been tried — read this before forecasting anything

**Do not forecast CM3 from its own sales history.** That history measures the absence of a shop, not the
appetite of the town. Two separate analyses in this conversation went wrong by treating it as a demand signal.

### 2.1 The floor holds 3.7% of the stock

| Location | Units | Styles |
|---|---|---|
| C3-Front | 1,299 | 128 |
| C3-Back | 535 | 105 |
| C1-Rack | 110 | 19 |
| **C3-Shop** | **78** | **20** |
| C3-Amazon (outbound staging) | 77 | 20 |
| UKD-Tests | 21 | 6 |

The building holds **2,121 sellable units**. The shop floor holds **78 units across 20 styles** — and they
are not a range, they are leftovers. Median size coverage is about **3 sizes per style** against a normal
EU 36–42 run of seven. For 18 of the 20 styles the floor already holds *every remaining unit in the building*,
so the shop is being given the **broken tails of styles Amazon and Shopify have already sold through**.

**Birkenstock is 1,785 units and 141 styles in the building, and 3 units on the shop floor.**

Mitigating fact, from the owner: staff *do* look stock up on the computer and fetch from storage, so a
customer can reach the full range. But that only serves someone already committed enough to ask. It cannot
do display's job, which is making someone who wasn't going to buy anything stop and pick something up.
**The 78 units don't limit what can be sold; they limit what gets started.**

### 2.2 The shop out-sold its own floor

85 units sold in 12 months from a floor of 78 — a stock turn of roughly **1.1×**, against Shopify's 1.76×,
achieved with no display, no advertising, no size runs and an ambiguous door. That is not a channel failing
to find customers. **It is a channel that ran out of things to sell.**

### 2.3 Displaying stock costs nothing in online availability

This is the point that separates CM3 from the DAWNS concession and from any off-site option. The shop is in
the same building as the stock and draws on the same `localstock` pool. **A pair on a display rack is still
pickable for an Amazon or Shopify order tomorrow.** Putting 400 units on the floor is not an allocation
decision and consumes no online availability — the only costs are racking, display and a slightly longer
picking walk.

So the plan is not "give the shop some stock". It is **display the warehouse**.

### 2.4 What FBA does and doesn't take

752 units are physically at Amazon, but **569 of them are Lunar**. Rieker (38), Strive (53) and Remonte (19)
are minor; Caprice and Birkenstock are not at FBA at all. **FBA is essentially a Lunar programme** and does
not compete with the shop for the brands the floor needs.

---

## 3. Baseline — what the shop does today

12 months to 2026-09-20, channel `CM3`:

| | |
|---|---|
| Units | 85 |
| Revenue | ~£4,823 |
| Profit | ~£1,310 |
| Average price | £56.74 |
| **Average profit per pair** | **£15.41** |
| Days with a sale | 60 |
| Open days (Mon–Fri 11–4) | ~250 |
| **Profit per open hour** | **£1.05** |

Three days in four take nothing. When a day does convert it averages 1.42 units, so the range and the
selling are fine when someone walks in — **the problem is that nothing on the floor starts a sale.**

---

## 4. The pricing rule — the single most important line in this document

> **The shop sells at RRP. The shop does not sell at the website price.**

### 4.1 The shop is NOT discounting at the till

Tested per style, comparing each CM3 sale to that same style's listed prices:

| Brand | Shop sold | Online price | RRP | vs online | **vs RRP** |
|---|---|---|---|---|---|
| Birkenstock | £64.18 | £61.00 | £77.28 | +£3.18 | **−£13.09** |
| Rieker | £60.35 | £57.35 | £67.47 | +£3.00 | **−£7.12** |
| Remonte | £81.67 | £81.67 | £87.33 | £0.00 | **−£5.67** |
| Lunar | £39.64 | £43.56 | £50.36 | −£3.91 | **−£10.71** |
| Free Spirit | £53.75 | £59.99 | £59.99 | −£6.25 | −£6.25 |

Per transaction: 21 sales above the online price (+£11.00 avg), 12 at it, 27 below (−£7.42).
**Net across 60 comparable sales: +£0.51.** The `discount` flag is zero on all 85 rows.

An earlier draft of this analysis claimed the shop was discounting ~14.5% off its own price. **That was
wrong.** It compared the list price of Rieker currently *held* (£70.23) against the price of Rieker that
*sold* (£60.06) — two different baskets, because the stock in hand is pricier than the stock that went.
Do not repeat that comparison; test per `groupid`.

### 4.2 The real leak is that the shop inherits the competed-down online price

`skusummary.shopifyprice` is not "the price". It is a **competed** price, set by a Shopify/Amazon fight with
sellers who undercut on commodity brands. The shop is importing that price war into the one place it does
not exist. The customer in the shop is not in that auction — they are buying today, in their size, tried on,
with no return.

| Brand | Profit at online price | **Profit at RRP** | Gain |
|---|---|---|---|
| Birkenstock | £18.09 | **£29.00** | +£10.91 |
| Remonte | £30.77 | **£35.50** | +£4.73 |
| Rieker | £17.52 | **£23.45** | +£5.93 |
| Lunar | £12.54 | **£21.47** | +£8.93 |
| **Caprice** | **£37.36** | **£37.36** | — already RRP |

**Caprice, Goor, Grafters, Scimitar and Free Spirit have `shopifyprice` = `rrp`.** They have never been
competed down because they have never had to fight. On those brands the shop price is already correct and
there is nothing to import.

### 4.3 Consequence for the build

Whatever screen the shop uses **must show RRP as the shop price**, with `shopifyprice` hidden or explicitly
labelled as the website's number. If the screen shows the online price, the shop will keep selling at it —
which is exactly what has been happening.

---

## 5. The target

> **30 shoes + ~20 add-ons per month = £1,000.**
> About **1.4 pairs per open day**, five days a week.

How it builds up:

| Pricing basis | £/pair | Pairs/month for £1,000 |
|---|---|---|
| At online price (today) | £15.41 | 65 |
| **At RRP, current mix** | ~£25 | **40** |
| At RRP, weighted to Caprice / Remonte / Zermatt | ~£28–30 | **34–36** |
| …plus add-ons at ~70% attachment | — | **~30** |

### 5.1 Cannibalisation is smaller than it looks

A shop sale may displace a Shopify sale, so the honest measure is **incremental** profit. For the brands the
shop actually sells, the Shopify alternative is worth almost nothing:

| Brand | Shop £/unit | Shopify £/unit | **Incremental** |
|---|---|---|---|
| Remonte | £30.77 | £3.39 | £27.38 |
| Free Spirit | £20.24 | £3.70 | £16.54 |
| Rieker | £17.52 | £2.40 | £15.12 |
| Roamers | £22.54 | £8.43 | £14.11 |
| Birkenstock | £18.09 | £7.47 | £10.62 |
| Lunar | £12.54 | £3.15 | £9.39 |
| Caprice | — | never sells online | full value |

Weighted across the shop's mix: **£15.41 gross vs £13.70 if literally everything would have sold online.**
**Cannibalisation costs ~£1.70 a pair, not £9.**

Two rules fall out:

- **Fill the floor with what doesn't sell online.** Rieker, Remonte, Caprice and the UKD men's stock are
  near-100% new money.
- **Birkenstock is the exception** — it has a real online alternative, so a Birkenstock-heavy floor pushes
  the target from 65 to 81 units at online prices. Birkenstock earns its place **in the window as the name
  that stops people**, not as what fills the racks.

---

## 6. The floor

**Target ~400–500 units on display, all of it already owned.** The binding unknown is how many units the
floor physically takes once the storage racking comes off it — a tape measure, not a query, and the number
the whole plan sizes from.

Sellable stock in the building, with profit per pair at each price basis:

| Brand | Styles | Units | Avg cost | Online px | RRP | Profit @ online | **Profit @ RRP** |
|---|---|---|---|---|---|---|---|
| Birkenstock | 141 | 1,785 | £35.15 | £70.21 | £83.69 | £23.36 | **£34.59** |
| Lunar | 26 | 108 | £15.84 | £37.29 | £45.50 | £15.23 | £22.07 |
| Rieker | 12 | 68 | £32.51 | £70.23 | £75.92 | £26.02 | **£30.76** |
| **Caprice** | 6 | 53 | £30.33 | £81.23 | £81.23 | **£37.36** | **£37.36** |
| Goor | 6 | 33 | £15.37 | £37.27 | £37.27 | £15.69 | £15.69 |
| Remonte | 5 | 21 | £37.60 | £81.76 | £88.10 | £30.53 | **£35.81** |
| Roamers | 4 | 18 | £20.94 | £48.61 | £51.89 | £19.57 | £22.30 |
| Free Spirit | 3 | 10 | £21.95 | £59.99 | £59.99 | £28.04 | £28.04 |
| Grafters | 1 | 9 | £14.25 | £36.00 | £36.00 | £15.75 | £15.75 |
| Scimitar | 1 | 8 | £14.95 | £36.00 | £36.00 | £15.05 | £15.05 |
| Strive | 1 | 2 | £38.00 | £79.95 | £89.95 | £28.63 | **£36.96** |

*(Averages across sellable units. Profit = price ÷ 1.2 − cost; the shop carries no referral fee, postage or
ad cost, which is why it is so much higher than the online equivalents. Validated against Rieker:
£60.06 ÷ 1.2 − £32.53 = £17.52, matching booked `sales.profit`.)*

### 6.1 The shape that works

- **Caprice and Remonte at the front, at RRP.** Highest margin, most complete size runs, no online price anchor.
- **Rieker as the volume workhorse.** Known name in the town, £30.76 at RRP, worth £15.12 incremental.
- **Birkenstock as the name in the window.** Not as rack filler — see §5.1.
- **Lunar and the UKD men's stock (Goor / Roamers / Grafters / Scimitar — 68 units) as the cheap end.**
  Lunar's job is price points, not margin; if the floor tilts Lunar the average drops toward £18 and the
  target climbs back above 50.
- **Zermatt slippers as a second lead product** — see §7.2.

### 6.2 Caprice is the best thing in the building

Arrived week of 2026-09-15. **No sales history on any channel anywhere**, so 100% incremental and no price
anchor a customer can check on a phone. High cost, high value comfort — and it answers the wide-fit question
the shop keeps being asked.

| Style | Units | Cost | Price = RRP | **Profit/pair** | Sizes |
|---|---|---|---|---|---|
| 25511-41-022 | 10 | £49.95 | £130.00 | **£58.38** | 6 |
| 25547-41-306 | 9 | £32.50 | £85.00 | £38.33 | 5 |
| M9502-42-019 | 6 | £26.25 | £70.00 | £32.08 | 5 |
| 22503-42-311 | 10 | £23.50 | £65.00 | £30.67 | 6 |
| 22503-42-199 | 9 | £23.50 | £65.00 | £30.67 | 6 |
| 22152-42-019 | 9 | £23.50 | £65.00 | £30.67 | 5 |

**53 units, £37.36 average profit, 5–6 sizes on every style — the most complete size coverage of anything
outside Birkenstock. £1,980 of profit sits in six styles**, or two months of wages, on stock already paid for.

It is also the right brand on which to build the habit of holding price, precisely because no comparison exists.

---

## 7. Add-ons — the owner's own point, and it is a big one

There is no history of add-on selling at CM3. The data says this is the cheapest margin available.

### 7.1 Socks lose money online and make £4–6 across a counter

| Sock | Price | **Shopify profit** | Shop profit, same price |
|---|---|---|---|
| Womens Cotton Socks Dark Grey | £14.90 | +£0.72 | ~£6.04 |
| Mens Cotton Socks Light Grey | £11.71 | **−£0.75** | ~£4.18 |
| Womens Invisible Sock White | £8.95 | **−£0.93** | ~£3.88 |
| Womens Trainer Socks Black | £8.90 | **−£0.97** | ~£2.84 |

Postage and referral fees eat a £12 item alive online. In the shop there is neither. The one CM3 sock sale on
record: **£27.90, £14.06 profit** — two pairs, earning nearly as much as a Rieker.

**`C3-Socks` is currently empty.** This is the only genuinely new spend in the plan: ~£600 buys ~100 pairs at
£5.58–£6.38 cost, paying back inside two months.

### 7.2 Zermatt is the same story at four times the size

Birkenstock Zermatt cork-latex footbed slippers, cost £25, listed £54–£59:

| | Shopify realised | **Shop at listed price** |
|---|---|---|
| Profit per pair | £4.86 – £9.03 | **~£20.83** |

**254 Zermatt units in stock.** A £55 comfort product for exactly the customer who walks in asking about
arthritis. This is the largest per-unit margin gap between channels found anywhere in the data, and it is
a lead product, not an accessory.

### 7.3 Use stock, never cash, as the discount currency

The town's customers ask for discounts and then say they like to shop locally. The answer is not a hard no,
and it is definitely not money off:

> *"I can't move on the price, but I'll put a pair of Birkenstock socks in for you."*

10% off a £70 Rieker costs **£8.50 of margin** (a VAT-inclusive discount against VAT-exclusive profit). A pair
of socks costs **£6.38 of stock** and carries a **£13.95 ticket** — nearly double the perceived value for less
real cost, **and the shoe price survives intact**, which matters because today's price is what the next
customer pays. Cash discounts leak out of the shop permanently; stock discounts come back as margin.

---

## 8. Operations

- **Hours: Mon–Fri 11:00–16:00.** Already the case. 94% of units historically sell between 11:00 and 15:00;
  after 16:00 it is four units a year.
- **Lock the door outside hours.** People wander in, don't buy, and interrupt the online work. The condition
  is that *inside* the hours it must be unmistakably open — ambiguity costs the customer and the interruption.
- **Get the storage racking off the shop floor.** The window display is good; the room behind it reads as a
  stockroom with people working in an office, which is a likely contributor to the 190 zero-sale days.
- **Minimum kit:** display racking, a chair, a footstool, a Brannock gauge on the counter. The gauge alone
  tells someone what kind of shop this is before a word is said.
- **Free before paid:** accurate Google Business Profile (hours, photos, brand names), an A-board carrying
  brand names rather than "SHOES", a window that changes. Rieker and Remonte are reasons to cross a road.
- **Marketing spend is deferred** until the floor is stocked. Then £150–£250/month, local, one message.
- **The metric to watch monthly is the share of open days that convert** — 24% today. It is immune to the
  seasonality noise that makes unit counts hard to read.

---

## 9. Wide fitting / orthopaedic — the unserved demand

Customers repeatedly ask for wide fittings and shoes for arthritis. These have been treated as unreasonable
requests for a small town. They are the only spontaneous, repeated, unpaid demand signal the shop has, and
**Rieker, Remonte and Caprice are already that answer** — comfort brands built on removable footbeds and
accommodating fits, with Caprice doing width fittings and half sizes. Strive is a podiatrist-designed
arch-support brand (£36.96 at RRP) with 53 units sitting at FBA, in the wrong place if this route is taken.

This is also the structural answer to the discount culture: **nobody haggles over a fitting.** A wide-fit
measure-and-fit has no Amazon comparison and no price to check, which is what changes the conversation from
price to service.

**Blocker:** `skusummary.width` is populated **only for Birkenstock** (Narrow / Regular — Birkenstock's own
system, 936 Regular / 541 Narrow). Every Rieker, Remonte, Caprice and Lunar row is blank, so the question
"have you got that in a wide?" cannot be answered from any screen. The column exists; filling it is data
entry, not a build. Do that before promoting the shop as a wide-fit specialist.

Treat this as **phase 2**. It is what lifts £25 to £30+ a pair. Phase 1 is getting the shoes in the room.

---

## 10. BCWEB build — sketch only, not a spec

- **Till screen showing RRP**, with the online price hidden or explicitly labelled as the website's. See §4.3.
- **Sale writes `localstock` and the sale row in one transaction.** The hourly Shopify stock sync is the push,
  never the source of truth. Same discipline as the Pick module.
- **Channel stays `CM3`** — it is the owner's own shop and the existing history is continuous. (`DWN` was the
  proposed code for the DAWNS concession and is now unused.)
- **Add-on prompt at the point of sale** — socks and care items, since §7 is the whole reason the average
  transaction can move.
- **Accessories need to exist as sellable lines** with shop stock, not just Shopify listings.
- **A monthly scoreboard**: units, profit, share of open days that converted, attachment rate. Four numbers.

---

## 11. Open questions

1. **How many units does the shop floor physically hold** once storage racking is removed? Everything sizes
   from this. Tape measure.
2. **Sock order** — which lines, how many, ~£600. The only new cash in the plan.
3. **Recall Strive (53 units) from FBA?** Only if §9 is going ahead.
4. **Who fills in `skusummary.width`** for the non-Birkenstock brands, and when.
5. **Picking list for the 400–500 unit floor** — the owner is doing this personally (2026-09-20).

---

## 12. Corrections recorded, so they are not repeated

Two errors were made building this analysis and both mattered:

1. **Forecasting the town from the shop's sales history.** 85 units/year was treated as evidence of demand
   and projected forward. It is evidence of **78 units of broken-size stock in an undisplayed room**. Any
   forecast must be built from stock density and turn rate, not from CM3's own trade.
2. **Claiming the shop discounts at the till.** Built by comparing current stock list prices against historic
   sold prices — different baskets. Per-`groupid` testing showed the shop sells *at or slightly above* its
   online price. The real gap is **online price vs RRP**, not price vs till behaviour.

---

## 13. Sources

All figures: live `brookfield_prod`, read-only, 2026-09-20. 12-month windows to date.
Channel economics and brand splits from `sales` (`profit` per unit, returns netted, `channel` in SHP/AMZ/CM3).
Stock from `localstock` (`ordernum='#FREE'`, `deleted=0`, `qty>0`) joined through `skumap` to `skusummary`,
with `location` giving the shop-floor split. Prices via `safeNumeric` semantics on the varchar price columns
(`cost`, `shopifyprice`, `rrp`). FBA quantities from `amzfeed.amztotal` (read-only).
Shop profit modelled as `price ÷ 1.2 − cost`, validated against booked `sales.profit` on Rieker.
