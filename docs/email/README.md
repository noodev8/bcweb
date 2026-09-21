# Email — working notes

Starting point for email marketing as a bcweb concern. **Nothing is built and nothing is
decided.** This file is the current state of play; it grows as we learn.

History lives in `C:\scripts\email\` (Klaviyo programme, Feb–Apr 2026, now legacy — see the
README there). Not copied here on purpose: one home per thing.

## Why email, why now

Google Ads spend has been cut back. Shopify nets roughly 2x what Amazon does on the same sale
(no referral fee), and email carries no acquisition cost on top, so it is the highest-margin
channel available. Birkenstock cannot be re-ordered on demand — the job is sell-through of stock
already held, at the best price we can hold. That makes email a **stock-clearing and margin**
tool, not a general demand-generation one.

## Tool under evaluation: Spoks

Shopify app, $35/mo flat. Replaces Klaviyo (switched off). **Not committed to** — but the cost
questions are now answered.

**Pricing, confirmed with Spoks support 2026-09-21:** $35/mo, **unlimited contacts** and **no
monthly send cap**. The `0 / 5 000` counter in the app is the *free* plan's send allowance
(free is also capped at 1,000 contacts, and we hold 20,678, so nothing can be sent until
upgrade). SMS is separate, credit-based — not in scope. Klaviyo was ~GBP 480/yr for features we
barely used, so this is a straight saving if it does the job. Not upgraded yet, deliberately.

- Docs `https://docs.spoks.com` · API `https://api.spoks.com` · app `https://app.spoks.com/brookfieldcomfort`
- Auth: `x-api-key` header. Key is `SPOKS_API_KEY` in `bcweb-server\.env` (not in git).
- **Beta** — the docs warn response bodies may change; ignore unrecognised fields.
- Rate limit **60 req/min per key**, bursts of ~20+ get 429 + `Retry-After`.
- Shopify sync to `brookfieldcomfort2` is complete (collections, products, contacts, coupons).
- Sender identity already valid: `sales@brookfieldcomfort.com`, custom domain
  `brookfieldcomfort.com`, `isCustomDomainValid: true`.

### Verified by direct call (2026-09-21, read-only)

| Endpoint | Method | Result |
|---|---|---|
| `/workspaces` | GET | 200 — workspace "Brookfield Comfort" |
| `/team-members` | GET | 200 |
| `/contacts-search` | POST | 200 — the one that matters |
| `/contacts` | GET | 404 — does not exist, use `contacts-search` |

`POST /contacts-search` takes `limit` (max 100), `offset`, optional `filter`, `orderBy`,
`fields`. Response is `{items, meta:{maxResults}}` — `maxResults` gives a segment count without
paging through it.

**Gotcha: numeric filter values must be sent as STRINGS.** `"value": "0"` works, `"value": 0`
throws a union-validation error. Cost half an hour; don't rediscover it.

Filter shape:

```json
{"limit":1,"offset":0,"fields":["id"],
 "filter":{"type":"conjunction","operator":"and","isGrouped":false,
   "filters":[{"type":"filter","field":"emailMarketingConsent","operator":"eq","value":"subscribed"},
              {"type":"filter","field":"totalOrders","operator":"eq","value":"0"}]}}
```

### Campaign drafts (`POST /campaigns`, `PATCH /campaigns/:id`)

Needs an API key with `posts:read-write`. Always created as `draft`; publishing/scheduling is
UI-only, so nothing done here can send. `blocks` and `recipients.segmentIds` **replace** the
whole list on PATCH; omitted fields keep their values. Response carries `editorUrl`.

**Their docs are wrong about block types.** Documented as `h1` / `button`; the API actually
accepts `h1, h2, regular, quote, list, divider, link, image`. There is no `button` — use
`{"type":"link","style":"button"}`.

**Non-ASCII must be sent as raw UTF-8, not `\uXXXX` escapes.** A `£` escape through curl
comes back double-encoded (stored as `U+00C2 U+00A3`, renders as `Â£`). Send the literal
character with `Content-Type: application/json; charset=utf-8` — e.g. Python
`json.dumps(..., ensure_ascii=False).encode('utf-8')`. Verify by checking codepoints, not by
eyeballing a Windows console, which mangles the display either way.

**Personalisation token:** `{{firstName||fallback}}` — fallback after `||` shows when the
contact has no first name. Sample of the 28-day segment: 79/79 had a name, ~6% lowercase or
junk ("lauren James", a company name in one). Not worth engineering around.

