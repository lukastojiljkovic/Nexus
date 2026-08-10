/**
 * The encode/decode drawer: base64, percent-escaping, URL structure, the four
 * views of a byte run, Unicode inspection, HTML entities and hexdumps.
 *
 * **Seven tools in one module because they share one boundary.** Every one of
 * them is a question about the same seam — where text becomes bytes — and each
 * needs the same two refusals at that seam: "these bytes are not UTF-8" and
 * "this character is half of a surrogate pair and therefore not a character at
 * all". Split across seven files those two rules get written seven times and
 * drift; here they are `utf8ToText` and `hasLoneSurrogate`, written once.
 *
 * **On the base64 duplication, which is a recorded defect class in this repo.**
 * `packages/sync-crypto/src/bytes.ts` already holds the strict canonical codec
 * — hand-rolled, unpadded base64url only, refusing padding, `+`, `/` and
 * non-canonical trailing bits. This module deliberately does NOT reach for it,
 * and the reason is a fact about the package graph rather than a preference:
 * `@nexus/core` does not declare `@nexus/sync-crypto` as a dependency, so the
 * import does not resolve — not at typecheck, not under Vitest. Declaring one
 * is a package-manifest change, which is not this module's to make.
 *
 * What that costs is bounded, and the shape below is chosen so the debt can be
 * paid in one edit rather than a rewrite. `bytesToBase64`/`base64ToBytes` are a
 * strict SUPERSET of the sync-crypto pair — both alphabets, padding optional on
 * decode. `bytesToBase64(b, { alphabet: "url", padded: false })` is
 * `bytesToBase64url(b)` character for character, and the decoder differs in one
 * stated direction only: it ADMITS what the strict one refuses on grounds of
 * form (padding, the `+/` alphabet), while every string it rejects as
 * ill-formed or non-canonical is rejected there too. `encoding.test.ts` pins
 * that against RFC 4648 §10's published vectors — the same external authority
 * the sync-crypto file answers to — so the two cannot drift silently. When core
 * does declare the dependency, the collapse is: delete the six-bit loops here
 * and express the four variants as a padding strip plus an alphabet translation
 * (`+/` → `-_`, a character map, no bit maths) in front of the sync-crypto
 * pair, which then supplies every strictness check.
 *
 * **Everything here refuses rather than repairs.** A decoder that accepts two
 * spellings of one value is how id-confusion bugs start, and a decoder that
 * quietly substitutes U+FFFD for a byte it did not like has destroyed the one
 * thing the user opened the tool to see. So: non-canonical base64 is refused,
 * not truncated; a malformed percent escape is refused, not skipped; an
 * unterminated HTML entity is refused, not passed through; an undelimited ASCII
 * gutter in a hexdump is refused, because `beef` is both plausible text and
 * four plausible nibbles and no rule can tell them apart.
 *
 * The one knob that exists instead of a refusal is `allowWhitespace` on base64,
 * and it is a knob rather than a default because MIME (RFC 2045) *mandates*
 * line breaks inside base64 while RFC 4648 §3.3 says a decoder MUST reject
 * characters outside the alphabet. Both are right about their own format, so
 * the caller says which one it has. Silently stripping whitespace would teach
 * the user that their input was fine when the next tool along will disagree.
 *
 * **Nothing here throws for user input.** `RangeError` appears in exactly two
 * places, both guarding a layout option that only a caller can get wrong.
 */

// --- The shared refusal vocabulary -----------------------------------------

/**
 * Why a decoder refused. One flat union across all seven tools so the surface
 * has one message table rather than seven, and so a code can never mean two
 * different things in two different tools.
 */
export type EncodingErrorCode =
  | "not-base64"
  | "base64-padding"
  | "base64-non-canonical"
  | "base64-mixed-alphabet"
  | "percent-escape"
  | "not-utf8"
  | "lone-surrogate"
  | "not-a-hex-byte-list"
  | "not-a-binary-byte-list"
  | "not-a-code-point-list"
  | "code-point-out-of-range"
  | "entity-unterminated"
  | "entity-unknown"
  | "entity-out-of-range"
  | "not-a-hexdump"
  | "hexdump-offset-mismatch"
  | "hexdump-ambiguous-gutter";

export interface EncodingSuccess<T> {
  readonly ok: true;
  readonly value: T;
}

export interface EncodingFailure {
  readonly ok: false;
  readonly code: EncodingErrorCode;
  /**
   * Zero-based index into the input where the refusal happened, when the
   * refusal has a location at all. Absent — never `undefined`-valued, the
   * package compiles with `exactOptionalPropertyTypes` — for whole-input
   * verdicts such as "the padding count is wrong for this length".
   */
  readonly at?: number;
}

/** What every decoder in this module returns. Failure is ordinary, so it is a value and not an exception. */
export type EncodingResult<T> = EncodingSuccess<T> | EncodingFailure;

function ok<T>(value: T): EncodingSuccess<T> {
  return { ok: true, value };
}

function fail(code: EncodingErrorCode): EncodingFailure {
  return { ok: false, code };
}

function failAt(code: EncodingErrorCode, at: number): EncodingFailure {
  return { ok: false, code, at };
}

// --- The text/bytes seam ----------------------------------------------------

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

/** UTF-8 bytes of `text`. The only text encoding this module performs, in either direction. */
export function textToUtf8(text: string): Uint8Array {
  return utf8Encoder.encode(text);
}

/**
 * Strict UTF-8 decode. Invalid sequences are a refusal, never U+FFFD: the whole
 * point of a decoding tool is to report what the bytes are, and a replacement
 * character where a byte used to be is the tool answering a question the user
 * did not ask.
 */
export function utf8ToText(bytes: Uint8Array): EncodingResult<string> {
  try {
    return ok(utf8Decoder.decode(bytes));
  } catch {
    return fail("not-utf8");
  }
}

/**
 * Whether `codePoint` is a Unicode scalar value — an integer in range that is
 * not a surrogate. Surrogates are excluded because they are a UTF-16 storage
 * artefact, not characters: no scalar has a UTF-8 encoding, and every encoder
 * that pretends otherwise emits U+FFFD.
 */
function isScalarValue(codePoint: number): boolean {
  return (
    Number.isInteger(codePoint) &&
    codePoint >= 0 &&
    codePoint <= 0x10ffff &&
    !(codePoint >= 0xd800 && codePoint <= 0xdfff)
  );
}

/**
 * Index of the first unpaired surrogate in `text`, or −1.
 *
 * This exists because a JavaScript string is a UTF-16 sequence, not a sequence
 * of characters, and it is perfectly capable of holding half a pair. Every
 * encoder downstream handles that badly and differently: `encodeURIComponent`
 * throws `URIError`, `TextEncoder` silently substitutes U+FFFD. Both are worse
 * than a named refusal, so the check happens once, up front, at the two entry
 * points where such a string could arrive.
 */
function hasLoneSurrogate(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      return i;
    }
    if (code >= 0xdc00 && code <= 0xdfff) return i;
  }
  return -1;
}

