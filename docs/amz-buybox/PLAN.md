# Amazon Buy Box pricing — plan (agreed so far)

Started 2026-11-12. **Ideas and decisions only, no code yet.** This file is the working record: each owner decision is added here as it is made, one at a time.

## Sources compared

| Source | Where | Status |
|---|---|---|
| Opus write-up (2026-11-11) | `~/Downloads/Opus-pricing.md` | Compared |
| Fable write-up (2026-11-11) | `~/Downloads/fable-pricing.md` | Compared |
| ChatGPT write-up (2026-11-12) | pasted in chat — no BCWEB context, so read for ideas only | Compared |

## The gap

BCWEB already sends Amazon prices live (`utils/amzPricePush.js`), logs every change (`amz_price_log`), keeps price + stock history per size (`amz_size_history`) and knows the £3-a-pair walk-away price per size (`utils/amzPricingStandard.js`). What it **cannot see is the competition**: who holds the Buy Box on a size, at what price, and how many other sellers there are. The pricing standard's first test ("Buy Box first") still needs a Business Report downloaded by hand.

The Product Pricing API (the Pricing role BCWEB already has) gives, per SKU:
- **who holds the Buy Box** (us / another FBA seller / a self-posting seller / nobody),
- **the price Amazon expects would win it for our own offer** (featured offer expected price) — THE number to use, not the rival's price,
- up to 20 other offers (price, FBA or not, seller ID — no shop name),
- whether our offer is **not eligible** (Amazon has pulled the Buy Box, usually because it sees the item cheaper elsewhere).

It does not give a rival's stock or sales. It is a snapshot: about 1 request per 30 seconds, 20–40 sizes a request, so ~7 minutes for the ~300 in-stock sizes.

## Where both write-ups agree (taken as settled)

- Poll on a timer. **No AWS / SQS push notifications** (where the 2025 attempt stalled).
- Store a **Buy Box history**: change-only rows per size, like `amz_size_history`. It answers "didn't sell — the price, or no Buy Box?" and replaces the hand-supplied Business Report in the pricing standard.
- **One screen of groups, one press per group**, through the existing W-A1 write + live push — logged, reviewed, nothing new to trust.
- **Never under the £3 walk-away price, never over RRP.** No race to the bottom; a rival that chases is left to sell cheap.
- **Not Amazon's "Automate Pricing"** — it would change prices outside BCWEB (unexplained "Manual" rows next morning, restarts the pricing standard's windows, knows nothing of cost).
- **Weeks of stock left decides how hard to chase** — shown first (a colour on the row), a rule only if it proves right.
- **Automatic repricing last**, per size, off by default, only if the manual presses prove it earns its place.

## Where they differed — and the pick

| Point | Opus | Fable | Pick (Claude, 2026-11-12) |
|---|---|---|---|
| **First step** | Store snapshots | Half-day read-only look at 20–40 sizes | **Fable.** "How many of our sizes have a rival at all?" decides the design: mostly alone → the gain is raising; mostly contested → Match is the main press. |
| **Sizes with no rival** | A "step up a few %" press | No press — the pricing standard's job | **Fable.** Price with no rival is about demand, which the sister-size standard judges; one question per screen. Keep Opus's point: these may be where the money is, so they must be easy to reach via the Amazon Due list. |
| **Floor protection** | Set each listing's Amazon minimum price to the walk-away price | Respect the min / max already on the listing | **Fable now, Opus later.** The push deliberately leaves min / max alone, and the walk-away moves with cost / FBA fee, so a stored minimum would go stale and Amazon would refuse prices. Reconsider as a safety net before any Auto. |
| **How often to read** | Every few hours | Hourly in working hours, its own job | **Fable.** ~7 min a read fits; Update Orders stays fast; a lost Buy Box shows the same morning. |
| **Groups** | 5 (incl. "No Buy Box") | 5 + a separate "Not eligible" list | **Fable**, especially **Winning, room to go up** — the money repricers leave behind when a rival sells out. |
| **Daily figure** | "Buy Box lost · n" folded into Amazon due | "% Buy Box held" | **Undecided** — choose after the read-only look shows how many sizes are contested. |
| **Size drill** | Last sold prices + price changes | Same + **profit a week at each price** | **Fable.** Profit a week balances sales vs profit — the "best price for revenue vs profit" analysis `amz_size_history` was kept for. |

