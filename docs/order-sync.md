# Update Orders — the order run

**One copy of the logic, two triggers, every channel.** Since 2026-11-01:

| Trigger | Calls |
|---|---|
| The **Update orders** button (Analytics → Sales, Customer Orders, dashboard tile, manifest button) → `POST /order-sync` | `utils/orderSync.js → runOrderSync({ by: <user> })` |
| Cron → `bcweb-server/scripts/order-sync.js` (schedule: `crontab.txt` in the scripts repo — not restated here) | `runOrderSync({ by: 'cron' })` |

Before that, Shopify's cron half was a Python twin (`C:\scripts\orders\update_orders.py`) and eBay had its own
cron script, timed five minutes apart because the Python took no lock. Both were retired. Git history has them,
and the port write-up (`docs/order-sync-port.md`, removed the same day).

## 1. The run

```
1 READ   every channel in utils/orderChannels.js, in parallel, outside any transaction
2 WRITE  one transaction, under pg_advisory_xact_lock(hashtext('bcweb_order_sync')):
           each channel's write()      new orders, sales, refreshed addresses, posted/cancelled archived
           E  allocate picks           ONCE, for every channel's orders
           F  housekeeping             six statements
           bclog row                   section 'Order Sync', workstation = user or 'cron'
```

- **The lock** serialises everything: two people pressing, a double-click, a press during the cron. The second
  run waits a few seconds, then finds nothing to do. No timing gaps are needed in the crontab.
- **Network never holds a transaction.** Every read happens before `BEGIN`.
- **A channel that can't be read is "not checked".** It writes nothing (above all, it archives nothing) and the
  others carry on. It shows in the server log, the bclog row and the response's `channels`, but **not on the
  button** (owner: "Just the total number of orders without confusing the user"). If **no** channel can be read,
  the run returns `NO_CHANNEL_READ` and nothing is written.
- **The button shows one line:** `3 new orders` / `No new orders`, distinct orders new to `orderstatus`, every
  channel together.
- **All or nothing.** If a write fails, the run rolls back, so it's safe to press again.
- **"Last updated"** (`GET /order-sync-last`) reads the latest bclog row, so it covers cron runs too.

## 2. Channels

A channel is one file exporting `channel` (the shape is in the `utils/orderChannels.js` header):
`name`, `isConfigured()`, `setupHint`, `fetch()` (network), `write(client, fetched)` → `{ newOrders, notes, log, detail }`.

| Channel | Read | Write | orderstatus | sales |
|---|---|---|---|---|
| Shopify | `utils/shopifyOrders.js` (REST 2024-01, paginated) | `utils/shopifyOrderSync.js` | `channel 'SHOPIFY'`, ordernum `BC…` | `SHP`, `utils/shopifyProfit.js` |
| eBay | `utils/ebayOrders.js` (Fulfillment API) | `utils/ebayOrderSync.js` | `channel 'EBAY'`, ordernum `EB…` | `EBY`, `utils/ebayProfit.js` |

**A channel's write owns its own rows and nothing else.** That means its orders, its sales (booked once per new
line, plus a duplicate guard on `(channel, ordernum, code)`), and its posted and cancelled orders with their picks.
It archives **only its own `channel` value, and never after a partial read**. Archive-by-absence on a truncated
list would archive live orders. Shopify archives by absence; eBay asks eBay about each order that left the open list
(posted → delete the pick; cancelled → shoe back to `#FREE`, sale rows deleted).

**Adding a channel (e.g. TikTok):**
1. `utils/<name>Orders.js` reads the API.
2. `utils/<name>OrderSync.js` holds the write plus `channel`.
3. Add one line to `CHANNELS` in `utils/orderChannels.js`.
4. Add its `sales.channel` code to the Sales screen.

Pick allocation, housekeeping, the headline, the lock, the button and the cron all pick it up with no further change.

## 3. Shopify's write (phases A–D)

- **A, sync.** Only orders with `financial_status ∈ {paid, partially_refunded}`, unfulfilled and not cancelled are
  taken. They're fetched wide and filtered in code, because `partially_refunded` (postage refunded) still has to be posted.
  - New `(ordernum, sku)` → INSERT with the legacy constants (commented in the file; `shippingcost` is always `''`).
  - Existing → refresh the delivery fields + `last_seen`, so "fix the address in Shopify, press Update orders" works.
  - `courier` is set at insert only: `'4'` when the postage paid is in `NEXT_DAY_POSTAGE`, else `'5'`.
  - Same SKU on two lines → folded, quantities summed.
- **B, sales.** Only for a genuinely new row, plus a check of `sales` itself, so an order archived and handed back
  never books twice. No groupid → no sale (order still written).
- **C, archive.** `channel='SHOPIFY'` rows absent from the read → `orderstatus_archive` (archivedate = `last_seen`).
  **Skipped on a truncated read.**
- **D.** Only after C archives something: delete `BC%` picks whose order has gone.

## 4. Shared phases

- **E, allocate.** Candidates: `ordertype NOT IN (3,5)`, batch not `-1`, no sourcing flag set, not "do not order".
  - Take free shelf stock one unit at a time, `ORDER BY location, id`. A multi-unit row is split; the split id is
    `digits(ordernum)+random`, with a collision retry.
  - Nothing on the shelf → Amazon FBA (`amz`), then UKD (`ukd`), then `othersupplier`.
  - `orderdate` is stamped even on a partial pick, so the line isn't picked twice.
- **F, housekeeping.** Six statements, listed in `cleanup()`.

**Cross-module hazards (long-standing):**
- E reaches Order Status `ordertype 2` rows. They're kept out only because `order-status-add` always sets
  `ukd` or `othersupplier`.
- F deletes `ordertype <> 1` rows older than 30 days without archiving them.
- F's `C3-Amazon` re-flag is what keeps FBA stock out of the pick pool.

## 5. Config

```
SHOPIFY_SHOP, SHOPIFY_ORDERS_ACCESS_TOKEN   # read_orders — NOT the write_products SHOPIFY_ACCESS_TOKEN
SHOPIFY_ORDERS_API_VERSION=2024-01          # optional default
EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_REFRESH_TOKEN   # refresh token QUOTED (contains #); scripts/ebay-token.js mints it
```

## 6. Checking a run

```sql
SELECT created_at AT TIME ZONE 'Europe/London' AS at, workstation, log
  FROM bclog WHERE section = 'Order Sync' ORDER BY created_at DESC LIMIT 10;
```
A row reads like `Order Sync: 2 new orders — Shopify 1 new, 1 sales, 0 archived · eBay 1 new, 1 sales, 0 posted,
0 cancelled · 2 picks`. `eBay not checked` there means eBay couldn't be read on that run. The server log
(`[orderSync] … not checked: <reason>`) or the cron output says why.

**Rehearsal.** Run `runOrderSync` with `COMMIT` swapped for `ROLLBACK` on the pool client. The reads are real,
nothing is kept. That's how this was verified on 2026-11-01: a real read, each channel forced down, all down,
and an injected new order (insert → RM24 courier → SHP sale → pick taken).
