'use client';
/*
=======================================================================================================================================
Context: AmzBasketContext  (the Amazon Pricing upload basket)
=======================================================================================================================================
Purpose: Amazon has no live price push — a price change is logged (POST /amz-apply) and only reaches Amazon when the operator uploads ONE
         tab-separated file to Seller Central. This context is that basket: the set of price changes queued during the current sitting.

Why a context (not per-page state): the flow is multi-page (apply on a SKU's detail page, navigate back to the list, apply another). The
provider lives in the module layout (src/app/amz/layout.tsx), above every /amz page, so the basket survives client-side navigation between
them.

DURABLE + TEAM-WIDE, regenerate-anytime (2026-07-12): the basket is no longer only in browser memory — it is a VIEW of "the team's Amazon
price changes in the last 12 hours" (any operator, so whoever is at the desk can upload a colleague's pending change), rebuilt from the
audit log (GET /amz-basket) on mount. So switching the machine off before downloading no longer loses the file: reopen and recent changes
are still there (they were persisted to amz_price_log by every Apply). add() still updates it optimistically on Apply for instant feedback;
a hard refresh re-hydrates from the DB. The basket shows only PENDING changes (uploaded_at IS NULL): downloading the file arms a confirm
step, and pressing "I've uploaded" (POST /amz-mark-uploaded) stamps those rows uploaded team-wide so they leave the basket for good — which
is what tells the operator (and a colleague, and tomorrow-morning-them) the work is done. Confirmation is deliberate, not auto-on-download:
a download may be a preview, and a Seller Central upload can fail after the file is fetched, so nothing clears until a human confirms it went
live. lastUpload surfaces the team's most recent confirmed upload (who/when/how many) so an empty basket reads as "done", not "did anyone
check?". A generous rolling 72h window bounds the pending set as a backstop; the upload confirmation, not the clock, is what normally clears
a row. No delete (that would tamper with the audit log); re-confirming is a harmless no-op since the upload itself is idempotent.

The file is built here, client-side, from the queued rows (each carries its Amazon SKU + RRP), so no extra round-trip is needed — both the
POST /amz-apply response and GET /amz-basket return amz_sku + rrp. What we write per row is unchanged since AMZ_PRICING.md — sku = the
Amazon SKU (amzfeed.sku), NOT our code; min = blank; max = the style's RRP (blank if unknown) — but the file AROUND those values was
rebuilt on 2026-08-28 when Amazon retired the old flat file. See the format block above buildAndDownload() for the shape and, more
importantly, for what to do when Amazon rejects the template version again.
=======================================================================================================================================
*/

import { createContext, useContext, useCallback, useMemo, useState, ReactNode } from 'react';
import { useApiQuery } from '@/lib/useApiQuery';
import { getAmzBasket, markAmzUploaded, AmzLastUpload } from '@/lib/api';

// One queued change. Everything the Seller Central file needs lives on the item (amz_sku, new_price, rrp) so it's built without a fetch.
export interface AmzBasketItem {
  id: number;               // the amz_price_log row id — sent to /amz-mark-uploaded so the server knows which rows the file covered
  code: string;             // our SKU (the map key)
  amz_sku: string;          // the Amazon SKU written to the file
  size: string;
  title: string | null;
  segment: string | null;
  old_price: number | null;
  new_price: number;
  rrp: number | null;
}

// A snapshot taken at download time: exactly the rows written to the file the operator now has. Kept separate from the live `items` so a
// change applied AFTER the download (by them or a colleague) doesn't get swept into "I've uploaded" — only what was downloaded is cleared.
interface PendingUpload {
  items: AmzBasketItem[];   // what the downloaded file contained (used to re-download the identical file)
  ids: number[];            // their log-row ids (latest pending row per SKU) — the mark-uploaded payload
}

