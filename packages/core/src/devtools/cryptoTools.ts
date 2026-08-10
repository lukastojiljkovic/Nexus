import { base64ToBytesOrNull, bytesToBase64, bytesToHex, hexToBytes } from "../bytes.js";
import { webCryptoRandom, type RandomPort } from "./random.js";

/**
 * The cryptography drawer: eight tools that operate ONLY on what the user typed
 * into them.
 *
 * **The boundary, first, because it is the reason this file is allowed to
 * exist.** Nothing here reads an app key, a profile, the database or the
 * Recovery Kit; nothing here writes one. Every key is either generated for this
 * one call or pasted into the field by the person at the keyboard. That makes
 * this a calculator that happens to compute AES, not a second cryptographic
 * subsystem — and it is why a defect in here cannot reach a user's data. Keep
 * it that way: the moment one of these functions takes a profile id, it stops
 * being a tool and starts being a security surface.
 *
 * **Why `crypto.subtle` directly rather than `@nexus/sync-port`.** That package
 * is the sanctioned adapter and its header forbids a second one — but what it
 * adapts is the sync `CryptoPort`: SHA-256, HMAC-SHA-256, HKDF, Argon2id,
 * XChaCha20-Poly1305 and X25519. Not one of the primitives this drawer is about
 * (SHA-1/384/512, HMAC over each, AES-GCM/CBC, PBKDF2, RSA-OAEP/PSS/PKCS1v15,
 * ECDSA) is on that list, so there is nothing here to route through it and no
 * second implementation of anything it owns. Importing it would also invert the
 * dependency direction — `@nexus/core` is below sync, not above it — and drag
 * `@noble/ciphers` plus `hash-wasm` into a devtool. So: platform WebCrypto,
 * reached the same way that file reaches it, with the same type derivation off
 * `globalThis.crypto` so this compiles under Node's libs and the DOM's alike.
 *
 * **Refuse, do not repair.** Every entry point answers a `CryptoToolResult`.
 * Bad user input is a typed failure with a code the surface turns into Serbian;
 * a `throw` from here means a CALLER bug, and there are only a couple of those.
 * A GCM tag that does not check out is `aes-authentication-failed`, never an
 * empty string; a plaintext too long for an RSA key is refused WITH the number
 * of bytes that would have fit, rather than left for WebCrypto to reject with
 * `OperationError`.
 *
 * **Randomness comes through `RandomPort`.** Not because the default is
 * suspect — it is `crypto.getRandomValues` — but because a token generator
 * whose bias can only be argued about is a token generator nobody has tested.
 * With the port, a test feeds known bytes and checks the exact string that
 * falls out, including the bytes the rejection sampler is supposed to throw
 * away.
 *
 * **MD5 is absent on purpose.** WebCrypto has none, and hand-rolling one would
 * mean shipping an unreviewed implementation of a broken primitive; the drawer
 * reports it unavailable and names it, which is a more useful answer than a
 * hash nobody should act on. `hashAvailability` exists to make that refusal a
 * value rather than a missing menu entry.
 */

// ── Results ────────────────────────────────────────────────────────────────

/**
 * Every way a tool in this file can decline. One flat union rather than a
 * per-tool enum, so the surface holds ONE message table and a new tool cannot
 * quietly invent a failure with no Serbian text behind it.
 */
export type CryptoToolFailureCode =
  | "length-out-of-range"
  | "count-out-of-range"
  | "alphabet-too-small"
  | "alphabet-too-large"
  | "alphabet-repeats"
  | "no-character-classes"
  | "length-below-required-classes"
  | "randomness-exhausted"
  | "word-count-out-of-range"
  | "invalid-hex"
  | "invalid-base64"
  | "not-utf8"
  | "pem-malformed"
  | "pem-wrong-label"
  | "key-import-failed"
  | "key-is-private"
  | "key-length-mismatch"
  | "iterations-too-low"
  | "unsupported-algorithm"
  | "hash-unavailable"
  | "jwt-malformed"
  | "jwt-not-base64url"
  | "jwt-not-json"
  | "jwt-alg-missing"
  | "jwt-alg-none"
  | "jwt-alg-unsupported"
  | "jwt-key-mismatch"
  | "aes-authentication-failed"
  | "aes-decrypt-failed"
  | "envelope-malformed"
  | "envelope-key-mismatch"
  | "rsa-plaintext-too-long"
  | "rsa-decrypt-failed"
  | "signature-failed";

/**
 * A refusal, with the figures the message needs interpolated into it.
 *
 * `limit`/`actual` carry the numbers the user has to act on — „najvise 190
 * bajtova, uneto 240" is an instruction, „predugacko" is a shrug. `subject`
 * carries an identifier quoted verbatim: the `alg` a token asked for, the PEM
 * label that turned up instead of the expected one.
 */
export interface CryptoToolFailure {
  readonly code: CryptoToolFailureCode;
  readonly limit?: number;
  readonly actual?: number;
  readonly subject?: string;
}

/** A tool's answer: the value, or the reason there is none. Never a throw for user input. */
export type CryptoToolResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: CryptoToolFailure };

const ok = <T>(value: T): CryptoToolResult<T> => ({ ok: true, value });

const fail = <T>(
  code: CryptoToolFailureCode,
  detail?: Omit<CryptoToolFailure, "code">,
): CryptoToolResult<T> => ({ ok: false, failure: { code, ...detail } });

/**
 * Uniform indices into an alphabet of `alphabetSize`, by REJECTION SAMPLING.
 *
 * **Never `byte % alphabetSize`.** 256 is not a multiple of 58, so a modulo
 * hands the first 256 mod 58 = 24 characters of a base58 alphabet an extra
 * chance each: they come up 5/256 of the time against 4/256 for the rest, a
 * 25% surplus on the low quarter of the alphabet. Nothing about the token looks
 * wrong — it is the right length out of the right characters — and the entropy
 * this file reports would be an overstatement on every single one. That is the
 * quiet kind of weakness a generator is exactly the wrong place for.
 *
 * So: take the low `bits` of each byte, where `bits` is the fewest that can
 * express `alphabetSize − 1`, and DISCARD anything that lands past the end.
 * Masking rather than taking bytes whole keeps the acceptance rate above one
 * half for every size — the mask's range is under twice the alphabet by
 * construction — which is what makes the byte budget below sufficient rather
 * than hopeful.
 *
 * `null` when the budget runs out — which real randomness will not do (the odds
 * are worse than 2^-count) but a fake port feeding a constant certainly will,
 * and a non-terminating loop is not an acceptable answer to a bad port.
 */
function randomIndices(
  random: RandomPort,
  alphabetSize: number,
  count: number,
): readonly number[] | null {
  let bits = 1;
  while (1 << bits < alphabetSize) bits += 1;
  const mask = (1 << bits) - 1;

  const indices: number[] = [];
  // Sixteen bytes per index against a worst case of two: room for a run of bad
  // luck no real generator will have, and a hard stop for one that is stuck.
  let budget = count * 16 + 256;

  while (indices.length < count) {
    const wanted = Math.min(budget, (count - indices.length) * 2 + 8);
    if (wanted <= 0) return null;
    const block = random.bytes(wanted);
    budget -= wanted;
    for (const byte of block) {
      const candidate = byte & mask;
      if (candidate < alphabetSize) {
        indices.push(candidate);
        if (indices.length === count) break;
      }
    }
    if (budget <= 0 && indices.length < count) return null;
  }
  return indices;
}

/** The characters at `indices`, joined. `chars` is code points, so an astral alphabet survives. */
function pick(chars: readonly string[], indices: readonly number[]): string {
  let out = "";
  for (const index of indices) out += chars[index] ?? "";
  return out;
}

// ── Encodings ──────────────────────────────────────────────────────────────

/**
 * Hex and standard base64 come from `../bytes.ts`, this package's one codec,
 * and are re-exported under these names because the drawer's surfaces and tests
 * reach for them here.
 *
 * What is left below is this module's POLICY rather than a codec: the base64url
 * alphabet, JWS's no-padding rule, and the check that padding — when it is
 * present at all — is padding of a complete group. None of that belongs in a
 * shared codec, and all of it is what a cryptography drawer is for.
 */
export { bytesToBase64, bytesToHex, hexToBytes };

/** Base64url (RFC 4648 §5) with the padding removed, which is what JWS uses. */
export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const BASE64_STANDARD = /^[A-Za-z0-9+/]*={0,2}$/;
const BASE64_URL = /^[A-Za-z0-9_-]*$/;

function decodeBase64(canonical: string): Uint8Array | null {
  // A remainder of 1 is impossible for any byte string: 4 base64 characters
  // carry 3 bytes, and no number of bytes produces a lone trailing character.
  if (canonical.length % 4 === 1) return null;
  return base64ToBytesOrNull(canonical.padEnd(Math.ceil(canonical.length / 4) * 4, "="));
}

/** Standard base64 to bytes, padded or not, whitespace ignored; `null` for anything else. */
export function base64ToBytes(text: string): Uint8Array | null {
  const stripped = text.replace(/\s+/g, "");
  if (!BASE64_STANDARD.test(stripped)) return null;
  const body = stripped.replace(/=+$/, "");
  // Unpadded input is accepted, but input that DOES pad has to pad correctly:
  // padding only means anything on a complete four-character group, and a run
  // of nothing but „=" is not an encoding of anything. Without this, „==" would
  // decode to zero bytes and be indistinguishable from a legitimately empty
  // value — which for a key field is the difference between „you pasted
  // nothing" and „you pasted something broken".
  if (body.length !== stripped.length && (stripped.length % 4 !== 0 || body.length === 0)) {
    return null;
  }
  return decodeBase64(body);
}

/**
 * Base64url to bytes, STRICTLY: no padding, no `+`, no `/`, no whitespace.
 *
 * Strict because this is what reads JWS segments, and RFC 7515 §2 defines them
 * as base64url with padding OMITTED. A decoder that also accepted `=` would
 * accept a token no compliant verifier does, which is precisely the confusion a
 * JWT inspector is supposed to clear up rather than add to.
 */
