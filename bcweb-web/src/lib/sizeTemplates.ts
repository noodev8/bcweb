/*
=======================================================================================================================================
Module: src/lib/sizeTemplates.ts
=======================================================================================================================================
Purpose: Default size lists for a NEW product, keyed by brand (+ gender where it matters). A faithful port of the legacy PowerBuilder
         "populate size grid" routine: when the size list is empty, the user can generate the standard run for that brand/gender and
         then tweak it before saving. This ONLY produces the editable rows (size display + code suffix); the actual write still goes
         through POST /product-sizes.

         Notes carried over from the legacy code:
           - The CODE SUFFIX is explicit per brand, NOT always the EU number: Lunar uses 03..08, Skechers uses 07..11, the generic
             fallback uses 03..08. Everything else uses the EU size as the suffix. (Size = RIGHT(code,2) downstream, per CLAUDE.md.)
           - Size DISPLAY format varies by brand ("37 EU / 4 UK", "3 UK", "4 UK / 37 EU" for Skechers) — stored verbatim.
           - `uksize` is captured here for when we bring the UK-size column back, but the current size editor/save don't use it yet.
           - Gender only splits the run for Birkenstock, Rieker and Strive. For those, anything that isn't MENS (womens/unisex/blank)
             uses the womens/unisex run — the legacy code left non-matching genders empty, but a sensible default is more useful.
           - Legacy also auto-filled Birkenstock cost/RRP from a `birktracker` table; that pricing lookup is NOT ported here.

-- CODING THE RUN EU OR UK (owner, 2026-09-16) -----------------------------------------------------------------------------------------
Each run above codes its sizes the way its brand does, and that is still the default. But the brand a new product belongs to is often
NOT one of the runs above — it falls to DEFAULT_RUN, which is UK 03..08 — and plenty of those brands are EU-sized. Caprice is the
proof in the live data: EU 36..42 on every one of its variants, coded by hand, because the template could only offer UK. So the size
grid can now ask for the run in the other convention; `sizeTemplateAs` is what it calls.

TO EU, FROM A UK-CODED RUN: the answer is the RIEKER LADDER (owner's choice of the two we hold), gender-aware — EU 36..42 womens,
39..47 mens, carrying Rieker's own UK equivalents in the display. It is NOT a per-size conversion of the UK run: UK 3..8 has no exact
rung for 3 or 7 on that ladder (it runs 3.5, 4, 5, 6, 6.5, 7.5, 8), and rounding each one to a neighbour would invent sizes this
business has never sold. Handing over a real, complete EU run that a real brand uses is honest; a converted run with guessed rungs in
it would not be.

TO UK, FROM AN EU-CODED RUN: only offered when every UK size in that run is a WHOLE number, which in practice means Fly London. The
others (Birkenstock, Rieker, Strive, Remonte) have half sizes — Birkenstock 37 is UK 4.5 — and a code ending '-4.5' is read back as
`RIGHT(code,2)` = '.5' (CLAUDE.md: size IS the last two characters of the code). That is not hypothetical damage: Skechers already
carries suffixes '-8', '-9' and '.5' in the live table from codes built that way. `sizeTemplateAs` returns null for that combination
and the grid disables the button rather than offering a trap.
=======================================================================================================================================
*/

export interface TemplateSize {
  size: string;        // size display, verbatim (e.g. "37 EU / 4 UK")
  codeSuffix: string;  // appended to the groupid to form the code (e.g. "37", "03", "07")
  uksize: string;      // UK size (kept for later; not yet used by the editor/save)
}

// Helper: build a run from [display, suffix, uksize] tuples.
const rows = (t: [string, string, string][]): TemplateSize[] =>
  t.map(([size, codeSuffix, uksize]) => ({ size, codeSuffix, uksize }));

const STRIVE = rows([
  ['37 EU / 4 UK', '37', '4 UK'], ['38 EU / 5 UK', '38', '5 UK'], ['39 EU / 6 UK', '39', '6 UK'],
  ['40 EU / 6.5 UK', '40', '6.5 UK'], ['41 EU / 7 UK', '41', '7 UK'], ['42 EU / 8 UK', '42', '8 UK'],
]);