## ChatGPT — what we took, what we left

Written without knowing BCWEB, so most of it is what BCWEB already has (SKU-level sales and profit, cost / fees / walk-away price, stock cover, live push, audit trail). Its closing question, "is sales and profit stored per size?", is already answered: yes, `sales` is per code.

**Taken:**
- **Amazon Retail as a rival is its own tag.** If Amazon itself sells the size, the row says so. Matching Amazon is rarely worth it. The probe shows whether this happens on our shoes at all.
- **"Unusual drop" flag.** A rival dropping ~15%+ between reads is shown, not chased. With the stored history this is also how "they're chasing you" (Opus) gets spotted.
- **Sort Room to go up by £ a month gained**, i.e. (winning price − our price) × profit change × pairs a month at today's pace, so the biggest wins come first. This is its "pricing opportunity report", folded into the group rather than added as a screen.
- **Amazon's own average selling price** (60 days, excluding promotions), if the API returns it per SKU, as a check beside our sold prices. **Check in the probe**: not yet confirmed which call carries it.
- **Read the hot sizes more often** (recent sales or recent rival moves) if the full hourly read proves too slow. Opus's option (c) as well.
- **Profit a week carries a caution:** don't credit a price for a sales change that season, stock or the Buy Box explains. Only in-stock days with the Buy Box held should count (the stored history makes that possible). Show the number of observations, and say "can't tell" below a minimum, like the pricing standard.
- **An emergency stop** on Auto, if Auto ever comes: one switch that halts every automatic move.

**Left out:**
- **Push notifications** (ANY_OFFER_CHANGED, PRICING_HEALTH). They need AWS SQS, which is ruled out above.
- **A configurable rules table** (PricingRules). BCWEB keeps rules as named constants in one util, set by owner decision. No settings screen.
- **A KPI dashboard** (average margin %, product counts, brand / margin filters). One question per screen. The only headline figure is the Daily one, still undecided.
- **Clearance on this screen.** Excess stock is Range / Clearance / Deep sellers' job.
- **A "test a higher price" press for sizes we're winning.** The winning price is Amazon's own ceiling for keeping the Buy Box. Going above it on a contested size gives the Buy Box away. Price above it only matters on Alone sizes, which is the pricing standard's job.
- **Birkenstock examples.** Not on Amazon.

## The groups (draft)

Each in-stock (and inbound) Amazon size lands in exactly one:

| Group | Meaning | Press |
|---|---|---|
| **Alone** | No other seller on the size | None — pricing standard / Due list |
| **Winning, room to go up** | We hold it, priced under what would still win | **Raise to the winning price** |
| **Winning, at the top** | We hold it, nothing to gain | Leave |
| **Losing, can match** | Someone else holds it; the winning price still keeps ≥ £3 a pair | **Match** |
| **Losing, can't match** | The winning price is under the walk-away | Hold / park; no race to the bottom |
| *Not eligible* (apart) | Amazon has pulled the Buy Box | Flag; link to Shopify vs Amazon |

Row: our price · Buy Box price + holder (us / other FBA / other self-posted) · other sellers · winning price · profit a pair at it · walk-away · FBA stock (live +inbound) · pairs 30d · weeks of stock left. Tags when they apply: **Amazon Retail** is a rival · **unusual drop** (a rival down ~15%+ since the last read). **Room to go up** is sorted by £ a month gained.

## Build order

1. **Read-only look** — a probe script (e.g. `scripts/amz-buybox-probe.js`, on `utils/amzSpApi.js`) printing the above for ~30 known sizes (IVES-WHITE + some Rieker / Lunar). Changes nothing.
2. Hourly background read + stored Buy Box history + the screen, read only.
3. Match / Raise presses (W-A1, note e.g. "Buy Box match", 3-day review keeping a later date).
4. Profit a week on the size drill; stored Buy Box % feeds the pricing standard instead of the Business Report.
5. Auto per size, only if steps 2–4 earn it. It would have a daily move cap and one emergency-stop switch.

