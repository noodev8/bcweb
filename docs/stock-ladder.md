# Stock Ladder

Agreed with the owner 2026-11-15. **Built:** the front screen (Range) and the drill-down below. Doc with flow chart: https://claude.ai/artifact/L4gnEvZYgria73p6MPUr5i

Every SKU we hold sits in exactly ONE of five buckets, set by how long it has gone without a sale. Purpose: see a SKU's bucket while
pricing, and pick a bucket and price it.

- **Grain:** SKU (one size).
- **Sales:** any channel, net of returns.
- **Stock:** local + FBA, one number.
- **Pricing:** Amazon only for now. A bucket might later be pushed to eBay (e.g. half price).

## The five buckets

| # | Bucket | Moves in when | Leaves when |
|---|---|---|---|
| 1 | **Arrived** | stock comes in, moving the stock level from 0 to more than 0 | it sells → 2, or 90 days pass with no sale → 3 |
| 2 | **Sold 90** | a sale | 90 days pass with no sale → 3 (another sale keeps it in 2) |
| 3 | **Unsold 90** | 90 days pass with no sale | it sells → 2, or 180 days pass with no sale → 4 |
| 4 | **Unsold 180** | 180 days pass with no sale | it sells → 2, or 9 months pass with no sale → 5 |
| 5 | **Clearance** | 9 months pass with no sale | only when ALL its stock is gone (a sale keeps it in 5) |

## Flow

```
  stock comes in from 0
          │
          ▼
     1 Arrived ──── 90 days, no sale ───┐
          │ sells                       │
          ▼                             ▼
     2 Sold 90 ──► 3 Unsold 90 ──► 4 Unsold 180 ──► 5 Clearance ──► off the ladder
          ▲              │               │          (sales keep     (all stock gone)
          └── a sale ────┴───────────────┘           it here)
```

## Rules in plain words

- **One bucket at a time.** Never two.
- **A sale wins.** From 1, 3 or 4, a sale moves it to 2 at once. Clearance is the exception.
- **Clearance is a one-way door.** Stays in 5 until every pair is gone.
- **Stock at 0 leaves the ladder.** Nothing to price, so it's in no bucket.
- **Coming back in starts at 1.** Stock arriving when we had none: the first time ever, or after selling out.
- **A top-up changes nothing.** Adding pairs while we still hold some leaves it where it is, so slow stock can't hide behind a new delivery.
- **Worked out, not stored.** Computed fresh from stock, Goods In and sales. Oldest pairs are assumed to sell first. Stock from before
  Goods In logging is dated 31 Dec 2024 (`utils/onShelf.js`).

## Overstocked (a label, not a bucket)

Agreed 2026-11-15. Sits on top of step 2 (Sold 90).

- **Ideal = 90 days' worth of stock; buffer = 1 more month. More than 4 months' worth = Overstocked.**
- Worth = the SKU's average selling rate (12-month pace, so summer sellers aren't judged on a winter rate).
- Even 1 pair over counts. The old "3 pairs over" minimum (`utils/deepSizes.js` MIN_OVER) was never approved by the owner:
  dropped. The code still has it until this is built.
- Only on step 2 because it needs a selling rate: step 1 hasn't had time to show one, and steps 3–5 aren't selling, so they're
  being cleared anyway. At step 5 (Clearance) the aim is to get rid of the lot, at next to nothing if need be (owner).
- The label goes by stock level only. Sell pairs off (at a loss or not) until we hold 4 months' worth or less, and it drops off.

## On screen

- **Range becomes the ladder** (owner, 2026-11-15: adapt it, don't build a second screen). Changes needed: split its 91 days – 9 months
  box at 180 days; step 1 = came in from 0 stock (Range uses New stuff's first-ever Goods In); Clearance holds until all stock is gone;
  the Overstocked tag on step 2 (from Deep sellers, at 4 months' worth).
- **Front screen:** the size run is removed. The total stays, then five boxes labelled STEP 1 – STEP 5 like the chart, each with its %
  of all SKUs, its SKU count and units, and each opening its own list (Range's list layout). Step 2's box also shows its Overstocked
  count.

## Drill-down from each box (agreed and built 2026-11-15 — membership `utils/stockLadderList.js`, list `/analytics/slow-sizes/step`, cards `/amz/step-cards`)

Birkenstock and Shopify are left out of these decisions for now (owner: "too many variables and mixes"). Counted that day, Birkenstock
was most of the stock on Overstocked (60 of 71), Unsold 90 (303 of 365) and Clearance (100 of 163), and nearly all of it local.

- **Arrived, Sold 90:** a list only, perhaps with a link to Amazon Pricing. No step cards. The Buy Box already prices these sizes
  (New, Raise, Cut), and a second door to the same sizes was rejected on 13 Nov.
- **Overstocked, Unsold 90, Unsold 180, Clearance:** list first, then cards.
  - The list shows every size on the step: days since the last sale, the review date, and pairs over for Overstocked.
  - **Chips at the top, no separate summary screen:** Due n · Within a week n · Later n · All n. A chip narrows the list; it opens on
    **Due**.
  - **Price these (n)** opens the Amazon price cards (THE card layout, `components/AmzCardFrame.tsx`) for the sizes the list is
    showing, with the step's aim on the reason line. A single size can be opened from its row.
  - **Due = `utils/amzDue.js`, unchanged.** Pricing early from Within a week / Later is the owner's choice and sets a new review date
    as normal. The step changes no rule (Season parks still hold on Due, e.g. a sandal in November).
  - A Buy Box size on the step (sold on Amazon in 30 days) shows under All only, marked "Buy Box", and is never carded here.
- Sizes that day (live at FBA, Birkenstock left out): Overstocked 10, Unsold 90 50, Unsold 180 6, Clearance 25. None were due.

## Still to decide
- [ ] Worked examples for each move.
- [x] **What the step cards suggest: nothing (owner, 2026-11-15, option A).** The box starts at today's price, as the due cards do;
      the step's aim is only the reason line (Overstocked = sell down to 4 months' worth, with pairs over; Unsold 90 = a gentle cut;
      Unsold 180 = a firmer cut; Clearance = clear the lot, a loss is OK). No new pricing rule. Rejected for now: a set cut per step
      (e.g. −5% / −10%) — revisit only if the presses show a steady habit.
- [x] **Season parks and the clock (owner, 2026-11-15: "yes leave it").** The ladder ignores price and review dates, so a season-parked
      summer sandal keeps climbing over winter and can reach Clearance (one-way) as its season starts (e.g. Strive WAVE-BLACK-2-37,
      parked to 1 Mar 2027 at RRP, reaches 9 months about 21 Apr). Left as is: nothing prices itself, and the review date still
      decides Due.
- [ ] Clearance: an option to send to eBay at 50% (owner). **Human touch, not rules** (owner, 2026-11-15) — no bulk send; a size
      with a review date still to come (a season park) must not be swept to eBay. **eBay is a tag, never its own bucket** (owner,
      same day): a size stays on its step. Shop + FBA stock on one eBay listing is fine (Update Orders lines the counts up).
      Birkenstock never on eBay.
- [ ] **The Clearance screen as a whole** (owner, 2026-11-15: "I just want the Clearance screen to be easy … more thought needed"):
      the choices under it are drop the Shopify price, drop the Amazon price, add / remove eBay, adjust the eBay price. Not built
      until agreed — including the "List on eBay →" mark. eBay's rules already start 9-month sizes at 50% of RRP and list FBA stock (MCF).
- [ ] Birkenstock / Shopify on the steps.
