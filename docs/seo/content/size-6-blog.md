# Size-6 blog — rewritten content (ready to paste)

**Target URL:** `/blogs/info/why-doesnt-birkenstock-make-a-uk-size-6-brookfield-comfort`
**Written 2026-08-11.** Replaces the original ~72-word stub.

**Why rewritten:** the original never answered its own title. It said sizing was
"euro based" and a "best guess" without stating the reason, had two H1s, no
conversion table despite the CHANGELOG claiming one, and no FAQ schema. It got a
freshness boost to pos 4.9 then decayed to 6.4 while impressions *rose* — served
often, answered badly. See `../PROGRESS.md`.

**All figures below are taken from our own `/pages/birkenstock-size-guide` chart**
so the two pages cannot contradict each other. UK 5.5 = EU 39 = 250mm;
UK 7 = EU 40 = 260mm.

---

## 1. Shopify fields

**Title** (the article title — Shopify renders this as the H1):

```
Why Doesn't Birkenstock Make a UK Size 6?
```

⚠️ **Drop the "| Brookfield Comfort" suffix.** The theme already appends the shop
name in the `<title>`, so the current title duplicates it, and the same text also
appears again as a heading in the body — two H1s on one page.

**Meta description** (155 chars):

```
Birkenstock sizes jump from UK 5.5 to UK 7 because they build on EU lasts - EU 39 is 250mm, EU 40 is 260mm. Here's which one to pick if you're a size 6.
```

**Excerpt** (blog listing):

```
There is no UK 6 in Birkenstock's range, and it isn't an oversight. Here's the reason, and what our customers actually buy instead.
```

---

## 2. Body — paste as HTML

Paste into the Shopify article editor using the `<>` (HTML) view. **Do not re-add
a heading with the article title** — start at H2 as below.

```html
<p><strong>Short answer:</strong> Birkenstock builds its shoes on European lasts, not UK ones. EU 39 measures 250mm and EU 40 measures 260mm. A true UK 6 would sit at roughly 255mm — exactly between the two — and Birkenstock doesn't make a last at that length. So when the EU sizes are converted to UK labels, the run goes straight from UK 5.5 to UK 7 with nothing in between.</p>

<p>It isn't a mistake, and it isn't that size 6 has sold out. There is no UK 6 anywhere in the range.</p>

<h2>So what should I buy if I'm a size 6?</h2>

<p><strong>Most of our size 6 customers go for the EU 39.</strong> That's the one we'd recommend if you want a normal, true fit. If you prefer a little more room, or you're between sizes and tend to size up, step to the EU 40.</p>

<p>One thing worth knowing: Birkenstock's footbed is meant to have a small amount of space around the toes. Your toes should not reach the front edge. So an EU 39 that feels slightly roomy is fitting correctly, not fitting large.</p>

<h2>Birkenstock UK to EU size chart</h2>

<table>
  <thead>
    <tr><th>UK size</th><th>EU size</th><th>Length</th></tr>
  </thead>
  <tbody>
    <tr><td>4.5</td><td>37</td><td>240mm</td></tr>
    <tr><td>5</td><td>38</td><td>245mm</td></tr>
    <tr><td><strong>5.5</strong></td><td><strong>39</strong></td><td><strong>250mm</strong></td></tr>
    <tr><td><em>— no UK 6 —</em></td><td><em>—</em></td><td><em>~255mm</em></td></tr>
    <tr><td><strong>7</strong></td><td><strong>40</strong></td><td><strong>260mm</strong></td></tr>
    <tr><td>7.5</td><td>41</td><td>265mm</td></tr>
    <tr><td>8</td><td>42</td><td>270mm</td></tr>
  </tbody>
</table>

<p>The full range, including men's sizes and both width fittings, is on our <a href="/pages/birkenstock-size-guide">Birkenstock size guide</a>.</p>

<h2>Do Birkenstock do a size 6 at all?</h2>

<p>No. Not in any style, and not in either width. If a UK 6 is listed anywhere, it's a retailer's own conversion of the EU 39 or EU 40 rather than a size Birkenstock manufactures.</p>

<h2>Don't forget the width</h2>

<p>Getting the width right matters more than agonising over 39 versus 40. Birkenstock make most core styles in two fittings, and the names are misleading:</p>

<ul>
  <li><strong>Regular</strong> is genuinely wide. It suits wider feet.</li>
  <li><strong>Narrow</strong> is closer to a standard fit. Most women between UK 3 and UK 7 want narrow.</li>
</ul>

<p>If you're a size 6, narrow is the more likely fit. Browse our <a href="/collections/birkenstock-narrow-fit-sandals">narrow fit Birkenstock sandals</a>.</p>

<p>We list both the UK and EU size and the width on every product, so you can see exactly what you're ordering.</p>

<h2>Still not sure?</h2>

<p>If you're between sizes or buying a style you've not worn before, email us at <a href="mailto:sales@brookfieldcomfort.com">sales@brookfieldcomfort.com</a> and we'll tell you what we'd send. We've been fitting Birkenstocks since 2017.</p>

<p>Shop the <a href="/collections/birkenstock-arizona">Birkenstock Arizona</a>, or see <a href="/collections/birkenstock">all Birkenstock</a>.</p>
```

