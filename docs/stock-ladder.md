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

Agreed 2026-11-15. Sits on top of step 2 (Sold 90) — and since 2026-11-17 on step 1 too (below).

- **Ideal = 90 days' worth of stock; buffer = 1 more month. More than 4 months' worth = Overstocked.**
- Worth = the SKU's average selling rate (12-month pace, so summer sellers aren't judged on a winter rate).
- Even 1 pair over counts. The old "3 pairs over" minimum (`utils/deepSizes.js` MIN_OVER) was never approved by the owner:
  dropped. The code still has it until this is built.
- **Step 1 too (owner, 2026-11-17):** a SKU **unsold for more than 30 days since it came in, holding 2+ pairs**, is Overstocked;
  pairs over = held − 1 ("having 1 isn't overstocked, but 2 might be, 5 certainly is"). 60 days was set aside as too close to 90.
  Judged per SKU, not per style (owner: "I don't think we should move to style judgement"). The case: D0772-14-40, 2 held, 75 days,
  never sold. First count: 47 SKUs, 26 styles, 69 pairs over. A sale moves it to step 2 (the 4 months' test); none moves it to
  step 3 on day 91, which has no label — one place at a time.
- The 4 months' test is only on step 2 because it needs a selling rate: step 1 hasn't had time to show one, and steps 3–5 aren't selling, so they're
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

- **Arrived — a choice of two doors, no list (owner, 2026-11-15:** the list "doesn't mean much"; the aim is the first sale). **Amazon
  New cards** = the Buy Box deck's New tab as it is (`/amz/buybox/deck?g=new` — only sizes landed at Amazon within 30 days with no
  Amazon sale; after that they are on the normal Due list). **Shopify price cards** = `/pricing/cards?step=arrived&pending=1`, the
  styles holding an Arrived SKU (any brand; `pricing-all-list ?step=`), walking all of them because nearly every style is parked
  (that day 169 SKUs on Arrived · 104 at FBA, 65 local only · 8 New cards ready · 35 Shopify styles, 0 due).
- **Unsold 90 — the same choice (owner, 2026-11-15, option A).** Amazon = the step's price cards on Due (`/amz/step-cards?step=unsold90&when=due`, an All | Due switch on the cards; owner: "I was expecting amazon to be price cards too, rather than the list" — the list stays at `&side=amazon`, a quiet link under the doors).
  Shopify = `/pricing/cards?step=unsold90`, opened on **Due** with an All | Due switch, and ONLY the styles with every held size
  on step 3 or later: a card sets the style price, and a style still holding a new or selling size must not be cut to clear its
  dead sizes (that wants a size price on the card — option B, next). That day: 364 SKUs (303 Birkenstock, none at FBA; 50
  non-Birkenstock at FBA, all parked), 135 styles, 56 whole-stuck, 46 of them on the Shopify list, 2 due (19 season-parked to
  March). A set cut per step (e.g. −5%) still not added: 3 Unsold 90 step-card presses so far, averaging +21%.
  **Option B (size prices on the Shopify card) not built (owner, 2026-11-15):** the 197 SKUs in styles still selling other sizes
  (37 styles held back by ONE selling size) wait for Clearance, where size prices already happen. Instead the Shopify card says
  why a style is there — a reason line, `lib/stockLadder → shopifyStepReason`: the sizes we hold and how long since any sold, plus
  the whole style's last sale when a size now sold out sold more recently (e.g. "Unsold 180 — 1 size left, unsold 193 days · the
  style's other sizes sold out, last sale 13 days ago · a firmer cut"; Arrived: "n sizes waiting for a first sale"). The first
  wording, "no size has sold for n days", was false for most cards: that day 35 of 46 Unsold 90 styles and 5 of 6 Unsold 180 were
  a selling style's leftovers. The choice's tally line reads "… + 197 in styles still selling
  other sizes".
