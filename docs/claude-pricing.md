# Claude Pricing Playbook

Claude reads this at the start of every pricing session. It works as a pricing employee: its price changes are applied live and logged as **Claude** in `price_change_log.changed_by`.

## Summary

- **The job:** maximum margin from stock we already hold. Birkenstock can't be re-ordered, so don't chase sales on slow, broken-size styles; harvest instead.
- **Hard limits:** never below cost (blocked); above RRP is allowed but flagged. Shopify and Amazon prices are independent.
- **The loop:** owner names a subset → Claude reads each style's price ladder (units/wk at each price, net of returns, against the season and segment) → proposes price + one-line reason → owner approves → Claude applies via W1 with a note and review period → logs the decision.
- **Owner's mood** sets the direction (push lower / hold / push higher); the evidence sets the size, and Claude says when the data argues against it.
- **Notes:** as short as possible, ≤80 chars, Andreas/Summer voice. No check/judge dates (the review date does that). Holds are a same-price apply, not a park.
- **Reviews:** raise 7d, cut 14d, hold 30d; longer on slow sellers.
- **Current state (Oct 2026):** STEADY is mostly ~1/month styles in the Birkenstock autumn lull, so expect mostly holds and small harvest raises; cuts only for heavy stock with a clearly failed price step.

## Contents

