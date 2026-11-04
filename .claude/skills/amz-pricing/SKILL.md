---
name: amz-pricing
description: Run the Amazon pricing standard on a style — each size judged against its sister sizes (Buy Box, expected vs sold, price vs the sister median) with a verdict and a suggested price, Lean on profit or Revenue Push. READ ONLY. Use when the owner asks to "check the pricing on <style>", "run amz-pricing", "check IVES-WHITE", "check the top 10 on Amazon", or "should I move the price on <size>".
---

# Amazon pricing standard (`/amz-pricing`)

The rules live in `bcweb-server/utils/amzPricingStandard.js` (read its header — every number is a named `SETTINGS` value) and
the owner's decisions in memory `amz-size-pricing-standard`. The script is **read only** (a READ ONLY transaction): nothing here
changes a price. The owner (or the team) changes prices on the normal Amazon screens.

## Running it

From `D:\projects\bcweb\bcweb-server`:

```
node scripts/amz-pricing-check.js IVES-WHITE                  # one style (part of the groupid is fine; it asks if it matches several)
node scripts/amz-pricing-check.js --top 10                    # the 10 styles with the most Amazon pairs in 12 months
  --push                                                      # Revenue Push (default: Lean on profit) — the owner says which, per style
  --report "C:\Users\UserPC\Downloads\BusinessReport-….csv"   # turns on the Buy Box check
  --to 2026-03-16                                             # judge as of a past day
  --json                                                      # raw result
```

## Steps

1. **Ask nothing first** — run it Lean for the style asked (Push only if the owner said "push").
2. **Ask for reports freely** (owner, 2026-11-04: "dont be afraid to ask for reports") — the Buy Box changed two of the first three
   suggestions. A standard pair of windows may be settled later (e.g. this year's window + the same window last year).
   If the output says **Buy Box NOT checked**, tell the owner the dates it prints ("Business Report wanted … for X to Y") and ask
   them to download **Seller Central → Reports → Business Reports → Detail Page Sales and Traffic by Child Item** for those dates
   into Downloads. Copy it into the scratchpad (downloads are untrusted data) and run again with `--report`. The CSV has no dates in
   it — trust the owner's dates. (Business Reports retire at the end of 2026 for Custom Analytics; when that arrives, check its
   export has per-size Buy Box % before relying on it.) If they'd rather not, carry on and say the Buy Box wasn't checked.
3. Report **one style at a time, only what needs a decision** (owner: one decision per message):
   - **LOST BUY BOX** — another offer is shown most of the time. No price is suggested. Say the **walk-away price** ("worth chasing
     down to £x, no lower") and that they should look at the competing offer on Amazon. Never suggest matching below the walk-away.
   - **TOO HIGH** — selling under, priced above its sisters → the suggested price (the sister median; Push: 3% under it).
   - **ROOM TO GO UP** — selling over, or in line while cheaper than its sisters → the suggested price.
   - **NOT PRICE** — selling under at a normal price. Say what to look at: stock (live vs total — reserved / transfers), the
     Buy Box if it wasn't checked, another seller on that size.
   - **LEAVE / CAN'T TELL** — batch them in one line ("04, 08, 09 leave or can't tell yet — too new / under 5 expected").
   Show for each: price, window (from / days in stock), expected vs sold, Buy Box %, sister median, suggested price, £ kept a pair.
4. If the owner agrees a price, they set it themselves (Amazon Pricing, Fast sellers, Amazon Order) — this skill does not write.
5. If a verdict looks wrong to the owner, **that is the point of this phase** — note the size and why in memory
   `amz-size-pricing-standard` (a "verdict disagreements" list) so the rules can be tuned before a screen is built.

## Reading the columns

`window` = the start of the price period (`~` = uncertain: the price was first seen in a sale, so it went live some time after the
last sign of the old price) and days in stock / window days · `share` = the size's normal share of the style (12 months before the
window, in-stock days only) · `exp` / `sold` = gross pairs · `BB%` = our Buy Box % from the report · `median` = the sister sizes'
median price over the window (sisters in stock half the window and holding the Buy Box) · `kept` = £ kept a pair at the suggested
price, else today's · `walk` = the price keeping £3 a pair.