**Footer:** unsubscribe is appended automatically; the postal address is not. Put the address in
the **workspace** footer (Settings > Email & SMS — `emailSettings.disclaimer` /
`trailingSection`, both already active), NOT in campaign blocks: per-campaign it looks wrong
centred under the sign-off and has to be remembered every time. (Klaviyo Campaign 3 shipped with
neither unsubscribe nor address.) Free-plan sends also carry a "Powered by Spoks" badge; check
whether it clears on the paid plan.

Operators: `eq ne gt ge lt le like in between`. Useful contact fields: `totalOrders`,
`lastPurchase`, `firstPurchase`, `totalSpentAmount`, `emailMarketingConsent`,
`emailMarketingCanReceive`, `subscriptionStatus`, `tags`, `systemSource`, `lastActive`.

Campaigns are **draft-only over the API** — publishing and scheduling happen in the app. No
segments endpoint exists (`/segments`, `/audiences`, `/lists`, `/flows`, `/events`,
`/automations` all 404), so a campaign's `recipients.segmentIds` has to come from a segment
built in the UI.

**UI segment builder confirmed working (2026-09-21).** Conditions are plain-English rows
("Email Marketing Consent equals Subscribed" AND "Last Purchase less than 90 days ago") with
and/or groups. Tick **"Posts can target this segment as receivers"** or a campaign can't use it.
Built in the UI that segment returned **839** against our API count of 900 — the gap is the UI's
relative "90 days ago" vs our fixed date. UI and API agree; both can be trusted.

**Tracking is NOT yet live.** `lastCartUpdate` is 0 across the whole base and `lastActive` is 1,
so Spoks currently sees no on-site behaviour — only order history imported from Shopify.
Abandoned-checkout and browse-abandonment flows have nothing to fire on until the Web/Embed
script is installed on the theme. Install, wait a day, re-run those two counts to confirm.

## The list (2026-09-21)

| Segment | Contacts |
|---|---|
| All contacts | 20,678 |
| Email-subscribed | 10,395 |
| — subscribed, has purchased | 8,278 |
| — subscribed, never purchased | 2,117 |
| Never purchased (any consent) | 3,983 |

Note: an earlier guess of "~6,000 subscribers who never bought" was wrong. It came from
subtracting a trailing-12-month buyer count from the list size; most subscribers have bought at
*some* point. The real never-purchased pool is 2,117.

## SEND PLAN — start here when you come back

**Campaign 1 is built and ready.** Draft `ad5a30f4-b380-4b2e-8f58-75a0ac50c812` —
`https://app.spoks.com/brookfieldcomfort/post/ad5a30f4-b380-4b2e-8f58-75a0ac50c812/edit`
Subject "It's that time of year", preview "The slippers are back in.", personalised, GBP signs
verified, unsubscribe auto-appended.

### Before send 1
1. Trading address into the **workspace** footer (Settings > Email & SMS), not the campaign.
2. Attach the segment; confirm **"Posts can target this segment as receivers"** is ticked.
3. Test send to yourself — check the `£` renders and the merge field fills.
4. Upgrade to the paid plan (sending is blocked on free at 20,678 contacts).

### THE ONE RULE: send to BANDS, not cumulative segments

"Last purchase within 60 days" **contains** the 28-day people. Climbing with cumulative
segments re-sends the same email to the same people every step. Build each rung as a band —
"last purchase MORE than X ago AND LESS than Y ago" — so nobody gets it twice.

### The ladder (counts as at 2026-09-21)

| # | Band: last purchase | Contacts | Notes |
|---|---|---|---|
| 1 | 0-28 days | **79** | Plumbing test. Read opens only; clicks/orders are noise at this size |
| 2 | 28-60 days | 279 | |
| 3 | 60-90 days | 497 | |
| 4 | 90 days - 6 months | 817 | |
| 5 | 6-12 months | 392 | |
| 6 | 12-24 months | 2,044 | First genuinely cold rung — watch bounces |
| 7 | 24-36 months | 3,108 | Biggest single jump; split in two if bounces creep |
| 8 | 36-48 months | 947 | |
| 9 | 48 months+ and never-purchased | 2,232 | Of which **2,104 have never purchased** — see below |

Total reachable 10,395. Roughly 3-4 days between sends; 2 a week is plenty. The whole ladder is
about 4-5 weeks, which lands the list warm in early November — in time for Christmas and well
before sandal season.

### Gates — check after every send before climbing

- Bounce **< 2%** · complaints **< 0.1%** · unsubscribes **< 0.5%**
- If any is breached: **hold at that rung**, do not climb. Re-send to the next band only once
  a send comes back inside the gates.
- Bounce risk rises as the bands get older (dead mailboxes, not consent). Rungs 6-9 are where
  it shows up.

