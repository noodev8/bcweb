# Product images — plan (TEMP, 2026-10-13)

Working plan carried between machines. Delete once steps 1–2 ship and the decisions below are recorded in the code headers.

## Why

`utils/shopify.js` productSet sent `files = [main DB image]` on every push (W1 price apply, Add/Modify saves) from 2026-07-09. Shopify
treats `files` as the WHOLE gallery, so every repriced product lost its extra images: 171 of 196 repriced in-stock products were down
to one image (133 Birkenstock). Deleted Shopify media 404s — not recoverable.

**Done 2026-10-13 (deployed to VPS):**
- Push fix (bcweb `22bfd72`): on an edit, push reads the live Shopify gallery and sends it back by media id; a main-image upload replaces
  only slot 0. Nothing deletes images any more.
- `shopifyimages` table DROPPED; `C:\scripts\images\updateimages.py` + Drive creds + cron line removed (scripts `296502e`) — the
  "protection" never protected anything and PowerBuilder products are retired.

Root problem left: our DB knows only the main image (`skusummary.imagename`); the gallery exists only on Shopify. Fix = we own it.

## Decisions (owner, 2026-10-13)

- **BCWEB is the only place images are managed** once the Images panel exists. Safety net: a push NEVER deletes a Shopify image our DB
  doesn't know — it is kept at the end and flagged "added in Shopify" on the Missing Images screen. An image removed only in the
  Shopify UI comes back on the next push (DB wins); remove in BCWEB.
- **2048 px**, square, white padded, JPEG q≈80, **never enlarged** (an 800 source stays 800). One shared processing util for every
  upload: main + gallery, new product + existing. Replaces product-image.js's 800×800.
- **No thumbnails needed** — every BCWEB screen renders via next/image (Vercel optimizer resizes to `sizes`, cached a year,
  `next.config.js minimumCacheTTL`). New screens must use `<Image>` with a small `sizes`, never a plain `<img>` of the original.
- Storage on one.com (existing SFTP, `utils/sftp.js`). ~250–400 KB/image → ~700 MB for the catalogue, ~+400 MB/yr. Shopify copies
  images to its own CDN, so the storefront never loads from one.com.
- **Existing 800 mains are NOT enlarged and NOT required to be replaced.** They stay live on Shopify/Google; a main is replaced at
  2048 only when someone sources new pictures for that product anyway.
- **"Done" for a product = ≥ 2 images** (owner: start with the single-image products; raise to 4 later). Main size is NOT part of
  it — "low-res main" (< 1500 px) is an optional filter on the screen only.
- **SEO naming:** `<existing SEO base from utils/imageName.js>-<view>.jpg`, e.g. `birkenstock-arizona-birko-flor-black-0151181-sole.jpg`;
  alt text "<title> – sole view". The view word is taken from the source filename ONLY if it's on a whitelist (side, sole, top, front,
  back, heel, inside, detail, pair, look, worn, campaign); otherwise a position number (`-2`, `-3`). Keeps Birkenstock's useful view
  words, drops garbage (`Screenshot_2025-…`, uuids). View word stored in its own column.
- **No Birkenstock portal login** → no bulk fetch; staff source images manually, tracked on the Missing Images screen.

## Status 2026-10-13 — steps 1–3 BUILT, committed, NOT yet deployed

- **Migration applied** (owner) and the follow-up applied by Claude: `UNIQUE(filename)` and `UNIQUE(shopify_media_id)` DROPPED — width
  twins share one main file (10 pairs) and Shopify media can be shared across products (M620A/XM620A). Every one.com delete now checks
  `fileInUseElsewhere` first (utils/productGallery.js), which also fixes the old "replace main deletes the twin's picture" bug.
- **Import run** (`--apply`): 294 mains + 279 gallery images in `product_images`, linked to their Shopify media ids. Re-runnable — it
  adopts anything added in the Shopify UI since.
- **Deploy the server, then the web** (Vercel). Until the server deploys, the live site still runs the 2026-10-13 "keep Shopify's media"
  push and uploads at 800.
- Tested on M113BT (R21, unsold since 2025-11): add (3 images, new media id recorded), reorder, price apply 50.00 → 49.99 → 50.00
  (gallery ids unchanged; both test log rows deleted), main replace (old main dropped from Shopify, extras kept), delete. Product left as
  it was except the main now has a new filename (same picture).

## What was built

1. `product_images` (position 1 = main, mirrored in `skusummary.imagename`; writers: product-image, product-copy; product-delete removes
   rows + files). `utils/productImage.js` = processing (2048, never enlarged, JPEG q80, mozjpeg), view whitelist, `isDone` (>= 2 images),
   `isLowResMain` (< 1500). `utils/imageUpload.js` = shared multer, **25MB**. `scripts/import-shopify-galleries.js` = the seed (dry run default).
2. **Missing Images** — Back Office tile → `/images-missing` (`routes/images-missing.js`). Hero = in-stock single-image count; filters
   Single image | All, In stock | Any stock, Low-res main, status, brand, search; non-Birkenstock first, then Birkenstock (no conversion drop seen on Birk after the wipe); New → Winners → Steady → Losers, then stock; "done by" date at one a day. "Added in
   Shopify" appears when Shopify's media count > ours (fix: re-run the import). Rows open Add / Modify with a Back link.
3. **Images strip on Add / Modify** (`components/ProductGallery.tsx`, under the Group ID): add up to 10 at once, move left/right, delete
   (two-click). Routes `product-images`, `-add`, `-delete`, `-move`. The main stays with Replace image.
   **Push** (`utils/shopify.js buildFiles`): our rows → `{id}` when the media is still live, else `originalSource` (one.com URL — BCWEB wins);
   live Shopify media we don't hold → kept at the end, except `dropMediaIds` (what BCWEB just removed/replaced). New media ids are recorded
   from the productSet response (same order as `files`). No rows yet → keep Shopify's media as is.

## Not done

4. Google feed: `additional_image_link` (up to 10) in `C:\scripts\merchant-feed\merchant_feed.py`.
- Raise "done" from 2 to 4 images later: `MIN_IMAGES` in `utils/productImage.js`.

## Useful

- Live single-image audit: `python C:\scripts\seo\find_single_image_groupids.py --csv out.csv`.
- Shopify token can't read the Files library (`read_files` missing) — not needed for this plan.