export function base64UrlToBytes(text: string): Uint8Array | null {
  if (!BASE64_URL.test(text)) return null;
  return decodeBase64(text.replace(/-/g, "+").replace(/_/g, "/"));
}

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true });

/** Text as UTF-8 bytes. */
export function textToBytes(text: string): Uint8Array {
  return UTF8_ENCODER.encode(text);
}

/**
 * Bytes back to text, or `null` when they are not UTF-8.
 *
 * Fatal rather than lenient, and that matters for AES-CBC: an unauthenticated
 * mode decrypts a wrong key into plausible-looking garbage, and a lenient
 * decoder would paper that over with U+FFFD replacement characters and call it
 * plaintext. Refusing is the closest thing CBC has to telling the truth.
 */
export function bytesToText(bytes: Uint8Array): string | null {
  try {
    return UTF8_DECODER.decode(bytes);
  } catch {
    return null;
  }
}

// ── PEM ────────────────────────────────────────────────────────────────────

/** The label a PKCS#8 private key wears (RFC 7468 §10). */
export const PEM_LABEL_PRIVATE = "PRIVATE KEY";

/** The label an SPKI public key wears (RFC 7468 §13). */
export const PEM_LABEL_PUBLIC = "PUBLIC KEY";

const PEM_LINE_LENGTH = 64;

/**
 * DER to PEM, written out here rather than borrowed.
 *
 * RFC 7468 §2 wraps the base64 at 64 characters and ends every line — including
 * the last — with a line break. The wrap is not cosmetic: tools that read PEM
 * with a line-oriented parser reject a single enormous line, so a PEM this app
 * emits that OpenSSL cannot read would be this app's bug. LF rather than CRLF,
 * since §3's grammar allows either and every consumer accepts LF.
 */
export function toPem(label: string, der: Uint8Array): string {
  const body = bytesToBase64(der);
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += PEM_LINE_LENGTH) {
    lines.push(body.slice(i, i + PEM_LINE_LENGTH));
  }
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

const PEM_BLOCK = /-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END ([A-Z0-9 ]+)-----/;

/** A PEM block's label and DER bytes. */
export interface PemBlock {
  readonly label: string;
  readonly der: Uint8Array;
}

/**
 * PEM to DER, or a refusal.
 *
 * Mismatched BEGIN and END labels are `pem-malformed` rather than a preference
 * for the first: a block that opens as a private key and closes as a
 * certificate is a paste that went wrong, and picking one of the two names
 * would decide which half of the accident to believe.
 */
export function fromPem(text: string, expectedLabel?: string): CryptoToolResult<PemBlock> {
  const match = PEM_BLOCK.exec(text);
  if (match === null) return fail("pem-malformed");
  const [, opening = "", body = "", closing = ""] = match;
  if (opening !== closing) return fail("pem-malformed");
  if (expectedLabel !== undefined && opening !== expectedLabel) {
    return fail("pem-wrong-label", { subject: opening });
  }
  const der = base64ToBytes(body);
  if (der === null || der.length === 0) return fail("pem-malformed");
  return ok({ label: opening, der });
}

// ── WebCrypto plumbing ─────────────────────────────────────────────────────

/**
 * The WebCrypto types read OFF the global rather than named, exactly as
 * `@nexus/sync-port` does and for the same reason: `SubtleCrypto` and
 * `CryptoKey` are DOM identifiers, and this package is compiled against Node's
 * libs in some of the places it runs.
 */
type Subtle = (typeof globalThis)["crypto"]["subtle"];

/** WebCrypto's opaque key handle, under whichever name the host libs give it. */
type KeyHandle = Awaited<ReturnType<Subtle["importKey"]>>;

/**
 * The algorithm and usage parameter types, read off the methods rather than
 * named for the same reason as `Subtle` itself — `RsaHashedImportParams`,
 * `EcdsaParams` and `KeyUsage` are DOM identifiers too. A plain
 * `Record<string, unknown>` will NOT do here and the attempt is worth recording:
 * the platform's parameter types are a discriminated union, and widening to a
 * record is precisely what would let `{ name: "ECDSA" }` be passed where a
 * `namedCurve` is required.
 */
type ImportAlgorithm = Parameters<Subtle["importKey"]>[2];

/** The algorithm parameter `sign` and `verify` share. */
type SignAlgorithm = Parameters<Subtle["sign"]>[0];

/**
 * One WebCrypto key usage — the ELEMENT type, inferred out of whatever
 * container the host libs declare the parameter as.
 *
 * **Why not `Parameters<Subtle["importKey"]>[4]` directly.** `Parameters<>` of
 * an overloaded method resolves to its LAST overload, and which overload is
 * last depends on the libs in scope: with `DOM` alone the parameter is
 * `KeyUsage[]`, and `DOM.Iterable` appends a further overload that widens it to
 * `Iterable<KeyUsage>`. So the same expression meant two different things in
 * this package's own build (no `DOM.Iterable`) and in the renderer's — and an
 * `Iterable` is not assignable to the `ReadonlyArray<KeyUsage>` that
 * `generateKey` wants, which is how a file that typechecked green here failed
 * the moment a renderer surface imported it. Inferring the element type and
 * re-forming the array is stable under every lib combination.
 */
type KeyUsage = Parameters<Subtle["importKey"]>[4] extends Iterable<infer Usage> ? Usage : never;

/** `KeyUsage[]`, so a usage list built by a conditional is not merely `string[]`. */
type KeyUsages = KeyUsage[];

function subtle(): Subtle {
  const provider = globalThis.crypto;
  if (provider?.subtle === undefined) {
    // Not user input and not recoverable: the module was loaded somewhere
    // WebCrypto does not exist, an insecure origin being the realistic case.
    throw new Error(
      "WebCrypto is unavailable. The crypto tools require globalThis.crypto.subtle, " +
        "which browsers expose only in a secure context (HTTPS or localhost).",
    );
  }
  return provider.subtle;
}

/**
 * `Uint8Array` → the `BufferSource` WebCrypto wants, WITHOUT reaching for
 * `.buffer`: a view onto a larger buffer would then hand WebCrypto bytes the
 * caller never offered. The cast is `ArrayBufferLike` meeting `ArrayBuffer`,
 * a gap only `SharedArrayBuffer` occupies and nothing in this product allocates.
 */
const view = (bytes: Uint8Array): Uint8Array<ArrayBuffer> => bytes as Uint8Array<ArrayBuffer>;

const bytesOf = (buffer: ArrayBuffer): Uint8Array => new Uint8Array(buffer);

/** `modulusLength` off an imported RSA key, structurally — `KeyAlgorithm` declares only `name`. */
function modulusBitsOf(key: KeyHandle): number | null {
  const algorithm: unknown = key.algorithm;
  if (typeof algorithm !== "object" || algorithm === null) return null;
  const length: unknown = (algorithm as { modulusLength?: unknown }).modulusLength;
  return typeof length === "number" ? length : null;
}

// ── 1. Token generator ─────────────────────────────────────────────────────

/** The named alphabets, plus the escape hatch. */
export const TOKEN_ALPHABETS = ["hex", "base64url", "base58", "alphanumeric", "custom"] as const;

export type TokenAlphabetId = (typeof TOKEN_ALPHABETS)[number];

/**
 * The named alphabets' characters.
 *
 * base58 is Bitcoin's ordering, which drops `0`, `O`, `I` and `l` — the four
 * glyphs that trade places when a token is read off a screen and typed into
 * something else. base64url is RFC 4648 §5's, so a token from here is safe in a
 * URL path or a filename without escaping.
 */
const TOKEN_ALPHABET_CHARS: Readonly<Record<Exclude<TokenAlphabetId, "custom">, string>> = {
  // Written out rather than borrowed from the hex codec's digit table: this is
  // the alphabet a RANDOM TOKEN is drawn from, and the fact that it currently
  // spells the same sixteen characters is a coincidence of notation, not a
  // shared rule. Sharing the constant would mean a change to one silently
  // changing the other.
  hex: "0123456789abcdef",
  base64url: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_",
  base58: "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
  alphanumeric: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
};

/** Longest token this tool will make. Past this the field is being used as a file generator. */
export const MAX_TOKEN_LENGTH = 512;

/** Most tokens one press produces. */
export const MAX_TOKEN_COUNT = 500;

/** A custom alphabet may not exceed one byte's worth of distinct characters. */
export const MAX_CUSTOM_ALPHABET_SIZE = 256;

export interface TokenRequest {
  /** Characters per token, 1…`MAX_TOKEN_LENGTH`. */
  readonly length: number;
  readonly alphabet: TokenAlphabetId;
  /** Required — and only read — when `alphabet` is `"custom"`. */
  readonly customAlphabet?: string;
  /** How many to make. Defaults to one. */
  readonly count?: number;
}

export interface TokenBatch {
  readonly tokens: readonly string[];
  /** The alphabet actually used, so the surface can show what the entropy was computed over. */
  readonly alphabet: string;
  readonly alphabetSize: number;
  /** `length · log2(alphabetSize)` — exact, because the sampler above is unbiased. */
  readonly entropyBitsPerToken: number;
}

/**
 * `count` random tokens.
 *
 * A custom alphabet is refused for repeating a character rather than deduped:
 * a repeat means the user's intent is ambiguous — did they want that character
 * twice as likely, or did they paste it twice — and the reported entropy would
 * be wrong under the first reading and right under the second. Asking again is
 * cheap; a token generator whose stated strength is a guess is not.
 */
