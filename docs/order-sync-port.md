# Order Sync — `update_orders.py` → BCWEB

**Status: BUILT 2026-07-28.** Not committed, not click-tested, no live run made.

> ## ⚠️ Two implementations, both live
>
> | | Where | Trigger |
> |---|---|---|
> | 1 | `C:\bcweb\bcweb-server\utils\orderSync.js` | **Update orders** button, Analytics → Sales + Customer Orders (`POST /order-sync`) |
> | 2 | `C:\scripts\orders\update_orders.py` | cron — `C:\scripts\crontab.txt` (09:00, 12:00, 13:00/13:30/13:45, 14:00/14:10, 21:00) |
>
> **The cron was deliberately NOT switched off** (owner's decision, 2026-07-28). The button is a
> "do it now", not a replacement. Both write `orderstatus`, `orderstatus_archive`, `sales` and
> `localstock`, and are expected to produce the same outcome.
>
> The profit formula is duplicated a second time: `utils/shopifyProfit.js` ↔ `shopify_profit()`.
>
> The failure mode to fear is not a crash. It is a change made in one place and not the other,
> producing a database where some rows followed one set of rules and some followed the other, with
> nothing recording which. That has already happened once, on the Amazon side, with `sales.profit`
> (see `update-amazon-port.md`, "Running alongside PowerBuilder").

---

## 1. What the pipeline does

Six phases, one transaction. The Python commits once at the very end; the port wraps the lot in
`withTransaction`, so in both systems a run lands completely or not at all.

| # | Phase | Writes |
|---|---|---|
| **A** | **Sync** — Shopify unfulfilled orders → `orderstatus` | insert new / refresh delivery details on existing |
| **B** | **Sales** — each *newly inserted* row | `sales`, channel `SHP` |
| **C** | **Archive** — `channel='SHOPIFY'` rows no longer in Shopify | `orderstatus_archive` + delete |
| **D** | **Picks GC** — only if C archived something | `localstock` delete |
| **E** | **Allocate** — picks against free stock, then AMZ / UKD / other-supplier fallbacks | `localstock`, `orderstatus` |
| **F** | **Cleanup** — six housekeeping statements | `orderstatus`, `localstock` |

### A — order sync

- `GET /admin/api/2024-01/orders.json?fulfillment_status=unfulfilled&status=open&limit=250`
- Accepted only when `financial_status ∈ {paid, partially_refunded}`, `fulfillment_status ∈ {unfulfilled, null}`,
  `cancel_reason = null`. `partially_refunded` matters — it is what an order becomes when the shipping is
  refunded, and it still has to be picked and posted. Filtering it server-side in the query would drop real work,
  which is why both systems fetch wide and filter in code.
- `courier = '4'` when the shipping charge is exactly `5.95`, else `'5'`. **Decided at insert only** — see the
  re-sync note below.
- `supplier` = `skumap.code → groupid → skusummary.supplier` (first non-blank), `''` when unknown.
- Existing row (PK is `(ordernum, shopifysku)`) → **UPDATE** `shippingname, postcode, address1, address2,
  company, city, county, country, phone, shippingnotes, email, last_seen`.
- New row → **INSERT** all 44 columns with the constants below.

**Re-sync overwrites the delivery details.** Every field in that UPDATE list is rewritten from the live Shopify
order on every run, so the owner's workflow — *change the address in Shopify, press Sync* — lands immediately,
at whatever stage the order has reached locally.

**Deliberately NOT refreshed** (same as the Python): `qty`, `title`, `supplier`, `createddate`, `shippingcost`,
and **`courier`**. Courier is derived from the shipping charge at insert, so changing the *delivery method* in
Shopify after the fact will not move it. That is one line away from changing if it ever matters.

#### The constants, and the one that looks like a mistake

```
batch '0'   orderdate ''   ukd/localstock/amz/othersupplier 0   fnsku ''   weight ''   pickedqty 0
courierfixed 0   customerwaiting 0   notorderamz NULL   alloworder NULL   searchalt ''
channel 'SHOPIFY'   picknotfound NULL   fbaordered NULL   notes ''   shopcustomer 0
shippingcost ''  <- ALWAYS. See below.
ordertype 1   ponumber ''   createddate <created_at date>   arrived 0   arriveddate NULL
```

**`shippingcost` is always the empty string, and the port reproduces that.** `safe()` tests
`isinstance(value, str)`, and the caller passes a float — so the value never survives. Live DB agrees: 13 of 13
`ordertype=1` rows are `''`. Fixing it on the BCWEB side alone would make bcweb-written rows differ from
cron-written ones for the benefit of nobody, so it is reproduced and commented instead.

#### Timestamps

Shopify sends `2026-07-28T08:37:48+01:00` — an instant *with* the shop's offset. Python's
`fromisoformat(...).strftime(...)` keeps the tzinfo and prints the local fields; it never converts. So the
correct port is a **literal field read**, not `new Date(...)` (which would convert to the server's zone and
shift every stamp by an hour for half the year). Confirmed against live row `BC18626`: arrived `+01:00`, stored
`20260728 08:37:48`.

### B — the sale row

Booked only when phase A actually inserted a new `orderstatus` row. That is the whole dedupe mechanism, and it
is why a re-synced order does not double-book.

- No `groupid` in `skumap` → **no sale row**, order still recorded. (Faithful: never invent a groupid.)
- `soldprice` is the **per-unit** price; `profit` is per-unit too.
- `paytype` = `payment_gateway_names` joined, or `'UNKNOWN'`, truncated to **20** — the Python's limit, though
  the column holds 100. Kept so both write identical values.
- `channel='SHP'`, `collectedvat=NULL`, `discount=0`.

#### The profit formula — now, finally, in the codebase

```
VAT      = sold / 6                       UK VAT is 1/6 of a VAT-inclusive price
Gross    = sold - VAT - cost
Expenses = (0.30 + 0.029 x sold) + 1.00 packing + 3.44 Royal Mail
Profit   = (Gross - Expenses) / 1.2       flat "cover refunds" haircut
```

`NULL` when cost is missing or unparseable — never a wrong figure. (`skusummary.cost` is a legacy VARCHAR.)

**This formula existed nowhere in bcweb before this port.** `CLAUDE.md` and the Python's own docstring both
pointed at `bcweb-server/utils/profit.js` and `docs/profit-model.md`; **neither file had ever been written.**
`utils/shopifyProfit.js` is that reference, made real, and the Python docstring now points at it.

**The `/1.2` stays.** Shopify returns are not booked as reversal rows the way Amazon's are, so on this channel
the haircut is the *only* place return cost is modelled at all. Removing it would overstate what a Shopify sale
keeps with nothing picking up the slack. (`update-amazon-port.md` §2.11 is the long, measured version of this
argument on the other channel.)

### C — archive, and why it is the dangerous phase

"No longer in Shopify" is decided by **absence from the fetched list**. Scoped to `channel='SHOPIFY'`, which is
what keeps the Order Status module's rows (`channel='MANUAL'`) out of reach.

`archivedate` is set from `last_seen`, not from `now()`. That is what the Python's `INSERT ... SELECT *` does
positionally — `orderstatus.last_seen` is column 45, `orderstatus_archive.archivedate` is column 45 — so the
column has always held "when this order was last seen in Shopify" for cron-archived rows. Kept identical, but
written with an **explicit column list** so adding a column to either table can never silently shift the
mapping. (Note `routes/order-status-archive.js` writes `CURRENT_DATE` into the same column for supplier orders,
so it already carries two meanings. That predates this port.)

### E — pick allocation

Candidates: `ordertype NOT IN (3,5)`, batch not `-1`, none of `amz / localstock / ukd / othersupplier` set, and
`orderdate` not containing "do not order". Then per line:

1. already-allocated ≥ qty → stamp `orderdate = created`, `localstock = <already>`, done
2. free shelf stock (`ordernum='#FREE'`, `allocated='unallocated'`, `deleted=0`, **`ORDER BY location, id`**) →
   take one unit at a time; a row holding >1 splits (one unit to the order, remainder to a new `#FREE` row);
   the loop **re-reads each iteration** so the split row is visible
3. nothing on the shelf → `amzfeed.amzlive` → set `amz`; else supplier `ukd` → `ukdstock.stock` → set `ukd`
   (or `ukd = needed` to trigger ordering); else → `othersupplier = needed`. None of these stamp `orderdate`.
4. any picks taken → `orderdate = created`, `localstock = total` — **even on a partial allocation.** That is
   deliberate in the original: the stamp is what stops the line being picked again. The port surfaces the
   partial as an operator-visible warning instead of burying it in a log file.

The split id is `digits(ordernum) + random(100..999)` — order `BC18624` produces `18624325`. The live table is
full of them (`18624325`, `18620407`, `18618629`, `18597877`), which is how we know this path runs and works.
`localstock.id` is a VARCHAR primary key with no sequence.

### F — cleanup

```sql
DELETE FROM localstock  WHERE deleted = 1;
DELETE FROM orderstatus WHERE batch = '-1';
DELETE FROM orderstatus WHERE ordertype <> 1 AND createddate < NOW() - INTERVAL '30 days';
DELETE FROM orderstatus WHERE ordertype = 3 AND arrived = 1 AND arriveddate < CURRENT_DATE - INTERVAL '7 days';
DELETE FROM localstock  WHERE qty = 0 AND ordernum = '#FREE';
UPDATE localstock SET allocated = 'amz' WHERE location = 'C3-Amazon' AND allocated = 'unallocated';
```

## 2. Cross-module hazards (pre-existing, not introduced here)

**Phase E can reach Order Status rows.** `ordertype NOT IN (3,5)` includes the module's local rows
(`ordertype = 2`). They are excluded in practice *only* because `routes/order-status-add.js` always sets
`ukd = 1` or `othersupplier = 1`, and the candidate filter requires both to be 0. That is load-bearing: a route
that ever inserts an `ordertype=2` row with both flags at 0 would have local stock allocated against a supplier
order and its `orderdate` stamped — flipping it from TO PLACE to ON ORDER behind the operator's back.

**Phase F deletes Order Status rows without archiving them.** The 30-day line takes `ordertype 2` and `3` with
it, so ON ORDER cards silently disappear at 30 days. Existing behaviour; worth knowing it lives here and not in
the Order Status module.

**Phase F's last line is an Inventory concern.** Re-flagging the `C3-Amazon` shelf to `allocated='amz'` is what
keeps FBA stock out of the pick pool.

## 3. Bugs found in the live data

| | Finding | Evidence | Fixed in the port? |
|---|---|---|---|
| 1 | **38 duplicate Shopify sale rows.** Archive → Shopify hands the order back → phase A sees no row, inserts one, re-books the sale. Inflates Analytics revenue and profit. | `BC17908 / 0129443-ARIZONA-39`, `BC17909`, `BC17910`, `BC17933`, `BC15975`, … identical price and minute, ids ~65 apart | **Yes** |
| 2 | **No pagination.** `limit=250`, no `Link` follow. Past 250 open unfulfilled orders the fetch truncates — and phase C then archives every order it never saw. | code | **Yes** |
| 3 | **`batch::int` raises** on a blank or non-numeric batch, unwinding the whole run with only "Unexpected error" logged. | code | **Yes** |
| 4 | **Split-id collision.** Random id against a PK, no guard; one clash is a unique violation that rolls back all six phases. | code | **Yes** |
| 5 | **Same SKU on two lines of one order** → the second line's quantity and sale row are dropped (PK is `(ordernum, shopifysku)`). | code, 0 live occurrences | **Yes** |

### How each is fixed

1. Before inserting, check `sales` directly for a positive-qty `SHP` row on the same `(ordernum, code)` — the
   same guard shape the Amazon importer uses. It holds whichever system booked the original, which
   `source_key` would not (the Python writes NULL source keys). Served by `idx_sales_channel_ordernum_code`.
2. Follow `Link: rel="next"` to completion, with a 20-page ceiling. If the fetch is ever truncated,
   **phase C is skipped entirely** rather than run on partial data, and the screen says so.
3. `TRIM(batch) !~ '^-0*1$'` — a batch that isn't a plain integer is treated as "not -1" (which is what every
   real value except `-1` resolves to anyway). Fail-soft instead of run-ending.
