/**
 * The Recovery Kit code (ADR-018 / DEV-003): the one documented way back from
 * a forgotten passcode, and — because it is deliberately not device-bound
 * (see `keyChain.ts`'s `deriveRecoveryKey`) — also the device-migration path.
 * 160 random bits, written on paper by a human, so the alphabet has to
 * survive handwriting: Crockford base32 drops the letters that get confused
 * with digits or each other when handwritten (`I`/`l`/`1`, `O`/`0`) and
 * excludes `U` outright (Crockford's own guard against accidentally spelling
 * something obscene when the bits are unlucky).
 */

const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 160 bits / 5 bits per Crockford digit = 32 characters, no padding needed. */
const RECOVERY_CODE_LENGTH = 32;
const RECOVERY_CODE_BYTES = 20;
const GROUP_SIZE = 4;

/**
 * Characters a human might write down or type in place of the "real" one,
 * mapped back per Crockford's own table. `U` is intentionally absent: Crockford
 * excludes it rather than remapping it, so a `U` in the input is invalid, not
 * silently corrected.
 */
const CONFUSABLE_MAP: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
};

/**
 * 160 random bits as 8 groups of 4 Crockford base32 characters: "XXXX-XXXX-…"
 * (39 characters with dashes). Reads 20 bytes from `crypto.getRandomValues`
 * (never `Math.random`, which is not cryptographically secure) and encodes
 * every bit through a 5-bit sliding window — never character-by-character with
 * a modulo, which would bias the alphabet toward its low end.
 */
export function generateRecoveryCode(): string {
  const bytes = new Uint8Array(RECOVERY_CODE_BYTES);
  crypto.getRandomValues(bytes);
  return formatRecoveryCode(encodeCrockfordBase32(bytes));
}

function encodeCrockfordBase32(bytes: Uint8Array): string {
  let buffer = 0;
  let bitsInBuffer = 0;
  let output = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= 5) {
      bitsInBuffer -= 5;
      output += CROCKFORD_ALPHABET.charAt((buffer >>> bitsInBuffer) & 0x1f);
    }
  }
  return output;
}

/**
 * The canonical (ungrouped, upper-case) form, or `null` if the input cannot be
 * one — this is what lets a user type what they think they see on the paper:
 * dashes and whitespace are cosmetic, case is ignored, and Crockford's
 * confusable characters are folded back to the digit they stand in for.
 * Anything left that is not one of the 32 alphabet characters, or a result
 * that is not exactly 32 characters long, is rejected rather than guessed at.
 */
export function normalizeRecoveryCode(input: string): string | null {
  const stripped = input.toUpperCase().replace(/[\s-]/g, "");
  let canonical = "";
  for (const ch of stripped) {
    const mapped = CONFUSABLE_MAP[ch] ?? ch;
    if (!CROCKFORD_ALPHABET.includes(mapped)) return null;
    canonical += mapped;
  }
  return canonical.length === RECOVERY_CODE_LENGTH ? canonical : null;
}

/** The canonical form re-grouped for display, in groups of `GROUP_SIZE`. */
export function formatRecoveryCode(canonical: string): string {
  const groups: string[] = [];
  for (let i = 0; i < canonical.length; i += GROUP_SIZE) {
    groups.push(canonical.slice(i, i + GROUP_SIZE));
  }
  return groups.join("-");
}
