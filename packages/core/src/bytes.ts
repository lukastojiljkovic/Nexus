/**
 * The one place `@nexus/core` turns bytes into text and back — hex and base64.
 *
 * **Why this file exists.** Four modules in this package had written the same
 * codec by hand: `auth/keyChain.ts`, `auth/blobCrypto.ts`, `imex/archiveContainer.ts`
 * and `imex/exportArchive.ts`, with `devtools/cryptoTools.ts` holding a fifth
 * copy under a policy layer. `archiveContainer.ts`'s comment even named the
 * duplication and gave its reason: „the same technique as `auth/keyChain.ts`'s
 * `toBase64`, duplicated rather than imported: see the file header on why this
 * module never reaches into `auth/`." That reason was sound — `imex` genuinely
 * must not import `auth`, because `auth/keyChain.ts` pulls in `hash-wasm` and
 * `archiveContainer.ts` is reachable from the renderer's ordinary bundle. The
 * conclusion did not follow. A module both of them may depend on is a LEAF, and
 * this is that leaf: no imports at all, so it can never drag anything into
 * anybody's bundle.
 *
 * **What is deliberately NOT collapsed into here**, so nobody re-opens it:
 *
 *   - `packages/sync-crypto/src/bytes.ts` — a different PACKAGE, whose manifest
 *     states „zero runtime dependencies" as a security property: the crypto core
 *     is auditable in isolation. Making it depend on `@nexus/core` would trade
 *     that property for a cosmetic one. Its codec is also stricter on purpose
 *     (unpadded base64url only, canonical trailing bits enforced).
 *   - `devtools/encoding.ts` — a hand-rolled six-bit loop, because that tool's
 *     PRODUCT is telling the user which character position is wrong. A codec
 *     that only answers „valid / not valid" cannot do that, and `atob` does not
 *     report a position at all.
 *
 * **Platform-free.** `btoa`/`atob` rather than `Buffer`: this package runs
 * unchanged in Node (Vitest), the Electron main process, and a browser. Every
 * function here loops rather than spreading — `String.fromCharCode(...bytes)`
 * throws `RangeError: Maximum call stack size exceeded` somewhere north of a
 * hundred thousand bytes, which for an attachment is exactly the input that
 * reaches it.
 *
 * **On the return type.** Every decoder returns `Uint8Array<ArrayBuffer>`
 * explicitly, and that is load-bearing rather than pedantic. Since TypeScript
 * 5.7 the bare name `Uint8Array` means `Uint8Array<ArrayBufferLike>`, a
 * supertype that also admits a `SharedArrayBuffer`-backed view — and WebCrypto's
 * `BufferSource` rejects it under a consumer whose tsconfig includes the DOM
 * lib. `archiveContainer.ts` had solved this by leaving its helpers' return types
 * off entirely so inference kept the narrow type; naming the narrow type says
 * the same thing out loud, and cannot be undone by an editor adding an
 * annotation.
 */

const HEX_DIGITS = "0123456789abcdef";

/** Lower-case hex, two characters per byte. */
export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += (HEX_DIGITS[byte >> 4] ?? "") + (HEX_DIGITS[byte & 0x0f] ?? "");
  }
  return out;
}

/**
 * Hex back to bytes, or `null` when the text is not hex.
 *
 * Refusing rather than repairing, in both directions a repair would be
 * tempting: an odd digit count is a truncated key, not a key with an implied
 * leading zero — guessing which end the missing nibble belongs to silently
 * produces a DIFFERENT key — and a stray non-hex character is a paste that went
 * wrong, not a character to skip over.
 *
 * Upper case is accepted because hex has no case, and whitespace is stripped
 * because a key pasted out of a hex dump arrives wrapped across lines: rejoining
 * lines is not repairing a value, it is reading one.
 */
export function hexToBytes(text: string): Uint8Array<ArrayBuffer> | null {
  const stripped = text.replace(/\s+/g, "").toLowerCase();
  if (stripped.length % 2 !== 0) return null;
  const bytes = new Uint8Array(stripped.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    const high = HEX_DIGITS.indexOf(stripped[i * 2] ?? "");
    const low = HEX_DIGITS.indexOf(stripped[i * 2 + 1] ?? "");
    if (high < 0 || low < 0) return null;
    bytes[i] = (high << 4) | low;
  }
  return bytes;
}

/** Standard base64 (RFC 4648 §4), padded. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * Standard base64 back to bytes.
 *
 * **Throws** on input that is not base64 — whatever `atob` throws, which is a
 * `DOMException`/`SyntaxError` depending on the runtime. That is deliberate and
 * is what every caller of this half already expected: `archiveContainer.ts`
 * catches it and re-throws as `ArchiveFormatError` because a bad header field is
 * untrusted input, and `exportArchive.ts` lets it out because its input came out
 * of an authenticated envelope and therefore cannot be malformed without
 * something graver having already happened. A `null` return would have made both
 * of those sites test a condition instead of stating one. `base64ToBytesOrNull`
 * is here for callers that genuinely want the question rather than the value.
 */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i) & 0xff;
  return bytes;
}

/** `base64ToBytes` for callers that want „is this base64?" as a value rather than as control flow. */
export function base64ToBytesOrNull(value: string): Uint8Array<ArrayBuffer> | null {
  try {
    return base64ToBytes(value);
  } catch {
    return null;
  }
}
