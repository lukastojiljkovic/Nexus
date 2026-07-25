/**
 * The local account's passcode policy (founder decision 2026-07-26, ADR-018):
 * minimum 8 characters, at least one letter and one digit. This amends PRD
 * 06's AUTH-004, which originally read "minimum 4 digits" — a policy for a PIN,
 * not a passcode that also gates a device-bound key (see `keyChain.ts`).
 */

export const MIN_PASSCODE_LENGTH = 8;
export const MAX_PASSCODE_LENGTH = 128;

/** Why a passcode was rejected — the renderer maps each to its own Serbian sentence. */
export type PasscodeProblem = "tooShort" | "tooLong" | "needsLetterAndDigit";

/**
 * Unicode-normalizes (NFKC): a passcode typed through a different keyboard
 * layout or IME can produce a different code-point sequence for what looks
 * like the same text (e.g. fullwidth digits/letters vs. their ASCII forms),
 * and `derivePasscodeKey` must see one canonical form or the same passcode
 * would derive two different keys depending on how it was typed.
 *
 * Deliberately does NOT trim. Leading/trailing spaces are part of the
 * passcode the user chose to type; trimming them would make "secret1 " and
 * "secret1" derive the same key, silently narrowing the passcode space.
 */
export function normalizePasscode(value: string): string {
  return value.normalize("NFKC");
}

// \p{L} and \p{N} (with the `u` flag) are Unicode property escapes: they match
// any letter or number in any script, not just ASCII. A Serbian passcode using
// Cyrillic or Latin letters counts exactly like an English one.
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\p{N}/u;

/**
 * `null` when acceptable. Runs on the normalized form, so validation and key
 * derivation always agree on what the passcode "is". Requires at least one
 * letter and one digit — the founder's "slovno-brojčano" — checked with
 * Unicode-aware tests so no script is second-class.
 */
export function validatePasscode(value: string): PasscodeProblem | null {
  const normalized = normalizePasscode(value);
  if (normalized.length < MIN_PASSCODE_LENGTH) return "tooShort";
  if (normalized.length > MAX_PASSCODE_LENGTH) return "tooLong";
  if (!HAS_LETTER.test(normalized) || !HAS_DIGIT.test(normalized)) {
    return "needsLetterAndDigit";
  }
  return null;
}