interface AmzBasketValue {
  items: Record<string, AmzBasketItem>;   // keyed by code; re-applying a code overwrites (latest price wins)
  count: number;
  lastUpload: AmzLastUpload | null;        // the team's most recent confirmed Seller Central upload (reassurance line)
  pending: PendingUpload | null;           // set while a downloaded file awaits its "I've uploaded" confirmation
  add: (item: AmzBasketItem) => void;
  refresh: () => void;                      // re-pull recent changes from the audit log (GET /amz-basket)
  download: () => void;                     // build + download the one upload file, then await confirmation
  redownload: () => void;                   // re-download the identical pending file (same snapshot)
  confirmUploaded: () => Promise<void>;     // stamp the downloaded rows uploaded -> they leave the basket (team-wide)
  cancelPending: () => void;                // dismiss the confirm prompt without marking (rows stay pending)
}

const AmzBasketContext = createContext<AmzBasketValue | null>(null);

// Stable "empty basket" identity — the value flows into a useMemo, so a fresh {} each render would churn the whole context value.
const NO_ITEMS: Record<string, AmzBasketItem> = {};

// What the basket query resolves to. Named so the fetcher (which returns the same shape down two branches) infers one type rather than
// a union of the success shape and the silent-fallback shape.
interface BasketSnapshot {
  items: Record<string, AmzBasketItem>;
  lastUpload: AmzLastUpload | null;
}

/* ---------------------------------------------------------------------------------------------------------------------------------
   THE SELLER CENTRAL FILE FORMAT  (rebuilt 2026-08-28 — Amazon retired the old flat file)

   Until 2026-08 this was a 4-column tab-separated file with one header line (sku / price / minimum-seller-allowed-price /
   maximum-seller-allowed-price). Amazon now rejects it: "Uploaded template version is no longer supported." That old
   `_POST_FLAT_FILE_PRICEANDQUANTITYONLY_UPDATE_DATA_` flat file has been replaced by the **unified** Price & Quantity template
   (`TemplateType=unified`, `flavor=seller-price-quantity`), which is a different shape entirely — not a version bump.

   The unified template is a 32-column sheet with a metadata line and THREE header lines before the data:

     row 1  the `settings=` blob below, in cell A1 (the rest of the row empty)
     row 2  spacer
     row 3  attribute-group labels          ("Listing Identity", "Offer (UK) - (Sell on Amazon)...")
     row 4  human-readable column labels    <- settings says labelRow=4
     row 5  MACHINE ATTRIBUTE NAMES         <- settings says attributeRow=5; this is the row Amazon actually parses
     row 6  Amazon's worked example         <- must be blank in what we send
     row 7+ our data                        <- settings says dataRow=7

   THE `settings=` BLOB IS LOAD-BEARING, not decoration. Amazon reads the row offsets above out of it, and its
   `AttributeDefaultValues` (base64) carries `product_type#1.value=PRODUCT` and `record_action#1.value=partial_update` — the
   latter is what makes this a partial update, i.e. what stops blank columns from wiping existing values. Without it every
   untouched attribute on the SKU would be at risk. It also pins `primaryMarketplaceId` to A1F83G8C2ARO7P (amazon.co.uk).

   WHEN AMAZON REJECTS THE FILE AGAIN (they will — `Version=` is stamped into the blob): re-download the template from
   Seller Central -> Catalogue -> Add Products via Upload -> Price & Quantity, open the `Template` sheet, and copy cell A1
   over AMZ_TEMPLATE_SETTINGS below. If the columns moved too, refresh the three header arrays and the COL_* indexes with
   rows 3/4/5 of that sheet. Everything Amazon needs to understand the file lives in these four constants.

   WE FILL FOUR COLUMNS AND LEAVE THE OTHER 28 BLANK — blank is safe here precisely because of `partial_update`.
   ** DO NOT populate Quantity (column 3). ** Our Amazon SKUs are FBA, and Amazon's own instructions are explicit: a quantity
   on an FBA SKU converts it to merchant-fulfilled. The old file had no quantity column so this was impossible; now it is one
   stray assignment away, hence this note. Same reason we leave Fulfillment Channel Code blank.
--------------------------------------------------------------------------------------------------------------------------------- */