export function generateTokens(
  request: TokenRequest,
  random: RandomPort = webCryptoRandom,
): CryptoToolResult<TokenBatch> {
  const { length, alphabet, count = 1 } = request;
  if (!Number.isInteger(length) || length < 1 || length > MAX_TOKEN_LENGTH) {
    return fail("length-out-of-range", { limit: MAX_TOKEN_LENGTH, actual: length });
  }
  if (!Number.isInteger(count) || count < 1 || count > MAX_TOKEN_COUNT) {
    return fail("count-out-of-range", { limit: MAX_TOKEN_COUNT, actual: count });
  }

  let alphabetText: string;
  if (alphabet === "custom") {
    alphabetText = request.customAlphabet ?? "";
  } else {
    alphabetText = TOKEN_ALPHABET_CHARS[alphabet];
  }

  // Code points, not UTF-16 units: a custom alphabet containing an emoji is
  // one character to the person who typed it, and slicing it in half would
  // emit lone surrogates.
  const chars = [...alphabetText];
  if (chars.length < 2) return fail("alphabet-too-small", { actual: chars.length });
  if (chars.length > MAX_CUSTOM_ALPHABET_SIZE) {
    return fail("alphabet-too-large", { limit: MAX_CUSTOM_ALPHABET_SIZE, actual: chars.length });
  }
  if (new Set(chars).size !== chars.length) return fail("alphabet-repeats");

  const indices = randomIndices(random, chars.length, length * count);
  if (indices === null) return fail("randomness-exhausted");

  const tokens: string[] = [];
  for (let i = 0; i < count; i += 1) {
    tokens.push(pick(chars, indices.slice(i * length, (i + 1) * length)));
  }
  return ok({
    tokens,
    alphabet: alphabetText,
    alphabetSize: chars.length,
    entropyBitsPerToken: length * Math.log2(chars.length),
  });
}

// ── 2. Password generator ──────────────────────────────────────────────────

export const PASSWORD_CLASSES = ["lower", "upper", "digit", "symbol"] as const;

export type PasswordClass = (typeof PASSWORD_CLASSES)[number];

/**
 * The four classes.
 *
 * The symbol set deliberately omits the quote characters, the backslash, the
 * backtick, the space and the number sign. Not for „compatibility" in the vague
 * sense — for the concrete one: those are the characters that change meaning
 * when a password travels through a shell command, a CSV column or a
 * hand-written config file, where the number sign starts a comment and the rest
 * start or end a string. A password silently altered in transit is worse than a
 * shorter one. The cost is stated rather than hidden: 27 symbols instead of 33,
 * which the reported entropy already accounts for.
 */
const PASSWORD_CLASS_CHARS: Readonly<Record<PasswordClass, string>> = {
  lower: "abcdefghijklmnopqrstuvwxyz",
  upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  digit: "0123456789",
  symbol: "!$%&()*+,-./:;<=>?@[]^_{|}~",
};

/** The glyphs a person confuses when reading a password aloud or off paper. */
export const AMBIGUOUS_CHARACTERS = "0O1lI";

/** Longest password this tool will make. */
export const MAX_PASSWORD_LENGTH = 256;

export interface PasswordRequest {
  readonly length: number;
  /** At least one. Order is irrelevant; duplicates are ignored. */
  readonly classes: readonly PasswordClass[];
  /** Drop `0O1lI` from every class. */
  readonly excludeAmbiguous?: boolean;
  /** Guarantee at least one character from each selected class. */
  readonly requireEachClass?: boolean;
}

export interface GeneratedPassword {
  readonly password: string;
  readonly alphabetSize: number;
  /**
   * Bits of entropy in THIS password, given how it was actually drawn.
   *
   * Without `requireEachClass` that is `length · log2(alphabetSize)`. With it,
   * the draw is uniform over a strictly smaller set — the strings that contain
   * every class — and the honest figure is `log2` of the size of that set,
   * which is a little LOWER. Reporting the unrestricted number there would
   * overstate a password by up to a couple of bits, and overstating strength is
   * the one direction a generator must never round.
   */
  readonly entropyBits: number;
}

/**
 * `log2` of the number of strings of `length` over an alphabet split into
 * `classSizes` that contain at least one character of every class.
 *
 * Inclusion–exclusion over the classes forbidden from appearing:
 * `N = Σ_{S ⊆ classes} (−1)^|S| (n − |S|)^length`. Computed in LOG space —
 * `length·log2(n) + log2(Σ (−1)^|S| ((n−|S|)/n)^length)` — because the direct
 * form overflows a double at around a 160-character password, and a generator
 * that reports `Infinity` bits is reporting nothing.
 *
 * The parenthesised sum is also the probability that an unrestricted draw
 * happens to contain every class, which is what the rejection loop below is
 * spending its attempts on.
 */
function restrictedEntropyBits(classSizes: readonly number[], length: number): number {
  const total = classSizes.reduce((sum, size) => sum + size, 0);
  let acceptance = 0;
  for (let subset = 0; subset < 1 << classSizes.length; subset += 1) {
    let excluded = 0;
    let members = 0;
    for (let i = 0; i < classSizes.length; i += 1) {
      if ((subset & (1 << i)) !== 0) {
        excluded += classSizes[i] ?? 0;
        members += 1;
      }
    }
    acceptance += (members % 2 === 0 ? 1 : -1) * ((total - excluded) / total) ** length;
  }
  return length * Math.log2(total) + Math.log2(acceptance);
}

/** How many whole candidates the require-each-class loop will draw before giving up. */
const PASSWORD_ATTEMPT_BUDGET = 4096;

/**
 * A random password.
 *
 * **Require-each-class is enforced by REJECTION, not by placement.** The usual
 * implementation picks one character from each class, fills the rest, and
 * shuffles — and it is subtly non-uniform unless the shuffle is perfect, which
 * is one more thing to get right. Drawing whole candidates and discarding the
 * ones that miss a class is uniform over the valid set by construction, which
 * is exactly the set `restrictedEntropyBits` counts. The two agree because they
 * are the same statement.
 */
export function generatePassword(
  request: PasswordRequest,
  random: RandomPort = webCryptoRandom,
): CryptoToolResult<GeneratedPassword> {
  const { length, excludeAmbiguous = false, requireEachClass = false } = request;
  if (!Number.isInteger(length) || length < 1 || length > MAX_PASSWORD_LENGTH) {
    return fail("length-out-of-range", { limit: MAX_PASSWORD_LENGTH, actual: length });
  }

  const selected = PASSWORD_CLASSES.filter((name) => request.classes.includes(name));
  if (selected.length === 0) return fail("no-character-classes");

  const classChars = selected.map((name) => {
    const chars = [...PASSWORD_CLASS_CHARS[name]];
    return excludeAmbiguous ? chars.filter((ch) => !AMBIGUOUS_CHARACTERS.includes(ch)) : chars;
  });
  // Excluding the ambiguous glyphs cannot empty a class here (the smallest,
  // digits, keeps nine), but a future class could be all-ambiguous and an
  // empty class would make the entropy arithmetic divide by its own size.
  if (classChars.some((chars) => chars.length === 0)) return fail("alphabet-too-small");

  if (requireEachClass && length < selected.length) {
    return fail("length-below-required-classes", { limit: selected.length, actual: length });
  }

  const alphabet = classChars.flat();
  const classSizes = classChars.map((chars) => chars.length);
  const entropyBits = requireEachClass
    ? restrictedEntropyBits(classSizes, length)
    : length * Math.log2(alphabet.length);

  for (let attempt = 0; attempt < PASSWORD_ATTEMPT_BUDGET; attempt += 1) {
    const indices = randomIndices(random, alphabet.length, length);
    if (indices === null) return fail("randomness-exhausted");
    const password = pick(alphabet, indices);
    if (!requireEachClass || classChars.every((chars) => chars.some((c) => password.includes(c)))) {
      return ok({ password, alphabetSize: alphabet.length, entropyBits });
    }
  }
  return fail("randomness-exhausted");
}

// ── 2b. Passphrase ─────────────────────────────────────────────────────────

export const WORD_LISTS = ["sr", "en"] as const;

export type WordListId = (typeof WORD_LISTS)[number];

/** Words per list. A power of two, so a word is exactly 8 bits and needs no rounding. */
export const WORD_LIST_SIZE = 256;

/** Most words one passphrase may have. */
export const MAX_PASSPHRASE_WORDS = 32;

export interface PassphraseRequest {
  readonly words: number;
  readonly list: WordListId;
  /** What goes between the words. Defaults to a hyphen. */
  readonly separator?: string;
  /** Upper-case each word's first letter. Adds no entropy and is not counted. */
  readonly capitalize?: boolean;
}

export interface GeneratedPassphrase {
  readonly passphrase: string;
  readonly words: readonly string[];
  readonly listSize: number;
  /**
   * `words · log2(listSize)` — from the LIST, never from the character count.
   *
   * The classic wrong answer is to measure the finished string: „22 characters,
   * lower case and hyphens, so 22 · log2(27) ≈ 104 bits". It is nonsense. The
   * attacker who knows this tool exists guesses WORDS, not letters, and six
   * words from a 256-word list is 48 bits however long the words happen to be.
   * Overstating it by a factor of two is how a passphrase ends up trusted with
   * something it cannot carry.
   */
  readonly entropyBits: number;
}

/** One of the two word lists, in its declared order. */
export function wordList(id: WordListId): readonly string[] {
  return id === "sr" ? SERBIAN_WORDS : ENGLISH_WORDS;
}

/**
 * A random passphrase.
 *
 * Words are drawn WITH replacement, which is what makes the entropy formula
 * exact rather than approximate: every position is an independent uniform pick
 * out of 256. Drawing without replacement would be marginally stronger and the
 * stated figure would then be slightly wrong, and a correct number beats an
 * unmeasured fraction of a bit.
 */
export function generatePassphrase(
  request: PassphraseRequest,
  random: RandomPort = webCryptoRandom,
): CryptoToolResult<GeneratedPassphrase> {
  const { words: count, list, separator = "-", capitalize = false } = request;
  if (!Number.isInteger(count) || count < 1 || count > MAX_PASSPHRASE_WORDS) {
    return fail("word-count-out-of-range", { limit: MAX_PASSPHRASE_WORDS, actual: count });
  }
  const source = wordList(list);
  const indices = randomIndices(random, source.length, count);
  if (indices === null) return fail("randomness-exhausted");

  const words = indices.map((index) => {
    const word = source[index] ?? "";
    return capitalize ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  });
  return ok({
    passphrase: words.join(separator),
    words,
    listSize: source.length,
    entropyBits: count * Math.log2(source.length),
  });
}

// ── 3. Hashing and HMAC ────────────────────────────────────────────────────

