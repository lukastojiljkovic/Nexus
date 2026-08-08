/**
 * Byte plumbing: encoding, framing and comparison. Everything here is pure
 * ECMAScript — no `btoa`/`atob`, no `Buffer`, no `TextEncoder` outside the two
 * wrappers below — because "platform-free" has to mean the language, not "the
 * globals Node and browsers happen to share".
 *
 * Nothing in this file is exported from the package barrel except
 * `bytesToBase64url` / `base64urlToBytes`, which callers need in order to move
 * sealed material in and out of JSON. The rest is internal framing that the
 * protocol modules share so they cannot drift apart.
 */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 bytes of `value`. The only text encoding this package ever performs. */
export function utf8(value: string): Uint8Array {
  return textEncoder.encode(value);
}

/**
 * UTF-8 decode, strict: invalid sequences throw rather than becoming U+FFFD.
 * A replacement character where a byte used to be is silent data corruption,
 * and every string this package decodes came out of an AEAD — if it is not
 * valid UTF-8 something is very wrong and the caller must hear about it.
 */
export function fromUtf8(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

/** Concatenates into a fresh array. Never aliases its inputs. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const part of parts) total += part.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

const MAX_FIELD_BYTES = 0xffffffff;

/**
 * Length-prefixed concatenation: each field becomes a 4-byte big-endian length
 * followed by its bytes.
 *
 * This exists because **plain concatenation of variable-length fields is not
 * injective**, and every AAD in this package is a concatenation of
 * variable-length identifiers. Without a length prefix,
 * `userId="a" ‖ profileId="b/c"` and `userId="a/b" ‖ profileId="c"` produce the
 * same bytes, so a hostile server could move a row between two profiles whose
 * ids happen to line up and the AEAD tag would still verify — the exact
 * relocation attack the AAD is there to prevent. A separator character does not
 * fix it either, because ids are attacker-influenced strings that may contain
 * the separator. Lengths do fix it: the encoding is uniquely decodable, so
 * distinct field tuples always produce distinct bytes.
 */
export function encodeStruct(fields: readonly Uint8Array[]): Uint8Array {
  const framed: Uint8Array[] = [];
  for (const field of fields) {
    if (field.length > MAX_FIELD_BYTES) {
      throw new TypeError(`encodeStruct field is too long: ${field.length} bytes`);
    }
    const header = new Uint8Array(4);
    new DataView(header.buffer).setUint32(0, field.length, false);
    framed.push(header, field);
  }
  return concatBytes(...framed);
}

/**
 * Eight big-endian bytes. Used for the row version inside the AAD, where a
 * fixed width is what keeps `encodeStruct`'s injectivity argument intact for a
 * numeric field.
 */
export function uint64BE(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`uint64BE expects a non-negative safe integer, got: ${String(value)}`);
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, BigInt(value), false);
  return out;
}

/** A single byte, 0 or 1. Fixed width, for the same reason as `uint64BE`. */
export function booleanByte(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
}

/**
 * Length-then-content comparison with no early exit on a mismatched byte.
 *
 * Honest about what it can promise: JavaScript gives no way to guarantee
 * constant time — the engine may optimise, and the branch on `a.length !==
 * b.length` is itself observable. Lengths here are always public constants
 * (a 32-byte tag, a 32-byte commitment), so leaking "the lengths differ" leaks
 * nothing. What this DOES buy is the property that matters: comparing two
 * secrets never terminates at the first differing byte, so an attacker cannot
 * walk a tag one byte at a time by timing repeated submissions.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) {
    difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return difference === 0;
}

/**
 * Best-effort erasure. Documented as best-effort because it is: a copying
 * garbage collector may already have moved these bytes, and this overwrites
 * only the copy in hand. Worth doing for long-lived key material anyway —
 * it shortens the window, and it marks in the source which values are secret.
 */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}

const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Reverse table for `base64urlToBytes`; 255 marks "not in the alphabet". */
const BASE64URL_REVERSE = ((): Uint8Array => {
  const table = new Uint8Array(128).fill(0xff);
  for (let i = 0; i < BASE64URL_ALPHABET.length; i++) {
    table[BASE64URL_ALPHABET.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Unpadded base64url (RFC 4648 §5). Unpadded and URL-safe because every value
 * this encodes travels as JSON, in a URL, or in a database column, and `+`,
 * `/` and `=` each need escaping in at least one of those. Hand-rolled rather
 * than delegated to `btoa`, which is a host global and not part of the
 * language.
 */
export function bytesToBase64url(bytes: Uint8Array): string {
  let accumulator = 0;
  let bitsHeld = 0;
  let out = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitsHeld += 8;
    while (bitsHeld >= 6) {
      bitsHeld -= 6;
      out += BASE64URL_ALPHABET.charAt((accumulator >>> bitsHeld) & 0x3f);
    }
  }
  // A trailing partial group is left-aligned and zero-filled, which is exactly
  // what makes `base64urlToBytes`'s "leftover bits must be zero" check able to
  // reject a non-canonical spelling.
  if (bitsHeld > 0) {
    out += BASE64URL_ALPHABET.charAt((accumulator << (6 - bitsHeld)) & 0x3f);
  }
  return out;
}

/**
 * The inverse, or `null` for anything that is not canonical unpadded
 * base64url — padding, a standard-alphabet `+`/`/`, whitespace, or a length
 * that no byte string can produce.
 *
 * Returns `null` rather than throwing because every caller is parsing
 * untrusted input from the server or from a peer, and "this field is not
 * base64url" is an ordinary rejection, not an exception. Strict rather than
 * lenient on purpose: a decoder that tolerates two spellings of one value
 * hands an attacker two ciphertexts with the same meaning, which is how
 * signature- and id-confusion bugs start.
 */
export function base64urlToBytes(value: string): Uint8Array | null {
  const length = value.length;
  if (length % 4 === 1) return null;
  const outLength = Math.floor((length * 3) / 4);
  const out = new Uint8Array(outLength);

  let accumulator = 0;
  let bitsHeld = 0;
  let written = 0;
  for (let i = 0; i < length; i++) {
    const code = value.charCodeAt(i);
    const digit = code < 128 ? (BASE64URL_REVERSE[code] ?? 0xff) : 0xff;
    if (digit === 0xff) return null;
    accumulator = (accumulator << 6) | digit;
    bitsHeld += 6;
    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      out[written++] = (accumulator >>> bitsHeld) & 0xff;
    }
  }
  // Leftover bits of a final partial group must be zero, or the string is a
  // non-canonical spelling of the same bytes.
  if (bitsHeld > 0 && (accumulator & ((1 << bitsHeld) - 1)) !== 0) return null;
  return out;
}

/**
 * Keys that must never be written into a plain object built from untrusted
 * data. `__proto__` on an object literal invokes the prototype setter, so a
 * synced row carrying a field named `__proto__` would silently reparent every
 * object in the process; `constructor` and `prototype` are rejected for the
 * same family of reasons and because no legitimate Nexus column is called
 * either. Enforced in `merge.ts`, where remote field names arrive.
 */
export function isSafeFieldName(name: string): boolean {
  return name.length > 0 && name !== "__proto__" && name !== "constructor" && name !== "prototype";
}