// Row 1, cell A1 of the downloaded template. Account-specific (contributorId) and versioned (Version=2026.0828) — see the
// re-download instructions above. Copied verbatim; do not hand-edit the encoded fields.
const AMZ_TEMPLATE_SETTINGS =
  'settings=feedType=256&timestamp=2026-08-28T09%3A43%3A40.880Z&contributorId=amzn1.cr.o.A190P9F3Y5ZWH&primaryMarketplaceId=amzn1.mp.o.A1F83G8C2ARO7P&contentLanguageTag=en_GB&templateIdentifier=a9957b1a-fb1b-4e2d-b457-8e5bd2c6ee2a&headerLanguageTag=en_GB&labelRow=4&attributeRow=5&dataRow=7&flavor=seller-price-quantity&isProcessingSummary=false&isEdit=false&productTypeRequirement=LISTING_OFFER_ONLY&listingsItemRequirement=LISTING_OFFER_ONLY&reportProvenance=false&settingsHasAllDelocalizationData=true&ptds=UFJPRFVDVA%3D%3D&ptdToNamespaceMap=eyJQUk9EVUNUIjoiaW5nZXN0aW9uIn0%3D&browseClassifications=W3sicHJvZHVjdFR5cGUiOiJQUk9EVUNUIiwiYnJvd3NlQ2xhc3NpZmljYXRpb25LZXlzIjpbXX1d&vendorCodes=W10%3D&AttributeDefaultValues=eyJwcm9kdWN0X3R5cGUjMS52YWx1ZSI6IlBST0RVQ1QiLCJyZWNvcmRfYWN0aW9uIzEudmFsdWUiOiJwYXJ0aWFsX3VwZGF0ZSJ9&attributeSettings=W3siYXR0cmlidXRlIjoicHVyY2hhc2FibGVfb2ZmZXJbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdW2F1ZGllbmNlPUIyQl0jMS5jdXJyZW5jeSIsImFsaWFzZXMiOnsiR0JQIjoiR0JQIn19LHsiYXR0cmlidXRlIjoibWVyY2hhbnRfc2hpcHBpbmdfZ3JvdXBbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdIzEudmFsdWUiLCJhbGlhc2VzIjp7IkJyb29rZmllbGQiOiJsZWdhY3ktdGVtcGxhdGUtaWQifX0seyJhdHRyaWJ1dGUiOiJwdXJjaGFzYWJsZV9vZmZlclttYXJrZXRwbGFjZV9pZD1BMUY4M0c4QzJBUk83UF1bYXVkaWVuY2U9QjJCXSMxLm1heGltdW1fc2VsbGVyX2FsbG93ZWRfcHJpY2UjMS5zY2hlZHVsZSMxLnZhbHVlX3dpdGhfdGF4IiwiYWxpYXNlcyI6eyJEZWxldGUgTWF4aW11bSBTZWxsZXIgQWxsb3dlZCBQcmljZSAoQW1hem9uIEJ1c2luZXNzIChCMkIpLCBVSykiOiJhbXpuMS52b2x0LmN2LmRlbGV0ZV91bXBfdG9wX2xldmVsX2ZpZWxkIn19LHsiYXR0cmlidXRlIjoibWVyY2hhbnRfc2hpcHBpbmdfZ3JvdXAjMS52YWx1ZSIsImFsaWFzZXMiOnsiQnJvb2tmaWVsZCI6ImxlZ2FjeS10ZW1wbGF0ZS1pZCJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW21hcmtldHBsYWNlX2lkPUExRjgzRzhDMkFSTzdQXVthdWRpZW5jZT1CMkJdIzEubWluaW11bV9zZWxsZXJfYWxsb3dlZF9wcmljZSMxLnNjaGVkdWxlIzEudmFsdWVfd2l0aF90YXgiLCJhbGlhc2VzIjp7IkRlbGV0ZSBNaW5pbXVtIFNlbGxlciBBbGxvd2VkIFByaWNlIChBbWF6b24gQnVzaW5lc3MgKEIyQiksIFVLKSI6ImFtem4xLnZvbHQuY3YuZGVsZXRlX3VtcF90b3BfbGV2ZWxfZmllbGQifX0seyJhdHRyaWJ1dGUiOiJwdXJjaGFzYWJsZV9vZmZlclttYXJrZXRwbGFjZV9pZD1BMUY4M0c4QzJBUk83UF1bYXVkaWVuY2U9QUxMXSMxLmF1dG9tYXRlZF9wcmljaW5nX21lcmNoYW5kaXNpbmdfcnVsZV9wbGFuIzEubWVyY2hhbmRpc2luZ19ydWxlLnJ1bGVfaWQiLCJhbGlhc2VzIjp7IkdyYWRlIEFuZCBSZXNlbGwgQXV0b21hdGVkIFByaWNpbmcgUnVsZSI6Ijk2Mjc0NTEzNDAwMi1HUkFERV9BTkRfUkVTRUxMX0FVVE9NQVRFRCIsIkF1dG8tUHJpY2UiOiJmZjRkYmI5MS01ZGU1LTQ0OWEtODBkOC01NmVlM2M4N2JjN2QiLCJObyBQcmljZSBSdWxlIjoiZW1wdHlfdmFsdWVfbGFiZWwiLCJDb21wZXRpdGl2ZSBQcmljZSBSdWxlIGJ5IEFtYXpvbiI6Ijk4NTg1MTgwMjEyLUNPTVBFVElUSVZFX0JVWUJPWCJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW21hcmtldHBsYWNlX2lkPUExRjgzRzhDMkFSTzdQXVthdWRpZW5jZT1BTExdIzEuY3VycmVuY3kiLCJhbGlhc2VzIjp7IkdCUCI6IkdCUCJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW2F1ZGllbmNlPUIyQl0jMS5xdWFudGl0eV9kaXNjb3VudF9wbGFuIzEuc2NoZWR1bGUjMS5kaXNjb3VudF90eXBlIiwiYWxpYXNlcyI6eyJQZXJjZW50IjoicGVyY2VudCIsIkZpeGVkIjoiZml4ZWQifX0seyJhdHRyaWJ1dGUiOiJwdXJjaGFzYWJsZV9vZmZlclthdWRpZW5jZT1BTExdIzEuYXV0b21hdGVkX3ByaWNpbmdfbWVyY2hhbmRpc2luZ19ydWxlX3BsYW4jMS5tZXJjaGFuZGlzaW5nX3J1bGUucnVsZV9pZCIsImFsaWFzZXMiOnsiR3JhZGUgQW5kIFJlc2VsbCBBdXRvbWF0ZWQgUHJpY2luZyBSdWxlIjoiOTYyNzQ1MTM0MDAyLUdSQURFX0FORF9SRVNFTExfQVVUT01BVEVEIiwiQXV0by1QcmljZSI6ImZmNGRiYjkxLTVkZTUtNDQ5YS04MGQ4LTU2ZWUzYzg3YmM3ZCIsIk5vIFByaWNlIFJ1bGUiOiJlbXB0eV92YWx1ZV9sYWJlbCIsIkNvbXBldGl0aXZlIFByaWNlIFJ1bGUgYnkgQW1hem9uIjoiOTg1ODUxODAyMTItQ09NUEVUSVRJVkVfQlVZQk9YIn19LHsiYXR0cmlidXRlIjoicHVyY2hhc2FibGVfb2ZmZXJbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdW2F1ZGllbmNlPUIyQl0jMS5xdWFudGl0eV9kaXNjb3VudF9wbGFuIzEuc2NoZWR1bGUjMS5kaXNjb3VudF90eXBlIiwiYWxpYXNlcyI6eyJQZXJjZW50IjoicGVyY2VudCIsIkRlbGV0ZSBRdWFudGl0eSBEaXNjb3VudHMiOiJhbXpuMS52b2x0LmN2LmRlbGV0ZV91bXBfdG9wX2xldmVsX2ZpZWxkIiwiRml4ZWQiOiJmaXhlZCJ9fSx7ImF0dHJpYnV0ZSI6InByb2R1Y3RfdHlwZSMxLnZhbHVlIiwiYWxpYXNlcyI6eyJQUk9EVUNUIjoiUFJPRFVDVCJ9fSx7ImF0dHJpYnV0ZSI6ImZ1bGZpbGxtZW50X2F2YWlsYWJpbGl0eSMxLmlzX2ludmVudG9yeV9hdmFpbGFibGUiLCJhbGlhc2VzIjp7IkVuYWJsZWQiOiJ0cnVlIiwiRGlzYWJsZWQiOiJmYWxzZSJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW21hcmtldHBsYWNlX2lkPUExRjgzRzhDMkFSTzdQXVthdWRpZW5jZT1BTExdIzEubWluaW11bV9zZWxsZXJfYWxsb3dlZF9wcmljZSMxLnNjaGVkdWxlIzEudmFsdWVfd2l0aF90YXgiLCJhbGlhc2VzIjp7IkRlbGV0ZSBNaW5pbXVtIFNlbGxlciBBbGxvd2VkIFByaWNlIChTZWxsIG9uIEFtYXpvbiwgVUspIjoiYW16bjEudm9sdC5jdi5kZWxldGVfdW1wX3RvcF9sZXZlbF9maWVsZCJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW2F1ZGllbmNlPUIyQl0jMS5jdXJyZW5jeSIsImFsaWFzZXMiOnsiR0JQIjoiR0JQIn19LHsiYXR0cmlidXRlIjoicHVyY2hhc2FibGVfb2ZmZXJbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdW2F1ZGllbmNlPUFMTF0jMS5vdXJfcHJpY2UjMS5zY2hlZHVsZSMxLnZhbHVlX3dpdGhfdGF4IiwiYWxpYXNlcyI6eyJEZWxldGUgT2ZmZXIgKFNlbGwgb24gQW1hem9uKSI6ImFtem4xLnZvbHQuY3YuZGVsZXRlX3VtcF92YXJpYW50In19LHsiYXR0cmlidXRlIjoicHVyY2hhc2FibGVfb2ZmZXJbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdW2F1ZGllbmNlPUFMTF0jMS5tYXhpbXVtX3NlbGxlcl9hbGxvd2VkX3ByaWNlIzEuc2NoZWR1bGUjMS52YWx1ZV93aXRoX3RheCIsImFsaWFzZXMiOnsiRGVsZXRlIE1heGltdW0gU2VsbGVyIEFsbG93ZWQgUHJpY2UgKFNlbGwgb24gQW1hem9uLCBVSykiOiJhbXpuMS52b2x0LmN2LmRlbGV0ZV91bXBfdG9wX2xldmVsX2ZpZWxkIn19LHsiYXR0cmlidXRlIjoiZnVsZmlsbG1lbnRfYXZhaWxhYmlsaXR5IzEuZnVsZmlsbG1lbnRfY2hhbm5lbF9jb2RlIiwiYWxpYXNlcyI6eyJGdWxmaWxtZW50IGJ5IEFtYXpvbiAoRVUpIjoiQU1BWk9OX0VVIiwiQU1BWk9OX1VLX1RCWUIiOiJBTUFaT05fVUtfVEJZQiIsIkFNQVpPTl9FVV9WQ1MiOiJBTUFaT05fRVVfVkNTIiwiRnVsZmlsbWVudCBieSBNZXJjaGFudCAoRGVmYXVsdCkiOiJERUZBVUxUIn19LHsiYXR0cmlidXRlIjoicHVyY2hhc2FibGVfb2ZmZXJbbWFya2V0cGxhY2VfaWQ9QTFGODNHOEMyQVJPN1BdW2F1ZGllbmNlPUIyQl0jMS5vdXJfcHJpY2UjMS5zY2hlZHVsZSMxLnZhbHVlX3dpdGhfdGF4IiwiYWxpYXNlcyI6eyJEZWxldGUgT2ZmZXIgKEFtYXpvbiBCdXNpbmVzcyAoQjJCKSkiOiJhbXpuMS52b2x0LmN2LmRlbGV0ZV91bXBfdmFyaWFudCJ9fSx7ImF0dHJpYnV0ZSI6InB1cmNoYXNhYmxlX29mZmVyW2F1ZGllbmNlPUFMTF0jMS5jdXJyZW5jeSIsImFsaWFzZXMiOnsiR0JQIjoiR0JQIn19XQ%3D%3D&TemplateType=unified&Version=2026.0828&TemplateSignature=UFJPRFVDVA==&umpVersion=MS41My42Nw==';

