/*
=======================================================================================================================================
THE pricing review periods — the "Review in (None) 3 7 14 30 days" choices on every Shopify and Amazon PRICING screen
=======================================================================================================================================
One list for both channels (owner, 2026-11-04: "keep it standard"), read by components/PriceSetter (Shopify style drill),
components/AmzPriceSetter (Amazon size drill), components/BulkActionBar via the Shopify / Amazon lists and Amazon Find,
components/PriceEditor (Add / Modify) and the hidden components/MatchAmazonPanel.

HISTORY: was 3 · 5 · 7 · 10 · 14 · 30 · 90 (each screen kept its own copy). 14, 30 and 90 were taken out 2026-11-04 (owner: "shorten
the pricing list so not to overwhelm" — Amazon moves within days, and the /amz-pricing standard is set to take over the Amazon Due list;
the skill parks 7 days after a price, 3 after a leave). Existing longer review dates were left as they were. The owner may bring any
period back ("bear in mind we might bring them or anything back") — add it here and every pricing screen gets it. The server accepts
any whole number of days ≥ 1, so no route changes.
2026-11-06 (owner, agreed with Summer): 3 · 7 · 14 · 30 — longer parks are back for the team's deliberate holds (a long date no longer
hides a line from New Additions, whose Review column sorts every row by it), kept to four, each step about double the last: check
soon / a week / a fortnight / leave it. 5 and 10 went (too close to their neighbours); existing 5- and 10-day dates are left alone.

NOT here on purpose (they are not pricing): AMZ loaded's review (components/ReviewPicker) keeps its own list. Fixed periods stay fixed: Shopify vs Amazon 10 days, Fast sellers 7, New Additions' bulk % 3.
=======================================================================================================================================
*/

export const REVIEW_PERIODS: number[] = [3, 7, 14, 30];

/*
SEASON PARK (owner, 2026-11-11: "if im seeing for example a boot in summer i can park it for the season") — one more chip beside the
days: park until a few weeks BEFORE the next season starts, so the style is priced ready for it (owner, same day: "make it a few weeks
early"). The seasons are the code's own (utils/portfolioStatus.js): Summer = April–August, Winter = September–March, so the chip parks
to the next 1 MARCH (a month before summer) or 1 AUGUST (a month before winter), whichever comes first. Sent as a whole number of days
like every other chip (the server takes any integer ≥ 1), counted from today's date in the browser (UK).
*/
export function seasonPark(today: Date = new Date()): { days: number; label: string; title: string } {
  const y = today.getFullYear();
  const m = today.getMonth() + 1;                       // 1-based
  // Next 1 Mar / 1 Aug strictly after today: Jan–Feb → 1 Mar; Mar–Jul → 1 Aug; Aug–Dec → 1 Mar next year.
  const forSummer = m <= 2 || m >= 8;
  const target = forSummer ? new Date(m >= 8 ? y + 1 : y, 2, 1) : new Date(y, 7, 1);
  const start = new Date(y, today.getMonth(), today.getDate());
  const days = Math.round((target.getTime() - start.getTime()) / 86400000);
  const when = forSummer ? '1 Mar' : '1 Aug';
  return { days, label: `Season · ${when}`, title: `Park until ${when}, a month before ${forSummer ? 'summer' : 'winter'} (${days} days)` };
}

