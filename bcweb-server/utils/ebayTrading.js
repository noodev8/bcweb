/*
=======================================================================================================================================
Module: utils/ebayTrading.js
=======================================================================================================================================
Purpose: The eBay TRADING API (the older XML one) — one caller and a few small XML readers. Used where the REST APIs can't see what we
         need: the listings made by the Seller Hub bulk upload (2026-10-30 trial) live only in the Trading world, so GetSellerList is
         the one call that returns all of them, auctions included (utils/ebayListings.js).

AUTH: the seller's OAuth USER token (utils/ebayAuth.js → userToken) in the X-EBAY-API-IAF-TOKEN header — the Trading API takes the same
token as the REST calls, no separate Auth'n'Auth token. A 401 (or eBay's "token expired" error 21917053 inside a 200) drops the cached
token and retries once. Site 3 = eBay UK.

XML: no parser dependency (docs/maintenance-notes.md — every dependency is a landmine to keep patched). The readers below handle the
shape eBay actually sends: simple, non-recursive tags. xmlTag returns the FIRST match, so a caller reading an Item's own fields must cut
out child blocks that repeat the same tag names first (an Item's <Variations> carries its own <SKU>, <StartPrice>, <QuantitySold>).
Text comes back with XML entities decoded.

Production endpoint only — the same as the rest of the eBay code.
=======================================================================================================================================
*/

const { userToken, dropUserToken } = require('./ebayAuth');

const ENDPOINT = 'https://api.ebay.com/ws/api.dll';
const SITE_UK = '3';
const COMPAT_LEVEL = '1349';
const TIMEOUT_MS = 60000;
const TOKEN_EXPIRED_CODES = new Set(['21917053', '932', '21916984']);   // expired / invalid IAF token

function coded(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Decode the five XML entities and numeric references. &amp; last, so "&amp;lt;" stays "&lt;".
function decode(s) {
  if (!s) return '';
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

// The inner XML of the first <name>…</name> (attributes allowed), or '' if absent. RAW — not decoded (it may hold child tags).
function xmlBlock(xml, name) {
  if (!xml) return '';
  const m = xml.match(new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`));
  return m ? m[1] : '';
}

// Every <name>…</name> inner XML, in order.
function xmlBlocks(xml, name) {
  if (!xml) return [];
  const re = new RegExp(`<${escapeRe(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRe(name)}>`, 'g');
  return [...xml.matchAll(re)].map((m) => m[1]);
}

// The first <name> as decoded TEXT ('' if absent).
function xmlTag(xml, name) {
  return decode(xmlBlock(xml, name)).trim();
}

// A number, or null when the tag is missing / not numeric.
function xmlNum(xml, name) {
  const t = xmlTag(xml, name);
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/*
 * tradingCall(callName, innerXml) -> the response XML (string)
 * Throws EBAY_ERROR on a network failure, an HTTP error, or Ack=Failure (Warning is fine — eBay sends it for harmless notices).
 */
async function tradingCall(callName, innerXml) {
  const body = `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${innerXml}</${callName}Request>`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'X-EBAY-API-IAF-TOKEN': await userToken(),
          'X-EBAY-API-SITEID': SITE_UK,
          'X-EBAY-API-COMPATIBILITY-LEVEL': COMPAT_LEVEL,
          'X-EBAY-API-CALL-NAME': callName,
          'Content-Type': 'text/xml'
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS)
      });
    } catch (err) {
      throw coded('EBAY_ERROR', `eBay ${callName} failed: ${err.message}`);
    }
    const text = await res.text();
    if (res.status === 401 && attempt === 1) { dropUserToken(); continue; }
    if (!res.ok) throw coded('EBAY_ERROR', `eBay ${callName} answered HTTP ${res.status}`);

    const ack = xmlTag(text, 'Ack');
    if (ack === 'Failure' || ack === 'PartialFailure') {
      const errors = xmlBlock(text, 'Errors');
      if (TOKEN_EXPIRED_CODES.has(xmlTag(errors, 'ErrorCode')) && attempt === 1) { dropUserToken(); continue; }
      const msg = xmlTag(errors, 'LongMessage') || xmlTag(errors, 'ShortMessage') || 'unknown error';
      throw coded('EBAY_ERROR', `eBay ${callName}: ${msg}`);
    }
    return text;
  }
  throw coded('EBAY_ERROR', `eBay ${callName}: the seller token was refused twice`);
}

module.exports = { tradingCall, xmlBlock, xmlBlocks, xmlTag, xmlNum, decode };