---

## 3. FAQ schema

Google shows the size-6 cluster as **plain blue links with zero Merchant Listings**
— informational intent, no Shopping grid competing. FAQ markup is worth having here
for that reason. Paste at the very end of the body HTML.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "Why doesn't Birkenstock make a UK size 6?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Birkenstock builds on European lasts. EU 39 is 250mm and EU 40 is 260mm. A UK 6 would be about 255mm, which falls between the two, and Birkenstock does not make a last at that length. Converted to UK labels the range therefore runs straight from UK 5.5 to UK 7."
      }
    },
    {
      "@type": "Question",
      "name": "Do Birkenstock do a size 6?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. Birkenstock do not make a UK size 6 in any style or width. Any UK 6 listing is a retailer's own conversion of the EU 39 or EU 40."
      }
    },
    {
      "@type": "Question",
      "name": "What size Birkenstock should I get if I am a UK 6?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Most UK 6 customers take the EU 39. Choose the EU 40 if you prefer a looser fit or usually size up. Birkenstock footbeds are designed with a little space at the toes, so a slightly roomy EU 39 is fitting correctly."
      }
    },
    {
      "@type": "Question",
      "name": "Should a UK 6 choose regular or narrow Birkenstocks?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Narrow is the more likely fit. Birkenstock's regular width is genuinely wide, while narrow is closer to a standard fitting, and most women between UK 3 and UK 7 want narrow."
      }
    }
  ]
}
</script>
```

---

## 4. Also fix — the size guide contradicts itself

`/pages/birkenstock-size-guide` has an FAQ entry that says:

> **Do Birkenstock do size 6?** "Yes, they use euro sizes and make a best guess for
> UK sizes..."

**That answer says "Yes" to a question whose answer is no**, and contains a typo
("if your a size 6"). The two pages compete on this exact query, so leaving a
contradiction between them helps neither. Suggested replacement:

> **Do Birkenstock do size 6?** No — Birkenstock build on EU lasts and there is no
> UK 6 in the range. EU 39 (250mm) is UK 5.5 and EU 40 (260mm) is UK 7. If you're a
> UK 6, take the EU 39, or the EU 40 if you prefer a looser fit.
> [Full explanation here](/blogs/info/why-doesnt-birkenstock-make-a-uk-size-6-brookfield-comfort).

That link also gives the blog its first internal link from a page earning 72
clicks/28d — currently the blog is linked from nowhere.

---

## 5. After publishing

- Request re-indexing in GSC for the blog URL.
- Log the row in `../CHANGELOG.md` **before** the result is known.
- The fold-back decision (due 2026-08-14) should be **postponed**, not taken —
  the original test ran on a stub and proved nothing. Re-read 4 weeks after this
  goes live. Watch **position** (was 4.9 → 6.4) more than clicks.
- Do not build any further size pages until this one is read.