4. Check for the id before inserting and retry, widening the random suffix if the 900-value space is exhausted.
   Same id shape, no run-ending failure.
5. Line items are folded by SKU first and the **quantities sum**. Price and title come from the first line of a
   group — two lines of one SKU at different unit prices would record the first price against the combined
   quantity, which needs a line-level discount on one of two identical lines and is still strictly better than
   dropping the line.

## 4. Concurrency

`runFullSync` takes `pg_advisory_xact_lock(hashtext('bcweb_order_sync'))`, so two operators or a double-click
serialise.

**It only serialises bcweb against bcweb.** The cron takes no such lock. The inserts are safe either way (both
guard on the `orderstatus` primary key, so neither can double-insert an order or its sale), but two overlapping
phase-C runs could each archive rows the other had just inserted. The window is seconds. Adding the same
one-line advisory lock to `update_orders.py` would close it completely:

```python
cursor.execute("SELECT pg_advisory_xact_lock(hashtext('bcweb_order_sync'))")
```

Not done — it changes the cron's behaviour, which was outside the scope of "add a note".

## 5. Deliberately not ported

- **The pick-list CSVs** (`logs/picklist_archive/*.csv`). Nothing in either repo reads them — I checked the
  whole `C:\scripts` tree — and the API server owning a filesystem path outside its own repo is a liability.
  Owner's decision: drop them. The `bclog` audit row records how many picks a run allocated; the per-line
  detail (partial picks, unmatched SKUs, nothing in stock anywhere) is returned to the screen instead.
