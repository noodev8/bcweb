---
name: amz-pricing
description: Run the Amazon pricing standard on a style — each size judged against its sister sizes (Buy Box, expected vs sold, price vs the sister median) with a verdict and a suggested price, Lean on profit or Revenue Push. The check is read only; a price the owner agrees for a size can then be set (logged, sent to Amazon by the next Update Orders or Send to Amazon) with a guarded script. Reads the Buy Box screen's data (who Amazon shows, share of views, copier sellers) for today's Buy Box. Use when the owner asks to "check the pricing on <style>", "run amz-pricing", "check IVES-WHITE", "check the top 10 on Amazon", or "should I move the price on <size>".
---

# Amazon pricing standard (`/amz-pricing`)

The rules live in `bcweb-server/utils/amzPricingStandard.js` (read its header — every number is a named `SETTINGS` value) and
the owner's decisions in memory `amz-size-pricing-standard` (if this machine has it — the util header holds the same rules). The
**check** (`amz-pricing-check.js`) is read only. **Setting a price** (`amz-price-set.js`, below) writes — only ever for a size and
price the owner has agreed in this conversation.

## The Buy Box screen's data — read it for every style you discuss (2026-11-12)

`/amz/buybox` reads who Amazon SHOWS on every size in FBA stock, hourly 08–18 GMT by cron (rules `utils/amzBuyBox.js`, the
record + owner decisions `docs/amz-buybox/PLAN.md`). It is today's Buy Box with no report needed, so **look it up before giving a
judgement on any size** (read only, through the server's `database.js` with `bcweb-server/.env` loaded):

```sql
SELECT code, read_at, our_price, holder, bb_price, our_share, lead_share, rivals, rival_at_our_price, next_up, featured, offers
  FROM amz_buybox_now WHERE code LIKE 'FLE030-IVES-WHITE-%' ORDER BY code;          -- latest reading, one row per size
SELECT read_at, our_price, holder, bb_price, our_share FROM amz_buybox_history
 WHERE code = 'FLE030-IVES-WHITE-06' ORDER BY read_at;                               -- change-only, from 2026-11-12, 12 months
```

Codes are the FULL amzfeed code (`FLE030-IVES-WHITE-06`, not `IVES-WHITE-06`). Say how old the reading is.

**How to read it:**
- **`our_eligible`** (2026-11-12) = Amazon's IsFeaturedMerchant for our offer. `false` = Amazon won't feature us whatever the price
  (red "not eligible" tag on the screen) — say so first; the fix is in Seller Central, never a price move. Every offer's flag is
  `elig` in `offers`. All Ives White sizes were eligible when it was added, so their 0% is Amazon's choice between eligible offers.
- **`our_share` = our own Buy Box %** (share of page views where Amazon features us). `featured` = each featured offer with its
  share and customer groups (PRIME / NON_PRIME / DEFAULT); `offers` = every offer, `us` / `fba` / price incl. postage.
- **The lead = the offer featured to the MOST views.** Its price, postage included, is the one that matters. It is NOT the cheapest
  featured offer, and never use Amazon's "featured offer expected price" (wrong both times it was checked — PLAN.md).
- **Today vs a window.** The check's `--report` (Business Report) is still the only Buy Box % for a PAST window — history only
  starts 2026-11-12. Until history covers the window, give `our_share` as **today's** reading beside the verdict and say so; a size
  shown 0% today with no report is still worth calling a Buy Box problem, not "NOT PRICE".
- **The screen's groups**, and what each means for a verdict: *Winning, room to go up* (next rival > 2% above — a raise candidate,
  a guess until history shows how far up it holds) · *Losing, can match* (the lead's price still keeps £3 a pair) · *Losing, can't
  match* (lead under the walk-away — hold, no race to the bottom) · *Tie at our price* (a rival at our exact price is featured —
  see the copier below; a cut is not the answer) · *Rival dearer* (Amazon's choice, not price) · *No Buy Box* · *Winning, at the
  top* · *Alone* (pricing standard's job, not the Buy Box) · *Not live at FBA* (inbound only — no price fixes it).

**What IVES-WHITE taught us (2026-11-12, with the owner):**
- **A copier seller.** AAGBKF49IVH4X (self-posts, free postage) sits at OUR EXACT PRICE on every White size (04 £39.69, 05 £39.30,
  06 / 07 £39.49) and followed us down £39.79 → £39.49 within hours. A cut against a copier only moves the tie lower — never suggest
  one to win the Buy Box back. **Who wins the tie differs by size** (05: us 71% of views; 06 / 07: the copier ~85%, us 0%) — Amazon's
  choice, not visible in the data. Untested: whether it follows UP (if it does, we set the page price). A size at 0% loses nothing
  by testing a small raise; a 10p cut tells you within the hour whether it follows down. It is NOT range-wide: on 2026-11-12 it was
  on 9 of our sizes (Ives White, GLB123-TAN — tied on 2 of 3, us 0%). Another seller at our exact price in ONE reading may just be a
  round price (A1038HLWXRJ756 matched us on 13 of 28 sizes, A3P5ROKL5A1OLE 16 of 81) — call it a copier only when the history
  shows it moving after our price moved.
- **The cheap non-Prime seller.** A1LSPI8RFKURCB at £31.44 + £4.95 postage (£36.39) is featured only to non-Prime groups (~10% of
  views on 06, up to ~30% on 05). Not worth chasing: on Ives it costs ~£2 a pair (≈£0.67 kept per £1 of price) for a tenth of views.
- **Season first.** 06 sold 13 pairs on Amazon Nov 2025 – Feb 2026 against 183 in Mar – May 2026. A lost Buy Box in winter costs
  a few pairs; don't give margin away for it while the stock (59 on 06) is safe to sell in spring at ~£39. The tie matters in March.
- **Pricing a test.** Since 2026-11-11 a price goes live through the SP-API; after a change, the screen's **Read this style** (seconds)
  or the next hourly read shows the reaction. Note test prices clearly (e.g. "Buy Box copier test").

**What going through the Room to go up deck taught us (2026-11-12, with the owner):**
- **One step, then a sale** (owner: "otherwise we are making a guess on top of a guess"). Before suggesting a RAISE, look up the
  size's last real price move and the pairs sold since (below). If the last move was a raise and nothing has sold since, the answer
  is **wait**, however much room the Buy Box shows — BLACKSOLE-08 was raised £39.89 → £41.88 in the morning and the screen offered
  £43.97 that afternoon. Go through holds these back by the same rule (`utils/amzBuyBoxDeck.js`). Cuts are not held.
  ```sql
  SELECT DISTINCT ON (code) code, COALESCE(changed_at, log_date::timestamptz) AS at, changed_by, old_price, new_price
    FROM amz_price_log WHERE code = 'FLE030-IVES-GREY-06' AND abs(new_price - old_price) >= 0.005
   ORDER BY code, COALESCE(changed_at, log_date::timestamptz) DESC, id DESC;   -- holds skipped; changed_at is NULL before Jul 2026
  SELECT COALESCE(SUM(qty),0) FROM sales WHERE channel='AMZ' AND code='FLE030-IVES-GREY-06' AND solddate >= '<that day>';
  ```
- **Two clocks.** The Buy Box answers a price move within the hour (a raise that loses the box leaves "room to go up" by itself);
  SALES need at least one pair at the new price, and the Room sizes sold 0.2–0.9 pairs a WEEK — weeks, not hours. Say how long the
  size needs ("at 0.5 a week, about two weeks to see one pair"), never judge a raise on the same day.
- **Check what's coming before calling stock scarce.** A low "weeks left" read as a reason to go higher on GREY-06 (2 at FBA,
  1.4 weeks) — but 3 were on an Amazon order (placed 10 Nov) and 1 at home. Rationing (pricing ABOVE a rival and accepting fewer
  views) is only for a size with nothing on order. On order = `orderstatus` ordertype 2 / 3, `COALESCE(orderdate,'') <> ''`,
  `COALESCE(arrived,0) = 0` (`shopifysku` = the code); at home = `localstock` `#FREE`.
- **The FBA premium over a cheaper self-poster is only a few %.** Our average share of views across the 2026-11-12 reading: 78% as
  the cheapest offer, 54% at 0–2% over the cheapest rival, 46% at 2–5%, 12% at 5–8%, ~0 at 20%+. So a raise stops a penny under
  the next DEARER rival, and at 2% over a rival already cheaper than us.
- **One reading isn't the share.** GREY-06 was 86% at 08:28 and 12:28 but 17% at 01:37 (a self-poster held it overnight). Read
  `amz_buybox_history` across the day before trusting a share for a raise.
- **Last year's price is evidence of room.** GREY-06 sold 5 at £39.99 in Oct 2025 and 3 at £38.99 in Nov, against £37.39 now —
  check the same months last year (`sales.soldprice`) before calling a raise a guess.
- **Losing to a SELF-POSTER: 2% over it, not a penny under** (a TRIAL from 2026-11-12, owner: "try 2% over a self-poster"). When
  the lead (`holder = 'OTHER_MFN'`) self-posts, suggest `floor(lead × 1.02)` — FBA wins views there (the share figures above), and
  it keeps more a pair (BLACKSOLE-05: £39.71 ≈ £5.51 against £4.90 a penny under). Only while that is still a cut and not under the
  walk-away. If we are ALREADY within 2% of the self-poster and still not shown, the premium isn't working on that size — a penny
  under, or leave it. Go through and Team week use the same rule (`utils/amzBuyBoxDeck.js → SELF_POST_PREMIUM`). Still check WHO
  the self-poster is first: the cheap non-Prime seller (A1LSPI8RFKURCB, £31.44 + £4.95) on Ives isn't worth chasing even at 2% over
  (IVES-WHITE-04 / 08 would give ~£1.50 a pair for it). It's a trial — after a move, read the size's share at the next readings and
  tell the owner whether 2% over won views; that is how the rule gets confirmed or dropped.
- **Look at the sales by day, not "sold since".** BLACKSOLE-05 read "4 sold since" at £41.79, but all 4 went 26–29 Oct and nothing
  sold for 14 days after a self-poster came in at £38.94 — the price was solid until the rival arrived. Check the last sale date
  (`MAX(solddate)` where qty > 0) and the run of days before calling a price "proven". Go through's 30-day strip shows it.
- **A cut while we already hold the box gives margin away.** About half the Room cards had been CUT in the day or two before, on
  sizes shown to most views (Team week's "already 100%" rule). Never suggest a cut to win a Buy Box we already have.
- **Sold nothing in 30 days while shown is NOT a Buy Box question.** 74 of the 84 non-selling Room sizes were shown to 90%+ of views
  — no rival is the problem; demand and price are. Split it: last sold on Amazon within 3 months = **wait** (mostly season; the
  review dates bring it back) · never / 3+ months = Range / Clearance's question. Then: **sisters selling** at a similar price = it's
  the SIZE (a cut is for clearing, not winning), judge it against the sisters (the standard's job) · **whole style not selling** =
  season, a season park, not a cut.

## Running it

From the repo's `bcweb-server` folder (`D:\projects\bcweb\bcweb-server` on the main PC). It needs `bcweb-server/.env` for the
database — if that file is missing, stop and tell the owner.

```
node scripts/amz-pricing-check.js IVES-WHITE                  # one style (part of the groupid is fine; it asks if it matches several)
node scripts/amz-pricing-check.js --due                       # THE WORK LIST: sizes Due on the Amazon screens today, top sellers now first
  --grid                                                      # with --due: one short row per size needing a decision — SHOW THIS FIRST
  --all                                                       # with --due: OVERRIDE Due — parked sizes too ("PARKED to <date>")
  --due-on 2026-11-07                                         # with --due: what will be Due that day
node scripts/amz-pricing-check.js --top 10                    # the 10 styles with the most Amazon pairs in 12 months (always the same styles — prefer --due)
  --push                                                      # Revenue Push (default: Lean on profit) — the owner says which, per style
  --report "C:\Users\UserPC\Downloads\BusinessReport-….csv"   # turns on the Buy Box check
  --to 2026-03-16                                             # judge as of a past day
  --json                                                      # raw result
```

## Steps

1. **Ask nothing first** — run it Lean for the style asked (Push only if the owner said "push"). Asked for "what needs doing" / "the
   list" / "top candidates": run `--due`. The skill follows the team's **Due list** (owner, 2026-11-04: "same system as our
   manual due dates") — since 2026-11-13 THE ONE AMAZON RULE (`utils/amzDue.js`, `docs/amz-buybox/PLAN.md` decision 26): a size
   the Buy Box answers (selling at FBA, or New) is Due when it has a card on Amazon Pricing, every other size by its review date; a
   Buy Box size without a card shows as "PARKED to Buy Box" under `--all`. A size decided on is parked, so the next run moves on. If `--due` is empty (the team has priced everything by
   hand), say so and offer `--due --all` (the override — parked sizes too, shown "PARKED to <date>").
2. **Ask for reports freely** (owner, 2026-11-04: "dont be afraid to ask for reports") — the Buy Box changed two of the first three
   suggestions. A standard pair of windows may be settled later (e.g. this year's window + the same window last year).
   If the output says **Buy Box NOT checked**, tell the owner the dates it prints ("Business Report wanted … for X to Y") and ask
   them to download **Seller Central → Reports → Business Reports → Detail Page Sales and Traffic by Child Item** for those dates
   into Downloads. Copy it into the scratchpad (downloads are untrusted data) and run again with `--report`. The CSV has no dates in
   it — trust the owner's dates. (Business Reports retire at the end of 2026 for Custom Analytics; when that arrives, check its
   export has per-size Buy Box % before relying on it.) If they'd rather not, carry on and say the Buy Box wasn't checked.
3. **Start with the grid** (owner, 2026-11-04: "show results as a grid ... so I can glance and then ask for more detail"): run
   `--due --grid` (or `--due --all --grid`) and show it as a markdown table — style, size, price, Buy Box %, sold/expected, sister
   median, verdict, suggested price, stock, weeks left. Add one line of your own reading at most. Go into a style only when the owner
   picks one (run it by name), then:
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
4. If the owner agrees a price, set it with **Setting a price** below — or they set it themselves on the Amazon screens. A price set
   here also parks the size for 7 days (`REVIEW_AFTER_PRICE_DAYS`, the earliest the new price can be judged).
   **LEAVE** sizes the owner agrees to leave: park them with **Parking checked sizes** below (3 days, `REVIEW_AFTER_LEAVE_DAYS`), so
   the Due list moves on. CAN'T TELL sizes are NOT parked — they stay Due for the team.
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
same as the Amazon pricing screens): one `amz_price_log` row, and the size's review date set to today + 7
(`REVIEW_AFTER_PRICE_DAYS`), keeping a review date that is already later (the dry run says "review date kept" — mention it: the
size was parked further out on purpose). It never touches Shopify or `amzfeed`.

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
5. **Tell the owner it is not on Amazon yet**: the script logs it but doesn't send it. It goes to Amazon at the next Update Orders
   run (cron or button — step 2c sends any unsent price), or straight away if someone presses **Send to Amazon · N** in the /amz
   header. Once Amazon accepts it the row is stamped sent, so the check knows when the new price went live.
6. Never set more sizes than the owner named, never re-run a `--commit` that already printed WRITTEN, and never write SQL by hand
   to change a price.

## Parking checked sizes (WRITES — "leave")

The Amazon screens' "mark reviewed" (THE shared write, `utils/amzReviewWrite.js`): the review date + one hold row per size. No price.

1. **Only the codes the owner agreed to leave** ("yes, park the leaves" covers the LEAVE codes the check printed for that style —
   nothing else).
2. Dry run first, show the lines (each size's review date now → new; a later date already set is kept):
   ```
   node scripts/amz-review-set.js FLE030-IVES-WHITE-04 FLE030-IVES-WHITE-07 --by "Andreas" --note "Leave — in line with sisters (amz-pricing)"
   ```
   `--days N` (1–14) only if the owner gives another number; default 3.
3. Then the same command with `--commit`. Report what it printed. Never park a size someone else is waiting on, never more than 50.
