# Black Friday 2026 — plan

Black Friday is **Fri 27 Nov**, Cyber Monday **Mon 30 Nov**. We run it **Mon 23 Nov → Mon 30 Nov**, then put the store back on Tue 1 Dec.

## Decisions (owner, 2026-11-17)

- **No discount code.** Most of the store is already on sale: 127 of 140 live Birkenstock styles and 40 of 53 others are below RRP.
  The clearance Birkenstock sells **at cost** (50% of RRP, ex VAT, is the cost price), so an extra 10% would lose £3.50–£6.50 on
  every pair, about £230 if the whole collection sold.
- **The goal is to get rid of the Birkenstock clearance** (collection `clearance`: 16 Birkenstock styles, 50 pairs in stock, about
  £1.9k at cost; most styles have 1–4 sizes left, while 0043663-GIZEH has 14 and 1013070-ARIZONA has 11). Lead with it everywhere.
- **Customers should still browse the whole store**, so every message has a second link to everything else.
- **The banner goes on Shopify through Claude** (theme editor, announcement bar). **The owner sends the email** through Shopify Email to all
  subscribers.

## Collections — no new ones needed

All of these already exist on the store:

| Use | Collection | Why |
|---|---|---|
| Hero (banner + email block 1) | `/collections/clearance` | The stock we want gone |
| Email block 2: winter / gifts | `/collections/birkenstock-slippers`, `/collections/womens-boots`, `/collections/strive-slippers` | Late November is when people buy slippers, boots and presents, and these sell at full margin |
| Email block 3 + banner slide 2 | `/collections/all` | "Sale prices across the store" |

Clearance stays Birkenstock-led. The other brands' sale items appear through Shop all, so no extra discount is needed to get them seen.

## Banner (Dawn announcement bar) + home page block

Mock-up: https://claude.ai/artifact/3xVfVenFEjrA6HkYe6W2iz (desktop, phone, rotation).

**Today's bar (read from the live store 2026-11-17, so it can be put back exactly).** White bar, auto-rotate every 5 seconds, 6 slides:
1. Brookfield Comfort - Family run business est. 2017 (no link)
2. Order before 2pm for SAME DAY dispatch (Mon-Fri) (no link)
3. Open online 24/7 and In-Store (Mon-Fri) 11am to 3pm (no link)
4. £4.50 Standard Delivery. £6.50 Express Delivery. All Tracked. → /policies/shipping-policy
5. Tracked NEXT DAY Delivery. Order before 2pm → /policies/shipping-policy
6. Hassle free 14 Day return - Print your own label. → /pages/returns

**For the week:** the bar turns black (the theme's dark colour scheme) and has 4 slides:
1. **BLACK FRIDAY — 50% off selected Birkenstock. Last sizes.** → `/collections/clearance` (new)
2. **Sale prices across the store — shop now** → `/collections/all` (new)
3. Tracked NEXT DAY Delivery. Order before 2pm (kept)
4. Hassle free 14 Day return - Print your own label. (kept)

Slides 1–4 of today's bar are switched off, not deleted, so putting it back on 1 Dec is just switching them on again.

**Home page block:** add a Dawn "Rich text" section at the top of the home page, in the dark colour scheme. It needs no image or theme
file edit:
- Caption: BLACK FRIDAY · 23–30 NOVEMBER
- Heading: 50% off selected Birkenstock
- Text: Last sizes in Arizona, Gizeh, Mayari, Florida and more. When they're gone, they're gone.
- Button 1 (solid): Shop Birkenstock 50% off → `/collections/clearance`
- Button 2 (outline): Shop the whole store → `/collections/all`

On 1 Dec, hide the section (eye icon) rather than deleting it, so it can be reused next year.

Wording note: say "50% off selected", not "up to 50% off", because every clearance style is exactly 50% off RRP.

## Steps

**Before Mon 23 Nov**
- [ ] Take FLN038-ESTHER-BK (0 stock) off the clearance collection (BCWEB Collections screen) so the page doesn't show a sold-out style.
- [ ] Re-check the clearance collection: stock and prices still at 50%.
- [ ] Owner builds the Shopify Email draft (copy below) and sends a test to themselves. Check the plan's send allowance first:
      about 20.7k contacts. Shopify Email only sends to subscribed customers, which is correct.

**Mon 23 Nov: banner live (Claude, in Shopify admin via Chrome)**
- [ ] Take a copy of the theme first (Online Store → Themes → Duplicate).
- [ ] Theme editor → Header → Announcement bar: set the colour scheme to dark, add the 2 new slides at the top, and switch off slides 1–4
      of today's bar. Add the home page Rich text block. Save, then check on phone and desktop.
- [ ] This is a theme *setting*, not a file edit, so it isn't recorded in `docs/shopify-theme-edits.txt`.

**Black Friday morning (Fri 27 Nov, around 7am): owner sends the email**
- [ ] Optional reminder on Cyber Monday morning (30 Nov), sent only to people who didn't open: "Last day. Final sizes."

**Tue 1 Dec: put the store back**
- [ ] Bar back to white, take off the 2 Black Friday slides, switch the 4 hidden slides back on (the list above). Hide the home page block.
- [ ] Look at what sold: clearance pairs gone (stock before and after) and Shopify sales over 23–30 Nov against the week before.

## Email copy (Shopify Email)

- **Subject:** Black Friday: 50% off Birkenstock, final sizes
- **Preview text:** When they're gone, they're gone. Plus sale prices across the store.
- **Heading:** Black Friday at Brookfield Comfort
- **Block 1 (hero):** 50% off selected Birkenstock. Arizona, Gizeh, Mayari, Florida and more, at half price. Most styles have only one or two
  sizes left, so when they're gone, they're gone. **[Shop Birkenstock 50% off]** → `/collections/clearance`
- **Block 2:** Ready for winter. Slippers and boots to keep you warm, and make easy presents. **[Shop slippers]** · **[Shop boots]**
- **Block 3:** Sale prices across the store. **[Shop all]** → `/collections/all`
- **Footer:** Free UK returns line as on the site (check the current wording on the site before sending).