The probe (step 1) also checks two things: whether Amazon Retail ever sells our sizes, and whether a per-SKU Amazon average selling price is available.

## Step 1 result: the read-only look (2026-11-12)

`node scripts/amz-buybox-probe.js [--top N | GROUPID/CODE…] [--raw]` (READ ONLY: three Product Pricing reads, nothing written). A full run takes about 2½ minutes for 30 sizes. Run on the top 30 Amazon sellers (30 days) and on FLE030-IVES-WHITE:

- **Contested, not alone.** 29 of the top 30 sizes have a rival, and every IVES-WHITE size does. The rivals are mostly **self-posting** sellers, often at £44.99 and up. A few undercut at around £36–40 landed. So **Match matters**. The Alone group is tiny.
- **Groups on the top 30:** 14 Winning with room to go up · 10 Losing, can match · 3 Winning at the top · 2 Losing, can't match · 1 Alone.
- **Amazon's "expected winning price" is NOT a target.** It came back £34.19 on IVES-WHITE-03, where we already held the Buy Box at £39.79. The same figure came back across sizes with different rivals. It's a "sure to win" price, often £4–6 under what actually wins. On some sizes it is ABOVE our price (IVES-BEIGE, MIDBLUE £43.57 vs our ~£40). It is also missing when Amazon sees no competing offer (NO_COMPETING_OFFER) or our offer isn't eligible (OFFER_NOT_ELIGIBLE). **Changed:** the match target is the **real Buy Box price, postage included** (the cheapest rival Buy Box winner from itemOffers), and Amazon's figure is shown beside it, not obeyed. It may still prove useful when it sits above our price. Watch it.
- **The Buy Box is shared.** Several offers can be winners at once, because Amazon splits the featured offer by customer (Prime / non-Prime / postcode). "US + shared" = we are one of them. Seen on 7 of the top 30.
- **A rival at our exact price**, to the penny, on 4 sizes (one self-poster, AAGBKF49IVH4X, on IVES-WHITE-04/06 at £39.69 / £39.49). This looks like a **repricer following us**. Matching it starts the race the plan warns about. The tag stays, and the stored history will confirm it.
- **"Room to go up" is a guess, not a fact.** It's measured to the next rival's price, but FBA offers win the Buy Box above cheaper self-posters (we hold IVES-BLACKSOLE-06 at £39.89 against a £39.99 self-poster and £44.99s). How far up we can go before losing it is something **only history will show**. So a Raise should be a small step with a short review, not "to just under the next rival".
- **Amazon Retail sells on some of ours** (72581-…, 45973-…). On 45973-00-39 the Buy Box holder is another FBA seller at £53.99, which would leave us −£0.28 a pair. Can't match.
- **Reference prices returned:** CompetitivePrice and WasPrice. **No per-SKU "average selling price"**, so the ChatGPT idea is dropped.
- Not a fault: Amazon gives no shop names, only seller IDs. The 4 seller IDs on IVES-WHITE are the same across sizes, so naming the regulars by hand (Fable) is workable.

## Proposed: the screen with a button, and its storage (2026-11-12, not agreed yet)

The owner wants to **press the read by hand** until the team is used to it and the read frequency is decided. Automating it later just means the same read, run by cron.

**The screen.** A Buy Box screen opens instantly on the **last stored reading** ("read 2 hours ago by Andreas"), with the groups and the rows as in the probe. Two buttons:
- **Read all.** About 358 sizes (FBA live + inbound), roughly 4 minutes, because Amazon's rate limits set the pace. That is too long for one web request, so the server runs it in the background and the screen shows progress (n of 358). It is locked so that two presses can't overlap. Pressing again while it runs just shows the progress.
- **Read one style**, from a row. A few seconds, for checking straight after a price change.

The calls are itemOffers (who holds the Buy Box, and every rival) plus the expected price, both run side by side. competitiveSummary is dropped: it only added reference prices, and the CompetitivePrice it returns also comes back in itemOffers.

**Storage. Yes, it needs some**, for two reasons: so the screen can open on the last reading without waiting 4 minutes, and because the history is the point (whether a rival follows our price, how far up we can go and still hold the Buy Box, and the Buy Box % for the pricing standard). Three tables:

