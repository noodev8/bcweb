---
name: amz-pricing
description: Run the Amazon pricing standard on a style — each size judged against its sister sizes (Buy Box, expected vs sold, price vs the sister median) with a verdict and a suggested price, Lean on profit or Revenue Push. The check is read only; a price the owner agrees for a size can then be set (logged into the Amazon upload basket) with a guarded script. Use when the owner asks to "check the pricing on <style>", "run amz-pricing", "check IVES-WHITE", "check the top 10 on Amazon", or "should I move the price on <size>".
---

# Amazon pricing standard (`/amz-pricing`)

The rules live in `bcweb-server/utils/amzPricingStandard.js` (read its header — every number is a named `SETTINGS` value) and
the owner's decisions in memory `amz-size-pricing-standard` (if this machine has it — the util header holds the same rules). The
**check** (`amz-pricing-check.js`) is read only. **Setting a price** (`amz-price-set.js`, below) writes — only ever for a size and
price the owner has agreed in this conversation.

## Running it

From the repo's `bcweb-server` folder (`D:\projects\bcweb\bcweb-server` on the main PC). It needs `bcweb-server/.env` for the
database — if that file is missing, stop and tell the owner.

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
   - **LOST BUY BOX** — another offer is shown most of the time. No price is suggested and there is **no step rule** (owner: "Human
     and your judgement rather than a step rule") — give your judgement from the row: its **sister reading** ("against its sisters:
     too high / leave …", compared with the other contested sizes — same page, same competitors), pairs a week, weeks of stock
     left, the 4-week profit, and the **walk-away price** ("worth chasing down to £x, no lower"). A contested size that is also
     too high against its sisters is the one pricing itself out (IVES-WHITE-05, 2026-11-04: +£1.40 over the £39.99 sellers sold
     0.4 a week while 06 at +80p sold 3.5) — moving it to the price its sister sells at is a cautious first test. Never suggest
     below the walk-away. The owner may paste the competing offers for learning — welcome, never required.
   - **TOO HIGH** — selling under, priced above its sisters → the suggested price (the sister median; Push: 3% under it).
   - **ROOM TO GO UP** — selling over, or in line while cheaper than its sisters → the suggested price.
   - **NOT PRICE** — selling under at a normal price. Say what to look at: stock (live vs total — reserved / transfers), the
     Buy Box if it wasn't checked, another seller on that size.
   - **LEAVE / CAN'T TELL** — batch them in one line ("04, 08, 09 leave or can't tell yet — too new / under 5 expected").
   Show for each: price, window (from / days in stock), expected vs sold, Buy Box %, sister median, suggested price, £ kept a pair.
4. If the owner agrees a price, set it with **Setting a price** below — or they set it themselves on the Amazon screens.
5. If a verdict looks wrong to the owner, **that is the point of this phase** — note the size and why in memory
   `amz-size-pricing-standard` (a "verdict disagreements" list) so the rules can be tuned before a screen is built.

## Reading the columns

`window` = the start of the price period (`~` = uncertain: the price was first seen in a sale, so it went live some time after the
last sign of the old price) and days in stock / window days · `share` = the size's normal share of the style (12 months before the
window, in-stock days only) · `exp` / `sold` = gross pairs · `BB%` = our Buy Box % from the report · `median` = the sister sizes'
median price over the window (sisters in stock half the window; a size holding the Buy Box is compared with sisters holding it,
a Lost Buy Box size with the other contested sizes) · `kept` = £ kept a pair at the suggested price, else today's · `walk` = the
price keeping £3 a pair · `/wk` = pairs a week at this price · `wks` = weeks of FBA stock at that pace · `£4wk` = profit over the
next 4 weeks at today's price.

## Setting a price (WRITES — follow every step)

The only way this skill changes a price. It goes through THE shared Amazon price write (`utils/priceWrite.js → writeAmzPrice`, the
same as the Amazon pricing screens): one `amz_price_log` row. It never touches review dates, Shopify, or `amzfeed`.

1. **Only after the owner has said yes to THAT size at THAT price** in this conversation (e.g. "yes, 05 to 39.79"). A general "go
   ahead", "looks good", or a yes to a different size is NOT an OK. One OK = one size. If unsure, ask: "Set FLE030-IVES-WHITE-05 to
   £39.79 — yes?"
2. **Dry run first**, and show the owner the lines it prints (today → new price, £ kept a pair, RRP, walk-away):
   ```
   node scripts/amz-price-set.js FLE030-IVES-WHITE-05 39.79 --by "Andreas" --note "Back under £40. Too high since 25 Aug: sold 16 v 42 expected (amz-pricing)"
   ```
   - **Exact code** — the full code from the check's output (e.g. `FLE030-IVES-WHITE-05`); price to the penny.
   - **--by** = the OWNER'S name as they gave it (e.g. `Andreas`) — never your own name, never "Claude".
   - **--note** = one short line: what and why, in the check's words, ending `(amz-pricing)`.
3. **If it says REFUSED, stop.** Tell the owner the reason it printed. Add an override flag (`--big-move`, `--below-walk-away`,
   `--above-rrp`, `--replace-pending`) only if the owner, told that reason, says to — never on your own.
4. **Then the same command with `--commit`.** Report the log id it prints.
5. **Tell the owner it is not on Amazon yet**: it is in the team upload basket — download the Seller Central file, upload it, then
   press "I've uploaded" (so the check knows when the new price went live).
6. Never set more sizes than the owner named, never re-run a `--commit` that already printed WRITTEN, and never write SQL by hand
   to change a price.