/** Nibble value of an ASCII hex digit, or −1. `NaN` in (an index past the end) gives −1 out, which is what callers rely on. */
function hexValue(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30;
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10;
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10;
  return -1;
}

// --- 1. base64 --------------------------------------------------------------

/** RFC 4648's two alphabets. They differ in exactly two characters, and those two are why the URL-safe one exists. */
export const BASE64_ALPHABETS = ["standard", "url"] as const;

export type Base64Alphabet = (typeof BASE64_ALPHABETS)[number];

const BASE64_DIGITS: Readonly<Record<Base64Alphabet, string>> = {
  standard: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
  url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
};

/**
 * Reverse table for the 62 digits both alphabets agree on; −1 marks "not one of
 * them". The four that differ (`+`, `/`, `-`, `_`) are handled in the decode
 * loop instead, because seeing one is not just a digit — it is evidence about
 * WHICH alphabet the input is written in, and that evidence has to be recorded.
 */
const BASE64_SHARED_REVERSE = ((): Int8Array => {
  const table = new Int8Array(128).fill(-1);
  const shared = BASE64_DIGITS.standard.slice(0, 62);
  for (let i = 0; i < shared.length; i++) table[shared.charCodeAt(i)] = i;
  return table;
})();

export interface Base64EncodeOptions {
  /** Default `"standard"` — the alphabet a reader who says "base64" without qualification means. */
  readonly alphabet?: Base64Alphabet;
  /**
   * Default: padded for `"standard"`, unpadded for `"url"`. Those are the
   * conventions each alphabet is actually used with — `=` needs escaping in a
   * URL, which is most of why the URL-safe alphabet exists — so the default
   * produces the spelling the caller almost certainly wants and the flag exists
   * for the case where they do not.
   */
  readonly padded?: boolean;
}

/** `bytes` as base64. See `Base64EncodeOptions` for the alphabet and padding defaults. */
export function bytesToBase64(bytes: Uint8Array, options: Base64EncodeOptions = {}): string {
  const alphabet = options.alphabet ?? "standard";
  const padded = options.padded ?? alphabet === "standard";
  const digits = BASE64_DIGITS[alphabet];

  let accumulator = 0;
  let bitsHeld = 0;
  let out = "";
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bitsHeld += 8;
    while (bitsHeld >= 6) {
      bitsHeld -= 6;
      out += digits.charAt((accumulator >>> bitsHeld) & 0x3f);
    }
  }
  // A trailing partial group is left-aligned and zero-filled. That is precisely
  // what lets the decoder's "leftover bits must be zero" test tell a canonical
  // spelling from one of the three others that decode to the same bytes.
  if (bitsHeld > 0) out += digits.charAt((accumulator << (6 - bitsHeld)) & 0x3f);
  if (padded) while (out.length % 4 !== 0) out += "=";
  return out;
}

export interface Base64DecodeOptions {
  /**
   * Which alphabet the input is required to be in. Default `"any"`: accept
   * either, but refuse a string that mixes them, because a value containing
   * both `+` and `-` was produced by two different encoders and there is no
   * reading of it that is not somebody's bug.
   */
  readonly alphabet?: Base64Alphabet | "any";
  /**
   * Whether ASCII whitespace between digits is skipped. Default `false`. See
   * the module comment: MIME requires line breaks, RFC 4648 forbids them, and
   * this is the caller saying which format is in hand rather than the decoder
   * guessing and being wrong for the other one.
   */
  readonly allowWhitespace?: boolean;
}

/**
 * base64 → bytes, strictly.
 *
 * Refuses, in order of how often each actually catches something real: a
 * character outside the alphabet; a mixed-alphabet string; padding that is not
 * the exact amount this length requires (including padding on a length that
 * needs none); a length of the form 4n+1, which no byte string can produce; and
 * a final group whose unused low bits are not zero — `Zh==` and `Zg==` both
 * "decode" to the byte 0x66, and accepting both means a value has two
 * spellings.
 */
export function base64ToBytes(
  text: string,
  options: Base64DecodeOptions = {},
): EncodingResult<Uint8Array> {
  const expected = options.alphabet ?? "any";
  const allowWhitespace = options.allowWhitespace ?? false;

  const bytes: number[] = [];
  let accumulator = 0;
  let bitsHeld = 0;
  let digitCount = 0;
  let padCount = 0;
  let sawStandardOnly = false;
  let sawUrlOnly = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      if (!allowWhitespace) return failAt("not-base64", i);
      continue;
    }
    if (code === 0x3d) {
      padCount++;
      continue;
    }
    // A digit after padding has started: padding is a terminator, never an infix.
    if (padCount > 0) return failAt("base64-padding", i);

    let digit = code < 128 ? (BASE64_SHARED_REVERSE[code] ?? -1) : -1;
    if (digit < 0) {
      if (code === 0x2b) {
        digit = 62;
        sawStandardOnly = true;
      } else if (code === 0x2f) {
        digit = 63;
        sawStandardOnly = true;
      } else if (code === 0x2d) {
        digit = 62;
        sawUrlOnly = true;
      } else if (code === 0x5f) {
        digit = 63;
        sawUrlOnly = true;
      } else {
        return failAt("not-base64", i);
      }
      if (expected === "standard" && sawUrlOnly) return failAt("not-base64", i);
      if (expected === "url" && sawStandardOnly) return failAt("not-base64", i);
      if (sawStandardOnly && sawUrlOnly) return failAt("base64-mixed-alphabet", i);
    }

    accumulator = (accumulator << 6) | digit;
    bitsHeld += 6;
    digitCount++;
    if (bitsHeld >= 8) {
      bitsHeld -= 8;
      bytes.push((accumulator >>> bitsHeld) & 0xff);
    }
  }

  if (padCount > 2) return fail("base64-padding");
  if (digitCount % 4 === 1) return fail("not-base64");
  if (padCount > 0 && padCount !== (4 - (digitCount % 4)) % 4) return fail("base64-padding");
  if (bitsHeld > 0 && (accumulator & ((1 << bitsHeld) - 1)) !== 0) {
    return fail("base64-non-canonical");
  }
  return ok(Uint8Array.from(bytes));
}

/** UTF-8 text as base64. */
export function textToBase64(text: string, options: Base64EncodeOptions = {}): string {
  return bytesToBase64(textToUtf8(text), options);
}

/** base64 as UTF-8 text. Refuses twice over: once if the base64 is not canonical, again if the bytes are not UTF-8. */
export function base64ToText(
  text: string,
  options: Base64DecodeOptions = {},
): EncodingResult<string> {
  const bytes = base64ToBytes(text, options);
  return bytes.ok ? utf8ToText(bytes.value) : bytes;
}

// --- 2. url-encode ----------------------------------------------------------