// Row 3 — attribute-group labels.
const AMZ_TEMPLATE_GROUP_ROW: string[] = [
  'Listing Identity',  // 0
  'Offer (UK) - (Sell on Amazon), (UK) - (Amazon Business (B2B))',  // 1
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
  '',
];

// Row 4 — human-readable labels (settings: labelRow=4).
const AMZ_TEMPLATE_LABEL_ROW: string[] = [
  'SKU',  // 0
  'Fulfillment Channel Code (UK)',  // 1
  'Quantity (UK)',  // 2
  'Handling Time (UK)',  // 3
  'Restock Date (UK)',  // 4
  'Inventory Always Available (UK)',  // 5
  'Your Price GBP (Sell on Amazon, UK)',  // 6
  'Pricing Rule (Sell on Amazon, UK)',  // 7
  'Minimum Seller Allowed Price (Sell on Amazon, UK)',  // 8
  'Maximum Seller Allowed Price (Sell on Amazon, UK)',  // 9
  'Sale Price GBP (Sell on Amazon, UK)',  // 10
  'Sale Start Date (Sell on Amazon, UK)',  // 11
  'Sale End Date (Sell on Amazon, UK)',  // 12
  'Offering Release Date (Sell on Amazon, UK)',  // 13
  'Stop Selling Date (Sell on Amazon, UK)',  // 14
  'Your Price GBP (Amazon Business (B2B), UK)',  // 15
  'Minimum Seller Allowed Price (Amazon Business (B2B), UK)',  // 16
  'Maximum Seller Allowed Price (Amazon Business (B2B), UK)',  // 17
  'Offering Release Date (Amazon Business (B2B), UK)',  // 18
  'Stop Selling Date (Amazon Business (B2B), UK)',  // 19
  'Quantity Price Type (Amazon Business (B2B), UK)',  // 20
  'Quantity Threshold (Lower Bound, Amazon Business (B2B), UK)',  // 21
  'Quantity Price (Fixed Price/Percentage Discount, Amazon Business (B2B), UK)',  // 22
  'Quantity Threshold (Lower Bound, Amazon Business (B2B), UK)',  // 23
  'Quantity Price (Fixed Price/Percentage Discount, Amazon Business (B2B), UK)',  // 24
  'Quantity Threshold (Lower Bound, Amazon Business (B2B), UK)',  // 25
  'Quantity Price (Fixed Price/Percentage Discount, Amazon Business (B2B), UK)',  // 26
  'Quantity Threshold (Lower Bound, Amazon Business (B2B), UK)',  // 27
  'Quantity Price (Fixed Price/Percentage Discount, Amazon Business (B2B), UK)',  // 28
  'Quantity Threshold (Lower Bound, Amazon Business (B2B), UK)',  // 29
  'Quantity Price (Fixed Price/Percentage Discount, Amazon Business (B2B), UK)',  // 30
  'Merchant Shipping Group (UK)',  // 31
];