const RIEKER_W = rows([
  ['36 EU / 3.5 UK', '36', '3.5 UK'], ['37 EU / 4 UK', '37', '4 UK'], ['38 EU / 5 UK', '38', '5 UK'],
  ['39 EU / 6 UK', '39', '6 UK'], ['40 EU / 6.5 UK', '40', '6.5 UK'], ['41 EU / 7.5 UK', '41', '7.5 UK'],
  ['42 EU / 8 UK', '42', '8 UK'],
]);
const RIEKER_M = rows([
  ['39 EU / 6 UK', '39', '6 UK'], ['40 EU / 6.5 UK', '40', '6.5 UK'], ['41 EU / 7.5 UK', '41', '7.5 UK'],
  ['42 EU / 8 UK', '42', '8 UK'], ['43 EU / 9 UK', '43', '9 UK'], ['44 EU / 9.5 UK', '44', '9.5 UK'],
  ['45 EU / 10.5 UK', '45', '10.5 UK'], ['46 EU / 11 UK', '46', '11 UK'], ['47 EU / 12 UK', '47', '12 UK'],
]);

const BIRK_W = rows([
  ['35 EU / 2.5 UK', '35', '2.5 UK'], ['36 EU / 3.5 UK', '36', '3.5 UK'], ['37 EU / 4.5 UK', '37', '4.5 UK'],
  ['38 EU / 5 UK', '38', '5 UK'], ['39 EU / 5.5 UK', '39', '5.5 UK'], ['40 EU / 7 UK', '40', '7 UK'],
  ['41 EU / 7.5 UK', '41', '7.5 UK'], ['42 EU / 8 UK', '42', '8 UK'],
]);
const BIRK_M = rows([
  ['40 EU / 7 UK', '40', '7 UK'], ['41 EU / 7.5 UK', '41', '7.5 UK'], ['42 EU / 8 UK', '42', '8 UK'],
  ['43 EU / 9 UK', '43', '9 UK'], ['44 EU / 9.5 UK', '44', '9.5 UK'], ['45 EU / 10.5 UK', '45', '10.5 UK'],
  ['46 EU / 11.5 UK', '46', '11.5 UK'], ['47 EU / 12 UK', '47', '12 UK'], ['48 EU / 13 UK', '48', '13 UK'],
]);

const LUNAR = rows([
  ['3 UK', '03', '3 UK'], ['4 UK', '04', '4 UK'], ['5 UK', '05', '5 UK'],
  ['6 UK', '06', '6 UK'], ['7 UK', '07', '7 UK'], ['8 UK', '08', '8 UK'],
]);

const FLY_LONDON = rows([
  ['36 EU / 3 UK', '36', '3 UK'], ['37 EU / 4 UK', '37', '4 UK'], ['38 EU / 5 UK', '38', '5 UK'],
  ['39 EU / 6 UK', '39', '6 UK'], ['40 EU / 7 UK', '40', '7 UK'], ['41 EU / 8 UK', '41', '8 UK'],
]);

// Skechers: note the code suffix is 07..11 (NOT the UK/EU number) and the display leads with UK.
const SKECHERS = rows([
  ['4 UK / 37 EU', '07', '4 UK'], ['5 UK / 38 EU', '08', '5 UK'], ['6 UK / 39 EU', '09', '6 UK'],
  ['7 UK / 40 EU', '10', '7 UK'], ['8 UK / 41 EU', '11', '8 UK'],
]);

// Generic fallback (any brand without a specific run) — UK 3..8, same as Lunar.
const DEFAULT_RUN = LUNAR;

/**
 * The standard size run for a brand + gender. Always returns a non-empty list (falls back to DEFAULT_RUN). Brand/gender are matched
 * case-insensitively. Only Birkenstock / Rieker / Strive vary by gender (MENS vs everything-else).
 */