- **`get_current_datetime()`** — defined in the Python, never called.
- **`ENABLE_DELETION` / `DELETION_DAYS_THRESHOLD`** — declared, never referenced.
- **The `--picks` flag.** The button always runs the full pipeline (owner's choice). Pick-only stays a
  Python-side affordance.

## 6. Files

| File | What it is |
|---|---|
| `bcweb-server/utils/orderSync.js` | ★ The business logic. Six phases, each taking a `client` so the whole thing is rehearsable inside `BEGIN … ROLLBACK`. Carries the dual-implementation banner. |
| `bcweb-server/utils/shopifyProfit.js` | The Shopify P&L formula. Single source of truth on this side. |
| `bcweb-server/utils/shopifyOrders.js` | Shopify Orders REST read + pagination. Separate from `utils/shopify.js`: different token, different API, different direction. |
| `bcweb-server/routes/order-sync.js` | `POST` — fetch outside the transaction, six phases inside one, `bclog` audit row. |
| `bcweb-server/routes/order-sync-last.js` | `GET` — when the button was last pressed. |
| `bcweb-server/config/config.js` | `shopify.ordersAccessToken`, `shopify.ordersApiVersion`. |
| `bcweb-web/src/lib/api.ts` | `runOrderSync()`, `getOrderSyncLast()`. |
| `bcweb-web/src/app/analytics/sales/page.tsx` | The button, in the existing filter row. |

### Config — one new environment variable

```
SHOPIFY_ORDERS_ACCESS_TOKEN=<the read_orders token>
SHOPIFY_ORDERS_API_VERSION=2024-01     # optional; this is the default
```

`SHOPIFY_ORDERS_ACCESS_TOKEN` is a **different token** from `SHOPIFY_ACCESS_TOKEN` — verified by comparing
hashes of both values in `C:\scripts\.env`. Reading orders needs `read_orders`; the product push needs
`write_products`. They are not interchangeable, and sending the wrong one returns a 401 that
`utils/shopifyOrders.js` translates into a message naming the variable.

The API version is pinned to the exact REST version the Python calls. Two parallel implementations must see the
same payload shape; a field renamed between versions would silently diverge them. Bump it only when the Python
bumps too.

## 7. The screen

The button sits at the right-hand end of the **existing** channel · window filter row on Analytics → Sales —
no new row, nothing added to the layout when idle:

```
[ All | Shopify | Amazon ]   [Today|Yesterday|3 days] · [7d|30d|90d] totals        ⟳ Sync orders · 2h ago
```

- The result of a run appears as a single chip beside it (`+3 orders · +3 sales · 3 picks`, or
  `Up to date — nothing to do`).
- Failures go to the error banner the page already has, so a failed sync never blanks a ledger that loaded fine.
- On success the sales query refreshes, so the new lines appear underneath.
- "· 2h ago" reads the `bclog` row. **It only ever reflects bcweb runs** — the cron writes no audit row, so it
  means "last time somebody pressed the button", not "last time the pipeline ran". Adding a `bclog` write to
  the Python is the way to make it mean both.

## 8. Before the first live run

1. Add `SHOPIFY_ORDERS_ACCESS_TOKEN` to `bcweb-server/.env` **and to the VPS `.env`**.
2. Restart the API so the two routes register.
3. **Rehearse against the live DB inside `BEGIN … ROLLBACK`** before allowing a commit — every phase function
   takes an explicit `client` precisely so this is possible. Check: orders inserted, sales booked, nothing
   unexpected archived, picks allocated against the shelves you'd expect.
4. Then a real press, at a quiet moment, and compare the next cron run's log — it should find nothing to do.
