/**
 * The export archive's passphrase policy (ADR-022: the archive is protected
 * by a passphrase typed at export time, not the app's local data key, because
 * an archive must open on a machine with no Nexus account at all). A tiny,
 * crypto-free module of its own — both the renderer (form validation) and the
 * main process (re-validation, then `auth/keyChain.ts`'s `deriveArchiveKey`)
 * need it, and the renderer must never pull in `hash-wasm` just to validate a
 * text field (see `@nexus/core/auth`'s own header comment on that boundary:
 * this module lives under `imex/`, exported from the `.` barrel, specifically
 * so it stays on the hash-wasm-free side of that line).
 *
 * The minimum is 12, not the passcode's 8 (`auth/passcode.ts`), because the
 * two secrets defend completely different things. The passcode's KEK is
 * device-bound: it is HKDF-salted with a secret held in the OS keystore
 * (`auth/keyChain.ts`'s `derivePasscodeKey`), so a stolen database file alone
 * gives an attacker no salt to even begin guessing the passcode against — the
 * device binding, not the passcode's length, is the primary defence. An
 * export archive carries its own Argon2id salt in its own header and travels
 * anywhere (a USB stick, an email attachment, a cloud drive); the passphrase
 * is the *only* barrier standing between that file and its contents, and it
 * is offline-attackable forever, on hardware the founder will never see. A
 * higher minimum is the one lever this module has to raise the cost of that
 * attack; `auth/keyChain.ts`'s `ARCHIVE_KDF_PARAMS` (deliberately heavier than
 * the passcode's own KDF parameters) is the other.
 */

export const MIN_ARCHIVE_PASSPHRASE_LENGTH = 12;
export const MAX_ARCHIVE_PASSPHRASE_LENGTH = 256;

/** Why a passphrase was rejected — the renderer maps each to its own Serbian sentence. */
export type ArchivePassphraseProblem = "tooShort" | "tooLong";

/**
 * Unicode-normalizes (NFKC): a passphrase typed through a different keyboard
 * layout or IME can produce a different code-point sequence for what looks
 * like the same text (e.g. fullwidth digits/letters vs. their ASCII forms),
 * and `deriveArchiveKey` must see one canonical form or the same passphrase
 * would derive two different keys depending on how it was typed.
 *
 * Deliberately does NOT trim. Leading/trailing spaces are part of the
 * passphrase the user chose to type; trimming them would make "secret one "
 * and "secret one" derive the same key, silently narrowing the passphrase
 * space — the same reasoning `normalizePasscode` documents for the passcode.
 */
export function normalizeArchivePassphrase(value: string): string {
  return value.normalize("NFKC");
}

/**
 * `null` when acceptable. Runs on the normalized form, so validation and key
 * derivation always agree on what the passphrase "is". Unlike the passcode,
 * an archive passphrase has no letter-and-digit requirement: the founder's
 * "slovno-brojčano" rule exists so a device-bound passcode is not trivially
 * short, but here length alone is the whole defence (see the file header),
 * so a long, unusual phrase — including one made of a single repeated
 * character or script — is accepted rather than second-guessed.
 */
export function validateArchivePassphrase(value: string): ArchivePassphraseProblem | null {
  const normalized = normalizeArchivePassphrase(value);
  if (normalized.length < MIN_ARCHIVE_PASSPHRASE_LENGTH) return "tooShort";
  if (normalized.length > MAX_ARCHIVE_PASSPHRASE_LENGTH) return "tooLong";
  return null;
}