### Band 9 needs different copy

The 2,104 never-purchased are not lapsed customers — they subscribed and never bought. The
"Thanks for your order" opening is wrong for them and will read as a mistake. Write a separate
version before sending that rung. This is also the segment the Klaviyo programme deliberately
suppressed, so it has never been mailed — treat the result as new information, not a repeat.

### After the ladder

Winter result decides the next move. If the slippers convert, winter is a real season and worth
a second campaign. If not, nothing is lost — the list is warm, flows are running, and we arrive
at February able to send at full volume from day one, which was always the bigger prize.

## Segment reference — cumulative counts (2026-09-21)

Source numbers the bands above were derived from. These are **cumulative** ("within N"), so
subtract adjacent rows to get a band. Build segments by changing the "Last Purchase within N"
condition — do NOT export to Excel, cut, and re-import (duplicates, and it resets consent
timestamps).

| Subscribed + bought within | Contacts |
|---|---|
| 28 days | 79 |
| 30 days | 91 |
| 60 days | 358 |
| 90 days | 855 |
| 6 months | 1,672 |
| 12 months | 2,064 |
| 24 months | 4,108 |
| 36 months | 7,216 |
| 48 months | 8,163 |
| all subscribed | 10,395 |
| — of which never purchased | 2,104 |

Warmest first is deliberate: recent buyers have live addresses, so early sends are naturally
clean and bounce risk concentrates at the bottom rungs.

**Suppression:** Klaviyo's list is not being imported (owner's call — consent came across from
Shopify, and anyone unwanted was already unsubscribed). Note this covers unsubscribes but not
**hard bounces**, which are not a consent signal: addresses valid in 2022 die by 2026. The
ladder is the mitigation — watch bounce rate and stop climbing rather than pre-cleaning.

## Stock the list could be pointed at (2026-09-21)

| | Styles | Units | Retail value |
|---|---|---|---|
| No Shopify sales in 30d | 121 | 741 | GBP 43,336 |
| Selling | 86 | 1,507 | GBP 106,602 |

## What the Klaviyo year taught us

13 orders / GBP 858 over 12 months. Flows (abandoned checkout, browse abandonment) were 11
orders / GBP 748; eight manual campaigns were 2 orders / GBP 110.

- **Flows worked, campaigns did not.** Flows catch live intent. Rebuild those first.
- Campaigns targeted lapsed Birkenstock repurchasers (~500 people) and suppressed everyone who
  had never bought. Birkenstock has a multi-year replacement cycle, so the 8.3% repeat rate is
  closer to a ceiling than a fault.
- Design learnings that still hold: short curious subject, personal tone, 1-2 hero products,
  always set preview text, real product shots on white.
- Campaign 3 (designed 2026-04-10, never logged) had **no unsubscribe link and no postal
  address** — a PECR requirement both earlier designs met. Check what actually sent.
- Blanket "20% off" messaging fights the business: it discounts styles that sell fine at full
  price and trains the list to wait. Discount the stuck stock, not the catalogue.

## Strategy

**Winter is the rehearsal; summer is the event.** ~95% of Shopify is Birkenstock and the year is
won in sandal season. Warming takes 4-6 weeks, so starting in April means still climbing the
ladder at peak. Warming now on winter stock means arriving at February with a warm domain,
working flows, proven segments and real benchmarks. The winter campaign pays either way: if it
converts, that is a season we did not know we had; if it does not, we are warmed regardless.

**Campaign one (drafted, not built): Birkenstock Zermatt slippers.** ~250 pairs in stock across
shearling felt and cork latex, GBP 55-81 against GBP 60-90 RRP, full size runs, and just
starting to move. Full margin, no discount.

Angle: most people do not know Birkenstock make slippers. Same cork footbed as the sandals they
already bought, different season. This is a **first purchase in a new category, not a repeat
purchase** — which is the whole reason it sidesteps the multi-year replacement cycle that sank
the Klaviyo campaigns.

**What NOT to send:** a sandal clearance. The 121 "no 30d sales" styles look dead but sold 25-30
units each over 90 days — it is 21 September and sandal season just ended. That is seasonal
residue, not failure, and discounting it now gives away stock that sells at full price in May.

## Open questions

1. Install the Web/Embed tracking script, then confirm `lastCartUpdate` / `lastActive` populate.
   Flows are blocked until they do.
2. Did Campaign 3 actually send? Its design had no unsubscribe link or postal address.
3. Export the Klaviyo campaign history before that account lapses — it is the only record.
4. Is the bcweb piece a full module (screen + routes) or just a place to generate audiences?
   Undecided. Do not start building until it is.
