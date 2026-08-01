/*
=======================================================================================================================================
Module: src/lib/socialLink.ts
=======================================================================================================================================
Purpose: Build the UTM-tagged link for a social post, for DISPLAY. Used by Compose (preview before you save) and by the Queue (what a
         scheduled post will actually go out with).

         THE SERVER IS CANONICAL. bcweb-server/utils/socialMeta.js -> buildTrackedLink() is what actually publishes; this is a mirror
         so the screen can show the same thing without a round-trip. If the rule changes, change it THERE first, then here.

         It lives in one place on the client for the obvious reason: two components needed it, and two copies of a rule that must agree
         with a third copy on the server is how they quietly stop agreeing.

WHY THE UTM IS NOT STORED
         `social_post.link_url` holds the BARE url. The tag is added at publish time because one saved post can go to Facebook and
         Instagram and the two must be distinguishable in GA4 — a stored tag could only ever describe one of them. So this function
         exists precisely because there is nothing in the database to just read and display.

         `utm_medium` is always 'social' (docs/social/README.md), so the whole channel rolls up as one line in GA4 regardless of
         platform or campaign.
=======================================================================================================================================
*/

export type SocialPlatform = 'FB' | 'IG';

/** Returns the tagged URL, or null when there is no link or the stored one is unparseable (never throws — this is display code). */
export function buildTrackedLink(
  linkUrl: string | null | undefined,
  campaign: string | null | undefined,
  platform: SocialPlatform = 'FB',
): string | null {
  if (!linkUrl) return null;
  try {
    const u = new URL(linkUrl);
    u.searchParams.set('utm_source', platform === 'IG' ? 'instagram' : 'facebook');
    u.searchParams.set('utm_medium', 'social');
    if (campaign) u.searchParams.set('utm_campaign', campaign);
    return u.toString();
  } catch {
    return null;
  }
}