- **Unsold 180 — the same choice (owner, 2026-11-15).** A style is on the Shopify cards of ONE stuck step: the step of its
  freshest size (no held size on an earlier step), so the reason line's days always fit. That day 39 SKUs = 6 on Amazon cards
  (all parked) + 9 on Shopify cards (6 styles, 0 due) + 24 in styles with a size that sold more recently (17 Birkenstock).
- **Sold 90:** a list only, perhaps with a link to Amazon Pricing. No step cards. The Buy Box already prices these sizes
  (New, Raise, Cut), and a second door to the same sizes was rejected on 13 Nov.
- **Overstocked, Unsold 90, Unsold 180, Clearance:** list first, then cards.
  - The list shows every size on the step: days since the last sale, the review date, and pairs over for Overstocked.
  - **Chips at the top, no separate summary screen:** Due n · Within a week n · Later n · All n. A chip narrows the list; it opens on
    **Due**.
  - **Price these (n)** opens the Amazon price cards (THE card layout, `components/AmzCardFrame.tsx`) for the sizes the list is
    showing, with the step's aim on the reason line. A single size can be opened from its row.
  - **Due = `utils/amzDue.js`, unchanged.** Pricing early from Within a week / Later is the owner's choice and sets a new review date
    as normal. The step changes no rule (Season parks still hold on Due, e.g. a sandal in November).
  - A Buy Box size on the step (sold on Amazon in 30 days) shows under All only, marked "Buy Box", and is carded here too with the Buy Box cards' suggestion (owner 2026-11-17: "I want to price in cards"; was never carded).
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
- [x] **The Clearance screen as a whole — BUILT 2026-11-15** (`/analytics/slow-sizes/clearance`, read `GET /clearance-list`, rules
      `utils/clearanceList.js`; Range's step 5 box and the Clearance step cards' Back go there via `lib/stockLadder → stepListHref`;
      the eBay screen takes `?q=<groupid>` to start on a style). Decisions below. (Owner, 2026-11-15: "I just want the Clearance screen to be easy … more thought needed"):
      the choices under it are drop the Shopify price, drop the Amazon price, add / remove eBay, adjust the eBay price. Not built
      until agreed — including the "List on eBay →" mark. eBay's rules already start 9-month sizes at 50% of RRP and list FBA stock (MCF).
  - [x] **Decision 1 — ONE list, one row per SKU, Shopify | Amazon | eBay side by side (owner, 2026-11-15: "yes, one list with the
        three channels").** A NEW Clearance screen, opened from Range's step 5 box in place of the step list (the other steps keep the
        step list + Amazon cards). Every Clearance SKU, any brand. Rows grouped under their style (the eBay listing is per style).
        Each channel cell = its price + its own button, or a grey reason why that channel can't sell it — never hidden:
        Shopify always (Shopify button = a SIZE price, `utils/sizePrice.js`; whether a style with every size on Clearance cuts the style
        price instead is still to decide) · Amazon only with pairs at FBA (else "no FBA stock") · eBay any brand but Birkenstock (else
        "not for Birkenstock"; the rule stays in `utils/ebayListingRules.js`). Channels are independent — changing one never touches
        another. Chips are filters, not parts: All · Could go on eBay · At Amazon. Job lot and the other shop deal kept off for now.
        The row shows the review date (a park must be seen before a price change or an eBay listing).
        Rejected on the way, same day: parts by where the stock sits (only Amazon depends on location — Shopify and eBay sell local
        + FBA via MCF), then parts by where it could sell with a lead tool per part, then a Birkenstock part.
        That day: 163 SKUs, all live on Shopify (1 with a size price); 25 at FBA, 138 none; eBay 25 on, 38 could list, 100
        Birkenstock; 151 with a review date still to come (Shopify or Amazon).
  - [x] **Decision 2 — opens on All (owner, 2026-11-15, option A).** Every Clearance SKU shows, parked or not. Each channel cell shows
        its own review date under its price (Shopify per style, Amazon per size; eBay has none). A parked price can still be changed and
        sets a new date as usual. No Due chip. Rejected: open on Due (would have shown ~12 of 163, the rest behind a chip).
  - [x] **Decision 3 — the Shopify button is ALWAYS a size price (owner, 2026-11-15, option A)**, even when every held size of the
        style is on Clearance; a style with several Clearance sizes gets one "all sizes of this style" entry. Why: it ends by itself
        on sell-out (a later delivery or return never sells at the clearance price), it goes as `sale_price` and is left out of paid
        Shopping (no ad spend on clearance), and it never moves the style price, its log or its review date. The size price's own
        rules stand (`utils/sizePrice.js`: below the style price, in stock, no review date). Rejected: B, style price when every size
        is on Clearance. That day 85 styles had a Clearance size: 44 (84 SKUs) all sizes on Clearance, 41 (79 SKUs) only some.
  - [x] **Decision 4 — eBay "List" opens the existing listing form for the WHOLE style (owner, 2026-11-15, option A)** — the eBay
        screen's Not on eBay form, nothing new: Clearance sizes start at 50% of RRP, the others at their Amazon price (else Shopify +
        £4.50), every price editable before List. The style's other sizes go on too, at a normal price (Update Orders already adds new
        in-stock sizes by itself). Rejected: B, list only the Clearance sizes (a new keep-off-the-listing rule + a stock-sync change,
        for 8 sizes). That day the 38 listable SKUs came from 16 styles: 12 all on Clearance, 4 also holding 8 other sizes.
  - [x] **Decision 5 — no take-off on the Clearance screen (owner, 2026-11-15, option C).** A size on eBay shows its eBay price with
        [change] (POST /ebay-size-price, built) and a "listing →" link to the eBay screen; ending a listing stays there, where every
        size it holds is in view. Why: eBay ends per style, and that day 7 of the 8 live listings holding Clearance sizes also held
        non-Clearance sizes, so a row's "take off" would pull selling sizes. Rejected: A (row button ending the whole listing), B (take
        off one size — the build passed on in Decision 4).
  - [x] **Decision 6 — Amazon: ONE button for the lot, no per-row Amazon change (owner, 2026-11-15: "I don't want to be going back and
        forth … I go through them as normal on the price card section, not here").** A single "Price on Amazon (n)" at the top sends
        every Clearance size at FBA to the Amazon step cards (`/amz/step-cards`, step clearance, All — parked included, each card
        shows its review date; Buy Box sizes left out as always). The row's Amazon cell is read only: price + review date, or "no FBA
        stock". The cards are as built (reason line "clear the lot, a loss is OK", no suggested price). Rejected: a [change] per row
        opening one card (back and forth), a plain price box on the row (second way to set an Amazon price, no cost/fee in view).
  - [x] **Decision 7 — Shopify size price set on the row, kept SIMPLE (owner, 2026-11-15, option A: "I'm expecting Shopify cards to be
        designed later and may come back here").** A price box + Set on each row; a style with several Clearance sizes gets one box
        on its style line that sets them all. Same save as the drill's Size prices panel (`utils/sizePrice.js`, W-S1, pushIfLive),
        live on Shopify at once. Interim: when Shopify price cards exist, this may move to a "Price on Shopify (n)" button like
        Amazon's — so build nothing here that a card screen would have to undo.
  - [x] **Decision 8 — what a row shows, kept short (owner, 2026-11-15: "start with that").** Style line: name (`title.shopifytitle`),
        brand, cost, RRP, the "all sizes" Shopify box. Size row: size · pairs · last sold (date, or "never") · Shopify / Amazon / eBay.
        Left out: where the pairs sit (local / FBA — decides nothing here), profit per channel (the Amazon card and the eBay price
        show their own; a Shopify size price below cost gets a small red "below cost" flag, never a block), sales history.
  - [x] **After the build (owner, 2026-11-15):** column headings stick to the window (one scroll bar, no inner box); − / + in 5% of RRP
        steps with the % shown on every price box here and on the eBay listing form (`components/RrpStepper.tsx`); the eBay box shows
        today's eBay price; a brand eBay never carries = a greyed-out List, no words; the whole code per size (the barcode shown under it was dropped the same day — the look-up reads it); the Amazon cell says why
        a size can't sell there (listed · none at FBA / not listed by us); **Look up on Amazon** (a button, never on load — owner: "at my
        request rather than slowing the screen down") finds those sizes in Amazon's catalogue BY BARCODE: ASIN + rank, whoever sells it,
        nothing stored (`utils/amzBarcodeLookup.js`, POST /clearance-amz-lookup; rank = the Buy Box's `fashionRank`). Our ASIN isn't
        needed — the barcode finds Amazon's. First run: 138 sizes in 7s — 81 ranked, 33 no rank, 24 not on Amazon at all.
  - [x] **Amazon on Clearance, after the build (owner, 2026-11-15):** only sizes NOT listed by us and NOT Birkenstock (`listable`) are
        looked up; chip **Could go on Amazon** = those Amazon's catalogue has (pressing it runs the look-up). Amazon's own price: not
        wanted ("these are clearance … I will price low or RRP"). **List on Amazon is PER SIZE** (owner, same day: "it sends the whole
        size range? Some have rank 43k while other sizes are much more") — a button in the size's Amazon cell, one size per press, at
        RRP, FBA (POST /amz-list now takes optional `codes`; without them it still lists the whole style, as on the other screens). Shown
        for a listable size, hidden once the look-up says Amazon hasn't the product. No bulk. (First tried: the style-wide button on
        the style line — dropped for this.) Amazon's VALIDATION_PREVIEW (check mode) answers INVALID for SHOES even when its only issue
        is the harmless Dangerous Goods WARNING, so it can't vouch for a size — real presses read ACCEPTED. A listed size reaches
        the Amazon cards only once pairs are at FBA, and even then not for its first 30 days: a size that has never sold on Amazon is
        the Buy Box's NEW when it lands (utils/amzBuyBoxDeck.js), so it's carded on Amazon Pricing only if a rival is cheaper, and
        joins the Clearance cards after 30 days with no Amazon sale. **price → (owner, same day, option A)** on the size's Amazon cell
        opens its own Amazon price screen at ANY stage (listed, on its way in, New, selling) — price it ahead of arrival and it is live
        at that price when the pairs land. Rejected: B (Clearance skips New — would change the one due rule), C (leave it).
        **PICK on the row (owner, same day, option A):** a size's free shelf pairs are picked for Amazon from its Amazon cell — `− n +
        Pick`, starting at every free pair — through POST /amz-pick-allocate (Amazon Order's own pick write, idempotent); they then wait
        on /pick's Amazon tab ("n picked →"); undo is /pick's Unallocate. Not Birkenstock; not for a size Amazon hasn't got at all.
        Rejected: B (send to Amazon Order with the basket pre-loaded — a hand-over into its most complex part). Flow: List → Pick →
        price → → send. That day 41 sizes / 58 pairs could be picked (32 of them not listed by us yet). That day: 32 listable sizes — 23 on
        Amazon's catalogue (20 ranked) in 10 styles, 9 not on Amazon at all.
        **Rank decides nothing on screen (owner, 2026-11-15, option B):** the owner's own bar is under 200k, sometimes under 500k, no
        rank = don't send — but it's applied BY HAND, size by size. The rank is shown on every looked-up size; no filter, no colour
        band, no button hidden. Rejected: A (chip only under 500k + green / amber dots), C (List shown only under a set rank). That
        day: under 200k 5 sizes / 1 style · 200–500k 5 / 4 · over 500k 10 / 5 · no rank 3 / 2.
  - [x] **Decision 9 — order: longest unsold first (owner, 2026-11-15, option A)**, as every other Stock ladder list: a style ranks
        by its longest-waiting size, sizes in size order under it. Rejected: most money tied up first (cost × pairs — ranks by qty,
        and qty is shown, never a rule).
- [ ] Birkenstock / Shopify on the steps.
