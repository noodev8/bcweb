# Social — front door

**Status: PLAN ONLY. Nothing here is confirmed, scheduled, or automated.**
No scripts, no APIs, no paid spend. This document is the case and the pilot
spec. It gets torn up or promoted based on what the Birkenstock pilot does.

Facebook + Instagram only. Published by hand through Meta Business Suite (one
publish action cross-posts both). No Meta Graph API — that needs app review and
long-lived tokens, and it is a fragile dependency to take on for three manual
posts a week.

## The goal

**Brand awareness: make a stranger aware we stock these brands, so they come and
look.** Not SKU selling. Not promotions. Not follower-chasing.

The secondary hope — that awareness primes a later Google search — is real but
slow and unattributable. Do not build the case on it. Two things there *are*
concrete: an active, linked profile is a trust signal for a first-time buyer
checking we are a real shop, and our own profiles fill the branded SERP for
"brookfield comfort".

## The scoreboard

**Clicks. Same currency as SEO, same rule: social and the P&L are separate
scoreboards and never get merged.**

Every link is UTM-tagged, so GA4 reports it as its own source/medium and it sits
next to organic search as a free-clicks channel. Sales are not the measure and
must not become the measure — at realistic organic reach this will never show in
the P&L, and judging it on revenue kills it at week six for the wrong reason.

| Metric | Role |
|---|---|
| **Clicks to site (UTM, GA4)** | The scoreboard. |
| Reach / impressions | Are we shown at all? Platform-reported, treat as soft. |
| Followers | Diagnostic only. Never a target. |
| Sales | **Not measured here.** Separate scoreboard. |

### Expectation setting

Organic reach on a small page is roughly 1–5% of followers. Early posts will
produce **low single-digit clicks**. That is the normal starting point, not
failure. The thing being tested in the pilot is not whether it produces traffic
today — it is whether the process is cheap enough to sustain and whether the
click line moves at all off zero.

## Is it justified? — the gate

The honest answer is *unknown*, and the pilot exists to find out cheaply. Decide
against these, not against a feeling:

**Stop if:** producing a batch of posts costs more than ~30 minutes a week, or
after 8 weeks of consistent posting the UTM click line is still flat at zero.

**Continue unpaid if:** clicks are non-zero and growing, and the batch process is
genuinely low-effort.

**Only then consider paying:** amplify posts that *already* earned organic clicks,
with a fixed small budget and a click cost compared against the paid search CPC.
Never boost a post that has not proved itself organically. This is the whole
reason not to pay yet — without organic performance data, paid is a guess, and at
our margins a guess is expensive.

## Granularity — brand vs style

**Recommendation: style-level, with the brand page as the anchor.**

"We stock Birkenstock" is one post and then you are repeating yourself. Arizona,
Mayari, Gizeh, Milano, EVA are names people actually recognise and search — they
give distinct posts, a natural rotation, and a more concrete reason to click. The
brand-level collection stays as the fallback link for general posts.

This also decides itself later: run the pilot on one style, see whether the
specific angle or the general one gets engagement, and let that pick between
"5–6 big collections" and the linear style-by-style approach. Do not decide it
now.

## The pilot — Birkenstock Arizona

One collection. Firm the process up here before touching anything else.

**Why Arizona:** most recognised name in the brand, 35 products behind the
collection, and its collection page currently gets almost no organic search
visibility. That last part matters — any traffic it receives is genuinely
incremental and cleanly attributable to social, with no organic-search noise to
untangle.

**Landing page:** `https://brookfieldcomfort.com/collections/birkenstock-arizona`

**Fallback / general posts:** `https://brookfieldcomfort.com/collections/birkenstock`

### Link tagging

Every link, every time. Without this there is no scoreboard.

```
?utm_source=instagram&utm_medium=social&utm_campaign=birkenstock-arizona
?utm_source=facebook&utm_medium=social&utm_campaign=birkenstock-arizona
```

`utm_campaign` = the collection slug. Keep `utm_medium=social` fixed so the whole
channel rolls up as one line in GA4 regardless of platform or campaign.

Instagram has no clickable link in a feed caption — the link lives in the bio
(or a link-in-bio page) and the caption says so. This is a real constraint and
means **Facebook will carry most of the measurable clicks**. Instagram's job in
the pilot is reach and recognition, not traffic.

### Post template

Four fixed parts, in this order:

1. **Hook** — the style name and one concrete thing about it.
2. **Range/stock line** — breadth, not specific SKUs. "Most colours, sizes 35–46."
3. **Delivery badge** — *ordered by 2pm Mon–Fri, with you next working day.*
   Every post, as a footer. **Not the headline every time** or it becomes
   wallpaper.
4. **Link line** — tagged URL (FB) / "link in bio" (IG).

**Before the first post: check the site states the delivery promise in the same
words.** A promise on social the site does not back is a customer-service
problem, not a marketing win.

### Rotation

2–3 posts a week, as agreed. Angles rotate so nothing repeats inside ~12 weeks:

- Range breadth ("every Arizona colour we stock")
- Next-day delivery
- Fitting / sizing help (regular vs narrow — genuinely useful, and the kind of
  post people save)
- Seasonal / occasion
- Care and longevity (footbed, resoling)

No prices. No individual SKUs. Nothing that expires.

## Graphics

**We are not solving graphics yet.** But the honest constraint, up front, because
it decides whether this survives past week three:

**An image generator cannot invent a Birkenstock.** Ask one for "a Birkenstock
Arizona sandal" and it produces a plausible-looking sandal that is not the
product, with wrong strap geometry, wrong buckles and a fake logo. Posting that
as a real brand's product is both misleading to a customer and a trademark
problem. **You must supply real product photography.** That is not a limitation
we can engineer around.

What a generator *is* good for: backgrounds, scenes, surfaces and textures to
composite a real cut-out product onto, and layout/template scaffolding. Use it
for the setting, never for the shoe.

### Prompt to feed a graphics generator

For a **background plate** to drop a real product photo onto (square, 1080×1080):

> A clean, minimal product-photography backdrop for a footwear brand social post.
> Soft natural daylight from the upper left, gentle diffused shadows. A warm
> neutral surface — pale sand-toned matte stone or lightly textured plaster —
> filling the frame, with a plain, softly out-of-focus off-white wall behind.
> Empty centre-frame space with nothing in it, reserved for a product to be
> placed later. Muted, natural, earthy palette. Calm and understated, not glossy
> or commercial. Square 1:1 composition. Photographic, shallow depth of field, no
> text, no logos, no products, no people.

Vary the surface (pale oak, linen, weathered timber, sun-warmed terracotta) and
the light (soft morning, low golden afternoon) to get a set that looks like one
family without being identical. Keep the palette consistent across all of them —
that consistency is what makes a feed look deliberate.

Then composite the real product photo into the reserved centre space and add the
delivery badge as text in the corner.

## What is deliberately deferred

- Any script or automation. Manual first; automate a part only once we have done
  it by hand enough to know it is worth automating.
- Meta Graph API / scheduled publishing.
- The rest of the collections. One collection, process firmed up, then expand.
- Paid spend — gated on the criteria above.
- TikTok and Pinterest. Pinterest is arguably a better fit for footwear and feeds
  Google Images, but it is different content and a separate build.

## Log

Once posting starts, what actually went out goes in `CHANGELOG.md` — date,
collection, angle, platform. Without it there is no way to connect a click bump
to a post six weeks later.