export const HASH_ALGORITHMS = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"] as const;

export type HashAlgorithm = (typeof HASH_ALGORITHMS)[number];

/**
 * Named so the surface can offer them and be told why they are not there,
 * rather than leaving a user to conclude the tool is incomplete.
 */
export const UNAVAILABLE_HASH_ALGORITHMS = ["MD5"] as const;

/** Digest length in bytes — also RSA-OAEP's `hLen` and RSA-PSS's default salt length. */
const HASH_OUTPUT_BYTES: Readonly<Record<HashAlgorithm, number>> = {
  "SHA-1": 20,
  "SHA-256": 32,
  "SHA-384": 48,
  "SHA-512": 64,
};

/** HMAC's block size per hash (RFC 4231 §2: 128 bytes for the SHA-384/512 family). */
const HMAC_BLOCK_BYTES: Readonly<Record<HashAlgorithm, number>> = {
  "SHA-1": 64,
  "SHA-256": 64,
  "SHA-384": 128,
  "SHA-512": 128,
};

export interface DigestOutput {
  readonly bytes: Uint8Array;
  readonly hex: string;
  readonly base64: string;
}

const digestOutput = (bytes: Uint8Array): DigestOutput => ({
  bytes,
  hex: bytesToHex(bytes),
  base64: bytesToBase64(bytes),
});

/**
 * Whether a hash the user named is one this drawer can compute.
 *
 * MD5 is the reason this is a function. It is not merely absent from WebCrypto —
 * it is absent on purpose, and the honest response to „hash this with MD5" is
 * to say the platform has none and that writing one here would mean shipping an
 * unreviewed implementation of a primitive that is broken for every purpose a
 * person asking for it has in mind.
 */
export function hashAvailability(name: string): CryptoToolResult<HashAlgorithm> {
  const upper = name.trim().toUpperCase();
  const known = HASH_ALGORITHMS.find((algorithm) => algorithm === upper);
  if (known !== undefined) return ok(known);
  if (UNAVAILABLE_HASH_ALGORITHMS.some((algorithm) => algorithm === upper)) {
    return fail("hash-unavailable", { subject: upper });
  }
  return fail("unsupported-algorithm", { subject: name });
}

/** A digest over raw bytes. */
export async function digestBytes(
  bytes: Uint8Array,
  algorithm: HashAlgorithm,
): Promise<CryptoToolResult<DigestOutput>> {
  return ok(digestOutput(bytesOf(await subtle().digest(algorithm, view(bytes)))));
}

/** A digest over text, encoded UTF-8. */
export async function digestText(
  text: string,
  algorithm: HashAlgorithm,
): Promise<CryptoToolResult<DigestOutput>> {
  return digestBytes(textToBytes(text), algorithm);
}

/**
 * HMAC over raw bytes with a raw key.
 *
 * An EMPTY key is substituted for a block of zeros, which is not a fudge:
 * WebCrypto refuses to import a zero-length HMAC key at all, while RFC 2104's
 * key schedule zero-pads any short key to the block size — so an empty key and
 * a block of zero bytes ARE the same key, and the substitution changes no
 * output. `@nexus/sync-port` makes the identical substitution for the identical
 * reason; the block size is per-hash here because this tool offers four.
 */
export async function hmacBytes(
  key: Uint8Array,
  message: Uint8Array,
  algorithm: HashAlgorithm,
): Promise<CryptoToolResult<DigestOutput>> {
  const material = key.length === 0 ? new Uint8Array(HMAC_BLOCK_BYTES[algorithm]) : key;
  const handle = await subtle().importKey(
    "raw",
    view(material),
    { name: "HMAC", hash: algorithm },
    false,
    ["sign"],
  );
  return ok(digestOutput(bytesOf(await subtle().sign("HMAC", handle, view(message)))));
}

/** HMAC over text with a text key, both encoded UTF-8. */
export async function hmacText(
  key: string,
  message: string,
  algorithm: HashAlgorithm,
): Promise<CryptoToolResult<DigestOutput>> {
  return hmacBytes(textToBytes(key), textToBytes(message), algorithm);
}

// ── 4. JWT ─────────────────────────────────────────────────────────────────

/**
 * The claims RFC 7519 §4.1 registers. Anything else in a payload is a private
 * claim and is shown as it arrived.
 */
export const REGISTERED_CLAIMS = ["iss", "sub", "aud", "exp", "nbf", "iat", "jti"] as const;

export type RegisteredClaim = (typeof REGISTERED_CLAIMS)[number];

/** The registered claims that are NumericDate values (RFC 7519 §2) — seconds, not milliseconds. */
const TIME_CLAIMS: readonly string[] = ["exp", "nbf", "iat"];

/** The `alg` values this drawer will VERIFY. Everything else is refused by name. */
export const JWT_ALGORITHMS = ["HS256", "HS384", "HS512", "RS256", "ES256"] as const;

export type JwtAlgorithm = (typeof JWT_ALGORITHMS)[number];

const JWT_HASHES: Readonly<Record<JwtAlgorithm, HashAlgorithm>> = {
  HS256: "SHA-256",
  HS384: "SHA-384",
  HS512: "SHA-512",
  RS256: "SHA-256",
  ES256: "SHA-256",
};

/** One claim, ready to render. */
export interface JwtClaimView {
  readonly name: string;
  readonly registered: boolean;
  readonly value: unknown;
  /** ISO-8601 rendering of a NumericDate claim; absent when it is not one, or is unreadable. */
  readonly instant?: string;
}

/** What `exp` and `nbf` say about an instant. Nothing here consults a clock. */
export interface JwtValidity {
  /** Neither expired nor not-yet-valid AT the instant that was passed in. */
  readonly valid: boolean;
  readonly expired: boolean;
  readonly notYetValid: boolean;
  /** Whether `exp` or `nbf` was present at all — an unbounded token is `valid` but says nothing. */
  readonly bounded: boolean;
  /**
   * Time claims that were PRESENT but not a NumericDate, so this window could
   * not use them. Reported rather than dropped: „`exp` was the string 'sutra'"
   * and „there is no `exp`" are different tokens and only one of them is broken.
   */
  readonly unreadable: readonly string[];
}

/** Whether the token's `alg` is one this drawer can check, and if not, why not. */
export type JwtAlgorithmSupport =
  | { readonly supported: true; readonly algorithm: JwtAlgorithm }
  | {
      readonly supported: false;
      readonly reason: "missing" | "none" | "unsupported";
      readonly algorithm: string | null;
    };

export interface JwtDecoded {
  /** The three segments exactly as they appeared, for a surface that shows the raw token. */
  readonly segments: {
    readonly header: string;
    readonly payload: string;
    readonly signature: string;
  };
  readonly header: Readonly<Record<string, unknown>>;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly claims: readonly JwtClaimView[];
  readonly signature: Uint8Array;
  readonly support: JwtAlgorithmSupport;
  readonly validity: JwtValidity;
}

/** Milliseconds in a second, spelled out because `exp` is in the other unit and that is the bug. */
const MS_PER_SECOND = 1000;

/** `Date` refuses instants beyond ±100 000 000 days from the epoch (ECMA-262 21.4.1.1). */
const MAX_DATE_MS = 8.64e15;

function instantOf(seconds: unknown): string | undefined {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return undefined;
  const millis = seconds * MS_PER_SECOND;
  if (Math.abs(millis) > MAX_DATE_MS) return undefined;
  return new Date(millis).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeJsonSegment(segment: string): Record<string, unknown> | CryptoToolFailureCode {
  const bytes = base64UrlToBytes(segment);
  if (bytes === null) return "jwt-not-base64url";
  const text = bytesToText(bytes);
  if (text === null) return "jwt-not-json";
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "jwt-not-json";
  }
  return isRecord(parsed) ? parsed : "jwt-not-json";
}

function algorithmSupport(header: Record<string, unknown>): JwtAlgorithmSupport {
  const alg: unknown = header["alg"];
  if (typeof alg !== "string") return { supported: false, reason: "missing", algorithm: null };
  // `none` is called out separately from „unsupported" because it is not an
  // algorithm this tool merely lacks — it is the one whose ACCEPTANCE is the
  // textbook JWT vulnerability (CVE-2015-9235 and its descendants): a verifier
  // that honours `alg` from the token itself can be told by an attacker that no
  // signature is required. There is no configuration under which this drawer
  // will verify one, and the surface says so in as many words.
  if (alg.toLowerCase() === "none") return { supported: false, reason: "none", algorithm: alg };
  const known = JWT_ALGORITHMS.find((candidate) => candidate === alg);
  if (known === undefined) return { supported: false, reason: "unsupported", algorithm: alg };
  return { supported: true, algorithm: known };
}

function validityOf(payload: Record<string, unknown>, atMillis: number): JwtValidity {
  const seconds = atMillis / MS_PER_SECOND;
  const unreadable: string[] = [];
  const read = (name: "exp" | "nbf"): number | null => {
    if (!(name in payload)) return null;
    const raw: unknown = payload[name];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      unreadable.push(name);
      return null;
    }
    return raw;
  };
  const exp = read("exp");
  const nbf = read("nbf");
  // RFC 7519 §4.1.4: a token „MUST NOT be accepted for processing" ON or after
  // `exp` — so the boundary instant is already expired. §4.1.5: not before
  // `nbf`, so the boundary instant IS acceptable. The two boundaries are
  // deliberately opposite and getting them the same way round is the usual slip.
  const expired = exp !== null && seconds >= exp;
  const notYetValid = nbf !== null && seconds < nbf;
  return {
    valid: !expired && !notYetValid,
    expired,
    notYetValid,
    bounded: exp !== null || nbf !== null,
    unreadable,
  };
}

/**
 * A token pulled apart WITHOUT verifying anything.
 *
 * `atMillis` is a parameter rather than a call to the clock: the module has no
 * clock, a test needs the boundary instant exactly, and „is this valid" is a
 * question about a moment somebody chose.
 *
 * A token whose `alg` is `none` still DECODES — you asked to look inside it,
 * and refusing to show you would be refusing the wrong thing — but `support`
 * carries the refusal so the surface can put the warning next to the payload,
 * and `verifyJwt` will not touch it.
 */