0. [Where this is heading](#where-this-is-heading)
1. [How a session runs](#how-a-session-runs)
2. [Rules (owner-set, authoritative)](#rules-owner-set-authoritative)
3. [Instructions (how Claude should work)](#instructions-how-claude-should-work)
4. [Learnings (dated, from results)](#learnings-dated-from-results)
5. [Decisions log](#decisions-log)
6. [Change log of this playbook](#change-log-of-this-playbook)

## Where this is heading

The owner's intention (2026-10-02): once comfortable, Claude reprices the whole due list in one run; batches with owner review are for when the owner wants to revisit the rules.

## How a session runs

1. The owner names a subset: a list of styles, a segment, a status or a campaign.
2. Claude looks at recent price changes for that subset: old → new price, note, who made it, and what happened afterwards (units/wk, profit/wk before vs after).
3. Claude proposes a price per style, each with a one-line reason, and the owner approves or edits.
4. Claude applies the approved prices through the normal W1 route, with a short note and a review period.
5. Anything learned goes into **Learnings** below, with the date.

## Rules (owner-set, authoritative)

- Birkenstock can't be re-ordered. The job is maximum margin from the stock we already hold.
- Never price below cost (the server blocks it). Going above RRP is allowed but gets flagged.
- Shopify and Amazon prices are independent. Amazon's price is shown for context, never matched.
- Re-orderable? (owner, 2026-10-02) Birkenstock: never. Other brands (e.g. Rieker): usually in season, but some sell out at the supplier. Check the "Can't get" flag: `skusummary.no_supply_until > CURRENT_DATE` means staff have marked that we can't get more, so harvest it like a Birkenstock. Unmarked non-Birkenstock = treat as re-orderable (owner: the flag is kept up to date as orders are placed; no extra logic needed).
- _(add as we go)_

## Instructions (how Claude should work)

- **The owner's MOOD (from 2026-09-30, coming):** the owner will sometimes give a mood for a session or a style: **push lower** (cut to try and create sales), **hold**, or **push higher** (raise to harvest profit). The mood is the direction; the evidence decides the size and whether it's sensible. Take the mood as the intent, propose a price that serves it, and say so if the data argues against it (e.g. "you want to cut, but it sold nothing at 3 prices already"). Put the mood in the Decisions log (Why) and write the note in its terms ("Push down to get it moving", "Up to harvest"). No mood given = judge on the evidence, as now. Still learning: which mood works on which kind of style is what Learnings should build up.
- Review periods are a default, not a rule: on a slow seller (~1/month) a 7-day review can't show anything, so lengthen it (raise on a slow seller: 14d).
- Prices are 2dp. No price-ending convention (owner, 2026-09-28): pick the number, not a .95/.99 pattern.
- Login: `claude_dev` (display name "Claude", shared with API testing). Test writes use BEGIN…ROLLBACK, so only real applies reach the log.
- Until Learnings show a track record: propose → owner approves → Claude applies.
- Every change carries a note saying why, so the result can be judged later.
- Notes: 80 characters max, plain words, one clear reason (e.g. "Hold: season stall, not price. All Mayaris stopped mid-Sep."). The detail goes in the Decisions log, not the note (owner, 2026-09-29).
- Note style (owner, 2026-09-30): write like Andreas and Summer do, short and plain, a glance-guide for the next person changing the price, not a technical record. Say what we did, why, and what to expect. Don't try to catch everything; the detail goes in the Decisions log. Examples: "Slow but steady at 55. Not the price, just quiet. Hold." / "Selling at 48" / "Move up, see if it keeps selling".
- **New styles: hands off for 4 weeks** (owner, 2026-10-02). If a style was listed (`skusummary.created_at`) under 4 weeks ago, don't reprice it: record it unchanged (same-price apply, note "New, listed <date>.") with the review date set to the day it turns 4 weeks old. Why: in Sep 2026 new styles were cut weekly before they'd had a fair run (RAMSES £85 → £60 in 5 weeks; Arizona EVA Pink Clay £50 → £32 for a 14p profit; a Caprice boot cut after 6 days). Playbook only, no screen change.
- Notes as minimal as possible (owner, 2026-10-02). Never put a check/judge date in a note ("judge in spring", "check Dec"): that's what the review date is for.
- Notes are evidence for judging past moves (owner, 2026-09-29). When reviewing a style's history, read each change's note (ours and staff's) as the intent behind it, and judge what followed against that intent. Example: Summer's "trying to get moving" cut to £72 sold nothing in a week, so the cut didn't do what it was meant to. So write notes that can be checked later: say what you expect to happen, not only what you did.
- Default review periods: raise 7d, cut 14d, hold 30d. Out of season, review just before the season returns instead (1 Mar for summer styles).
- Check `skusummary.season` first (owner, 2026-10-02). Summer = a quiet Sep-Feb is the season, not the price. Any = sells all year, so a quiet autumn IS a price signal (though a dead segment still weighs). Values are Summer / Any / Winter; the owner sets Any on Back Office → Seasons for Birkenstocks that sell year-round.
- Batches: when the evidence is clear, propose several styles at once; one approval, apply all, then one playbook commit (owner, 2026-10-02).
- A HOLD is recorded as a same-price apply with a note (e.g. 80 -> 80), not park-only, so it can be judged later like any change (owner, 2026-09-29).
- _(add as we go)_

## Learnings (dated, from results)

- 2026-09-29: Check a stall against the segment and the brand before calling it price resistance. In Sept 2026 Birkenstock Shopify units fell from 152/wk (mid-Aug) to ~15/wk, and the whole Mayari segment sold 0 from 14 Sep. 1031620-MAYARI stalled at £80 for 3 weeks, but that was the season, not the price.
- 2026-09-30: A style's price history is a ladder: read units per week at each price before proposing. 1027704-ARIZONA sold ~12 at £66.99 in 6 weeks (summer peak), 0 in 2 weeks at £72.99, and ~4 across £68.99-£69.49. That shows where the resistance is (above ~£70), so a cut or raise inside £67-£70 is unlikely to change much.
- 2026-09-30: Staff's £0.50 nudges with no note (Summer, 5 in 6 weeks on ARIZONA) can't be judged, and they move too little to show a response. Prefer one move with a note, then wait out the review period.
- 2026-09-30: Returns muddy a 30-day unit count. Net them off before calling a style a "seller" (ARIZONA: 1 sold, 1 returned, so net 0).
- 2026-09-30: STEADY (Shopify, due, in stock) is mostly 1-unit-a-month styles in Birkenstock's Sept lull. Expect mostly holds until the season turns; save cuts for styles with a lot of stock and a clearly failed price step.
- 2026-09-30: A hold isn't always right for a stalled style. If the stall is the season, the price isn't costing sales, so a small step back UP to a price that has sold before costs little and harvests margin (owner's call on 1031695-SYDNEY: £90 → £95, which sold 3 in a week in July). Rule of thumb: on a slow, can't-reorder style with broken sizes, harvest rather than chase.
- 2026-10-02: Pull a style's FULL sales history, not 12 months. On 1005294-ARIZONA, 12 months showed nothing above £73.44; 2024-25 showed ~8/mo at £72-73 and one sale at £85, which changed the call.
- 2026-10-02: Out of season, set the review to just before the season returns (Arizona: 1 Mar), not 30d. A 30d review on a dead segment only brings it back to be held again.
- 2026-10-02: Two styles in the same family can have different ceilings. Arizona Patent White Narrow sold ~8/mo at £72; Gizeh Black Narrow sold ~1 in 10 months at £72. Test a price per style, not per family.
- 2026-10-02: Check sister styles (same model, other colour/width) before deciding. Regular Sydneys sell at ~£90 while both Narrows sold 0 at any price, which points at width, not price. Some codes are misfiled (1031689-ARIZONA is a Sydney): go by the title.
- 2026-10-02: A lower price can sell SLOWER than a higher one a year earlier (1025046-ARIZONA: £72 ~3.5/mo in 2025, £68 ~1.6/mo in 2026). Compare pace at each price across years before assuming a cut helps.
- 2026-10-02: Summer's September cuts on summer styles bought nothing, because the segment had stopped. Undoing them to a price that sold in season is a free harvest.
- 2026-10-02: When the core sizes are gone, cuts don't sell the rest. Four Arizonas/Gizehs were cut 4-5 times in Aug-Sep with core sizes out and sold 0 at every step. Put them back to a price that sold.
- 2026-09-30: The API isn't normally running in a Claude session. Apply through the real W1 route in-process (temp express app, JWT signed for claude_dev, POST body uses `newPrice` not `price`). Don't hand-write SQL for applies: W1 also pushes to Shopify.

## Decisions log

| Date | Style | Old → New | Review | Why | Result |
|---|---|---|---|---|---|
| 2026-09-29 | 1031620-MAYARI | 80 → 80 (hold) | 30d (29 Oct) | Season stall, not price. Walk-up 72→75→76→78 sold at each step; £80 untested. 8 left, core 37/39/41 gone. | _pending_ |
| 2026-09-30 | 1027704-ARIZONA | 69.99 → 69.99 (hold) | 30d (30 Oct) | Season stall, not price. £66.99 sold 12 in 6wk, £72.99 none, £69 a few. 10 left (36-40), net 0 in 30d. | _pending_ |
| 2026-09-30 | 1014932-ZERMATT | 55 → 55 (hold) | 30d (30 Oct) | ~1 a month at £52.50-£55, no price signal either way, Sept lull. 15 left (35-41). £12/pair margin, so a cut costs a lot for no visible gain. | _pending_ |
| 2026-09-30 | 1031695-SYDNEY | 90 → 95 (raise, harvest) | 14d (14 Oct) | Owner: small rise to harvest. £95 sold 3 in a week in July; nothing moved 97→90 through the lull, so £90 buys no speed. 7 left, broken sizes, £5/pair extra. Judge: units and profit/wk 14 Oct vs the ~1/month before. | _pending_ |
| 2026-10-02 | 1005294-ARIZONA (Patent White Narrow) | 69 → 90 (raise to RRP, harvest) | 150d (1 Mar 2027) | Owner mood: push to RRP. Overbought (41 left, all sizes), not a price problem. Full history: £72-73.44 sold ~8/mo in summer 2025; £85 sold 1 (Aug 2024); £59 in 2026 sold 16 net at £4.35/pair, so margin given away. £90 untested. Segment sold 1 in Sept, so no signal until spring. Judge: Mar-Apr 2027 sales at £90 vs ~8/mo at £72-73. | _pending_ |
| 2026-10-02 | 0043693-GIZEH (Birko-Flor Black Narrow) | 69.50 → 69.50 (hold) | 150d (1 Mar 2027) | Season stall (segment 70/mo Jun → 10 Sep, same as 2025). £72 tested fairly and failed: 1 sold Aug 2025-May 2026, incl. peak May. Best at £67-69.50 (5 in Aug). 40 left, all sizes; in-season pace clears ~25-30, so spring may need a small cut, not a raise. | _pending_ |
| 2026-10-02 | 0128163-MADRID (EVA Black Narrow) | 33.50 → 33.50 (hold) | 150d (1 Mar 2027) | Season = Summer, EVA segment 212/mo Jun → 2 Sep. Sells at £32 (16 May 2025, 11 Jun + 11 Aug 2026); £35 sold 3 in total. 39 left. Hold for +£1/pair over £32; if not moving by Apr, back to £32. | _pending_ |
| 2026-10-02 | 1032100-GIZEH (EVA Pink Clay Regular) | 38.99 → 39.99 (back up) | 150d (1 Mar 2027) | New Jul 2026. £45 sold 0 in 2wk, £39.49-40.49 sold 4 in Aug; Summer's lull nudge to £38.99 bought nothing. 28 left, all sizes. Spring is the real test. | _pending_ |
| 2026-10-02 | 1015398-BARBADOS (EVA Black Regular) | 33 → 36 (raise, harvest) | 150d (1 Mar 2027) | Broken sizes (36-39 only), 15 left. £39.92 sold 10 in May-Jun 2025 but failed Jun 2026; £32-34 sold ~12. Harvest step under the failed price: ~£6/pair vs £4.30. | _pending_ |
| 2026-10-02 | 0043663-GIZEH (Patent Black Narrow) | 80 → 80 (hold) | 150d (1 Mar 2027) | Summer jumped 61.18 → 80 on 25 Sep, no note, never sold at 80. Sold 9 Apr-Aug at £56.68-61.68 (£3-6/pair). 14 left, 39/40 gone. Lull makes holding free; expect a stall in spring. | _pending_ |
| 2026-10-02 | 1031340-ARIZONA (EVA Pink Clay Narrow) | 37 → 37 (hold) | 150d (1 Mar 2027) | New Jul 2026. £38-40 sold 0, £32 sold 3 at 14p profit, £36.50 sold 2 (£3.16). 14 left, all sizes. | _pending_ |
| 2026-10-02 | 0143623-GIZEH (Birko-Flor Blue Narrow) | 67 → 70 (raise, harvest) | 150d (1 Mar 2027) | Broken sizes (37/40 gone), 13 left. £70 sold 2 in Jun 2026; Sep cuts to £65 sold 0 (lull). Sister Black Narrow sells £67-69.50. | _pending_ |
| 2026-10-02 | 0040731-MADRID (Birko-Flor White Regular) | 74.99 → 74.99 (hold) | 150d (1 Mar 2027) | RRP is £75. Sold 6 at £74.50-75 Jul-Aug (~£20/pair) + 1 in Jan. 13 left. | _pending_ |
| 2026-10-02 | 1019142-ARIZONA (EVA Blue Narrow) | 41.99 → 40 (cut) | 60d (1 Dec 2026) | Season = Any. Sold ~1/mo at £40 through winter 2025-26. Summer walked 36 → 41.99 in Aug; 0 at 41.99 since 24 Aug (one 40.49 returned). 13 left, broken. Keep the winter trickle. | _pending_ |
| 2026-10-02 | 1031689-ARIZONA (Sydney Black Narrow; ARIZONA code) | 88.99 → 88.99 (hold) | 150d (1 Mar 2027) | Listed Jun, walked 110 → 88.99, 0 net on Shopify. Regular Sydneys sell ~£90 (Pearl 5, Metallic Black 3, Taupe 2). Spring test vs White Narrow at 79.99: if neither sells, it's width not price. | _pending_ |
| 2026-10-02 | 0044791-RAMSES (Black Regular) | 70 → 70 (hold) | 150d (1 Mar 2027) | Listed Jul, walked 85 → 60, sold 2 at £60 (£6.75). Andreas up to 70 on a Google ads sale; 0 since (lull). £70 ≈ £13/pair. 12 left, 38-42. | _pending_ |
| 2026-10-02 | 0071793-MAYARI (Birko-Flor Black Narrow) | 70.13 → 75 (raise, harvest) | 150d (1 Mar 2027) | Good seller: £68 ~20 spring 2025, £64-70 ~15 summer 2026. £75.05 sold 2 (Aug 2025, Feb 2026). Broken (39/42 gone, 37 1), 12 left. | _pending_ |
| 2026-10-02 | 1015487-HONOLULU (EVA Black Regular) | 32 → 35 (raise, harvest) | 150d (1 Mar 2027) | £29 sold 9 in Jun at £1.60/pair; £35-36 sold 3 at ~£6; £30-32 3 in Aug. Broken (37/42 gone), 12 left. | _pending_ |
| 2026-10-02 | L7514-15 (Rieker fleece zip boot Navy) | 70.99 → 70.99 (hold) | 30d (1 Nov 2026) | Season = Winter, in season now (Winter styles sold 7/5/9 Oct-Dec 2025). Listed 21 Aug; Summer cut 80 → 70.99 in Sep, sold 1 (£15.13). 11 left, all sizes. Re-orderable? Unknown. | _pending_ |
| 2026-10-02 | 1029151-ARIZONA (Birkibuc Latte Cream Narrow) | 70 → 70 (hold) | 150d (1 Mar 2027) | Slow: 3 sold Jul-Aug at £69-75 while the segment did 100+/mo. Too thin to move. 11 left, 1-2 per size. | _pending_ |
| 2026-10-02 | 1027721-ARIZONA (Birko-Flor New Beige Regular) | 69.29 → 71 (raise, harvest) | 150d (1 Mar 2027) | Two years of ~1-3/mo at every price £64-72; 3 at £70.29-70.79 Jul-Aug; even sold 3 in Jan 2025. Broken (35/38 gone), 11 left. | _pending_ |
| 2026-10-02 | 1025046-ARIZONA (Birko-Flor Vegan Pecan Narrow) | 65 → 72 (raise) | 150d (1 Mar 2027) | £72 sold 8 in 2025 (~3.5/mo peak); Andreas: stopped above 72. 2026 at £68.01 sold SLOWER (~1.6/mo), so lower bought nothing; Sep cuts to 65 in the lull. 11 left. | _pending_ |
| 2026-10-02 | 1031458-ARIZONA (Birko-Flor Basalt Grey Regular) | 74.99 → 74.99 (hold) | 150d (1 Mar 2027) | £69.99 sold 11 Jun-Jul (fast); £73.99-75.99 sold 4, 1 returned (slow, +£3.30/pair). Broken (39/42 gone), 10 left: take the margin. | _pending_ |
| 2026-10-02 | 1029492-SYDNEY (White Narrow) | 79.99 → 79.99 (hold) | 150d (1 Mar 2027) | Walked 110 → 79.99, 0 on Shopify (1 Amazon); already £10 under regular Sydneys. Pair with Black Narrow at 88.99 as the spring width-vs-price test. | _pending_ |
| 2026-10-02 | 25511-41-022 (Caprice knee high boot Black Nappa) | 130 → 130 (hold) | 30d (1 Nov 2026) | Winter, in season, re-orderable. Listed 16 Sep; sold 1 at RRP (£41.56). Summer cut to 115, Andreas back to RRP. | _pending_ |
| 2026-10-02 | 25547-41-306 (Caprice Cafe stretch boot Brown) | 85 → 85 (hold) | 30d (1 Nov 2026) | Winter, in season, re-orderable. Listed 15 Sep; sold 1 at £80, Summer back to RRP £85. | _pending_ |
| 2026-10-02 | M710AP (Goor patent tuxedo shoe, men's) | 40 → 40 (hold) | 30d (1 Nov 2026) | Any, re-orderable. Autumn peak: sold 26 at £40 RRP Oct-Dec 2024 (£9.54/pair); £28 sold 33 in summer 2024 at £1.50. Sizes 10/11 gone: worth a re-order look. | _pending_ |
| 2026-10-02 | M620A (Scimitar cadet oxford, men's) | 36 → 36 (hold) | 60d (1 Dec 2026) | Any, re-orderable. ~1/mo at £36 RRP for 18 months (£7.72/pair); £28.80 sold faster in 2024 at £2.90. | _pending_ |
| 2026-10-02 | 1029356-SYDNEY (Taupe Regular) | 89.99 → 95 (raise, harvest) | 150d (1 Mar 2027) | Sold at 110, 90, 89.99. Regular Sydneys sell 90-95, 110 sold twice. Broken (35/39 gone), 9 left. Matches Metallic Black at 95. | _pending_ |
| 2026-10-02 | 1032019-ARIZONA (Grey Taupe Regular) | 75 → 85 (raise to RRP, harvest) | 150d (1 Mar 2027) | Sold 3 at £85 Jun-Jul, then 8 at 75-76.50 after a cut. Badly broken (37/40/41/42 only), 8 left. £23.51/pair vs £16.80. | _pending_ |
| 2026-10-02 | 1001498-ARIZONA (EVA Anthracite Narrow) | 37 → 39 (raise, harvest) | 150d (1 Mar 2027) | Cost £20.83; all Shopify sales at £31-36 for £0.53-2.82/pair. Broken (38/39/41 gone), 8 left. Small step: nothing above 37 proven. | _pending_ |
| 2026-10-02 | 1016145-GIZEH (Taupe Narrow) | 75 → 75 (hold) | 150d (1 Mar 2027) | Sold 6 at 71.50-73 Jul-Sep (1 returned); Summer up to 75 in the lull. Broken (39/41 gone), 7 left. | _pending_ |
| 2026-10-02 | 65918-52 (Rieker elasticated sandal Green) | 48 → 48 (hold) | 150d (1 Mar 2027) | Summer, out of season, re-orderable, lead channel BOTH (Amazon 7 vs Shopify 3 in 2026). Shopify: £40 sold 2 at £1.28, £48 sold 1 at £6.64. | _pending_ |
| 2026-10-02 | JLY219-BRONWYN-BK (Lunar Bronwyn T-bar Black) | 15 → 25 (raise) | 150d (1 Mar 2027) | £15 = -£3.05/pair (cost 10.99) and still only 2 sold in 8 months. Sold at 24.74 (£3.47) and 29.71 (£6.81) before. Break-even ~£20. | _pending_ |
| 2026-10-02 | JLH587-JULES-BK (Lunar woven strap Black) | 30 → 30 (hold) | 150d (1 Mar 2027) | Summer, re-orderable. Sold 5 at £28-29; 0 at 30-31 (Aug-Sep). 7 left. | _pending_ |
| 2026-10-02 | 0128221-GIZEH (EVA White Regular) | 34 → 39 (raise, harvest) | 150d (1 Mar 2027) | Only sizes 43-46 left (7). 2025: 15 sold at £40.87-45 incl. Oct/Nov. 2026 cut to 35 sold 18 at £3.88. Andreas 39, Summer walked back to 34. | _pending_ |
| 2026-10-02 | 1030590-ARIZONA (Birko-Flor Concrete Grey Regular) | 70.49 → 70.49 (hold) | 150d (1 Mar 2027) | 17 sold at £66.99-70.99 Jun-Aug; £73.99 stalled in peak. Core 38-40 gone, 7 left. | _pending_ |
| 2026-10-02 | 1015471-ARIZONA (EVA Betroot Purple Narrow) | 50 → 50 (hold) | 150d (1 Mar 2027) | Sold 5, all at RRP £50 (£12.21). 7 left. | _pending_ |
| 2026-10-02 | JLD102-JADEN-NAVY (Lunar Jaden Navy) | 40 → 55 (raise) | 150d (1 Mar 2027) | Summer, re-orderable. £55 sold 1 in ~6-8wk (£13.33); £42 sold 2 in ~6wk (£4.62). Same pace, 3x margin at 55. Out of season. 6 left. | _pending_ |
| 2026-10-02 | 40535-FRISCO-BLACK (Free Spirit Frisco Black) | 59.99 → 59.99 (hold) | 150d (1 Mar 2027) | Brand asked for RRP (Andreas). 0 Shopify, 2 Amazon. 6 left. | _pending_ |
| 2026-10-02 | 1029463-SYDNEY (Graceful Pearl White Regular) | 91.50 → 95 (raise, harvest) | 150d (1 Mar 2027) | Sold 5 at ~£90. Broken (35/36/38/41 gone), 5 left. Regular Sydneys now 95; RRP 100. | _pending_ |
| 2026-10-02 | 0147131-KAIRO (Mocca Regular) | 100 → 100 (hold) | 150d (1 Mar 2027) | Sold 7, all at RRP £100 (£28.35). 5 left. | _pending_ |
| 2026-10-02 | 1031501-ARIZONA (Birko-Flor Sandcastle Narrow) | 64.99 → 69.99 (raise) | 150d (1 Mar 2027) | £66.99 sold 9 Jun-Jul; 0 since at 64.99-69.99 with only 36/40/41 left. Sister Concrete Grey sold 7 at 69.99. 4 left. | _pending_ |
| 2026-10-02 | ELZ006-LAKE-OL (Lazy Dogz wellies Olive) | 44.50 → 44.50 (hold) | 30d (1 Nov 2026) | Any, re-orderable, Amazon-led (11 in 2026). Andreas priced above Amazon on purpose (returns). Wellies peaked Nov-Dec 2025. 4 left. | _pending_ |
| 2026-10-02 | 1013075-GIZEH (Patent Sand Brown Regular) | 60 → 69.30 (raise) | 150d (1 Mar 2027) | 2025 £90 sold 6 (£25). Cut in 5 steps to £60: 1 sold at £5.02. £69.30 sold 8 this spring. Only 36 x1, 42 x3 left. | _pending_ |
| 2026-10-02 | 1025062-GIZEH (Birkibuc Pecan Regular) | 80 → 80 (hold) | 60d (1 Dec 2026) | Season Any. Sold at £77-82 incl. Nov 2025; £90 sold 6 in 2025. 4 left. | _pending_ |
| 2026-10-02 | 1031500-ARIZONA (Birko-Flor Basalt Grey Narrow) | 60 → 68.99 (raise) | 150d (1 Mar 2027) | £66.99-68.99 sold 8 Jun-Jul; Summer's cuts to 60 in Aug-Sep sold 0. 39 x2, 41 x2 left. | _pending_ |
| 2026-10-02 | 0040303-MADRID (Patent Black Narrow) | 62 → 62 (hold) | 60d (1 Dec 2026) | Season Any. Sold 12 at ~57.50 in 2026 (£6.80), 2 at £64 Feb 2026. 0 at 62 since Aug (segment 16 → 0). 41/42 only, 4 left. | _pending_ |
| 2026-10-02 | 1032070-ARIZONA (Birkibuc Grey Taupe Narrow) | 70 → 75 (raise) | 150d (1 Mar 2027) | £75 sold 7, £85 sold 1 Jun-Jul; walked 85 → 70 in Aug, 0 sold. 36/40/41/42, 4 left. Sister Regular now 85. | _pending_ |

## Change log of this playbook

- 2026-09-28: created.
- 2026-09-29: hold rule, first learning, decisions log (STEADY session).
- 2026-09-29: 80-char note rule.
- 2026-09-30: ARIZONA hold, 5 learnings, how to apply in-process.
- 2026-09-30: note-style rule (Andreas/Summer voice); ZERMATT hold. A same-price apply no longer touches Shopify (W1 fix).
- 2026-09-30: SYDNEY raise (harvest); owner MOOD section; review length is a default; harvest-vs-hold learning.
- 2026-10-02: summary and contents at the top.
- 2026-10-02: ARIZONA Patent raise to RRP; full-history and season-review learnings.
- 2026-10-02: GIZEH Black Narrow hold to 1 Mar.
- 2026-10-02: first batch (3 EVA styles); season-check and batch instructions.
- 2026-10-02: batch 2 (5 styles); minimal notes, no dates in notes; season value is Any, not ALL.
- 2026-10-02: batch 3 (10 styles); sister-style, cross-year pace and lull-cut learnings.
- 2026-10-02: batch 4 (10 styles, first non-Birkenstock); re-order rule (Can't get flag).
- 2026-10-02: 4-week hands-off rule for new styles; batch 5 (15 styles); core-sizes learning; where-this-is-heading section.
