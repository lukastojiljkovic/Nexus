/**
 * ISO 7064 MOD 97-10 and the text handling both pro packs run around it: the
 * separators typed into an account or IBAN, the four-character grouping, and the
 * check digits.
 *
 * Computed digit by digit, so no intermediate ever exceeds a small integer and no
 * BigInt is needed. A match means the string agrees with its own check arithmetic —
 * not that an account exists, is open, or belongs to anyone.
 */

/**
 * Removes the spaces and hyphens typed between the groups of an account or IBAN.
 * A dot is a separator only where `dots` says so.
 */
export function stripSeparators(text: string, dots: boolean): string {
  return text.replace(dots ? /[\s.-]/g : /[\s-]/g, "");
}

/**
 * r = (r·10 + digit) mod 97, a letter contributing its two-digit value (A = 10 …
 * Z = 35, ISO 13616-1:2020), hence ×100 and not ×10. Digits alone are plain
 * MOD 97-10. The remainder stays below 97, so it never needs a big-integer type.
 *
 * The alphabet is the caller's to check: every caller matches its input against a
 * pattern first, so nothing outside 0–9 and A–Z reaches this function.
 */
export function mod97(text: string): number {
  let remainder = 0;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code >= 48 && code <= 57) remainder = (remainder * 10 + (code - 48)) % 97;
    else remainder = (remainder * 100 + (code - 55)) % 97;
  }
  return remainder;
}

/** K = 98 − remainder, written with a leading zero (ISO 7064:2003). */
export function checkDigitsFrom(remainder: number): string {
  return String(98 - remainder).padStart(2, "0");
}

/** Four-character groups, the way an account or IBAN is written down. */
export function groupsOfFour(text: string): string {
  return (text.match(/.{1,4}/g) ?? []).join(" ");
}
