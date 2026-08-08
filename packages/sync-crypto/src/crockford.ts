/**
 * Crockford base32, length-parameterised.
 *
 * **Why this is a second implementation and not an import.** The rules here are
 * exactly `@nexus/core`'s `auth/recoveryCode.ts`: the same 32-character
 * alphabet (no `I`, `L`, `O` — they are folded to the digit they are mistaken
 * for; no `U` at all, Crockford's own guard against the bits spelling something
 * obscene), the same case folding, the same tolerance of dashes and whitespace.
 * Two things stop that module being reused directly. Its functions are
 * hard-wired to a 32-character, 160-bit recovery code, and this package needs a
 * 13-character, 65-bit pairing code. And its generator reads
 * `crypto.getRandomValues` itself, which this package must not do — all
 * randomness arrives through `CryptoPort`.
 *
 * The duplication is therefore deliberate, and it carries one invariant: **the
 * alphabet and the confusable map in the two files must stay identical.** If
 * they ever diverge, a human who can read one code on paper cannot read the
 * other, which is the whole point of choosing Crockford. The right long-term
 * fix is for `@nexus/core` to export a length-parameterised codec and for this
 * file to disappear; until then, changing either file means changing both.
 */

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Crockford's own remapping table. `U` is absent on purpose: invalid, not corrected. */
const CONFUSABLE: Record<string, string> = { O: "0", I: "1", L: "1" };

const BITS_PER_DIGIT = 5;

/**
 * Encodes the first `digits × 5` bits of `bytes` through a 5-bit sliding
 * window — never character-by-character with a modulo over a random byte,
 * which biases the alphabet toward its low end and quietly costs entropy.
 *
 * Taking a prefix of a uniformly random bit string is itself uniform, so
 * emitting 13 digits from 9 random bytes (65 of 72 bits) is unbiased; the
 * leftover 7 bits are simply discarded.
 */
export function encodeCrockford(bytes: Uint8Array, digits: number): string {
  if (!Number.isInteger(digits) || digits < 1) {
    throw new TypeError(`encodeCrockford expects a positive digit count, got: ${String(digits)}`);
  }
  if (digits * BITS_PER_DIGIT > bytes.length * 8) {
    throw new TypeError(
      `encodeCrockford cannot emit ${digits} digits from ${bytes.length} bytes — ` +
        "it would have to invent bits.",
    );
  }

  let buffer = 0;
  let bitsInBuffer = 0;
  let out = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsInBuffer += 8;
    while (bitsInBuffer >= BITS_PER_DIGIT && out.length < digits) {
      bitsInBuffer -= BITS_PER_DIGIT;
      out += ALPHABET.charAt((buffer >>> bitsInBuffer) & 0x1f);
    }
    if (out.length === digits) break;
  }
  return out;
}

/**
 * The canonical (upper-case, ungrouped) form, or `null` if the input cannot be
 * one. Dashes and whitespace are cosmetic, case is ignored, confusables are
 * folded — so a human may type what they think they see. Anything left over is
 * rejected rather than guessed at, and the length must match exactly.
 */
export function normalizeCrockford(input: string, digits: number): string | null {
  const stripped = input.toUpperCase().replace(/[\s-]/g, "");
  let canonical = "";
  for (const ch of stripped) {
    const mapped = CONFUSABLE[ch] ?? ch;
    if (!ALPHABET.includes(mapped)) return null;
    canonical += mapped;
  }
  return canonical.length === digits ? canonical : null;
}

/**
 * Re-groups a canonical code for display, with the leftover absorbed into the
 * FIRST group rather than left standing alone at the end.
 *
 * 13 is not a multiple of 4, and grouping from the left leaves
 * `XXXX-XXXX-XXXX-X` — a trailing single character that reads as a truncation
 * or a typo and invites the user to retype the whole code. Absorbing the
 * leftover gives `XXXXX-XXXX-XXXX`, which reads as deliberate.
 */
export function groupCrockford(canonical: string, groupSize: number): string {
  const remainder = canonical.length % groupSize;
  const firstGroupSize = remainder === 0 ? groupSize : groupSize + remainder;
  const groups: string[] = [];
  if (canonical.length > 0) groups.push(canonical.slice(0, firstGroupSize));
  for (let i = firstGroupSize; i < canonical.length; i += groupSize) {
    groups.push(canonical.slice(i, i + groupSize));
  }
  return groups.join("-");
}