/**
 * The three escapings a developer actually has to choose between, and they are
 * genuinely three rather than one with options:
 *
 * - `component` — `encodeURIComponent`. Escapes every reserved character, so
 *   the result is safe as ONE query value or one path segment. Its documented
 *   quirk is that it leaves `!'()*` alone even though RFC 3986 §2.2 lists them
 *   as sub-delimiters; that is ECMA-262 preserving RFC 2396 behaviour, and this
 *   module reproduces it rather than "fixing" it, because a tool named after a
 *   function must agree with that function.
 * - `uri` — `encodeURI`. Escapes only what cannot appear in a URI at all,
 *   leaving `;/?:@&=+$,#` intact, so a whole URL survives the round trip with
 *   its structure. Feed it a query VALUE and every `&` in that value silently
 *   becomes a parameter separator; that is the mistake this mode exists to make
 *   visible.
 * - `form` — `application/x-www-form-urlencoded` per the WHATWG URL standard:
 *   everything but `A-Za-z0-9*-._` percent-encoded, and a space as `+` rather
 *   than `%20`. The `+` is the whole reason this is a third thing.
 */
export const URL_ESCAPINGS = ["component", "uri", "form"] as const;

export type UrlEscaping = (typeof URL_ESCAPINGS)[number];

/** The urlencoded serializer's safe set (WHATWG URL, "application/x-www-form-urlencoded serializer"). */
const FORM_UNRESERVED = /^[A-Za-z0-9*\-._]$/;

function percentByte(byte: number): string {
  return `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
}

function formEncode(text: string): string {
  let out = "";
  for (const byte of textToUtf8(text)) {
    if (byte === 0x20) {
      out += "+";
      continue;
    }
    const character = String.fromCharCode(byte);
    out += FORM_UNRESERVED.test(character) ? character : percentByte(byte);
  }
  return out;
}

/**
 * Text → escaped text, in one of the three escapings.
 *
 * Returns a result rather than a bare string for one reason: a lone surrogate.
 * `encodeURIComponent` throws `URIError` on one, and a tool drawer whose input
 * field can crash the renderer is not a tool. The pre-check turns that into an
 * ordinary refusal with a position, and `form` — which delegates to nothing and
 * would otherwise have emitted U+FFFD's bytes — is held to the same rule.
 */
export function urlEncode(text: string, escaping: UrlEscaping): EncodingResult<string> {
  const lone = hasLoneSurrogate(text);
  if (lone >= 0) return failAt("lone-surrogate", lone);
  if (escaping === "component") return ok(encodeURIComponent(text));
  if (escaping === "uri") return ok(encodeURI(text));
  return ok(formEncode(text));
}

/**
 * The escapes `decodeURI` deliberately does NOT undo — ECMA-262's
 * `reservedURISet`, `;/?:@&=+$,#`. Preserving them is what makes
 * `decodeURI(encodeURI(url))` give back a URL with its structure rather than a
 * string where a `%2F` inside a path segment has become a segment boundary.
 */
const URI_PRESERVED: ReadonlySet<number> = new Set<number>([
  0x23, 0x24, 0x26, 0x2b, 0x2c, 0x2f, 0x3a, 0x3b, 0x3d, 0x3f, 0x40,
]);

const NOTHING_PRESERVED: ReadonlySet<number> = new Set<number>();

/**
 * Percent-decode to bytes and then to text, refusing a malformed escape by
 * position instead of letting `URIError` out.
 *
 * Bytes preserved by `preserved` are re-emitted as the ORIGINAL three
 * characters, case included, because that is what `decodeURI` does and a tool
 * that lowercased `%2F` to `%2f` on the way through would be editing its input.
 */
function percentDecode(text: string, preserved: ReadonlySet<number>): EncodingResult<string> {
  const bytes: number[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) === 0x25) {
      const high = hexValue(text.charCodeAt(i + 1));
      const low = hexValue(text.charCodeAt(i + 2));
      if (high < 0 || low < 0) return failAt("percent-escape", i);
      const byte = (high << 4) | low;
      if (preserved.has(byte)) {
        bytes.push(0x25, text.charCodeAt(i + 1), text.charCodeAt(i + 2));
      } else {
        bytes.push(byte);
      }
      i += 3;
      continue;
    }
    // Advance by CODE POINT. Stepping by UTF-16 unit and encoding each unit
    // alone turns every astral character into two U+FFFD.
    const chunk = String.fromCodePoint(text.codePointAt(i) ?? 0);
    for (const byte of textToUtf8(chunk)) bytes.push(byte);
    i += chunk.length;
  }
  return utf8ToText(Uint8Array.from(bytes));
}

/**
 * Escaped text → text, the exact inverse of `urlEncode` for the same escaping.
 *
 * `form` replaces `+` with a space BEFORE percent-decoding, which is what makes
 * a literal plus survive: it was written `%2B`, and by the time the escapes are
 * read the `+`-to-space pass is already over.
 */
export function urlDecode(text: string, escaping: UrlEscaping): EncodingResult<string> {
  const lone = hasLoneSurrogate(text);
  if (lone >= 0) return failAt("lone-surrogate", lone);
  if (escaping === "uri") return percentDecode(text, URI_PRESERVED);
  if (escaping === "form") return percentDecode(text.replace(/\+/g, " "), NOTHING_PRESERVED);
  return percentDecode(text, NOTHING_PRESERVED);
}

// --- 3. url-parse -----------------------------------------------------------

const PUNYCODE_PREFIX = "xn--";

// RFC 3492 §5's parameter set for the "punycode" profile of Bootstring.
const PUNY_BASE = 36;
const PUNY_TMIN = 1;
const PUNY_TMAX = 26;
const PUNY_SKEW = 38;
const PUNY_DAMP = 700;
const PUNY_INITIAL_BIAS = 72;
const PUNY_INITIAL_N = 128;
const PUNY_MAX_INT = 0x7fffffff;

/** RFC 3492 §5: `a`–`z` and `A`–`Z` are 0–25, `0`–`9` are 26–35. Anything else is not a digit. */
function punyDigit(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 26;
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61;
  return -1;
}

/** RFC 3492 §6.1, transcribed with explicit `Math.floor` — the reference is in C, where `/` on integers already truncates. */
function punyAdapt(delta: number, numPoints: number, firstTime: boolean): number {
  let scaled = firstTime ? Math.floor(delta / PUNY_DAMP) : delta >> 1;
  scaled += Math.floor(scaled / numPoints);
  let k = 0;
  while (scaled > ((PUNY_BASE - PUNY_TMIN) * PUNY_TMAX) / 2) {
    scaled = Math.floor(scaled / (PUNY_BASE - PUNY_TMIN));
    k += PUNY_BASE;
  }
  return k + Math.floor(((PUNY_BASE - PUNY_TMIN + 1) * scaled) / (scaled + PUNY_SKEW));
}

/**
 * One domain LABEL in its Unicode spelling: the punycode decoder of RFC 3492
 * §6.2, plus that section's mandatory overflow guards.
 *
 * A label without the `xn--` prefix comes back unchanged — it is already
 * Unicode, and "decoding" it would be inventing work. A label that carries the
 * prefix but does not decode returns `null` rather than the ACE spelling,
 * because "this is not valid punycode" and "this is what it says" are different
 * answers and a host display that confuses them is a phishing surface.
 *
 * Written out rather than delegated because there is no punycode in the
 * platform: `URL` will convert Unicode INTO punycode for you and offers no way
 * back. Every step below is checkable against the RFC, and the tests pin two
 * labels whose expansion was worked out by hand from §6.2 rather than by
 * running this code.
 */