// Row 5 — the machine attribute names Amazon parses (settings: attributeRow=5).
const AMZ_TEMPLATE_ATTRIBUTE_ROW: string[] = [
  'contribution_sku#1.value',  // 0
  'fulfillment_availability#1.fulfillment_channel_code',  // 1
  'fulfillment_availability#1.quantity',  // 2
  'fulfillment_availability#1.lead_time_to_ship_max_days',  // 3
  'fulfillment_availability#1.restock_date',  // 4
  'fulfillment_availability#1.is_inventory_available',  // 5
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.our_price#1.schedule#1.value_with_tax',  // 6
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.automated_pricing_merchandising_rule_plan#1.merchandising_rule.rule_id',  // 7
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.minimum_seller_allowed_price#1.schedule#1.value_with_tax',  // 8
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.maximum_seller_allowed_price#1.schedule#1.value_with_tax',  // 9
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.discounted_price#1.schedule#1.value_with_tax',  // 10
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.discounted_price#1.schedule#1.start_at',  // 11
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.discounted_price#1.schedule#1.end_at',  // 12
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.start_at.value',  // 13
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=ALL]#1.end_at.value',  // 14
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.our_price#1.schedule#1.value_with_tax',  // 15
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.minimum_seller_allowed_price#1.schedule#1.value_with_tax',  // 16
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.maximum_seller_allowed_price#1.schedule#1.value_with_tax',  // 17
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.start_at.value',  // 18
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.end_at.value',  // 19
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.discount_type',  // 20
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#1.lower_bound',  // 21
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#1.value',  // 22
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#2.lower_bound',  // 23
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#2.value',  // 24
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#3.lower_bound',  // 25
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#3.value',  // 26
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#4.lower_bound',  // 27
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#4.value',  // 28
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#5.lower_bound',  // 29
  'purchasable_offer[marketplace_id=A1F83G8C2ARO7P][audience=B2B]#1.quantity_discount_plan#1.schedule#1.levels#5.value',  // 30
  'merchant_shipping_group[marketplace_id=A1F83G8C2ARO7P]#1.value',  // 31
];

