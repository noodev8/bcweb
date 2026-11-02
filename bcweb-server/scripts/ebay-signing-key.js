/*
=======================================================================================================================================
Script: scripts/ebay-signing-key.js   (create the eBay signing key — WRITES bcweb-server/.env only)
=======================================================================================================================================
Purpose: eBay requires every Finances API call made for a UK seller to carry a DIGITAL SIGNATURE (RFC 9421 HTTP message signatures —
         developer.ebay.com "Digital Signatures for APIs"). Month End's eBay block reads the Finances API (utils/financeEbay.js), so it
         needs a signing keypair. This makes one with eBay's Key Management API and writes it into .env:

           EBAY_SIGNING_KEY_ID        eBay's id for the keypair (for reference — eBay lists keys by it)
           EBAY_SIGNING_JWE           the public key as JWE — sent on every signed call as the x-ebay-signature-key header
           EBAY_SIGNING_PRIVATE_KEY   the Ed25519 private key (base64, no PEM armour) — signs; NEVER sent anywhere
           EBAY_SIGNING_KEY_EXPIRES   YYYY-MM-DD — eBay keys last three years

         eBay does NOT keep the private key: lose it and you simply run this again (--force) for a new pair. Run once; copy the four
         lines to the VPS .env and pm2 restart.

The call uses the APPLICATION token (client credentials, the plain api_scope) — no seller sign-in. Touches no database. The private key
is never printed.

Usage:
    node scripts/ebay-signing-key.js            refuses if .env already has a key
    node scripts/ebay-signing-key.js --force    makes a new pair and replaces it
=======================================================================================================================================
*/

const path = require('path');
const fs = require('fs');

const ENV_PATH = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: ENV_PATH });

const { appToken } = require('../utils/ebayAuth');

const KEY_API = 'https://apiz.ebay.com/developer/key_management/v1/signing_key';

function setEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
}

// eBay returns the private key as base64 — strip any PEM armour/newlines so it fits one .env line (utils/ebaySignature.js re-armours).
function bareBase64(key) {
  return String(key || '').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
}

async function main() {
  if (process.env.EBAY_SIGNING_PRIVATE_KEY && !process.argv.includes('--force')) {
    console.error('.env already has EBAY_SIGNING_PRIVATE_KEY. Run with --force to make a new pair and replace it.');
    process.exit(1);
  }

  const res = await fetch(KEY_API, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await appToken()}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ signingKeyCipher: 'ED25519' }),
    signal: AbortSignal.timeout(30000)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.privateKey || !body.jwe) {
    const first = Array.isArray(body.errors) && body.errors[0] ? ` — ${body.errors[0].message}` : '';
    console.error(`eBay wouldn't make a signing key (HTTP ${res.status}${first})`);
    process.exit(1);
  }

  const expires = body.expirationTime ? new Date(Number(body.expirationTime) * 1000).toISOString().slice(0, 10) : '';
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  text = setEnvLine(text, 'EBAY_SIGNING_KEY_ID', body.signingKeyId);
  text = setEnvLine(text, 'EBAY_SIGNING_JWE', `"${body.jwe}"`);
  text = setEnvLine(text, 'EBAY_SIGNING_PRIVATE_KEY', `"${bareBase64(body.privateKey)}"`);
  text = setEnvLine(text, 'EBAY_SIGNING_KEY_EXPIRES', expires);
  fs.writeFileSync(ENV_PATH, text);

  console.log(`Done. Signing key ${body.signingKeyId} (${body.signingKeyCipher}) written to ${ENV_PATH} (private key not shown). Expires ${expires}.`);
  console.log('Copy EBAY_SIGNING_KEY_ID, EBAY_SIGNING_JWE, EBAY_SIGNING_PRIVATE_KEY and EBAY_SIGNING_KEY_EXPIRES to the VPS .env, then pm2 restart.');
}

main().catch((err) => { console.error(err.message); process.exit(1); });
