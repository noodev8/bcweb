/*
=======================================================================================================================================
Module: utils/googleSheets.js
=======================================================================================================================================
Purpose: Read a range of cells out of a Google Sheet with the service account the server already holds. One function, read only —
         nothing here writes to a sheet, and nothing should: a spreadsheet a human maintains is an INPUT to this system, never a
         store it can edit underneath them.

Credential: the SAME service account as the Merchant API push (GOOGLE_MERCHANT_CREDENTIALS_JSON — merchant-feed-api-462809). No second
            key, no new npm dependency: utils/googleAuth.js signs a JWT with Node's built-in crypto and we call the REST endpoint with
            native fetch, matching how utils/shopify.js and utils/googleMerchant.js talk to their APIs.

Scope: https://www.googleapis.com/auth/spreadsheets.readonly — deliberately the read-only one. The write scope would let a bug in a
       future caller overwrite the owner's own spreadsheet, and nothing we do needs it.

ACCESS IS GRANTED IN THE SHEET, NOT HERE. A service account sees only what has been shared with its address, exactly like a person:
       merchant-api-access@merchant-feed-api-462809.iam.gserviceaccount.com must be on the sheet's Share list (Viewer is enough). A
       403 back from Google means that share is missing or was removed — which readValues() reports in those words, because
       "permission denied" on its own sends you hunting through credentials that are perfectly fine.
=======================================================================================================================================
*/

const { getAccessToken } = require('./googleAuth');

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const API_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

/**
 * Read one range from a sheet.
 *
 * @param {string} spreadsheetId  the id out of the sheet's URL (…/spreadsheets/d/<THIS>/edit)
 * @param {string} range          A1 notation, tab name included, e.g. "Car Expense!A:H". A bare tab name means the whole tab.
 * @returns {Promise<string[][]>} rows of cell strings, exactly as displayed in the sheet
 *
 * Values come back FORMATTED (the default valueRenderOption), i.e. what a human reads in the cell: '16/06/2026', '£69.30'. That is
 * the right choice here — the caller parses UK dates and money as the owner sees them, and a serial date number (45824) would have to
 * be converted back through the sheet's own epoch to mean anything.
 *
 * Google omits trailing empty cells, so rows are RAGGED: a row can be shorter than the header. Callers must index defensively.
 */
async function readValues(spreadsheetId, range) {
  if (!spreadsheetId) throw new Error('readValues: no spreadsheetId');

  const token = await getAccessToken(SHEETS_SCOPE);
  const url = `${API_BASE}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`;

  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await resp.text();

  if (!resp.ok) {
    // Translate the two failures that actually happen into something that names the fix, rather than passing Google's wording through.
    if (resp.status === 403) {
      throw new Error('Google refused access to the sheet (403). Share it with merchant-api-access@merchant-feed-api-462809.iam.gserviceaccount.com as Viewer.');
    }
    if (resp.status === 404) {
      throw new Error(`Google could not find that sheet or range (404): ${range}`);
    }
    throw new Error(`Sheets API ${resp.status}: ${text.slice(0, 300)}`);
  }

  let json;
  try { json = JSON.parse(text); } catch { throw new Error(`Sheets API returned non-JSON: ${text.slice(0, 200)}`); }
  return Array.isArray(json.values) ? json.values : [];
}

module.exports = { readValues, SHEETS_SCOPE };
