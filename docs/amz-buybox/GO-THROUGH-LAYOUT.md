# Go through — calmer layout (agreed and BUILT 2026-11-13)

**Built** in `bcweb-web/src/app/amz/buybox/deck/page.tsx` and the new `bcweb-web/src/components/PriceLadder.tsx` (web only, no
server change). Owner: "yes" to the price ladder, then "go ahead and build it". The other three points were built with these
defaults, and any of them can be changed: the list drawer is closed on every load (nothing stored), the column is centred (~880px),
and Cut stays rose.

Owner, 2026-11-12, on the live screen (`buy-box.png`): "the current layout is too busy … Perhaps no need for the list to always show.
We want to glance at data and maybe see some colours but not too conflicting. We are making a decision on setting the price or leaving
it." Laptop first (~90%), phone sometimes. **Layout only** — no rule, route or data change. Every field below is already on the card the
deck route returns (`utils/amzBuyBoxDeck.js`). Mockup with the 12 Nov readings: the claude.ai artifact "Go Through Layout".

Builds on the answers / moods / New redesign (PLAN.md decisions 13–20, built 2026-11-13): tabs New · Raise · Cut, the mood picked on the
Buy Box screen and shown here as a badge.

## What makes it noisy today

1. Two panels side by side (card + queue), and the card itself has two data blocks side by side (8 facts + offers table). The eye has
   four places to start.
2. The move line crams a tag, two prices, the %, a truncated reason ("posta…") and pills onto one line.
3. Eight facts with equal weight. Lead, Walk-away, RRP and Next dearer are four numbers that only mean something against each other.
4. Colour everywhere: a red tag, green/red tab dots, a green share %, an amber pill, amber "last sold", green queue dots, an indigo
   button and a green result bar. They all compete.
5. Three lines of small grey text (key hints, "not in the deck" paragraph, the profit/warning line).

## The layout: one column, read in the order you decide

One centred column (~880px) holds the toolbar, progress, card and result line, all the same width. The card has fixed-height zones on a
laptop, so the buttons sit in the same place on every card (owner's 12 Nov rule: "I'm moving my cursor to chase it").

| Zone | What's in it |
|---|---|
| **1 Toolbar** | Tabs New · Raise · Cut (count + colour dot) · mood badge + Change · "Read 6 h ago" as grey text with a refresh ICON (no full button). No result message here. |
| **2 Progress** | One dot per card: hollow = to do, green = set, grey = left, ringed = current. Hover shows the code and the move, click jumps. "3 of 14 · 2 set · 0 left". The queue becomes a **drawer** behind a List button (key Q). It is closed on load and lies over the page, so the card never shifts. On New, the "mood doesn't apply" note goes on this line. |
| **3 The move** | One solid verb tag (RAISE / CUT / NEW · CUT) in the answer's colour, the only strong colour on the card. Old price grey → new price large → %. The reason on its own line, in full. Then the **price ladder**. |
| **Price ladder** | One horizontal line from the floor (walk-away, or break-even on New: a red tick, with a dashed track below it) to the RRP. Rivals are grey dots, and the lead is a larger dark dot labelled "Lead 90% £36.39". Our move is an arrow from Now (a ring) to the suggestion (a filled dot) in the answer's colour. Our labels go above the line and the market's go below. Overlapping labels drop to a second row with a leader line. Offers over the RRP show as "+2 over". It replaces the Lead / Next dearer / Walk-away / RRP facts and most of the offers table. |
| **4 Three facts** | **Buy Box**: "We're shown n%" (big), a views bar (us green, the lead dark grey, others light), a one-line description of the lead, "following us" as a quiet chip with a small amber dot, and "8 offers", which opens the full table in a pop-over. **Selling · 30 days**: the strip with bigger squares, "4 sold · last sold 22 days ago" (amber at 14+ days or never). On New: "3 days in · 27 days left to get the first sale". **Stock**: weeks left (big), then FBA (+ coming), at home and on order. |
| **5 Decide** | Left: the price box, then "keeps £x a pair" with "now £y" under it (+£z a week on a raise). Right: ← (small), **Leave →**, then **Set £x ⏎** as the primary button at the far right. Keys show as faint marks on the buttons, so the hint sentence goes. One reserved line under it shows warnings while typing (red only for under the floor, amber for the rest). Otherwise it reads "Set or Leave moves the Amazon Due date to 10 Dec", or "… 3 Jan kept" (this replaces the "parked to" pill). |
| **6 Under the card** | The last result as ONE grey line: green ✓, "CODE £a → £b · sent to Amazon", Undo. Errors are in red text and "not sent" in amber text. No coloured bar. Then "Not here: …" as one grey line linking to the Buy Box screen (its answers bar holds the breakdown). |

## Colour — one meaning each

The card is ink and greys. Raise = emerald, Cut = rose, New = violet. These appear only on the tab dot, the verb tag and the ladder
arrow. Green also means pairs sold and sets done (strip, views bar for us, progress dots). Amber means look twice (stale last sale, a
warning, "following us"). Red is only for under the floor. Indigo (brand) is only for the Set button and links. This follows the
2026-11-06 colour rule: small solid marks, no bands or faint tints.

## Phone

The same card, stacked. Tabs fill the width and the mood badge shows its face only. The dots stay on one line and clip, with no List
button. Buy Box takes the full width, with Selling and Stock side by side under it. The decide row is **sticky at the bottom**, with
Leave and Set splitting the width. Keys, key marks and the price-screen link are hidden.

## What moved where

| Today | Proposed |
|---|---|
| Queue panel always open | Progress dots, with the list in a drawer (List / Q) |
| Green result bar in the toolbar | One grey line under the card, with Undo |
| Tag + prices + % + truncated reason + pills on one line | Tag + prices, the reason in full under them, pills in the Buy Box fact |
| 8 equal facts | Price ladder + 3 facts |
| Offers table beside the facts | Ticks on the ladder, full table behind "n offers" |
| Profit now (a fact) | "now £y" under "keeps £x" |
| Key hint sentence | Key marks on the buttons, plus tooltips |
| "parked to … — kept" pill | The decide row's reserved line |
| "Not in the deck" paragraph | One line, with the detail on the Buy Box screen |

## Decided

1. Price ladder in place of the Lead / Walk-away / RRP numbers: **yes** (owner, 2026-11-13).
2. List drawer: closed on every load (default; could be remembered per browser).
3. Centred ~880px column (default).
4. Cut stays rose (default).

## Build notes

- Web only: `bcweb-web/src/app/amz/buybox/deck/page.tsx`, plus a small `PriceLadder` SVG component (labels placed by one scale, with a
  two-row dodge). No server change.
- Keep: the keys (+ Q for the list), the snapshot / Refresh behaviour, the Set → Undo / Leave → Next swap on a set card, fixed heights.
- Check at 1366×768 (no scroll) and at phone width.
