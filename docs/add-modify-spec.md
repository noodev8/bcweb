# Add / Modify Product — Working Spec (DRAFT)

> Scratch spec + progress log for the "Add / Modify" module. Built in stages; **thrown away when done.**
> References: `docs/current-add-modify.png` (legacy PowerBuilder screen) and `docs/add-modify-save-powerbuilder.txt`
> (the legacy SAVE code — authoritative for how new/updated products are written).

---

## 0. STATUS & NEXT UP  (read this first)

**Where we are:** the *edit an existing product* flow is functionally complete and committed on `main`
(up to commit `0d3d6f7`). You can search a groupid, load it master-detail, and edit + save the header
attributes, the title (with Generate), and the full size list. **New-product creation** has a start-simple
cut in progress (see Next up #1): searching a groupid that doesn't exist offers a create form that writes
the header basics (`skusummary`+`title`+`attributes`) via `POST /product-create`; sizes are added afterwards.

**Deploy (reminder, no action now):** web (Vercel) and server (VPS/PM2) deploy separately — when you do
deploy, the server step is manual (`docs/deploy.txt`), so don't ship the front end without it or the new
endpoints will 404 in production.

**Done since the edit flow:** new-product creation *(start cut)* — `POST /product-create` inserts the header basics for a brand-new
groupid (`skusummary`+`title`+`attributes`, legacy defaults, generated unique `handle`); the `/products` "no match → create" empty
state is a create form. Price edit *(start cut)* — `POST /product-price` (Cost/RRP/Tax + base `shopifyprice`; see #below and the Price
edit note in the Stage log). Title placeholders (`<…>`) are rejected on all title saves.

**Next up (not built), in suggested order:**
1. **Finish new-product creation:** the required-field rules the PB save enforces (brand/colour/producttype/gender/season, ≥1 size).
   (Sizes can now be generated in the editor via the brand/gender template — optionally auto-offer it right after create.)
2. **Shopify on/off toggle** (Winner block) → `skusummary.shopify` — AND the unpriced-product guard (block enabling Shopify when the
   live price ≤ 0; see open decisions). Win/Lose flag lives here too.
3. **Price edit — remaining:** min/max shopify price (`maxshopifyprice='RRP'` convention), and the direct Shopify API push (the deferred
   "address when ready" piece — `product-price` currently stores the value without pushing).
4. **Remaining legacy controls** (smaller): Copy button (clone to a new groupid); price-change Log view. (Image upload is done — a
   pure "rename the file without re-uploading" op isn't built; changing the title + re-uploading regenerates the name and deletes the old.)
5. **Downstream (later):** Amazon upload file.

**Open decisions to resolve when relevant:**
- **Unpriced new products vs Shopify:** `product-create` seeds price columns to `'0.00'`/`'RRP'` placeholders and sets `shopify=0`
  (OFF), so a new style is safe *until someone turns Shopify on*. The gap: enable Shopify + forget to price → it could sync at 0.00.
  Add a guard where Shopify gets enabled (or at the sync) that blocks a live price ≤ 0. Build alongside the price stage / shopify-on toggle.
- **Title placeholders:** DONE — `product-create` and `product-update` reject a title containing `<` or `>` (`INVALID_TITLE`), so the
  generated `<Any detail>` / `<Narrow/Regular> Fit` placeholders can't be saved. (Client also blocks before the call.)
- **Required-field validation:** the PB save *requires* brand/colour/producttype/gender/rrp/cost/season and
  per-size cost/price. Our edit endpoints are permissive (no required fields). Decide whether to enforce —
  especially important for new-product creation.
- **UK size** — RESTORED end-to-end (needed by the Google Merchant feed). New/edited sizes carry `uksize`; the brand/gender templates
  supply it, it's an editable grid column, and a **manual add derives UK size from the template** by code suffix (blank if off-run).
- New sizes get a blank per-size `shopifyprice` (legacy didn't set it either).

---

## 1. Purpose

Find & edit existing products, and load brand-new products. A "product" = one **groupid** (a style/colour),
with N size variants.

## 2. Data model (confirmed from live DB — `brookfield_prod`)

One product spans four tables, all keyed on `groupid` (title & attributes verified 1:1 on groupid):

| Table | Grain | Columns this screen touches |
|-------|-------|--------------------------------|
| `skusummary` | 1 / product | brand, colour, colourmap, segment, season, width, material, tax, cost, rrp, shopifyprice, minshopifyprice, maxshopifyprice, imagename, shopify (0/1), supplier |
| `skumap` | 1 / size variant | code, optionsize, uksize, ean, cost, amz* prices, deleted, status, fba, supplier, … |
| `title` | 1 / product | shopifytitle, googletitle, googletitleb, last_shopify_sync |
| `attributes` | 1 / product | gender, producttype, tag1..tag10, alt (⚠ junk schema — dozens of stray `information_schema`-style columns; only these are real) |

Lookup tables: `brand` (brand, supplier), `colour` (colour), `producttype` (producttype). Also `category`, `segment_notes`.

**Landmines (in addition to CLAUDE.md):**
- Price/number columns on `skusummary` **and** `skumap` are `character varying` — read via `safeNumeric`, write as 2dp strings.
- `attributes` is a polluted table — only write the real columns, never `SELECT *` / derive schema from it.
- Size code = `groupid` + `-` + EU size (e.g. `0128221-GIZEH-35`). Code is locked (never rewritten on edit).
- `optionsize` = `"<seq+100>--<display>"` (e.g. `101--35 EU / 2.5 UK`). The `<seq>` prefix IS the sort order;
  the save renumbers it by row position. **Confirmed** across all 1994 rows.
- `ean` carries a **trailing `B`** (legacy Excel guard — see memory `ean-trailing-b`): strip for display, re-append on write.
- `updated` stamp format = `YYYYMMDD HH24:MI:SS`, Europe/London wall-clock. New: `skusummary.created_at timestamptz DEFAULT now()`
  (proper date, going forward; existing rows NULL) — see CLAUDE.md.
- **Price lives only in `skusummary`** for our purposes (cost/rrp/shopifyprice). `skumap` still has `cost`/`amz*price` columns and
  `product-sizes` seeds them on new-size insert, but nothing in our app reads them back — legacy Amazon scaffolding, effectively unused.

## 3. Reference values (live DB)

- **brand** lookup (16): Birkenstock, Cipriata, Dek, Free Spirit, Goor, Grafters, Lazy Dogz, Lunar, Mod Comfys, R21, Remonte, Rieker, Roamers, Scimitar, Skechers, Strive
- **colour** lookup (17): Beige, Black, Blue, Brown, Gold, Green, Grey, Navy, Nude, Pink, Purple, Red, Silver, Tan, Taupe, White, Yellow
- **producttype** lookup (5): `<Other>`, Boots, Sandals, Shoes, Trainers
- **segment**: DISTINCT `skusummary.segment` (~29), alphabetical
- **gender** (fixed): Womens, Mens, Unisex · **season** (fixed): Summer, Winter, Any
- Lookup tables can be incomplete vs live data → the UI folds a product's current off-list value into its dropdown.

## 4. Title generation (CONFIRMED — from PB code)

Ported faithfully in `generateTitle` (web). Uses **brand / colour / producttype / gender only** (NOT groupid/segment/season).
Emits editable placeholders `<Any detail>` (the model/detail the user fills in) and, for Birkenstock, `<Narrow/Regular> Fit`.
Rules: Birkenstock → no gender, add the width-fit reminder; non-Birkenstock → prepend gender unless Unisex;
producttype `<Other>` → drop the type. Output normalised to single spaces.
(Earlier guess that the model came from the groupid suffix was **wrong** — it's a manual placeholder.)

## 5. Endpoints built (this module)

- `GET  /product-search?term=` — search `skusummary.groupid` (ILIKE), groupid order, cap 25 + `limited` flag.
- `GET  /product-get?groupid=` — header (skusummary + title + attributes) **+ `sizes[]`** from skumap (2nd fixed query).
- `GET  /product-lookups` — dropdown option lists (brand/colour/producttype tables; distinct segments; fixed gender/season).
- `POST /product-create` — create a brand-new groupid: rejects if it already exists; generates a unique `handle`;
  INSERTs skusummary + title + attributes with legacy defaults (no sizes yet). Same header fields as product-update.
- `POST /product-image` — multipart upload; sharp → 800×800 white-padded JPEG → SFTP to one.com → set `imagename` (+ delete old on rename).
- `POST /product-price` — save price fields on skusummary: cost, rrp, tax, shopifyprice (2dp strings). Enforces cost>0/rrp>0/rrp≥cost;
  Shopify price defaults to rrp if blank. Does NOT set shopifychange or write a price log. `PriceEditor.tsx` on the client.
- `POST /product-update` — atomic save of header attributes + title: skusummary(brand,colour,segment,season) +
  attributes(gender,producttype) + title(shopifytitle), each UPDATE-or-INSERT. Does NOT touch shopifychange/price log.
- `POST /product-sizes` — atomic reconcile of skumap to the submitted list: renumber `optionsize` by position;
  UPDATE existing by code; INSERT new (`code=groupid-<size>`) with legacy scaffold seeded from product cost + RRP;
  HARD DELETE removed codes. Barcode → `ean`+`B`. Validates ≥1 size, non-blank code/display, no dup code/barcode.

Web: `app/products/page.tsx` (master-detail + header edit) and `components/SizeEditor.tsx` (size grid).
Client fns in `lib/api.ts`. Dashboard tile "Add / Modify Product" → `/products`.

## 6. Stage log

- **Stage 1 — Search.** ✅ `product-search` + `/products` search screen + dashboard tile.
- **Stage 2a — Load & display header (read-only).** ✅ `product-get` + master-detail panel + image (next/image).
- **Stage 2b/Edit-1 — Header attributes editable + SAVE.** ✅ Brand/Colour/Product Type/Gender/Segment/Season dropdowns; `product-lookups` + `product-update`.
- **Edit-2 — Title + Generate.** ✅ Title folded into `product-update`; Generate button (PB port); "Title" label; Width/Material removed from UI.
- **Edit-3 — Sizes editable.** ✅ `product-sizes` reconcile + `SizeEditor` (edit barcode/display, add/remove/reorder). Size Display font aligned.
- **Create-1 — New product (basics).** ✅ `product-create` (header INSERT + handle) + create form on the "no match" empty state. Sizes/price come after via existing editors/stages.
- **Price-1 — Price edit.** ✅ `product-price` (cost/rrp/tax/shopifyprice, legacy validation, no shopifychange/log) + `PriceEditor` in the detail panel.
- **Image-1 — Main image upload.** ✅ `POST /product-image` (multipart): sharp converts any jpg/png/webp to a clean 800×800 white-padded
  JPEG, SFTPs it to one.com (`utils/sftp.js`, remoteDir `/webroots/5fc50976` = image root, verified 200), sets `skusummary.imagename`,
  then deletes the previous file (one image per product). SEO filename from title+groupid + a **per-upload version token** (`utils/imageName.js`)
  so every upload is a unique URL — **one.com has a CDN in front, so same-name overwrites would serve stale**; versioning sidesteps it.
  `ImageUploader.tsx` (file-picker, no cropper) in the detail header. New server deps: `sharp`, `multer`, `ssh2-sftp-client`. New `.env`:
  `ONECOM_SFTP_HOST/PORT/USERNAME/PASSWORD/REMOTE_DIR`. Google gets the image via the merchant feed's `image_link` (no separate push).
  Verified end-to-end except the endpoint→SFTP→DB combo on a real product (skipped: the delete-old step would remove a live product's real image). **Prod VPS `.env` still needs the `ONECOM_SFTP_*` keys + password (deploy excludes .env).**
- **Sizes-2 — Auto-fill default sizes + UK size.** ✅ `lib/sizeTemplates.ts` (brand+gender → standard run, PB port). SizeEditor now **auto-fills** the grid from the template when a product has no sizes (no button); user reviews/edits and Saves via `product-sizes`. **`uksize` brought back end-to-end** (`product-get` returns it, `product-sizes` writes it on insert+update, SizeEditor has an editable UK Size column, templates populate it) — it feeds the Google Merchant feed (`scripts/merchant-feed/merchant_feed.py`: `size` = `uksize` minus " UK", `size_system=UK`). `created_at timestamptz` added to skusummary; `product-create` sets it.

All writes verified against a live product via manual `BEGIN..ROLLBACK` (nothing committed), per CLAUDE.md.

## 7. Testing note

Write paths are exercised with a throwaway Node script using the server pool inside `BEGIN..ROLLBACK`
(see how prior stages were tested). HTTP smoke tests use a temp seeded user, deleted afterwards.
The API points at the LIVE prod DB — never commit a test write to a real product.