export function decodeJwt(token: string, atMillis: number): CryptoToolResult<JwtDecoded> {
  const segments = token.trim().split(".");
  const [headerSegment, payloadSegment, signatureSegment] = segments;
  if (
    segments.length !== 3 ||
    headerSegment === undefined ||
    payloadSegment === undefined ||
    signatureSegment === undefined ||
    headerSegment.length === 0 ||
    payloadSegment.length === 0
  ) {
    return fail("jwt-malformed", { actual: segments.length });
  }

  const header = decodeJsonSegment(headerSegment);
  if (typeof header === "string") return fail(header, { subject: "header" });
  const payload = decodeJsonSegment(payloadSegment);
  if (typeof payload === "string") return fail(payload, { subject: "payload" });
  // An empty signature segment is legal for an unsecured JWS (RFC 7515 §3),
  // which is exactly the `alg: none` shape — it decodes to zero bytes and
  // `support` has already refused it.
  const signature = base64UrlToBytes(signatureSegment);
  if (signature === null) return fail("jwt-not-base64url", { subject: "signature" });

  const claims: JwtClaimView[] = Object.keys(payload).map((name) => {
    const value: unknown = payload[name];
    const instant = TIME_CLAIMS.includes(name) ? instantOf(value) : undefined;
    const registered = REGISTERED_CLAIMS.some((claim) => claim === name);
    return instant === undefined
      ? { name, registered, value }
      : { name, registered, value, instant };
  });

  return ok({
    segments: { header: headerSegment, payload: payloadSegment, signature: signatureSegment },
    header,
    payload,
    claims,
    signature,
    support: algorithmSupport(header),
    validity: validityOf(payload, atMillis),
  });
}

/**
 * A JWK, narrowed to the public fields this drawer will forward to WebCrypto.
 *
 * Deliberately NOT a pass-through of whatever JSON arrived: the object handed
 * to `importKey` is rebuilt from these fields alone, so a stray `key_ops` or a
 * `d` cannot ride along into a verification key.
 */
export interface JwkKey {
  readonly kty?: string;
  /** The shared secret of an `oct` key, base64url (RFC 7518 §6.4). */
  readonly k?: string;
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
  readonly alg?: string;
  /** The private exponent/scalar. Present means somebody pasted a PRIVATE key; always refused. */
  readonly d?: string;
}

/** Where a verification key comes from. */
export type JwtVerificationKey =
  | { readonly kind: "secret"; readonly secret: Uint8Array }
  | { readonly kind: "pem"; readonly pem: string }
  | { readonly kind: "jwk"; readonly jwk: JwkKey };

export interface JwtVerification {
  /** Whether the SIGNATURE checks out. Says nothing about `exp` — `decoded.validity` does. */
  readonly signatureValid: boolean;
  readonly decoded: JwtDecoded;
}

function jwtImportAlgorithm(algorithm: JwtAlgorithm): ImportAlgorithm {
  const hash = JWT_HASHES[algorithm];
  if (algorithm.startsWith("HS")) return { name: "HMAC", hash };
  if (algorithm === "RS256") return { name: "RSASSA-PKCS1-v1_5", hash };
  return { name: "ECDSA", namedCurve: "P-256" };
}

function jwtVerifyAlgorithm(algorithm: JwtAlgorithm): SignAlgorithm {
  if (algorithm.startsWith("HS")) return "HMAC";
  if (algorithm === "RS256") return "RSASSA-PKCS1-v1_5";
  return { name: "ECDSA", hash: JWT_HASHES[algorithm] };
}

/** The JWK fields WebCrypto needs for this key type, rebuilt rather than forwarded. */
function publicJwk(jwk: JwkKey): CryptoToolResult<JwkKey> {
  if (jwk.d !== undefined) return fail("key-is-private");
  const { kty, k, n, e, crv, x, y } = jwk;
  const rebuilt: JwkKey = {
    ...(kty === undefined ? {} : { kty }),
    ...(k === undefined ? {} : { k }),
    ...(n === undefined ? {} : { n }),
    ...(e === undefined ? {} : { e }),
    ...(crv === undefined ? {} : { crv }),
    ...(x === undefined ? {} : { x }),
    ...(y === undefined ? {} : { y }),
  };
  return ok(rebuilt);
}

async function importJwtKey(
  algorithm: JwtAlgorithm,
  key: JwtVerificationKey,
): Promise<CryptoToolResult<KeyHandle>> {
  const parameters = jwtImportAlgorithm(algorithm);
  const symmetric = algorithm.startsWith("HS");
  try {
    if (key.kind === "secret") {
      if (!symmetric) return fail("jwt-key-mismatch", { subject: algorithm });
      const material =
        key.secret.length === 0
          ? new Uint8Array(HMAC_BLOCK_BYTES[JWT_HASHES[algorithm]])
          : key.secret;
      return ok(await subtle().importKey("raw", view(material), parameters, false, ["verify"]));
    }
    if (key.kind === "pem") {
      if (symmetric) return fail("jwt-key-mismatch", { subject: algorithm });
      const block = fromPem(key.pem, PEM_LABEL_PUBLIC);
      if (!block.ok) return block;
      return ok(
        await subtle().importKey("spki", view(block.value.der), parameters, false, ["verify"]),
      );
    }
    const rebuilt = publicJwk(key.jwk);
    if (!rebuilt.ok) return rebuilt;
    return ok(await subtle().importKey("jwk", rebuilt.value, parameters, false, ["verify"]));
  } catch {
    // Every WebCrypto import failure collapses here: a malformed SPKI, a JWK
    // whose curve disagrees with the `alg`, an RSA key offered for ES256. The
    // messages differ per platform and none of them is worth showing.
    return fail("key-import-failed", { subject: algorithm });
  }
}

/**
 * Verify a token's signature.
 *
 * The signing input is the first two segments and the dot between them, ASCII —
 * RFC 7515 §5.2. Note what this does NOT do: it does not decide whether the
 * token is acceptable. `decoded.validity` says whether `exp`/`nbf` admit the
 * instant, `decoded.payload` says who issued it and for whom, and a real
 * verifier has to agree with all three. A tool that fused them would let „valid"
 * mean four different things.
 */
export async function verifyJwt(
  token: string,
  key: JwtVerificationKey,
  atMillis: number,
): Promise<CryptoToolResult<JwtVerification>> {
  const decoded = decodeJwt(token, atMillis);
  if (!decoded.ok) return decoded;
  const { support, segments, signature } = decoded.value;
  if (!support.supported) {
    if (support.reason === "none") return fail("jwt-alg-none");
    if (support.reason === "missing") return fail("jwt-alg-missing");
    return fail("jwt-alg-unsupported", { subject: support.algorithm ?? "" });
  }

  const handle = await importJwtKey(support.algorithm, key);
  if (!handle.ok) return handle;

  const signingInput = textToBytes(`${segments.header}.${segments.payload}`);
  let signatureValid: boolean;
  try {
    signatureValid = await subtle().verify(
      jwtVerifyAlgorithm(support.algorithm),
      handle.value,
      view(signature),
      view(signingInput),
    );
  } catch {
    // A signature of the wrong LENGTH makes ECDSA's verify throw rather than
    // answer false. That is a forged or truncated token, not a caller bug, so
    // it becomes the same `false` a wrong signature gets.
    signatureValid = false;
  }
  return ok({ signatureValid, decoded: decoded.value });
}

// ── 5. AES ─────────────────────────────────────────────────────────────────

export const AES_MODES = ["AES-GCM", "AES-CBC"] as const;

export type AesMode = (typeof AES_MODES)[number];

export const AES_KEY_SIZES = [128, 256] as const;

export type AesKeySize = (typeof AES_KEY_SIZES)[number];

/** GCM's nonce is 96 bits — the one length NIST SP 800-38D §5.2.1.1 uses directly. */
const GCM_IV_BYTES = 12;

/** CBC's IV is one block. */
const CBC_IV_BYTES = 16;

/** PBKDF2-HMAC-SHA-256 iterations, OWASP's 2023 Password Storage Cheat Sheet figure. */
export const PBKDF2_DEFAULT_ITERATIONS = 600_000;

/**
 * The floor. Below this the derived key is weaker than the passphrase implies,
 * and a tool that quietly accepted 1 000 iterations would be handing out a
 * false sense of a key. Refused rather than raised: the user chose a number and
 * silently replacing it is how they end up unable to decrypt their own file.
 */
export const PBKDF2_MIN_ITERATIONS = 100_000;

/** The salt PBKDF2 gets, per encryption, carried in the envelope. */
const PBKDF2_SALT_BYTES = 16;

export type AesKeySource =
  | { readonly kind: "raw"; readonly text: string; readonly encoding: "hex" | "base64" }
  | { readonly kind: "passphrase"; readonly passphrase: string; readonly iterations?: number };

/** How a passphrase became a key, recorded so decryption can repeat it exactly. */
export interface AesKdfRecord {
  readonly name: "PBKDF2";
  readonly hash: "SHA-256";
  readonly iterations: number;
  /** Base64. Fresh per encryption — a fixed salt would make one rainbow table serve every file. */
  readonly salt: string;
}

/**
 * The self-describing output of an encryption.
 *
 * The IV rides INSIDE it. That is the whole point of an envelope: an IV is not
 * secret, it is required to decrypt, and every scheme that leaves the user to
 * „keep the IV somewhere" produces a ciphertext nobody can open six months
 * later. So does a scheme that reuses one, which is fatal for GCM.
 */
export interface AesEnvelope {
  readonly version: 1;
  readonly mode: AesMode;
  readonly keyBits: AesKeySize;
  /** Base64. 12 bytes for GCM, 16 for CBC. */
  readonly iv: string;
  /** Base64. For GCM this INCLUDES the 16-byte authentication tag WebCrypto appends. */
  readonly ciphertext: string;
  /** Present exactly when the key was derived from a passphrase. */
  readonly kdf: AesKdfRecord | null;
}