// Indexes into the three header arrays above — the only four columns we write.
const COL_SKU = 0;        // contribution_sku#1.value
const COL_PRICE = 6;      // purchasable_offer[...][audience=ALL]#1.our_price#1.schedule#1.value_with_tax  ("Sell on Amazon", not B2B)
const COL_MIN_PRICE = 8;  // minimum_seller_allowed_price — deliberately left blank, as it was in the old file
const COL_MAX_PRICE = 9;  // maximum_seller_allowed_price — the style's RRP

// Build the ONE tab-separated upload file from the queued items and trigger a browser download.
function buildAndDownload(items: AmzBasketItem[]) {
  const width = AMZ_TEMPLATE_ATTRIBUTE_ROW.length;
  const row = (cells: string[]) => cells.join('\t');
  const blankRow = () => row(new Array<string>(width).fill(''));

  // Rows 1-6: Amazon's preamble, reproduced exactly. Row 6 is blank because the template ships a worked example there and
  // dataRow=7 — an example row left in place would be uploaded as a real SKU.
  const lines = [
    row([AMZ_TEMPLATE_SETTINGS, ...new Array<string>(width - 1).fill('')]),
    blankRow(),
    row(AMZ_TEMPLATE_GROUP_ROW),
    row(AMZ_TEMPLATE_LABEL_ROW),
    row(AMZ_TEMPLATE_ATTRIBUTE_ROW),
    blankRow(),
  ];

  // Rows 7+: one line per queued price change, every other column left blank (partial_update leaves them alone).
  for (const item of items) {
    const cells = new Array<string>(width).fill('');
    cells[COL_SKU] = item.amz_sku;
    cells[COL_PRICE] = item.new_price.toFixed(2);
    cells[COL_MIN_PRICE] = '';
    cells[COL_MAX_PRICE] = item.rrp != null ? item.rrp.toFixed(2) : '';
    lines.push(row(cells));
  }

  const content = lines.join('\n') + '\n';
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  // One file per download, stamped with the local date + time it was built. This used to be a fixed 'AMZ-Price-Upload.txt', which
  // meant every download after the first landed as "AMZ-Price-Upload (1).txt" while the ORIGINAL kept the clean name and stayed at
  // the top of the operator's file picker — and after 2026-08-28 that original may be a stale file in the old, now-rejected format.
  // A stamped name never collides, and makes the newest download obviously the newest.
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
  a.download = `AMZ-Price-Upload-${stamp}.txt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function AmzBasketProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingUpload | null>(null);

  // The basket IS the server's view of the team's recent pending changes, so SWR's cache is the single source of truth rather than a
  // local copy seeded by an effect. It loads on mount, so a hard refresh / reopen restores the file. Rows without an Amazon SKU are
  // dropped (no file line can be built for them).
  const { data, refresh, mutate } = useApiQuery<BasketSnapshot>(
    ['amz-basket'],
    async () => {
      const res = await getAmzBasket();
      if (!res.success || !res.data) {
        // DELIBERATELY SILENT, including on UNAUTHORIZED. This provider wraps every /amz page, so it must never be the thing that
        // drives a logout redirect — the page chrome owns auth. An empty basket is the right fallback, and matches what the previous
        // `if (!res.success) return;` left behind.
        return { success: true, return_code: 'SUCCESS', data: { items: NO_ITEMS, lastUpload: null } };
      }
      const next: Record<string, AmzBasketItem> = {};
      for (const r of res.data.items) {
        if (!r.amz_sku) continue;
        next[r.code] = {
          id: r.id, code: r.code, amz_sku: r.amz_sku, size: r.size, title: r.title,
          segment: r.segment, old_price: r.old_price, new_price: r.new_price, rrp: r.rrp,
        };
      }
      return { success: true, return_code: 'SUCCESS', data: { items: next, lastUpload: res.data.lastUpload } };
    },
    { shouldRetryOnError: false },
  );
  const items = data?.items ?? NO_ITEMS;
  const lastUpload = data?.lastUpload ?? null;

  // An applied price is already on the server (that's what /amz-apply just did) — this only reflects it in the basket immediately, so
  // it's a cache write with no revalidation rather than a fetch.
  const add = useCallback((item: AmzBasketItem) => {
    mutate(
      (prev) => ({ items: { ...(prev?.items ?? NO_ITEMS), [item.code]: item }, lastUpload: prev?.lastUpload ?? null }),
      { revalidate: false },
    );
  }, [mutate]);

  // Download the file AND snapshot exactly what it contained, so the confirm step marks only those rows (not anything applied afterwards).
  const download = useCallback(() => {
    const list = Object.values(items);
    if (!list.length) return;
    buildAndDownload(list);
    setPending({ items: list, ids: list.map((i) => i.id) });
  }, [items]);

  // Re-download the identical file the operator is confirming (same snapshot) — e.g. they lost the first download.
  const redownload = useCallback(() => {
    if (pending && pending.items.length) buildAndDownload(pending.items);
  }, [pending]);

  // Confirm the download is live in Seller Central: stamp its rows uploaded (server-side, team-wide), then re-pull — the stamped rows drop
  // out of the basket and lastUpload updates. Clears the confirm prompt only on success, so a failed mark leaves the operator able to retry.
  const confirmUploaded = useCallback(async () => {
    if (!pending || !pending.ids.length) { setPending(null); return; }
    const res = await markAmzUploaded(pending.ids);
    if (!res.success) return;
    setPending(null);
    await refresh();
  }, [pending, refresh]);

  const cancelPending = useCallback(() => setPending(null), []);

  const value = useMemo<AmzBasketValue>(
    () => ({
      items, count: Object.keys(items).length, lastUpload, pending,
      add, refresh, download, redownload, confirmUploaded, cancelPending,
    }),
    [items, lastUpload, pending, add, refresh, download, redownload, confirmUploaded, cancelPending]
  );

  return <AmzBasketContext.Provider value={value}>{children}</AmzBasketContext.Provider>;
}

// Hook — throws if used outside the provider (a wiring bug, not a runtime condition to handle).
export function useAmzBasket(): AmzBasketValue {
  const ctx = useContext(AmzBasketContext);
  if (!ctx) throw new Error('useAmzBasket must be used within an AmzBasketProvider');
  return ctx;
}
