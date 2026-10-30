# eBay clearance — process notes

Started 2026-10-30. **Status: manual trial.** Nothing in BCWEB talks to eBay yet. This file records what works, so the
process can be repeated by hand now and built into BCWEB later.

## Why

Our flow is *find products → scale winners → drop the rubbish*. Dropping the rubbish is the part that doesn't get done.
eBay is a way out for dud non-Birkenstock stock that is cheaper and quicker than job lots, and once it's set up it needs
little effort per pair. It could become a regular sales channel for end-of-line stock.

## Rules

- **No Birkenstock on eBay.** Birkenstock's distribution rules and eBay's VeRO programme rule it out. Birkenstock
  leftovers go in the £5/pair job lots (see Slow movers → Clearance).
- **Other brands:** check the brand's supplier terms and eBay's VeRO list before listing it for the first time.
- **No links to our website**, and nothing in a listing that asks buyers to contact us or buy off eBay (eBay policy).
  Our photos are hosted on images.brookfieldcomfort.com, which is allowed because eBay copies them.
- **Clearance price, not margin.** Selling at a loss is accepted: the money has already gone, and the job is to clear
  the shelf.
- **Returns:** accepted within 30 days. In practice we refund and let the buyer keep the pair.
- **Stock is NOT synced.** These pairs stay live on Shopify too. When one sells on eBay, take the pair off in BCWEB the
  same day, or Shopify can sell it a second time.

## Fixed price or auction

| | Fixed price | Auction |
|---|---|---|
| Duration | Good 'Til Cancelled only. eBay has made GTC mandatory for fixed price since 2019; it renews monthly (~£0.36) until sold or ended | 1–10 days (we use 7); ends by itself |
| Postage | **Free**, built into the price. Buyers filter on it, and the fee is the same either way because eBay charges on item + postage | **Charged** (£4.50). With free postage a 99p win would cost us money |
| Price | Our price | Start price = the lowest we'll accept. No reserve (reserves cost extra) |
| Use for | Sizes with more than 1 pair (an auction sells only one); pairs worth a fair price | Single pairs; "just get rid" |

Review GTC listings before their monthly renewal: end them, cut the price, or let them run.

## Standard listing content

- **Title (≤ 80 chars):** our Shopify title plus the size, e.g. `Mens Goor Brogue Oxford Lace Up Shoes Black UK 10`.
- **Description:** Shopify description (`shopify_description.description`), then "Brand new in box. Size UK x", then:

  > **End of line clearance** — Genuine, brand new and boxed. This is surplus stock from a UK footwear retailer,
  > cleared at a fraction of the usual price. Only the size shown is available, and once it has gone it will not be
  > restocked. Sent within 2 working days by Royal Mail Tracked 48. Returns are accepted within 30 days.

- **Photos:** `https://images.brookfieldcomfort.com/<product_images.filename>`, in `position` order, up to 12,
  `|`-separated in `PicURL`.
- **Condition:** `1000` (New with box). **CustomLabel:** our code (`M014A-10`), so results files and orders map
  back to `skumap`.

## Bulk upload (how it's done today)

1. **Seller Hub → Reports → Uploads → download a category template** (max 5 categories per template). Categories so far:
   `53120` Men's formal shoes, `24087` Men's casual shoes, `57929` Boys' shoes, `45333` Women's flats. The template's
   `Info` rows list each category's required item specifics (Brand, UK Shoe Size, Colour, Style, Upper Material,
   Department, Type).
2. Fill one row per listing.
3. **Upload a copy with Action = `VerifyAdd` first.** eBay checks every row and reports fees and errors but **lists
   nothing**. Download the results file from the Uploads page.
4. When it's clean (warnings are fine), upload the same rows with Action = `Add`. The results file gives each
   listing's `ItemID` (`https://www.ebay.co.uk/itm/<ItemID>`).

### Field values that work (tested 2026-10-30)

