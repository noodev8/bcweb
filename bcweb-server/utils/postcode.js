/*
=======================================================================================================================================
Util: utils/postcode.js   — THE copy of "tidy a UK postcode on the way into orderstatus" (owner, 2026-11-20)
=======================================================================================================================================
WHY: EB24-15443-67051 arrived from eBay as 'da 12 4 eu'. Royal Mail Click & Drop refused the label mid-pack, the operator reset the
     order, and the postcode had to be fixed by hand in the DB — and the next sync would have put the bad one straight back, because
     both order syncs overwrite the address from the channel on every run.

TIDY AND FLAG (owner's choice, 2026-11-20):
  TIDY  a GB address: upper case, every space out, ONE space back before the last 3 characters, then test it against the UK
        pattern. If it fits, that is what we store ('da 12 4 eu' -> 'DA12 4EU'). The tidy only REARRANGES what the customer typed —
        it never guesses, swaps or adds a character — so it is safe to run on every sync and never fights the channel's overwrite.
  FLAG  if it still doesn't fit, the customer's text is stored exactly as typed (trimmed) and the caller adds an Update Orders note
        so it is checked before packing. Nothing is refused or blocked.

ONLY THE FORMAT. A well-formed postcode that is simply the wrong one for the address still only gets caught by Royal Mail.
NOT GB (country set and not 'GB'): left alone, never flagged — the syncs already note a non-UK delivery separately.

Called by: utils/shopifyOrderSync.js and utils/ebayOrderSync.js (insert AND re-sync paths). A new channel calls this too.
=======================================================================================================================================
*/

// Outward code: A9, A99, AA9, AA99, A9A, AA9A. Inward code: 9AA. Plus Girobank's GIR 0AA.
const UK_POSTCODE = /^(GIR 0AA|[A-Z]{1,2}[0-9][A-Z0-9]? [0-9][A-Z]{2})$/;

/*
 * tidyPostcode(raw, country) -> { postcode, flagged }
 *   postcode  what to store: the tidied form when it fits the UK pattern, else the raw text trimmed.
 *   flagged   true when a GB postcode doesn't fit the pattern even after tidying. BLANK is not flagged: collection / pack-only orders carry none, and
 *            the label route already refuses a blank postcode (NO_ADDRESS).
 */
function tidyPostcode(raw, country) {
  const text = String(raw == null ? '' : raw).trim();
  const c = String(country == null ? '' : country).trim().toUpperCase();
  if (!text || (c && c !== 'GB')) return { postcode: text, flagged: false };

  const squashed = text.toUpperCase().replace(/\s+/g, '');
  if (squashed.length >= 5) {
    const spaced = `${squashed.slice(0, -3)} ${squashed.slice(-3)}`;
    if (UK_POSTCODE.test(spaced)) return { postcode: spaced, flagged: false };
  }
  return { postcode: text, flagged: true };
}

// The one wording of the note, so both syncs say the same thing.
function postcodeNote(ordernum, raw) {
  return `${ordernum}: postcode '${String(raw == null ? '' : raw).trim()}' doesn't look like a UK postcode — check before packing`;
}

module.exports = { tidyPostcode, postcodeNote };
