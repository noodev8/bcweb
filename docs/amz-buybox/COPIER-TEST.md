# Copier test: IVES-WHITE-06 (a trial, kept apart from PLAN.md)

Started 2026-11-12. **A one-size trial, not a rule.** Nothing here goes into `PLAN.md`, the Buy Box screen or the `amz-pricing` skill unless the result confirms it. Point Claude at this file to carry on.

## The idea (owner, 2026-11-12)

On a size where a rival copies our exact price and Amazon gives it the tie (we're shown to 0%), step our price DOWN. If the copier follows, it keeps the Buy Box but sells at the lower price, maybe 10× our level. It may run out of stock at that price, and then we push back up with the Buy Box to ourselves. *Owner: "May be complex, but possible. And a possible strategy. Difficult with MANY skus but I'm sure we can carry on building our skills."*

## Why 06 is a cheap place to try

- We're shown to **0% of views** already and sold **2 pairs in November**, both through "Other sellers". A lower price costs about 67p a pair for each £1 off, on very few pairs.
- The copier pays for the drop on every pair it sells.
- Our stock is safe: 23 at FBA plus 36 on the way (59), against 13 pairs sold from Nov 2025 to Feb 2026. It sells in spring (183 pairs Mar–May 2026).

## Risks (read before every step)

- **The copier's floor.** Every repricer stops following somewhere. Below its floor WE win the Buy Box, at our cheapest price, which is when we start selling. Our floor is fixed below; never step past it.
- **Thin winter demand.** The whole page may sell only ~15–20 pairs a month, so draining a copier with 30+ pairs could take months.
- **It may restock.** It has 99,046 ratings (a big retailer) and Lunar can be reordered. We can't see its stock; we only see its offer disappear.
- **Raising afterwards.** Amazon has suppressed this size after sharp moves before (the May 2026 price-log notes). Go back up in steps.
- **The cheap non-Prime seller** (A1LSPI8RFKURCB, £31.44 + £4.95 = £36.39). Under £36.39 we also take its ~11% of views. Those are extra sales at a price we don't want.

## Limits (fixed for the trial)

| | |
|---|---|
| Size | FLE030-IVES-WHITE-06 only. Other sizes are watched, never moved for this trial. |
| Our floor | **£36.49**, 10p above the cheap seller's £36.39 and above the £35.62 walk-away (£3 a pair). Never lower without the owner. |
| Step | 10p first (step 1), then 20–30p a step (step 2). |
| Between steps | Read this style an hour after the price reaches Amazon, and wait for at least one hourly reading. |
| Stop | We win the Buy Box (found the copier's floor), we hit our floor, or the owner says stop. |

## Baseline (reading 2026-11-12 11:29 UTC, Read #11)

| Offer | Sent by | Price incl. postage | Shown to |
|---|---|---|---|
| A1LSPI8RFKURCB | self-post, not Prime, 24h dispatch | £36.39 | 11% of views (non-Prime groups) |
| **Us** (A190P9F3Y5ZWH) | FBA, national Prime, 0h | **£39.49** | **0%** (eligible) |
| **AAGBKF49IVH4X (the copier)** | self-post, regional Prime, 24h, 91% / 99,046 ratings | **£39.49** | **89%** (Prime + default) |
| A11TUGHSDV22PS | self-post, Prime, 0h | £39.99 | 0% |
| A1TY2IISVV8Q3R · A2TO9YS239JBVX · A2OO68TPXRX6GE | self-post | £44.99 · £48.98 · £53.48 | 0% |

Evidence that it copies: it sits at our exact price on 04 (£39.69), 05 (£39.30), 06 and 07 (£39.49), and moved £39.79 → £39.49 with us on 11 Nov. It's also on GLB123-TAN. On 05 we win the tie (71%); on 06 / 07 it does.
Our stock: 23 live + 36 inbound. Sales: 15 pairs in October, 2 in November so far. Walk-away £35.62; RRP £45.00.

**Watch, don't move:** 07 is the same set-up (copier at £39.49, us 0%). If the copier follows us on 06 but stays put on 07, it prices each size on its own.

## Steps

1. **Does it follow down, and how fast?** 06 from £39.49 to **£39.39** (note "Buy Box copier test"). Send it straight away (Send to Amazon), then Read this style an hour later and at the hourly readings after. Record when the copier's price changes, and who is shown.
2. **Find its floor.** Only if step 1 shows it follows: step down 20–30p a time to our £36.49 floor, a reading between each.
3. **Decide** (owner). If its floor is near ours, there's no room for the game: go back to £39.49 and leave it as a tie. If it follows well down, choose between draining it now (watch for its offer disappearing) and waiting for spring. Coming back up goes in steps.

## Log

| When (UK) | Our price | Copier | Who's shown (share) | Note |
|---|---|---|---|---|
| 2026-11-12 11:29 | £39.49 | £39.49 | copier 89% · cheap seller 11% · us 0% | Baseline |
| 2026-11-12 11:41 | **£39.39** | ? | ? | **Step 1 started**: amz_price_log 3462, by Andreas, accepted by Amazon (SP-API) at 11:41. Review date 19 Nov. Read this style ~12:45. |
| 2026-11-12 12:28 | £39.39 | £39.49 (not moved) | copier 89% · cheap seller 11% · us 0% | 47 min after: copier has NOT followed, and we're 10p under it yet still 0%. 07 unchanged (copier 91%, us 0%). Wait for the next hourly readings. |
| 2026-11-12 18:28 | £39.39 | £39.49 (not moved) | copier 89% · cheap seller 11% · us 0% | Six more hourly readings (13:28–18:28), no change on 06 (history has no row after 12:28). 07 the same: copier 91% (£39.49), cheap seller 9%, us 0% at £39.49. No Amazon sale of 06 since 12 Nov. ~7h after step 1 the copier has NOT followed and being 10p under it won us nothing: Amazon still prefers its self-posted regional-Prime offer. Checked 2026-11-13; no cron reading since 18:28 on the 12th (amz_buybox_run #18 is the last). |
| 2026-11-13 | £39.39 | — | — | **Owner: wait.** Hold at £39.39 and re-check at 24h after step 1 (from 2026-11-13 11:41) to see if the copier joins us. No step 2 before then. |
| 2026-11-13 08:28 | £39.39 | **£39.39** | copier (Buy Box £39.39) · us 0% | **Step 1 answered: it follows down**, overnight (between the 12th 18:28 and the 13th 08:28; no readings in between), so within ~20h. Found 2026-11-14 from history `bb_price`. |
| 2026-11-14 11:28 | £39.39 | £39.39 | cheap seller (£36.39) lead · us 0% | Meanwhile the copier dropped to **£36.39 on its own on 05** (by 08:28 on the 14th, our 05 unchanged at £39.30) and is at £36.39 on 08. So its floor reaches the cheap seller's £36.39, under our £36.49 floor: **no room for step 2 (down)**. On 05 / 08 we cut to £37.11 (2% over, 10:04) and are shown 95% / 86% though the copier is 72p under us. |
| 2026-11-14 | **£39.69** | ? | ? | **Owner: switch to the up test.** Step 2 is now: does it follow UP? 06 +30p, amz_price_log 3645, by Andreas, accepted by Amazon (SP-API) at 11:40:59 UTC — the clock starts there. Review date kept at 12 Dec. If it follows to £39.69 we set the page price and can step up again; if not, leave 06 there. 07 still watched, not moved. |

## How to read a step

```sql
-- the latest reading for 06 and 07: every offer's price, and who is shown
SELECT code, read_at, our_price, our_share, featured, offers FROM amz_buybox_now
 WHERE code IN ('FLE030-IVES-WHITE-06','FLE030-IVES-WHITE-07');
-- every change since the trial started (change-only)
SELECT read_at, our_price, holder, bb_price, rival_seller, rival_price, rivals, our_share FROM amz_buybox_history
 WHERE code = 'FLE030-IVES-WHITE-06' AND read_at >= '2026-11-12' ORDER BY read_at;
```
History keeps only the cheapest rival, so the copier's own price at each reading lives in `amz_buybox_now.offers`. Copy it into the log above after each reading.