export function sizeTemplate(brand: string, gender: string): TemplateSize[] {
  const b = (brand || '').trim().toUpperCase();
  const isMens = (gender || '').trim().toUpperCase() === 'MENS';
  switch (b) {
    case 'STRIVE':      return STRIVE; // mens and womens/unisex are identical in the legacy code
    case 'RIEKER':
    case 'REMONTE':     return isMens ? RIEKER_M : RIEKER_W; // Remonte uses the same size run as Rieker
    case 'BIRKENSTOCK': return isMens ? BIRK_M : BIRK_W;
    case 'LUNAR':       return LUNAR;
    case 'FLY LONDON':  return FLY_LONDON;
    case 'SKECHERS':    return SKECHERS;
    default:            return DEFAULT_RUN;
  }
}

// --- coding the run EU or UK (see the header) ----------------------------------------------------------------------------------
export type SizeCoding = 'eu' | 'uk';

/** How a run codes its sizes: EU when the suffix is a plain two-digit continental size, UK otherwise (03..08, 07..11). */
export function codingOf(run: TemplateSize[]): SizeCoding {
  const first = run[0]?.codeSuffix ?? '';
  return /^\d{2}$/.test(first) && Number(first) >= 30 ? 'eu' : 'uk';
}

/** What convention this brand+gender's own run is written in — the default the grid opens on. */
export function templateCoding(brand: string, gender: string): SizeCoding {
  return codingOf(sizeTemplate(brand, gender));
}

// '4 UK' -> 4, '3.5 UK' -> 3.5, '' -> NaN. The stored form always carries the ' UK' suffix.
const ukNumber = (uksize: string): number => Number((uksize || '').replace(/\s*UK\s*$/i, '').trim());

/**
 * The standard run in the requested convention, or null when that convention cannot be expressed safely.
 *
 * Asking for the convention the run is already in returns it unchanged — a Birkenstock EU run is the EU answer, not the generic one,
 * because the brand's own ladder is more accurate than any stand-in.
 *
 * eu, from a UK-coded run: the Rieker ladder, gender-aware. A whole real run, not a per-size conversion — see the header.
 * uk, from an EU-coded run: the same run with the code re-derived from its UK size, and ONLY when every UK size is a whole number.
 *     Half sizes would produce codes whose last two characters are not the size. Null, and the caller offers nothing.
 */
export function sizeTemplateAs(brand: string, gender: string, coding: SizeCoding): TemplateSize[] | null {
  const run = sizeTemplate(brand, gender);
  if (codingOf(run) === coding) return run;

  if (coding === 'eu') {
    return (gender || '').trim().toUpperCase() === 'MENS' ? RIEKER_M : RIEKER_W;
  }

  // -> uk. Every rung must be a whole UK size, or the codes stop being readable as sizes.
  if (!run.every((t) => Number.isInteger(ukNumber(t.uksize)))) return null;
  // Display and UK size are left exactly as the brand writes them; only the CODE changes, which is all the toggle claims to do.
  return run.map((t) => ({ ...t, codeSuffix: String(ukNumber(t.uksize)).padStart(2, '0') }));
}

/**
 * Look up a single size in the brand+gender run by its code suffix (what the user types when adding a size — e.g. "42"). Returns the
 * template entry (full display + UK size) so a MANUAL add gets the same brand-accurate EU→UK mapping as the auto-fill. Undefined if
 * the size isn't part of that brand's standard run (caller falls back to a blank UK size for the user to fill).
 *
 * `coding` searches the run as the grid is currently coding it, so typing "40" into a grid switched to EU finds the EU rung rather
 * than missing and leaving the display blank. Omitted, it searches the brand's own run — the behaviour before the toggle existed.
 */
export function lookupTemplateSize(
  brand: string,
  gender: string,
  codeSuffix: string,
  coding?: SizeCoding,
): TemplateSize | undefined {
  const suffix = (codeSuffix || '').trim();
  const run = (coding ? sizeTemplateAs(brand, gender, coding) : null) ?? sizeTemplate(brand, gender);
  return run.find((t) => t.codeSuffix === suffix);
}