async function pbkdf2Key(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  bits: AesKeySize,
  mode: AesMode,
): Promise<KeyHandle> {
  const base = await subtle().importKey("raw", view(textToBytes(passphrase)), "PBKDF2", false, [
    "deriveBits",
  ]);
  const derived = await subtle().deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: view(salt), iterations },
    base,
    bits,
  );
  return subtle().importKey("raw", derived, { name: mode }, false, ["encrypt", "decrypt"]);
}

async function aesKey(
  source: AesKeySource,
  bits: AesKeySize,
  mode: AesMode,
  kdf: AesKdfRecord | null,
  random: RandomPort,
): Promise<CryptoToolResult<{ handle: KeyHandle; kdf: AesKdfRecord | null }>> {
  if (source.kind === "raw") {
    const bytes =
      source.encoding === "hex" ? hexToBytes(source.text) : base64ToBytes(source.text);
    if (bytes === null) return fail(source.encoding === "hex" ? "invalid-hex" : "invalid-base64");
    if (bytes.length * 8 !== bits) {
      return fail("key-length-mismatch", { limit: bits / 8, actual: bytes.length });
    }
    const handle = await subtle().importKey("raw", view(bytes), { name: mode }, false, [
      "encrypt",
      "decrypt",
    ]);
    return ok({ handle, kdf: null });
  }

  // THE ENVELOPE'S COUNT WINS, and the floor applies only when there is no
  // envelope — that is, only when a key is being MINTED. The tempting version
  // enforces the minimum on both paths and is a data-loss bug waiting for the
  // day the constant is raised: every file encrypted under the old floor would
  // become undecryptable by the tool that wrote it. A floor is a policy about
  // what this tool will CREATE, never about what it will read.
  const iterations = kdf?.iterations ?? source.iterations ?? PBKDF2_DEFAULT_ITERATIONS;
  if (!Number.isInteger(iterations) || iterations < 1) {
    // WHOSE number is it? With an envelope it came out of the envelope, and the
    // envelope is what is wrong. Without one the CALLER supplied it, and
    // „the envelope is malformed" then names a field that is not on screen at
    // all — an encrypt has no envelope yet. Same guard, honest subject.
    return kdf === null
      ? fail("iterations-too-low", { limit: PBKDF2_MIN_ITERATIONS, actual: iterations })
      : fail("envelope-malformed");
  }
  if (kdf === null && iterations < PBKDF2_MIN_ITERATIONS) {
    return fail("iterations-too-low", { limit: PBKDF2_MIN_ITERATIONS, actual: iterations });
  }
  let salt: Uint8Array;
  if (kdf === null) {
    salt = random.bytes(PBKDF2_SALT_BYTES);
  } else {
    const stored = base64ToBytes(kdf.salt);
    if (stored === null || stored.length === 0) return fail("envelope-malformed");
    salt = stored;
  }
  const handle = await pbkdf2Key(source.passphrase, salt, iterations, bits, mode);
  return ok({
    handle,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: bytesToBase64(salt) },
  });
}

export interface AesOptions {
  readonly mode: AesMode;
  readonly keyBits: AesKeySize;
}

/**
 * Encrypt text.
 *
 * A fresh IV every time, from the port — never a counter, never a constant.
 * Under GCM an IV reused with the same key does not merely weaken
 * confidentiality, it leaks the authentication subkey and lets an attacker
 * forge; there is no „only for testing" version of that mistake, so there is no
 * way to supply an IV here at all.
 */
export async function encryptAes(
  plaintext: string,
  key: AesKeySource,
  options: AesOptions,
  random: RandomPort = webCryptoRandom,
): Promise<CryptoToolResult<AesEnvelope>> {
  const { mode, keyBits } = options;
  const prepared = await aesKey(key, keyBits, mode, null, random);
  if (!prepared.ok) return prepared;

  const iv = random.bytes(mode === "AES-GCM" ? GCM_IV_BYTES : CBC_IV_BYTES);
  const ciphertext = bytesOf(
    await subtle().encrypt(
      { name: mode, iv: view(iv) },
      prepared.value.handle,
      view(textToBytes(plaintext)),
    ),
  );
  return ok({
    version: 1,
    mode,
    keyBits,
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    kdf: prepared.value.kdf,
  });
}

/**
 * Decrypt an envelope.
 *
 * **A failing GCM tag is named, never swallowed.** `aes-authentication-failed`
 * says the ciphertext or the key is not what it claims — which is the ONE
 * useful thing an authenticated mode tells you, and the reason to prefer it.
 * CBC cannot make that statement: `aes-decrypt-failed` there means the padding
 * did not parse, and a wrong key that happens to produce valid padding gets as
 * far as `not-utf8`. Both refusals are honest about which mode they came from.
 */
export async function decryptAes(
  envelope: AesEnvelope,
  key: AesKeySource,
): Promise<CryptoToolResult<string>> {
  // The envelope says how the key was MADE, and offering the other kind is a
  // mistake worth naming rather than a decryption that fails. Handing a
  // passphrase to a raw-key envelope would otherwise derive a key against a
  // fresh random salt and report a failed authentication tag — technically true
  // and completely unhelpful.
  if ((envelope.kdf === null) !== (key.kind === "raw")) return fail("envelope-key-mismatch");

  const iv = base64ToBytes(envelope.iv);
  const ciphertext = base64ToBytes(envelope.ciphertext);
  const expectedIv = envelope.mode === "AES-GCM" ? GCM_IV_BYTES : CBC_IV_BYTES;
  if (iv === null || ciphertext === null || iv.length !== expectedIv) {
    return fail("envelope-malformed");
  }

  const { keyBits, mode, kdf } = envelope;
  const prepared = await aesKey(key, keyBits, mode, kdf, webCryptoRandom);
  if (!prepared.ok) return prepared;

  let plaintext: Uint8Array;
  try {
    plaintext = bytesOf(
      await subtle().decrypt(
        { name: envelope.mode, iv: view(iv) },
        prepared.value.handle,
        view(ciphertext),
      ),
    );
  } catch {
    return fail(
      envelope.mode === "AES-GCM" ? "aes-authentication-failed" : "aes-decrypt-failed",
    );
  }
  const text = bytesToText(plaintext);
  return text === null ? fail("not-utf8") : ok(text);
}

/** The envelope as text the user can copy, keep and paste back. */
export function formatAesEnvelope(envelope: AesEnvelope): string {
  return JSON.stringify(envelope, null, 2);
}

function parseKdf(value: unknown): AesKdfRecord | null | false {
  if (value === null) return null;
  if (!isRecord(value)) return false;
  const { name, hash, iterations, salt } = value;
  if (name !== "PBKDF2" || hash !== "SHA-256") return false;
  if (typeof iterations !== "number" || !Number.isInteger(iterations)) return false;
  if (iterations < 1) return false;
  if (typeof salt !== "string" || base64ToBytes(salt) === null) return false;
  return { name, hash, iterations, salt };
}

/** Text back to an envelope, validating every field — `formatAesEnvelope`'s exact inverse. */
export function parseAesEnvelope(text: string): CryptoToolResult<AesEnvelope> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail("envelope-malformed");
  }
  if (!isRecord(parsed)) return fail("envelope-malformed");
  const { version, mode, keyBits, iv, ciphertext } = parsed;
  const knownMode = AES_MODES.find((candidate) => candidate === mode);
  const knownBits = AES_KEY_SIZES.find((candidate) => candidate === keyBits);
  const kdf = parseKdf(parsed["kdf"]);
  if (
    version !== 1 ||
    knownMode === undefined ||
    knownBits === undefined ||
    typeof iv !== "string" ||
    typeof ciphertext !== "string" ||
    kdf === false
  ) {
    return fail("envelope-malformed");
  }
  return ok({ version: 1, mode: knownMode, keyBits: knownBits, iv, ciphertext, kdf });
}

// ── 6. RSA key generation ──────────────────────────────────────────────────

export const RSA_MODULUS_SIZES = [2048, 3072, 4096] as const;

export type RsaModulusSize = (typeof RSA_MODULUS_SIZES)[number];

export const RSA_SCHEMES = ["RSA-OAEP", "RSA-PSS"] as const;

export type RsaScheme = (typeof RSA_SCHEMES)[number];

/**
 * The hashes an RSA key here may be bound to.
 *
 * SHA-1 is absent although WebCrypto would accept it, and this is the one place
 * in the drawer where a primitive is withheld rather than offered with a
 * warning: SHA-1 is available for HASHING because people still have to check a
 * legacy digest, and a hash you are inspecting is not a hash you are trusting.
 * A KEY generated against SHA-1 is a long-lived commitment to a broken
 * collision resistance, and this tool will not mint one.
 */
export const RSA_HASHES = ["SHA-256", "SHA-384", "SHA-512"] as const;

export type RsaHash = (typeof RSA_HASHES)[number];

export interface RsaKeyRequest {
  readonly scheme: RsaScheme;
  readonly modulusBits: RsaModulusSize;
  /** Defaults to SHA-256. */
  readonly hash?: RsaHash;
}

export interface PemKeyPair {
  /** PKCS#8, `-----BEGIN PRIVATE KEY-----`. */
  readonly privatePem: string;
  /** SPKI, `-----BEGIN PUBLIC KEY-----`. */
  readonly publicPem: string;
}

/** 65537, the public exponent every RSA implementation agrees on, big-endian. */
const RSA_PUBLIC_EXPONENT = new Uint8Array([0x01, 0x00, 0x01]);

/**
 * An RSA key pair, exported as PEM.
 *
 * `extractable: true` on the private key, which is unusual in this codebase and
 * is the point of the tool: the user asked for a private key to keep. Nothing
 * about this key ever touches the app's own key chain, and the handle is
 * discarded the moment the PEM exists.
 */
