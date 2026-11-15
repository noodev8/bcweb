# Stock Ladder

Agreed with the owner 2026-11-15. **Nothing built yet.** Doc with flow chart: https://claude.ai/artifact/L4gnEvZYgria73p6MPUr5i

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

## Still to decide
- [ ] Worked examples for each move.
- [ ] What each bucket does on Amazon, and whether any bucket goes to eBay.
