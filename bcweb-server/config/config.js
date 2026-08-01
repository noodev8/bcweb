/*
=======================================================================================================================================
Module: config/config.js
=======================================================================================================================================
Purpose: Central place for JWT / auth configuration, read from environment variables. Per API-RULES ("Store auth configuration in
         config/config.js") no route or middleware reads process.env.JWT_* directly — they import from here. Keeps secrets in one
         place and makes it obvious which env vars the auth layer needs.

No secrets are hard-coded. If JWT_SECRET is missing we fail loudly at startup rather than signing tokens with `undefined`.
=======================================================================================================================================
*/

// Fail fast at boot if the signing secret is absent — a server that signs JWTs with an undefined secret is a security hole.
if (!process.env.JWT_SECRET) {
  throw new Error('[config] JWT_SECRET is not set. Add it to bcweb-server/.env before starting the server.');
}

module.exports = {
  jwt: {
    secret: process.env.JWT_SECRET,
    // Token lifetime. jsonwebtoken accepts the raw string (e.g. "30d"). Default bumped to 30d so dev/testing sessions don't
    // expire mid-work (CLAUDE.md originally specced 12h — set JWT_EXPIRES_IN in .env to tighten it back down for production).
    expiresIn: process.env.JWT_EXPIRES_IN || '30d'
  },
  // bcrypt cost factor for hashing passwords in seed-user.js / login comparison timing.
  bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '12', 10),

  // one.com SFTP — where product images are pushed (this host backs images.brookfieldcomfort.com, which the site + Google feed read).
  // Not validated at boot (the image feature is optional); utils/sftp.js checks these are present when it actually connects, and the
  // product-image route surfaces a clear error if they're missing. REMOTE_DIR is the directory that maps to the image host root.
  onecom: {
    host: process.env.ONECOM_SFTP_HOST || '',
    port: parseInt(process.env.ONECOM_SFTP_PORT || '22', 10),
    username: process.env.ONECOM_SFTP_USERNAME || '',
    password: process.env.ONECOM_SFTP_PASSWORD || '',
    remoteDir: process.env.ONECOM_SFTP_REMOTE_DIR || ''
  },

  // Social (Marketing module) — Meta publishing + where the marketing graphics live. Optional like onecom/shopify above: not validated
  // at boot, so a server with no Meta creds still runs and serves pricing. utils/socialMeta.js checks before it calls out.
  //
  // IMAGE HOSTING reuses the one.com CREDENTIALS above but a DIFFERENT webroot (/webroots/d760f67f -> social.brookfieldcomfort.com), so
  // marketing graphics never mix with product shots. Verified end-to-end 2026-08-01: uploaded, fetched back over HTTPS byte-identical,
  // and Meta itself successfully fetched an image from that host during the publish gate test.
  //
  // TOKEN NOTE: systemUserToken is the CREDENTIAL, not what you publish with. The Page edges want a PAGE access token derived from it
  // (GET /{page-id}?fields=access_token). utils/socialMeta.js does that derivation and caches it in-process. Deriving beats storing:
  // it is one cheap call and it survives a token regeneration in Business Settings without a redeploy.
  social: {
    // one.com webroot for marketing graphics. Do NOT create subdirectories under it from code — these webroots are symlinks and
    // ssh2-sftp-client's recursive mkdir fails on them (see utils/sftp.js).
    remoteDir: process.env.ONECOM_SOCIAL_REMOTE_DIR || '',
    assetBaseUrl: (process.env.SOCIAL_ASSET_BASE_URL || '').replace(/\/+$/, ''),
    meta: {
      appId: process.env.META_APP_ID || '',
      appSecret: process.env.META_APP_SECRET || '',
      pageId: process.env.META_PAGE_ID || '',
      systemUserToken: process.env.META_SYSTEM_USER_TOKEN || '',
      graphVersion: process.env.META_GRAPH_VERSION || 'v26.0',
      igUserId: process.env.META_IG_USER_ID || ''      // Phase 3 only; unset in v1
    }
  },

  // Shopify Admin API — the Add/Modify product push (utils/shopify.js). Like onecom above, this is an OPTIONAL feature: not validated
  // at boot (a server with no Shopify creds still runs and serves pricing). utils/shopify.js checks these are present when it actually
  // makes a call, and the calling route surfaces SHOPIFY_NOT_CONFIGURED rather than a confusing fetch error. Same custom-app token the
  // Python sync scripts use (C:\scripts\.env). locationId is only needed if/when we set inventory (deferred — stock stays with the
  // existing inventory script for now). apiVersion defaults to the version those scripts pin.
  shopify: {
    shop: process.env.SHOPIFY_SHOP || '',
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-04',
    accessToken: process.env.SHOPIFY_ACCESS_TOKEN || '',
    locationId: process.env.SHOPIFY_LOCATION_ID || '',

    // ORDER SYNC uses a DIFFERENT token and a DIFFERENT API version from everything above — deliberately, on both counts.
    //   token:   the product push above needs write_products; reading orders needs read_orders. They are two separate custom-app
    //            tokens in Shopify (verified: SHOPIFY_ACCESS_TOKEN and SHOPIFY_ORDERS_ACCESS_TOKEN in C:\scripts\.env are different
    //            values). Sending the product token at the Orders endpoint returns 401, so they must not be conflated.
    //   version: pinned to the exact REST version C:\scripts\orders\update_orders.py calls (2024-01). That script and utils/orderSync.js
    //            are two implementations of one business process (see the banner in utils/orderSync.js) and must see the SAME payload
    //            shape — a field renamed between API versions would silently diverge the two. Bump this only when the Python bumps too.
    ordersAccessToken: process.env.SHOPIFY_ORDERS_ACCESS_TOKEN || '',
    ordersApiVersion: process.env.SHOPIFY_ORDERS_API_VERSION || '2024-01'
  },

  // Google Merchant Center Merchant API — real-time price push after a Shopify Pricing apply (utils/googleMerchant.js). Without this,
  // Google Shopping/ads would show the old price until the next nightly C:\scripts\merchant-feed\merchant_feed.py --upload cron run.
  // Same service-account credential the (currently cron-disabled, --no-google) C:\scripts\price_update.py already uses. Optional
  // feature like onecom/shopify above: not validated at boot; utils/googleMerchant.js checks these are present before it does anything.
  //
  // The push is now done in-process in Node (utils/googleAuth.js signs a service-account JWT with the built-in crypto module and caches
  // the access token), replacing the old shell-out to scripts/google-price-push/push_google_price.py — that spawned a fresh Python
  // interpreter (heavy cold-start) on every apply. supplementalDatasource / contentLanguage / feedLabel mirror the same env vars the
  // Python helper read: the price-only override is written into an API-type SUPPLEMENTAL data source, matched on (offerId, contentLanguage,
  // feedLabel). Defaults 'en' / 'GB' match the primary SFTP feed (online:en:GB:<googleid>).
  google: {
    merchantId: process.env.GOOGLE_MERCHANT_ID || '',
    credentialsJson: process.env.GOOGLE_MERCHANT_CREDENTIALS_JSON || '',
    supplementalDatasource: process.env.GOOGLE_SUPPLEMENTAL_DATASOURCE || '',
    contentLanguage: process.env.GOOGLE_CONTENT_LANGUAGE || 'en',
    feedLabel: process.env.GOOGLE_FEED_LABEL || 'GB'
  }
};