export async function generateRsaKeyPair(
  request: RsaKeyRequest,
): Promise<CryptoToolResult<PemKeyPair>> {
  const { scheme, modulusBits, hash = "SHA-256" } = request;
  if (!RSA_MODULUS_SIZES.some((size) => size === modulusBits)) {
    return fail("unsupported-algorithm", { subject: String(modulusBits) });
  }
  if (!RSA_HASHES.some((candidate) => candidate === hash)) {
    return fail("unsupported-algorithm", { subject: hash });
  }
  const usages: KeyUsages = scheme === "RSA-OAEP" ? ["encrypt", "decrypt"] : ["sign", "verify"];
  const pair = (await subtle().generateKey(
    { name: scheme, modulusLength: modulusBits, publicExponent: view(RSA_PUBLIC_EXPONENT), hash },
    true,
    usages,
  )) as unknown as { publicKey: KeyHandle; privateKey: KeyHandle };

  return ok({
    privatePem: toPem(
      PEM_LABEL_PRIVATE,
      bytesOf(await subtle().exportKey("pkcs8", pair.privateKey)),
    ),
    publicPem: toPem(PEM_LABEL_PUBLIC, bytesOf(await subtle().exportKey("spki", pair.publicKey))),
  });
}

export const EC_CURVES = ["P-256", "P-384"] as const;

export type EcCurve = (typeof EC_CURVES)[number];

/**
 * An ECDSA key pair, as PEM.
 *
 * Not a ninth tool — the signature tool below takes PEM keys and would be
 * unusable without a way to make an EC one, since the RSA generator above only
 * makes RSA. Same export path, same PEM writer.
 */
export async function generateEcKeyPair(curve: EcCurve): Promise<CryptoToolResult<PemKeyPair>> {
  if (!EC_CURVES.some((candidate) => candidate === curve)) {
    return fail("unsupported-algorithm", { subject: curve });
  }
  const pair = (await subtle().generateKey({ name: "ECDSA", namedCurve: curve }, true, [
    "sign",
    "verify",
  ])) as unknown as { publicKey: KeyHandle; privateKey: KeyHandle };
  return ok({
    privatePem: toPem(
      PEM_LABEL_PRIVATE,
      bytesOf(await subtle().exportKey("pkcs8", pair.privateKey)),
    ),
    publicPem: toPem(PEM_LABEL_PUBLIC, bytesOf(await subtle().exportKey("spki", pair.publicKey))),
  });
}

// ── 7. RSA-OAEP encrypt / decrypt ──────────────────────────────────────────

/**
 * The longest message an RSA-OAEP key of this size and hash can carry:
 * `k − 2·hLen − 2`, RFC 8017 §7.1.1 step 1b, where `k` is the modulus in bytes.
 *
 * 190 bytes for a 2048-bit key with SHA-256 — which surprises people, and is
 * the reason this is a published number in the tool rather than an
 * `OperationError` from WebCrypto after the user has typed a paragraph. RSA
 * encrypts a KEY, not a document; if the message is longer, the answer is a
 * symmetric key wrapped with RSA, which is what tool 5 is for.
 */
export function rsaOaepMaxPlaintextBytes(modulusBits: number, hash: HashAlgorithm): number {
  return Math.floor(modulusBits / 8) - 2 * HASH_OUTPUT_BYTES[hash] - 2;
}

export interface RsaCryptOutput {
  readonly bytes: Uint8Array;
  readonly base64: string;
  readonly hex: string;
  /** What the key could have carried, so the surface can show the headroom that was left. */
  readonly maxPlaintextBytes: number;
  /**
   * How big the message that produced `bytes` actually was.
   *
   * It is here rather than left to the caller because the caller's copy of the
   * plaintext is a live text field: a surface that measures the field to
   * describe a ciphertext computed seconds ago reports the wrong number the
   * moment somebody types. A result describes itself.
   */
  readonly plaintextBytes: number;
}

/** Encrypt with a public PEM. */
export async function rsaEncrypt(
  publicPem: string,
  plaintext: string,
  hash: RsaHash = "SHA-256",
): Promise<CryptoToolResult<RsaCryptOutput>> {
  const block = fromPem(publicPem, PEM_LABEL_PUBLIC);
  if (!block.ok) return block;
  let handle: KeyHandle;
  try {
    handle = await subtle().importKey(
      "spki",
      view(block.value.der),
      { name: "RSA-OAEP", hash },
      false,
      ["encrypt"],
    );
  } catch {
    return fail("key-import-failed", { subject: PEM_LABEL_PUBLIC });
  }

  const modulusBits = modulusBitsOf(handle);
  if (modulusBits === null) return fail("key-import-failed", { subject: PEM_LABEL_PUBLIC });
  const maxPlaintextBytes = rsaOaepMaxPlaintextBytes(modulusBits, hash);
  const message = textToBytes(plaintext);
  if (message.length > maxPlaintextBytes) {
    return fail("rsa-plaintext-too-long", {
      limit: maxPlaintextBytes,
      actual: message.length,
    });
  }

  const ciphertext = bytesOf(await subtle().encrypt({ name: "RSA-OAEP" }, handle, view(message)));
  return ok({
    bytes: ciphertext,
    base64: bytesToBase64(ciphertext),
    hex: bytesToHex(ciphertext),
    maxPlaintextBytes,
    plaintextBytes: message.length,
  });
}

/** Decrypt with a private PEM. A ciphertext that does not open is a named refusal, not a throw. */
export async function rsaDecrypt(
  privatePem: string,
  ciphertextBase64: string,
  hash: RsaHash = "SHA-256",
): Promise<CryptoToolResult<string>> {
  const block = fromPem(privatePem, PEM_LABEL_PRIVATE);
  if (!block.ok) return block;
  const ciphertext = base64ToBytes(ciphertextBase64);
  if (ciphertext === null) return fail("invalid-base64");
  let handle: KeyHandle;
  try {
    handle = await subtle().importKey(
      "pkcs8",
      view(block.value.der),
      { name: "RSA-OAEP", hash },
      false,
      ["decrypt"],
    );
  } catch {
    return fail("key-import-failed", { subject: PEM_LABEL_PRIVATE });
  }
  let plaintext: Uint8Array;
  try {
    plaintext = bytesOf(await subtle().decrypt({ name: "RSA-OAEP" }, handle, view(ciphertext)));
  } catch {
    // OAEP's decoding failure is deliberately indistinguishable from a wrong
    // key — that is the padding's design, not a gap in this message.
    return fail("rsa-decrypt-failed");
  }
  const text = bytesToText(plaintext);
  return text === null ? fail("not-utf8") : ok(text);
}

// ── 8. Signatures ──────────────────────────────────────────────────────────

export const SIGNATURE_ALGORITHMS = [
  "RSA-PSS",
  "RSASSA-PKCS1-v1_5",
  "ECDSA-P-256",
  "ECDSA-P-384",
] as const;

export type SignatureAlgorithm = (typeof SIGNATURE_ALGORITHMS)[number];

/**
 * The hash each ECDSA curve is used with. Fixed rather than chosen: pairing
 * P-384 with SHA-256 throws away half the curve's strength for no benefit, and
 * a menu that allows it is a menu with a wrong answer on it.
 */
const ECDSA_HASHES: Readonly<Record<"ECDSA-P-256" | "ECDSA-P-384", RsaHash>> = {
  "ECDSA-P-256": "SHA-256",
  "ECDSA-P-384": "SHA-384",
};

function isEcdsa(algorithm: SignatureAlgorithm): algorithm is "ECDSA-P-256" | "ECDSA-P-384" {
  return algorithm === "ECDSA-P-256" || algorithm === "ECDSA-P-384";
}

function signatureImportAlgorithm(
  algorithm: SignatureAlgorithm,
  hash: RsaHash,
): ImportAlgorithm {
  if (isEcdsa(algorithm)) {
    return { name: "ECDSA", namedCurve: algorithm === "ECDSA-P-256" ? "P-256" : "P-384" };
  }
  return { name: algorithm, hash };
}

function signatureOperationAlgorithm(
  algorithm: SignatureAlgorithm,
  hash: RsaHash,
  saltLength: number,
): SignAlgorithm {
  if (isEcdsa(algorithm)) return { name: "ECDSA", hash };
  if (algorithm === "RSA-PSS") return { name: "RSA-PSS", saltLength };
  return "RSASSA-PKCS1-v1_5";
}

export interface SignRequest {
  readonly algorithm: SignatureAlgorithm;
  /** PKCS#8 PEM. */
  readonly privatePem: string;
  readonly message: string;
  /** RSA only; an ECDSA request's hash follows its curve. Defaults to SHA-256. */
  readonly hash?: RsaHash;
  /** RSA-PSS only. Defaults to the hash's own output length, which is the usual choice. */
  readonly saltLength?: number;
}

export interface SignatureOutput {
  readonly bytes: Uint8Array;
  readonly hex: string;
  readonly base64: string;
}

/**
 * Sign a message.
 *
 * **ECDSA signatures come out RAW (`r ‖ s`), not DER.** WebCrypto emits the
 * IEEE P1363 fixed-width pair — 64 bytes on P-256, 96 on P-384 — while
 * `openssl dgst -sign` emits an ASN.1 SEQUENCE of two INTEGERs. Neither
 * verifies the other's bytes without conversion, and the failure looks exactly
 * like a wrong key. It is stated here because the tool cannot detect which
 * shape a pasted signature is meant to be; JWS uses the raw form, so a
 * signature from here drops straight into a JWT.
 */
export async function signMessage(
  request: SignRequest,
): Promise<CryptoToolResult<SignatureOutput>> {
  const { algorithm, privatePem, message } = request;
  if (!SIGNATURE_ALGORITHMS.some((candidate) => candidate === algorithm)) {
    return fail("unsupported-algorithm", { subject: algorithm });
  }
  const hash = isEcdsa(algorithm) ? ECDSA_HASHES[algorithm] : (request.hash ?? "SHA-256");
  if (!RSA_HASHES.some((candidate) => candidate === hash)) {
    return fail("unsupported-algorithm", { subject: hash });
  }
  const block = fromPem(privatePem, PEM_LABEL_PRIVATE);
  if (!block.ok) return block;

  let handle: KeyHandle;
  try {
    handle = await subtle().importKey(
      "pkcs8",
      view(block.value.der),
      signatureImportAlgorithm(algorithm, hash),
      false,
      ["sign"],
    );
  } catch {
    return fail("key-import-failed", { subject: algorithm });
  }
  const saltLength = request.saltLength ?? HASH_OUTPUT_BYTES[hash];
  try {
    const signature = bytesOf(
      await subtle().sign(
        signatureOperationAlgorithm(algorithm, hash, saltLength),
        handle,
        view(textToBytes(message)),
      ),
    );
    return ok({
      bytes: signature,
      hex: bytesToHex(signature),
      base64: bytesToBase64(signature),
    });
  } catch {
    // A salt length the modulus cannot hold is the realistic case here.
    return fail("signature-failed", { subject: algorithm });
  }
}