export function punycodeToUnicode(label: string): string | null {
  if (!label.toLowerCase().startsWith(PUNYCODE_PREFIX)) return label;
  const encoded = label.slice(PUNYCODE_PREFIX.length);

  // The delimiter is the LAST hyphen. At index 0 there are no basic code points
  // before it, so by §6.2 it is not consumed and the loop meets it as a digit —
  // which it is not, so such a label is refused, which is correct.
  const delimiter = encoded.lastIndexOf("-");
  const basic = delimiter > 0 ? encoded.slice(0, delimiter) : "";
  const extended = delimiter > 0 ? encoded.slice(delimiter + 1) : encoded;

  const output: number[] = [];
  for (let i = 0; i < basic.length; i++) {
    const code = basic.charCodeAt(i);
    if (code >= 0x80) return null;
    output.push(code);
  }

  let n = PUNY_INITIAL_N;
  let index = 0;
  let bias = PUNY_INITIAL_BIAS;
  let at = 0;

  while (at < extended.length) {
    const oldIndex = index;
    let weight = 1;
    for (let k = PUNY_BASE; ; k += PUNY_BASE) {
      if (at >= extended.length) return null;
      const digit = punyDigit(extended.charCodeAt(at++));
      if (digit < 0) return null;
      if (digit > Math.floor((PUNY_MAX_INT - index) / weight)) return null;
      index += digit * weight;
      const t = k <= bias ? PUNY_TMIN : k >= bias + PUNY_TMAX ? PUNY_TMAX : k - bias;
      if (digit < t) break;
      if (weight > Math.floor(PUNY_MAX_INT / (PUNY_BASE - t))) return null;
      weight *= PUNY_BASE - t;
    }
    const outLength = output.length + 1;
    // `oldIndex === 0` is the RFC's `firsttime`: after the first insertion the
    // index is incremented past it, so it is never zero again.
    bias = punyAdapt(index - oldIndex, outLength, oldIndex === 0);
    if (Math.floor(index / outLength) > PUNY_MAX_INT - n) return null;
    n += Math.floor(index / outLength);
    index %= outLength;
    if (!isScalarValue(n)) return null;
    output.splice(index, 0, n);
    index++;
  }

  let decoded = "";
  for (const codePoint of output) decoded += String.fromCodePoint(codePoint);
  return decoded;
}

function hostToUnicode(host: string): string {
  return host
    .split(".")
    .map((label) => punycodeToUnicode(label) ?? label)
    .join(".");
}

/**
 * One query parameter. A LIST of these rather than a `Map` or a record, because
 * `?tag=a&tag=b` is legal and common, and both of those shapes answer it by
 * throwing one of the two values away without saying so.
 */
export interface UrlQueryParam {
  readonly key: string;
  readonly value: string;
}

export interface ParsedUrl {
  /** The URL as the parser normalised it — often not what was typed, which is itself worth showing. */
  readonly href: string;
  /** Without the trailing colon: `https`, not `https:`. */
  readonly scheme: string;
  readonly username: string;
  readonly password: string;
  /** The host in its punycode (ACE) spelling, which is what `URL` always stores and what actually goes on the wire. */
  readonly host: string;
  /** The same host in Unicode. Equal to `host` unless `isIdn`; falls back to the ACE spelling for a label that will not decode. */
  readonly hostUnicode: string;
  readonly isIdn: boolean;
  /** Empty when the URL uses its scheme's default port — `URL` drops those, and so does this. */
  readonly port: string;
  readonly path: string;
  readonly query: readonly UrlQueryParam[];
  /** Without the leading `#`. */
  readonly fragment: string;
}

/**
 * A URL split into its parts, or `null` when the string is not a URL.
 *
 * `null` rather than this module's result union, and that is deliberate: the
 * platform parser gives no structured reason for a rejection, so a code here
 * would be a single constant dressed up as information. One verdict, one
 * message.
 *
 * Note that a URL is parsed relative to nothing — a bare `example.com/a` has no
 * scheme and is therefore not a URL, which surprises people and is right.
 */
export function parseUrl(text: string): ParsedUrl | null {
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return null;
  }
  const host = parsed.hostname;
  const isIdn = host
    .split(".")
    .some((label) => label.toLowerCase().startsWith(PUNYCODE_PREFIX));
  return {
    href: parsed.href,
    scheme: parsed.protocol.replace(/:$/, ""),
    username: parsed.username,
    password: parsed.password,
    host,
    hostUnicode: isIdn ? hostToUnicode(host) : host,
    isIdn,
    port: parsed.port,
    path: parsed.pathname,
    query: [...new URLSearchParams(parsed.search)].map(([key, value]) => ({ key, value })),
    fragment: parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash,
  };
}

// --- 4. ascii-binary-hex ----------------------------------------------------