| Column | Value | Note |
|---|---|---|
| `ShippingType` | `Flat` | |
| `ShippingService-1:Option` | `UK_RoyalMailTracked` | = Tracked 48 (`UK_RoyalMailNextDay` = Tracked 24). **`UK_RoyalMailTracked48` is not a code** and fails with "Item.ShippingDetails invalid". Codes: eBay `ShippingServiceCodeType` docs |
| `ShippingService-1:Cost` | `0.00` free / `4.50` | |
| `ShippingProfileName` | leave blank | The account is opted into business policies, but "Standard" was rejected as a postage policy. Inline postage works with a warning, and eBay creates policies automatically |
| `ReturnsAcceptedOption` / `ReturnsWithinOption` / `ShippingCostPaidByOption` | `ReturnsAccepted` / `Days_30` / `Buyer` | `Days_14` is not accepted in every category. Leave `RefundOption` blank (eBay UK: "not valid on this site") |
| `*Format` / `*Duration` | `FixedPrice` / `GTC`, or `Auction` / `7` | |
| `*Location` | `Welshpool, SY21 7SB` | |
| `*DispatchTimeMax` | `2` | |

Expected warnings, all harmless: "Seller has opted into business policies…" and "Funds may be on hold…" (the account
hasn't sold for a while).

Fees seen: insertion **£0.36** per listing (some free), plus eBay's final value fee when it sells.

## Checking listings

- **Seller Hub → Listings → Active** (fixed price), **All auctions**, **Unsold and not relisted**.
- **Orders → Awaiting postage**: what to pick and send. Note the CustomLabel (our code) and the shelf.
- Results files from each upload give ItemIDs.

## First run (2026-10-30)

10 non-Birkenstock pairs from `clearance-picklist.csv` (unsold for 9 months):

All 10 listed on 2026-10-30 (insertion £0.36 each). Auctions end **6 Nov 13:12**. GTC listings renew **30 Nov**.

| Code | Pair | Format | Price | Qty | eBay item |
|---|---|---|---|---|---|
| `M014A-10` | Goor Brogue UK 10 | Fixed, free postage | £11.99 | 1 | 287691986997 |
| `M710AP-08` | Goor Patent Tuxedo UK 8 | Fixed, free postage | £11.99 | 3 | 287692018070 |
| `B710AP-11` | Boys Goor Patent UK 11 | Fixed, free postage | £9.99 | 4 | 287692018073 |
| `XM620A-09` | Grafters Capped Oxford UK 9 | Fixed, free postage | £11.99 | 1 | 287692018071 |
| `14621-00-41` | Rieker Black EU 41 | 7-day auction +£4.50 | from £9.99 | 1 | 287692018067 |
| `14621-24-42` | Rieker Brown EU 42 | 7-day auction +£4.50 | from £9.99 | 1 | 287692018069 |
| `M620A-09` | Scimitar Capped Oxford UK 9 | 7-day auction +£4.50 | from £4.99 | 1 | 287692018072 |
| `M404A-12` | Roamers Touch Fastening UK 12 | 7-day auction +£4.50 | from £4.99 | 1 | 287692018077 |
| `M196A-12` | Roamers Extra Wide UK 12 | 7-day auction +£4.50 | from £4.99 | 1 | 287692018075 |
| `FLN002-NATASHA-05` | Lunar Natasha UK 5 | 7-day auction +£4.50 | from £4.99 | 1 | 287692018076 |
- Scimitar (auction) vs Grafters (fixed) is a deliberate head-to-head: the same capped Oxford shoe in the same size.

## Path into BCWEB (later, only if the trial sells)

1. **eBay upload file button**: like the Amazon upload file (`components/AmazonExport`), from Slow movers / New
   Additions. Tick styles → choose sizes, fixed price or auction, and prices → download the eBay CSV built from the rules
   above. No eBay account link and no new secrets. A sale is still taken off stock by hand.
2. **eBay API** (needs an eBay developer account, OAuth user token, new `.env` vars):
   - *Listing:* Sell **Inventory API** (inventory item → offer → publish), or the older Trading API (`AddItem`), which
     takes the same fields as the CSV.
   - *Orders:* Sell **Fulfillment API** `getOrders`. Book eBay sales into `sales` as their own channel (not `SHP`) and
     take the pair out of `localstock`, the way order sync does for Shopify. This is what removes the hand step and the
     double-sell risk.
   - *Checking listings:* the Inventory / Trading APIs return status, views and watchers per listing, which BCWEB could
     show as an eBay list screen with an "end listing" button.
   - Add an `ebay_listing` table (code, item id, format, price, listed_at, ended_at) so BCWEB knows what is on eBay.

The Shopify **Marketplace Connect** app was tried and uninstalled on 2026-10-30: re-authorise did nothing, and recent
reviews reported prices and stock syncing wrongly. Don't go back to it without a reason.