export interface VerifyRequest {
  readonly algorithm: SignatureAlgorithm;
  /** SPKI PEM. */
  readonly publicPem: string;
  readonly message: string;
  readonly signature: string;
  readonly encoding: "hex" | "base64";
  readonly hash?: RsaHash;
  readonly saltLength?: number;
}

/**
 * Check a signature.
 *
 * A signature that does not check out is `{ valid: false }` — an ANSWER, not an
 * error. The failures reserved for the result union are the ones where no check
 * happened at all: an unreadable PEM, an unsupported algorithm, a signature
 * that is not the encoding it claims. Collapsing „wrong" and „unaskable" into
 * one falsy value is how a caller ends up treating a broken key as a rejected
 * signature.
 */
export async function verifyMessage(
  request: VerifyRequest,
): Promise<CryptoToolResult<{ readonly valid: boolean }>> {
  const { algorithm, publicPem, message, encoding } = request;
  if (!SIGNATURE_ALGORITHMS.some((candidate) => candidate === algorithm)) {
    return fail("unsupported-algorithm", { subject: algorithm });
  }
  const hash = isEcdsa(algorithm) ? ECDSA_HASHES[algorithm] : (request.hash ?? "SHA-256");
  if (!RSA_HASHES.some((candidate) => candidate === hash)) {
    return fail("unsupported-algorithm", { subject: hash });
  }
  const signature =
    encoding === "hex" ? hexToBytes(request.signature) : base64ToBytes(request.signature);
  if (signature === null) return fail(encoding === "hex" ? "invalid-hex" : "invalid-base64");

  const block = fromPem(publicPem, PEM_LABEL_PUBLIC);
  if (!block.ok) return block;
  let handle: KeyHandle;
  try {
    handle = await subtle().importKey(
      "spki",
      view(block.value.der),
      signatureImportAlgorithm(algorithm, hash),
      false,
      ["verify"],
    );
  } catch {
    return fail("key-import-failed", { subject: algorithm });
  }
  const saltLength = request.saltLength ?? HASH_OUTPUT_BYTES[hash];
  try {
    const valid = await subtle().verify(
      signatureOperationAlgorithm(algorithm, hash, saltLength),
      handle,
      view(signature),
      view(textToBytes(message)),
    );
    return ok({ valid });
  } catch {
    // ECDSA throws on a signature of the wrong length instead of answering
    // false. That is still „this signature does not check out".
    return ok({ valid: false });
  }
}

// ── Word lists ─────────────────────────────────────────────────────────────

/**
 * 256 Serbian words, Latin script and DELIBERATELY WITHOUT DIACRITICS.
 *
 * Not laziness and not sr-Latn being written badly: a passphrase is typed into
 * a login box, a terminal, sometimes a phone with an English keyboard layout,
 * and a `š` that arrives as `s` is a passphrase the user cannot use and cannot
 * see the reason for. Every word here is a Serbian word that genuinely has no
 * diacritic — `kuca` (as in „kuća") is NOT in the list, because writing it
 * without the diacritic would be a misspelling rather than a spelling.
 *
 * 256 words is 8 bits each, exactly. The size is a power of two so the entropy
 * a user is shown is a whole number they can reason about — six words is 48
 * bits, no rounding and no footnote.
 */
const SERBIAN_WORDS: readonly string[] = [
  "voda", "hleb", "sunce", "mesec", "zvezda", "planina", "reka", "more",
  "polje", "trava", "drvo", "list", "cvet", "koren", "seme", "plod",
  "jabuka", "malina", "dunja", "kupina", "limun", "banana", "grozd", "paradajz",
  "krastavac", "luk", "krompir", "pasulj", "kupus", "salata", "med", "mleko",
  "sir", "jaje", "meso", "riba", "testo", "torta", "sladoled", "kafa",
  "sok", "pivo", "vino", "pas", "konj", "krava", "ovca", "koza",
  "svinja", "patka", "guska", "golub", "vrabac", "orao", "soko", "vuk",
  "lisica", "medved", "jelen", "zec", "lav", "tigar", "slon", "majmun",
  "zmija", "mrav", "leptir", "pauk", "buba", "komarac", "glava", "oko",
  "uho", "nos", "usta", "zub", "jezik", "vrat", "rame", "ruka",
  "prst", "noga", "koleno", "stopalo", "srce", "kosa", "krv", "kost",
  "mozak", "dom", "stan", "soba", "kuhinja", "kupatilo", "vrata", "prozor",
  "krov", "zid", "pod", "tavan", "podrum", "stepenice", "sto", "stolica",
  "krevet", "orman", "polica", "tepih", "zavesa", "lampa", "sijalica", "ogledalo",
  "sat", "brava", "kanta", "metla", "pegla", "slavina", "sapun", "nebo",
  "oblak", "sneg", "led", "magla", "vetar", "oluja", "munja", "grom",
  "duga", "rosa", "mraz", "jutro", "podne", "dan", "nedelja", "godina",
  "leto", "jesen", "zima", "minut", "sekunda", "vreme", "bela", "crna",
  "crvena", "plava", "zelena", "siva", "roze", "braon", "jedan", "dva",
  "tri", "pet", "sedam", "osam", "devet", "deset", "hiljada", "milion",
  "nula", "prvi", "drugi", "grad", "selo", "ulica", "trg", "most",
  "put", "staza", "pruga", "voz", "autobus", "kola", "bicikl", "brod",
  "avion", "motor", "guma", "benzin", "karta", "kofer", "torba", "ranac",
  "novac", "dinar", "banka", "prodavnica", "pijaca", "cena", "popust", "kasa",
  "radnja", "profesor", "knjiga", "sveska", "olovka", "gumica", "lenjir", "tabla",
  "kreda", "papir", "mastilo", "pero", "slovo", "pesma", "roman", "pitanje",
  "odgovor", "zadatak", "ispit", "ocena", "znanje", "nauka", "istina", "ideja",
  "plan", "cilj", "posao", "rad", "alat", "testera", "ekser", "merdevine",
  "lopata", "motika", "kanap", "konopac", "lanac", "igla", "konac", "dugme",
  "makaze", "tastatura", "ekran", "telefon", "kamera", "slika", "video", "zvuk",
  "muzika", "gitara", "klavir", "bubanj", "truba", "violina", "nota", "ritam",
  "ljubav", "radost", "tuga", "strah", "nada", "mir", "snaga", "volja",
];

/** 256 English words, same size and the same 8-bits-per-word arithmetic. */
const ENGLISH_WORDS: readonly string[] = [
  "apple", "river", "stone", "cloud", "light", "ocean", "forest", "meadow",
  "garden", "island", "valley", "canyon", "desert", "jungle", "harbor", "bridge",
  "castle", "tower", "market", "street", "corner", "window", "ladder", "anchor",
  "candle", "lantern", "mirror", "basket", "bottle", "kettle", "pencil", "marble",
  "copper", "silver", "golden", "iron", "timber", "cotton", "velvet", "linen",
  "falcon", "badger", "otter", "rabbit", "walrus", "jaguar", "gazelle", "dolphin",
  "sparrow", "magpie", "heron", "raven", "salmon", "turtle", "beetle", "spider",
  "maple", "cedar", "willow", "birch", "cactus", "clover", "ginger", "pepper",
  "barley", "walnut", "almond", "cherry", "orange", "lemon", "melon", "grape",
  "bread", "butter", "cheese", "honey", "pastry", "coffee", "sugar", "noodle",
  "summer", "winter", "spring", "autumn", "sunset", "sunrise", "midnight", "morning",
  "thunder", "drizzle", "breeze", "frost", "shadow", "rainbow", "comet", "planet",
  "galaxy", "meteor", "orbit", "rocket", "engine", "piston", "gear", "lever",
  "hammer", "chisel", "wrench", "needle", "thread", "ribbon", "button", "buckle",
  "pocket", "jacket", "mitten", "sandal", "helmet", "collar", "pillow", "blanket",
  "teapot", "saucer", "spoon", "skillet", "cabinet", "drawer", "shelf", "carpet",
  "guitar", "violin", "trumpet", "drum", "flute", "banjo", "melody", "rhythm",
  "poem", "novel", "letter", "journal", "chapter", "story", "riddle", "puzzle",
  "cipher", "secret", "signal", "beacon", "compass", "sextant", "voyage", "harvest",
  "reason", "wisdom", "courage", "patience", "silence", "laughter", "freedom", "justice",
  "friend", "family", "neighbor", "teacher", "student", "doctor", "farmer", "sailor",
  "builder", "painter", "dancer", "singer", "writer", "baker", "miner", "weaver",
  "village", "county", "border", "prairie", "plateau", "glacier", "volcano", "geyser",
  "quartz", "granite", "basalt", "crystal", "amber", "opal", "pearl", "ruby",
  "circle", "square", "triangle", "spiral", "hexagon", "arrow", "pattern", "lattice",
  "number", "symbol", "digit", "matrix", "vector", "tensor", "kernel", "lambda",
  "orchard", "pasture", "barnyard", "windmill", "granary", "cottage", "chimney", "hearth",
  "torch", "ember", "cinder", "flame", "smoke", "ashes", "furnace", "forge",
  "vessel", "rudder", "mast", "keel", "cargo", "tunnel", "railway", "platform",
  "postcard", "package", "parcel", "envelope", "stamp", "ledger", "invoice", "receipt",
  "kitten", "puppy", "foal", "calf", "lamb", "chick", "cub", "fawn",
  "whisper", "echo", "murmur", "chorus", "anthem", "ballad", "sonnet", "lullaby",
];