function hexByte(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

function binaryByte(byte: number): string {
  return byte.toString(2).padStart(8, "0");
}

/**
 * One character and the bytes it costs.
 *
 * `bytes` is empty exactly when the "character" is an unpaired surrogate, which
 * has no UTF-8 encoding at all. Reporting `EF BF BD` there — what `TextEncoder`
 * does — would be the tool inventing three bytes that are not in the string.
 */
export interface CharacterBytes {
  readonly character: string;
  readonly codePoint: number;
  readonly bytes: readonly number[];
  /** Uppercase, space-separated: `C4 8D`. */
  readonly hex: string;
  /** Eight bits per byte, space-separated: `11000100 10001101`. */
  readonly binary: string;
}

/**
 * Four views of one string, plus the per-character breakdown they are built
 * from.
 *
 * The flat strings are deliberately FLAT — one space between bytes, no marker
 * where one character ends and the next begins — because their job is to be
 * copied into another program, and a grouping notation invented here would have
 * to be explained to that program. The grouping the tool actually needs to show
 * lives in `perCharacter`, where it is structure rather than punctuation, and a
 * surface that renders `perCharacter` cannot accidentally claim that `č` is two
 * characters.
 */
export interface TextViews {
  readonly perCharacter: readonly CharacterBytes[];
  /** Decimal code points, space-separated. */
  readonly decimal: string;
  /** All UTF-8 bytes, uppercase hex, space-separated. */
  readonly hex: string;
  /** All UTF-8 bytes in binary, space-separated. */
  readonly binary: string;
  /** The characters themselves, space-separated. */
  readonly characters: string;
}

/** The four views. Iterates by code point, so an astral character is one entry rather than two. */
export function textViews(text: string): TextViews {
  const perCharacter: CharacterBytes[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const bytes = isScalarValue(codePoint) ? [...textToUtf8(character)] : [];
    perCharacter.push({
      character,
      codePoint,
      bytes,
      hex: bytes.map(hexByte).join(" "),
      binary: bytes.map(binaryByte).join(" "),
    });
  }
  const allBytes = perCharacter.flatMap((entry) => [...entry.bytes]);
  return {
    perCharacter,
    decimal: perCharacter.map((entry) => String(entry.codePoint)).join(" "),
    hex: allBytes.map(hexByte).join(" "),
    binary: allBytes.map(binaryByte).join(" "),
    characters: perCharacter.map((entry) => entry.character).join(" "),
  };
}

/**
 * Split on runs of whitespace and commas — the two separators a byte list is
 * actually pasted with, one from a hex dump and one from a source-code array.
 * The separator set is grammar, not value repair: what a token MEANS is never
 * adjusted, only where one ends.
 */
function tokenise(input: string): string[] {
  const trimmed = input.trim();
  return trimmed === "" ? [] : trimmed.split(/[\s,]+/);
}

/**
 * A hex byte list → bytes. Each token must be an EVEN run of hex digits, so
 * `C48D` and `C4 8D` both work and `C 48 D` does not: a lone nibble means the
 * paste lost a character, and silently gluing the pieces back together would
 * hide that.
 */
export function hexBytesToBytes(input: string): EncodingResult<Uint8Array> {
  const bytes: number[] = [];
  for (const token of tokenise(input)) {
    if (token.length % 2 !== 0) return fail("not-a-hex-byte-list");
    for (let i = 0; i < token.length; i += 2) {
      const high = hexValue(token.charCodeAt(i));
      const low = hexValue(token.charCodeAt(i + 1));
      if (high < 0 || low < 0) return fail("not-a-hex-byte-list");
      bytes.push((high << 4) | low);
    }
  }
  return ok(Uint8Array.from(bytes));
}

/** A hex byte list → the text those bytes are the UTF-8 of. */
export function hexBytesToText(input: string): EncodingResult<string> {
  const bytes = hexBytesToBytes(input);
  return bytes.ok ? utf8ToText(bytes.value) : bytes;
}

/** A binary byte list → bytes. Every token must be a whole number of 8-bit groups. */
export function binaryBytesToBytes(input: string): EncodingResult<Uint8Array> {
  const bytes: number[] = [];
  for (const token of tokenise(input)) {
    if (token.length % 8 !== 0) return fail("not-a-binary-byte-list");
    for (let i = 0; i < token.length; i += 8) {
      let byte = 0;
      for (let bit = 0; bit < 8; bit++) {
        const code = token.charCodeAt(i + bit);
        if (code !== 0x30 && code !== 0x31) return fail("not-a-binary-byte-list");
        byte = (byte << 1) | (code - 0x30);
      }
      bytes.push(byte);
    }
  }
  return ok(Uint8Array.from(bytes));
}

/** A binary byte list → the text those bytes are the UTF-8 of. */
export function binaryBytesToText(input: string): EncodingResult<string> {
  const bytes = binaryBytesToBytes(input);
  return bytes.ok ? utf8ToText(bytes.value) : bytes;
}

/**
 * A decimal code point list → text. Refuses a surrogate value outright: it is
 * not a character, `String.fromCodePoint` would happily produce half a pair,
 * and the resulting string then breaks every other tool in this module.
 */
export function decimalCodePointsToText(input: string): EncodingResult<string> {
  let out = "";
  for (const token of tokenise(input)) {
    if (!/^\d+$/.test(token)) return fail("not-a-code-point-list");
    const codePoint = Number(token);
    if (!isScalarValue(codePoint)) return fail("code-point-out-of-range");
    out += String.fromCodePoint(codePoint);
  }
  return ok(out);
}

// --- 5. unicode-inspector ---------------------------------------------------

/** Every Unicode General_Category value, short form. Exactly one applies to any code point. */
export const GENERAL_CATEGORIES = [
  "Lu", "Ll", "Lt", "Lm", "Lo",
  "Mn", "Mc", "Me",
  "Nd", "Nl", "No",
  "Pc", "Pd", "Ps", "Pe", "Pi", "Pf", "Po",
  "Sm", "Sc", "Sk", "So",
  "Zs", "Zl", "Zp",
  "Cc", "Cf", "Cs", "Co", "Cn",
] as const;

export type GeneralCategory = (typeof GENERAL_CATEGORIES)[number];

/**
 * One anchored regexp per category.
 *
 * The brief for this tool said "if derivable without a table", and the honest
 * answer is that it is not — a general category is a lookup, and any rule of
 * thumb ("above 0x2000 it is punctuation") is wrong for thousands of code
 * points. What is available is the engine's OWN Unicode table, through property
 * escapes, which is the real thing rather than an approximation of it and
 * ships no data of ours to go stale. Thirty regexps constructed once at module
 * load is the entire cost.
 */
const CATEGORY_TESTS: readonly (readonly [GeneralCategory, RegExp])[] =
  GENERAL_CATEGORIES.map((category) => [category, new RegExp(`^\\p{${category}}$`, "u")] as const);

/** The General_Category of one code point. `Cn` (unassigned) is both a real answer and the fallback. */
export function generalCategory(codePoint: number): GeneralCategory {
  const character = String.fromCodePoint(codePoint);
  for (const [category, test] of CATEGORY_TESTS) {
    if (test.test(character)) return category;
  }
  return "Cn";
}

/** `U+` and at least four uppercase hex digits: `U+010D`, `U+1F600`. */
export function codePointLabel(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

export interface CodePointInfo {
  readonly codePoint: number;
  readonly label: string;
  readonly character: string;
  /** UTF-8 bytes; empty for an unpaired surrogate, which has none. */
  readonly utf8: readonly number[];
  /** UTF-16 code units — one for a BMP character, two for anything above it. */
  readonly utf16: readonly number[];
  readonly isSurrogatePair: boolean;
  readonly category: GeneralCategory;
}

/**
 * One entry per CODE POINT.
 *
 * Iterated with `for…of`, never by `.length`. Indexing a string walks UTF-16
 * units, which splits every emoji and every character above the BMP into two
 * meaningless halves — and the tool whose entire purpose is to explain that
 * distinction must not be the one making the mistake.
 */
export function inspectCodePoints(text: string): readonly CodePointInfo[] {
  const out: CodePointInfo[] = [];
  for (const character of text) {
    const codePoint = character.codePointAt(0) ?? 0;
    const utf16: number[] = [];
    for (let i = 0; i < character.length; i++) utf16.push(character.charCodeAt(i));
    out.push({
      codePoint,
      label: codePointLabel(codePoint),
      character,
      utf8: isScalarValue(codePoint) ? [...textToUtf8(character)] : [],
      utf16,
      // `for…of` yields either one BMP unit or a whole pair, so the length IS
      // the answer — and it stays right for a lone surrogate, where comparing
      // the code point against 0xFFFF would not be.
      isSurrogatePair: character.length === 2,
      category: generalCategory(codePoint),
    });
  }
  return out;
}

export const NORMALISATION_FORMS = ["NFC", "NFD", "NFKC", "NFKD"] as const;

export type NormalisationForm = (typeof NORMALISATION_FORMS)[number];

export interface NormalisationReport {
  readonly form: NormalisationForm;
  readonly value: string;
  /** Whether this form differs from the input — the field people actually came for. */
  readonly changed: boolean;
  /** Code points, not UTF-16 units: NFD's whole point is that it makes more of them. */
  readonly codePoints: number;
}

/** All four normalisations, each with whether it changed anything. */
export function normalisations(text: string): readonly NormalisationReport[] {
  return NORMALISATION_FORMS.map((form) => {
    const value = text.normalize(form);
    return { form, value, changed: value !== text, codePoints: [...value].length };
  });
}

const graphemeSegmenter = new Intl.Segmenter(["sr-Latn", "sr"], { granularity: "grapheme" });

export interface UnicodeReport {
  readonly codePoints: readonly CodePointInfo[];
  readonly normalisations: readonly NormalisationReport[];
  readonly codePointCount: number;
  /** `text.length` — what JavaScript calls the length, and the one of these four that is almost never what was meant. */
  readonly utf16Length: number;
  readonly utf8ByteCount: number;
  /** What a person would count as characters: `e` + combining acute is one grapheme, two code points, three UTF-8 bytes. */
  readonly graphemeCount: number;
}

/** Everything the inspector shows, in one pass. */
export function inspectText(text: string): UnicodeReport {
  const codePoints = inspectCodePoints(text);
  return {
    codePoints,
    normalisations: normalisations(text),
    codePointCount: codePoints.length,
    utf16Length: text.length,
    utf8ByteCount: codePoints.reduce((total, info) => total + info.utf8.length, 0),
    graphemeCount: [...graphemeSegmenter.segment(text)].length,
  };
}

// --- 6. html-entities -------------------------------------------------------

export const HTML_ESCAPE_MODES = ["minimal", "aggressive"] as const;

export type HtmlEscapeMode = (typeof HTML_ESCAPE_MODES)[number];

/**
 * The five characters that change how markup parses.
 *
 * `'` becomes the hex numeric reference rather than `&apos;` on purpose:
 * `&apos;` is HTML5 and XML but was never in HTML 4, so the named form breaks
 * in exactly the legacy consumers an escaper is being used to defend against.
 * A numeric reference is understood everywhere.
 */
const HTML_MINIMAL: ReadonlyMap<string, string> = new Map([
  ["&", "&amp;"],
  ["<", "&lt;"],
  [">", "&gt;"],
  ['"', "&quot;"],
  ["'", "&#x27;"],
]);

/**
 * U+00A0 through U+00FF in code point order.
 *
 * Written as a run rather than 96 pairs because that IS the structure: the
 * HTML 4.01 Latin-1 entity set names every code point in that block, in
 * sequence, with no gaps — so a list plus a base is both shorter and easier to
 * check against the standard than 96 hand-typed numbers, each of which is an
 * opportunity to transpose two digits.
 */
const LATIN1_ENTITY_NAMES =
  "nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr " +
  "deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest " +
  "Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml " +
  "Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times " +
  "Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig " +
  "agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml " +
  "igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide " +
  "oslash ugrave uacute ucirc uuml yacute thorn yuml";

const LATIN1_ENTITY_BASE = 0x00a0;

/**
 * Everything outside the Latin-1 run: the markup five, the Latin Extended and
 * modifier letters HTML names, the Greek block, general punctuation, the euro,
 * and the HTML 4 symbol set of arrows and mathematics.
 *
 * `lang`/`rang` carry the HTML5 values U+27E8/U+27E9, not HTML 4's
 * U+2329/U+232A. The characters look identical and are not the same character —
 * the older pair are CJK angle brackets, which are wide in a CJK font — and
 * HTML5 changed the mapping precisely because of it.
 *
 * This is deliberately not all 2231 HTML5 named references. It is the set that
 * appears in real documents; the rest are mathematical aliases that a developer
 * pasting markup into a tool will not meet, and carrying them would be carrying
 * a data file nobody can verify by reading.
 */
const NAMED_ENTITY_TABLE: readonly (readonly [string, number])[] = [
  ["quot", 0x0022], ["amp", 0x0026], ["apos", 0x0027], ["lt", 0x003c], ["gt", 0x003e],
  ["OElig", 0x0152], ["oelig", 0x0153], ["Scaron", 0x0160], ["scaron", 0x0161],
  ["Yuml", 0x0178], ["fnof", 0x0192], ["circ", 0x02c6], ["tilde", 0x02dc],
  ["Alpha", 0x0391], ["Beta", 0x0392], ["Gamma", 0x0393], ["Delta", 0x0394],
  ["Epsilon", 0x0395], ["Zeta", 0x0396], ["Eta", 0x0397], ["Theta", 0x0398],
  ["Iota", 0x0399], ["Kappa", 0x039a], ["Lambda", 0x039b], ["Mu", 0x039c],
  ["Nu", 0x039d], ["Xi", 0x039e], ["Omicron", 0x039f], ["Pi", 0x03a0],
  ["Rho", 0x03a1], ["Sigma", 0x03a3], ["Tau", 0x03a4], ["Upsilon", 0x03a5],
  ["Phi", 0x03a6], ["Chi", 0x03a7], ["Psi", 0x03a8], ["Omega", 0x03a9],
  ["alpha", 0x03b1], ["beta", 0x03b2], ["gamma", 0x03b3], ["delta", 0x03b4],
  ["epsilon", 0x03b5], ["zeta", 0x03b6], ["eta", 0x03b7], ["theta", 0x03b8],
  ["iota", 0x03b9], ["kappa", 0x03ba], ["lambda", 0x03bb], ["mu", 0x03bc],
  ["nu", 0x03bd], ["xi", 0x03be], ["omicron", 0x03bf], ["pi", 0x03c0],
  ["rho", 0x03c1], ["sigmaf", 0x03c2], ["sigma", 0x03c3], ["tau", 0x03c4],
  ["upsilon", 0x03c5], ["phi", 0x03c6], ["chi", 0x03c7], ["psi", 0x03c8],
  ["omega", 0x03c9], ["thetasym", 0x03d1], ["upsih", 0x03d2], ["piv", 0x03d6],
  ["ensp", 0x2002], ["emsp", 0x2003], ["thinsp", 0x2009], ["zwnj", 0x200c],
  ["zwj", 0x200d], ["lrm", 0x200e], ["rlm", 0x200f], ["ndash", 0x2013],
  ["mdash", 0x2014], ["lsquo", 0x2018], ["rsquo", 0x2019], ["sbquo", 0x201a],
  ["ldquo", 0x201c], ["rdquo", 0x201d], ["bdquo", 0x201e], ["dagger", 0x2020],
  ["Dagger", 0x2021], ["bull", 0x2022], ["hellip", 0x2026], ["permil", 0x2030],
  ["prime", 0x2032], ["Prime", 0x2033], ["lsaquo", 0x2039], ["rsaquo", 0x203a],
  ["oline", 0x203e], ["frasl", 0x2044], ["euro", 0x20ac],
  ["image", 0x2111], ["weierp", 0x2118], ["real", 0x211c], ["trade", 0x2122],
  ["alefsym", 0x2135], ["larr", 0x2190], ["uarr", 0x2191], ["rarr", 0x2192],
  ["darr", 0x2193], ["harr", 0x2194], ["crarr", 0x21b5], ["lArr", 0x21d0],
  ["uArr", 0x21d1], ["rArr", 0x21d2], ["dArr", 0x21d3], ["hArr", 0x21d4],
  ["forall", 0x2200], ["part", 0x2202], ["exist", 0x2203], ["empty", 0x2205],
  ["nabla", 0x2207], ["isin", 0x2208], ["notin", 0x2209], ["ni", 0x220b],
  ["prod", 0x220f], ["sum", 0x2211], ["minus", 0x2212], ["lowast", 0x2217],
  ["radic", 0x221a], ["prop", 0x221d], ["infin", 0x221e], ["ang", 0x2220],
  ["and", 0x2227], ["or", 0x2228], ["cap", 0x2229], ["cup", 0x222a],
  ["int", 0x222b], ["there4", 0x2234], ["sim", 0x223c], ["cong", 0x2245],
  ["asymp", 0x2248], ["ne", 0x2260], ["equiv", 0x2261], ["le", 0x2264],
  ["ge", 0x2265], ["sub", 0x2282], ["sup", 0x2283], ["nsub", 0x2284],
  ["sube", 0x2286], ["supe", 0x2287], ["oplus", 0x2295], ["otimes", 0x2297],
  ["perp", 0x22a5], ["sdot", 0x22c5], ["lceil", 0x2308], ["rceil", 0x2309],
  ["lfloor", 0x230a], ["rfloor", 0x230b], ["loz", 0x25ca], ["spades", 0x2660],
  ["clubs", 0x2663], ["hearts", 0x2665], ["diams", 0x2666],
  ["lang", 0x27e8], ["rang", 0x27e9],
];

const NAMED_ENTITIES: ReadonlyMap<string, number> = ((): ReadonlyMap<string, number> => {
  const table = new Map<string, number>();
  const latin1 = LATIN1_ENTITY_NAMES.split(" ");
  for (let i = 0; i < latin1.length; i++) {
    table.set(latin1[i] ?? "", LATIN1_ENTITY_BASE + i);
  }
  for (const [name, codePoint] of NAMED_ENTITY_TABLE) table.set(name, codePoint);
  return table;
})();

export interface HtmlEntity {
  readonly name: string;
  readonly character: string;
  readonly codePoint: number;
}

/**
 * The whole named table as a list, sorted for display.
 *
 * Sorted with the Serbian collator rather than by code unit for the same reason
 * every other list in this app is: `Alpha` and `alpha` are different entities
 * and a reader looking one up wants them next to each other, which is what a
 * collator gives and what a byte comparison does not. `["sr-Latn", "sr"]` and
 * not plain `"sr"` — the bare tag tailors for Cyrillic and mis-orders Latin
 * š/č/ć.
 */
export const HTML_ENTITY_REFERENCE: readonly HtmlEntity[] = ((): readonly HtmlEntity[] => {
  const collator = new Intl.Collator(["sr-Latn", "sr"]);
  return [...NAMED_ENTITIES.entries()]
    .map(([name, codePoint]) => ({ name, character: String.fromCodePoint(codePoint), codePoint }))
    .sort((a, b) => collator.compare(a.name, b.name));
})();

/**
 * Text → escaped text.
 *
 * `minimal` escapes only the five that change how markup parses — the right
 * default, because escaping more makes the output unreadable without making it
 * safer. `aggressive` additionally writes every non-ASCII code point as a hex
 * numeric reference, for the one case that still matters: a pipeline that will
 * mangle the bytes because somebody downstream did not declare a charset.
 *
 * Iterates by code point, so an emoji becomes one reference and not two
 * references to the surrogate halves — which would be markup that renders as
 * two replacement characters.
 */
export function htmlEscape(text: string, mode: HtmlEscapeMode = "minimal"): string {
  let out = "";
  for (const character of text) {
    const minimal = HTML_MINIMAL.get(character);
    if (minimal !== undefined) {
      out += minimal;
      continue;
    }
    const codePoint = character.codePointAt(0) ?? 0;
    if (mode === "aggressive" && codePoint > 0x7f) {
      out += `&#x${codePoint.toString(16).toUpperCase()};`;
      continue;
    }
    out += character;
  }
  return out;
}

/** Long enough for the longest name here (`thetasym`, 8) and the longest numeric body (`#x10FFFF`, 8), with room to spare. */
const MAX_ENTITY_BODY = 32;

const ENTITY_NAME_SHAPE = /^[A-Za-z][A-Za-z0-9]*$/;
const ENTITY_DECIMAL_SHAPE = /^#([0-9]+)$/;
const ENTITY_HEX_SHAPE = /^#[xX]([0-9A-Fa-f]+)$/;

/**
 * Escaped text → text.
 *
 * **Refuses a bare `&`.** An HTML parser passes one through, and this does not,
 * because the two are answering different questions: a parser is rendering a
 * document that may be sloppy, whereas this tool has been handed a string on
 * the claim that it is escaped. If that string contains an `&` that starts no
 * entity, either the producer forgot to escape it or the text was never escaped
 * at all — and both are worth being told, at the offset, rather than smoothed
 * over. Note that `htmlEscape` never produces one, so the round trip is exact.
 *
 * **Does not do HTML5's numeric repairs, and this is the sharp edge.** The
 * HTML5 tokeniser maps `&#128;` to U+20AC (a windows-1252 legacy rule),
 * `&#0;` and every surrogate and every value above U+10FFFF to U+FFFD. This
 * returns U+0080 for the first and refuses the rest. The reason is that the two
 * tools have different jobs: a browser must render something, while this must
 * report what the document SAYS. A tool that quietly reproduced the legacy
 * mapping would make `&#128;` and `&#8364;` indistinguishable, which is exactly
 * the confusion someone opens an entity decoder to resolve.
 */
export function htmlUnescape(text: string): EncodingResult<string> {
  let out = "";
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 0x26) {
      const chunk = String.fromCodePoint(text.codePointAt(i) ?? 0);
      out += chunk;
      i += chunk.length;
      continue;
    }
    const end = text.indexOf(";", i + 1);
    if (end < 0 || end - i - 1 > MAX_ENTITY_BODY) return failAt("entity-unterminated", i);
    const body = text.slice(i + 1, end);

    if (ENTITY_NAME_SHAPE.test(body)) {
      const codePoint = NAMED_ENTITIES.get(body);
      if (codePoint === undefined) return failAt("entity-unknown", i);
      out += String.fromCodePoint(codePoint);
      i = end + 1;
      continue;
    }

    const decimal = ENTITY_DECIMAL_SHAPE.exec(body);
    const hex = decimal === null ? ENTITY_HEX_SHAPE.exec(body) : null;
    const digits = decimal?.[1] ?? hex?.[1];
    // Neither a name nor a number: the `&` was not the start of an entity.
    if (digits === undefined) return failAt("entity-unterminated", i);
    const codePoint = Number.parseInt(digits, decimal === null ? 16 : 10);
    if (!isScalarValue(codePoint)) return failAt("entity-out-of-range", i);
    out += String.fromCodePoint(codePoint);
    i = end + 1;
  }
  return ok(out);
}

