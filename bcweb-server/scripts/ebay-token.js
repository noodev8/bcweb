/*
=======================================================================================================================================
Script: scripts/ebay-token.js   (mint the eBay refresh token — WRITES bcweb-server/.env only)
=======================================================================================================================================
Purpose: Get the long-lived eBay USER token that the order import, stock sync and listings will run on, and write it into .env as
         EBAY_REFRESH_TOKEN (+ EBAY_REFRESH_TOKEN_EXPIRES, the date it runs out). Run once now, then again about every 18 months when
         it expires. Touches no database.

HOW (eBay's authorization-code grant):
  1. The script prints eBay's sign-in link, built from EBAY_CLIENT_ID + EBAY_RUNAME and the SCOPES below.
  2. You open it, sign in as the SELLER (brookfield.comfort) and press Agree.
  3. eBay lands you on its "thank you" page; that page's address carries ?code=… . Paste the WHOLE address back into the script.
  4. The script swaps the code for tokens (POST identity/v1/oauth2/token) and writes the refresh token into .env.
  The code dies after about 5 minutes, so do steps 2–4 in one go. If it says "invalid_grant", just run the script again.

SCOPES — all asked for in ONE sign-in, so the consent never has to be repeated when a new feature lands:
  sell.fulfillment   read orders, send tracking back            (order import — Update Orders)
  sell.inventory     create / revise / end listings, price+qty   (stock sync, the eBay listings screen)
  sell.account       read the business policies a listing needs  (postage / returns / payment)
  sell.finances      read the seller's transactions              (Month End's eBay block — added 2026-11-01, so a token minted
                                                                  before then must be re-minted; see utils/ebayAuth.js FINANCE_SCOPES)

The token is NEVER printed — it goes straight into the file. Copy the two lines to the VPS .env yourself, then pm2 restart.

Usage:
    node scripts/ebay-token.js                 prints the link, then asks for the address
    node scripts/ebay-token.js "<address>"     the address eBay landed you on, given straight away (no prompt) — for running it from
                                               somewhere that can't answer a prompt: run it once bare to get the link (it stops at the
                                               prompt with nothing typed), sign in, then run it again with the address in quotes
=======================================================================================================================================
*/

const path = require('path');
const fs = require('fs');
const readline = require('readline');

const ENV_PATH = path.join(__dirname, '..', '.env');
require('dotenv').config({ path: ENV_PATH });

const AUTHORIZE_URL = 'https://auth.ebay.com/oauth2/authorize';
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const SCOPES = [
  'https://api.ebay.com/oauth/api_scope',
  'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  'https://api.ebay.com/oauth/api_scope/sell.inventory',
  'https://api.ebay.com/oauth/api_scope/sell.account',
  'https://api.ebay.com/oauth/api_scope/sell.finances'
];

// Replace KEY=… in the .env text, or append it if the key isn't there yet.
function setEnvLine(text, key, value) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, 'm');
  return re.test(text) ? text.replace(re, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
}

// Accept the whole thank-you page address, or just the code on its own.
function codeFrom(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (s.includes('code=')) {
    const query = s.slice(s.indexOf('?') + 1);
    return new URLSearchParams(query).get('code') || '';
  }
  return decodeURIComponent(s);
}

async function main() {
  const clientId = process.env.EBAY_CLIENT_ID;
  const clientSecret = process.env.EBAY_CLIENT_SECRET;
  const ruName = process.env.EBAY_RUNAME;
  const missing = [['EBAY_CLIENT_ID', clientId], ['EBAY_CLIENT_SECRET', clientSecret], ['EBAY_RUNAME', ruName]]
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error(`Fill these in ${ENV_PATH} first: ${missing.join(', ')}`);
    process.exit(1);
  }

  const link = `${AUTHORIZE_URL}?${new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: ruName, scope: SCOPES.join(' '), prompt: 'login'
  })}`;
  let answer = process.argv[2];
  if (!answer) {
    console.log('\n1. Open this link, sign in as brookfield.comfort and press Agree:\n');
    console.log(link);
    console.log('\n2. Paste the WHOLE address of the page eBay lands you on (you have about 5 minutes):\n');

    // Resolves '' if stdin closes with nothing typed (run from somewhere with no prompt) — "No code found" below, link already shown.
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    answer = await new Promise((resolve) => { rl.question('> ', resolve); rl.on('close', () => resolve('')); });
    rl.close();
  }

  const code = codeFrom(answer);
  if (!code) {
    console.error('\nNo code found in that address. If the page said you declined, run the script again and press Agree.');
    process.exit(1);
  }

  let res;
  try {
    res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: ruName }),
      signal: AbortSignal.timeout(30000)
    });
  } catch (err) {
    console.error(`\nCouldn't reach eBay: ${err.message}`);
    process.exit(1);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.refresh_token) {
    // eBay's error text is safe to show (no token in it); invalid_grant almost always means the 5 minutes ran out.
    console.error(`\neBay refused (HTTP ${res.status}): ${body.error || ''} ${body.error_description || ''}`.trim());
    if (body.error === 'invalid_grant') console.error('The code expired or was already used — run the script again and paste quicker.');
    process.exit(1);
  }

  const expires = new Date(Date.now() + (Number(body.refresh_token_expires_in) || 0) * 1000).toISOString().slice(0, 10);
  let text = fs.readFileSync(ENV_PATH, 'utf8');
  // QUOTED: eBay tokens contain '#' (v^1.1#i^1#…), and dotenv reads an unquoted '#' as the start of a comment — unquoted, only the
  // first 5 characters survive. Caught on the first run, 2026-11-01.
  text = setEnvLine(text, 'EBAY_REFRESH_TOKEN', `"${body.refresh_token}"`);
  text = setEnvLine(text, 'EBAY_REFRESH_TOKEN_EXPIRES', expires);
  fs.writeFileSync(ENV_PATH, text);

  console.log(`\nDone. EBAY_REFRESH_TOKEN written to ${ENV_PATH} (not shown here). It expires ${expires}.`);
  console.log('Copy EBAY_RUNAME, EBAY_REFRESH_TOKEN and EBAY_REFRESH_TOKEN_EXPIRES to the VPS .env, then pm2 restart bcweb-prod.');
}

main();