| Table | What | Size |
|---|---|---|
| `amz_buybox_now` | The latest reading, one row per size, overwritten by each read (incl. the full offer list as JSON) | ~360 rows, under 1 MB, never grows |
| `amz_buybox_history` | **Change-only**, like `amz_size_history`: a row only when the holder, the Buy Box price, our price, the cheapest rival (seller id + price) or the rival count changed. Not the full offer list. | See below |
| `amz_buybox_run` | One line per read (when, who pressed or cron, sizes read, errors) | Tiny |

**Can we hold it?** The whole database is **87 MB** today. `amz_size_history`, the nearest comparison, holds 13,181 rows in 3.6 MB (about 270 bytes a row with its index).
- Pressed by hand a few times a day, with maybe 20% of sizes changing between reads: about 200 rows a day, so **~75k rows a year, or ~20 MB**.
- Hourly in working hours (10 reads a day) at the same rate: about **~260k rows a year, or ~70 MB**. That would nearly double the database in a year, which is why it needs a cap.
- **Cap: keep 12 months** (enough to see one season come round), purged by the read itself as it writes, like `amz_size_history`. The row in force at the cut-off survives. That bounds it at roughly 20–70 MB for good. Nothing else is stored from Amazon.

## Owner decisions

*(none yet — first one pending)*

1. **Build the read-only look (step 1)?** — Claude: yes. *Owner, 2026-11-12: first "not yet — compare the ChatGPT version first", then yes. Built and run the same day (results above).*

2. **The screen with buttons + storage, 12 months?** *Owner, 2026-11-12: yes, keep 12 months. Happy for it to go in the cron; "I just don't want to get confused with what I'm seeing and whether or not I should press the button."* So **the screen only ever shows the database**: it says how old the reading is, the cron does the regular read, and the buttons are only for "now" (Read all now, and Read this style after a price change). **New and sold-out sizes need nothing**: each read takes the sizes in FBA stock (live + inbound) at that moment. The migration was approved by the owner and applied 2026-11-12.

### Built 2026-11-12 (step 2, read only)

- Tables `amz_buybox_now` / `amz_buybox_history` / `amz_buybox_run` (`bcweb-server/migrations/20261112_amz_buybox.sql`).
- Rules in `bcweb-server/utils/amzBuyBox.js` (THE copy): read (itemOffers + expected price, side by side, paced; a 429 waits one refill and retries), save (change-only history, 12-month purge as it writes, sold-out sizes leave `_now`), groups (worked out when the screen loads, from today's cost).
- `GET /amz-buybox` (screen, READ ONLY), `POST /amz-buybox-read` (start a read in the background; BUSY while one runs).
- `scripts/amz-buybox-read.js [GROUPID]`, which is what the cron calls.
- Screen `/amz/buybox`: a "Buy Box" tile in the dashboard's Pricing group.
- **First full read (2026-11-12 00:40, 358 sizes, 4½ min, 0 failed):** 116 Losing, can match · 128 Winning, room to go up · 50 Losing, can't match · 7 No Buy Box · 34 Winning, at the top · 23 Alone. We held the Buy Box (alone or shared) on 178 of 358 sizes. Rivals: 141 self-posters and 17 FBA sellers held it, and Amazon Retail held 8. 56 sizes had a rival at our exact price, and Amazon Retail sold 61. History held 358 rows in 120 kB (about 340 bytes a row), in line with the storage estimate.
- **Cron line for the owner to add on the VPS** (then re-pull `docs/crontab.txt`). Hourly, 8:20 to 18:20, clear of Update Orders on the hour:
  `20 8-18 * * * cd /apps/production/bcweb-server && /root/.nvm/versions/node/v22.17.0/bin/node scripts/amz-buybox-read.js`

Still to ask, one at a time, after that: read frequency (hourly, working hours?) · in-stock only, or inbound too (lean: both) · Match floor = the £3 walk-away (lean: yes) · review after Match / Raise (lean: 3 days, later kept) · where the screen lives (Pricing group; count on Daily?) · the Daily figure · Auto (after a month of readings).