// --- 7. hexdump -------------------------------------------------------------

export const HEXDUMP_DEFAULT_BYTES_PER_LINE = 16;
export const HEXDUMP_DEFAULT_BYTES_PER_GROUP = 8;

export interface HexdumpOptions {
  readonly bytesPerLine?: number;
  readonly bytesPerGroup?: number;
}

/**
 * The canonical dump: offset, the bytes as lowercase hex in groups, then the
 * printable-ASCII gutter between pipes with `.` standing in for everything
 * else.
 *
 * ```
 * 00000000: 48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 0a        |Hello, world!.|
 * ```
 *
 * Lowercase hex here and UPPERCASE in `textViews` is not an oversight. This
 * output exists to be compared, line for line, against what `xxd` and
 * `hexdump -C` print, and both print lowercase; the character-by-character view
 * is compared against percent-escapes and Unicode notation, which are
 * conventionally uppercase. Matching the neighbouring tool in each case beats a
 * consistency nobody can use.
 *
 * The hex field is padded to a fixed width so the opening pipe lands in the
 * same column on every line; the gutter itself is NOT padded, because it holds
 * exactly the bytes present and both `xxd` and `hexdump -C` end the last line
 * early. So lines are column-aligned without being equal in length.
 *
 * The gutter is always pipe-delimited, which `xxd` does not do — and that is
 * what makes `parseHexdump` able to read this back exactly. See its comment.
 *
 * A layout option outside its range throws: those come from the surface, not
 * from a text field, so a bad one is a caller bug rather than user input.
 */
export function hexdump(bytes: Uint8Array, options: HexdumpOptions = {}): string {
  const perLine = options.bytesPerLine ?? HEXDUMP_DEFAULT_BYTES_PER_LINE;
  const perGroup = options.bytesPerGroup ?? HEXDUMP_DEFAULT_BYTES_PER_GROUP;
  if (!Number.isInteger(perLine) || perLine < 1) {
    throw new RangeError(`hexdump bytesPerLine must be a positive integer, got: ${String(perLine)}`);
  }
  if (!Number.isInteger(perGroup) || perGroup < 1) {
    throw new RangeError(
      `hexdump bytesPerGroup must be a positive integer, got: ${String(perGroup)}`,
    );
  }

  const groupsPerLine = Math.ceil(perLine / perGroup);
  const groupWidth = perGroup * 3 - 1;
  const lines: string[] = [];
  for (let start = 0; start < bytes.length; start += perLine) {
    const line = bytes.subarray(start, Math.min(start + perLine, bytes.length));
    const groups: string[] = [];
    for (let group = 0; group < groupsPerLine; group++) {
      const from = group * perGroup;
      const slice = line.subarray(from, Math.min(from + perGroup, line.length));
      groups.push(
        [...slice]
          .map((byte) => byte.toString(16).padStart(2, "0"))
          .join(" ")
          .padEnd(groupWidth),
      );
    }
    const gutter = [...line]
      .map((byte) => (byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : "."))
      .join("");
    lines.push(`${start.toString(16).padStart(8, "0")}: ${groups.join("  ")}  |${gutter}|`);
  }
  return lines.join("\n");
}

const HEX_TOKEN = /^(?:[0-9a-fA-F]{2})+$/;
const COLON_OFFSET = /^([0-9a-fA-F]+)\s*:\s*/;
const BARE_OFFSET = /^([0-9a-fA-F]{8})\s\s+/;

type HexdumpOffsetFormat = "colon" | "bare" | "none";

/**
 * Consume one line's hex field into `bytes`, or name why it is not one.
 *
 * The two refusals are different on purpose. A junk token right after another
 * token is a corrupt dump (`not-a-hexdump`); a junk token separated by two or
 * more spaces is almost certainly an undelimited ASCII gutter, which gets its
 * own code so the message can say what to do about it.
 */
function readHexField(field: string, bytes: number[]): EncodingErrorCode | null {
  const tokens = /\S+/g;
  let previousEnd = 0;
  for (let match = tokens.exec(field); match !== null; match = tokens.exec(field)) {
    const token = match[0];
    if (!HEX_TOKEN.test(token)) {
      return previousEnd > 0 && match.index - previousEnd >= 2
        ? "hexdump-ambiguous-gutter"
        : "not-a-hexdump";
    }
    for (let i = 0; i < token.length; i += 2) {
      bytes.push((hexValue(token.charCodeAt(i)) << 4) | hexValue(token.charCodeAt(i + 1)));
    }
    previousEnd = match.index + token.length;
  }
  return null;
}

/**
 * A hexdump back to bytes. Reads what `hexdump` writes, and also `xxd`'s
 * default (`00000000: 4865 6c6c …`), `hexdump -C`'s bare offsets, and a plain
 * continuous hex run with no offsets at all.
 *
 * **The offset format is decided once, from the first line, and then enforced
 * on every line.** Deciding per line is the bug: `hexdump -C` writes its offset
 * with no colon, so a line that begins `00000000  48 65 …` is eight hex digits
 * followed by data, and a parser that guesses line by line will read four zero
 * bytes that are not there — silently, since the result is still bytes. Fixing
 * the format up front and then checking every offset against the running byte
 * count turns that whole class into a loud `hexdump-offset-mismatch`, and
 * catches `hexdump -C`'s `*` elision line at the same time, which would
 * otherwise drop a run of repeated bytes without a word.
 *
 * **An undelimited ASCII gutter is refused, not guessed past.** `xxd` writes
 * its gutter as trailing text with no delimiter, and a dump whose data happens
 * to spell `beef`, `dead`, `face` or `cafe` is then genuinely undecidable — the
 * same characters are both plausible text and four plausible nibbles. Rather
 * than pick, this refuses with `hexdump-ambiguous-gutter` so the message can
 * say: delete the gutter column, or use a dump whose gutter is delimited. Every
 * dump this module produces is delimited, so its own round trip is exact.
 */
export function parseHexdump(text: string): EncodingResult<Uint8Array> {
  const lines = text.split(/\r?\n/);
  const bytes: number[] = [];
  let format: HexdumpOffsetFormat | null = null;

  for (const raw of lines) {
    const pipe = raw.indexOf("|");
    const stripped = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
    if (stripped === "") continue;

    if (format === null) {
      format = COLON_OFFSET.test(stripped)
        ? "colon"
        : /^0{8}\s\s/.test(stripped)
          ? "bare"
          : "none";
    }

    let field = stripped;
    if (format !== "none") {
      const match = (format === "colon" ? COLON_OFFSET : BARE_OFFSET).exec(stripped);
      if (match === null) return fail("not-a-hexdump");
      if (Number.parseInt(match[1] ?? "", 16) !== bytes.length) {
        return fail("hexdump-offset-mismatch");
      }
      field = stripped.slice(match[0].length);
    }

    const problem = readHexField(field, bytes);
    if (problem !== null) return fail(problem);
  }

  return ok(Uint8Array.from(bytes));
}
