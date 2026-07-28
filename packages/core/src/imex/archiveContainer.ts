/**
 * The `NXA1` encrypted-export container (ADR-022). The IMEX full export is a
 * `.nexus.zip` stream that can be very large — attachments are capped at 50 MB
 * each and an archive may hold many — so this cannot be "one
 * `crypto.subtle.encrypt` call over the whole archive": that would require the
 * entire zip resident in memory at once, exactly what the export writer was
 * built to avoid. Instead the archive is a cleartext header followed by a
 * sequence of independently-sealed AES-256-GCM frames, so the caller can
 * stream the zip through a bounded window one chunk at a time in either
 * direction:
 *
 *   passphrase --Argon2id(salt)--> key (auth/keyChain.ts's deriveArchiveKey)
 *   header     = {format, version, cipher, kdf, salt, noncePrefix, chunkBytes}, CLEARTEXT
 *   frame[i]   --AES-256-GCM(key, nonce=noncePrefix‖i, aad=headerHash‖i‖finalFlag)--> ciphertext‖tag
 *
 * — using only WebCrypto (`globalThis.crypto`), so this module runs unchanged
 * in Node (Vitest), the Electron main process, and a browser: no `node:*`
 * import, no `Buffer`, no DOM API. It must also never import `hash-wasm`
 * (directly or transitively): this file is exported from the `.` barrel,
 * which the renderer imports for ordinary, non-lock-screen UI, and pulling
 * Argon2id's WASM into that bundle would defeat the whole reason
 * `auth/keyChain.ts` lives behind its own `./auth` subpath. Key derivation is
 * the caller's job (`deriveArchiveKey`); this module only ever receives an
 * already-derived 32-byte key.
 *
 * ## Byte layout
 *
 * ```
 * magic          4 bytes   ASCII "NXA1"
 * headerLength   4 bytes   uint32 big-endian, length of headerJson
 * headerJson     N bytes   UTF-8 JSON, CLEARTEXT — see ArchiveHeader
 * frame[0]       ...       framePrefix (4 bytes) + frameBody (L bytes)
 * frame[1]       ...       ditto
 * ...
 * frame[n]       ...       ditto, with the FINAL flag set in its framePrefix
 * ```
 *
 * `magic + headerLength + headerJson` together are the "header block". Every
 * `framePrefix` is a big-endian uint32 whose top bit (`0x8000_0000`) is the
 * FINAL flag and whose low 31 bits are the frame body's length; `frameBody`
 * is AES-256-GCM ciphertext with its 16-byte tag appended.
 *
 * ## Why the AAD is 37 bytes, and what each part closes
 *
 * Every frame is sealed with 37 bytes of additional authenticated data:
 * `headerHash` (32 bytes, SHA-256 of the exact `headerJson` bytes) ‖
 * `frameIndex` (4 bytes, big-endian, matching the nonce's own counter) ‖
 * `finalFlag` (1 byte, `0x01`/`0x00`). None of these are encrypted — the
 * reader must know them before it can decrypt anything — but binding them as
 * AAD means AES-GCM's tag fails to verify the moment any of them is wrong.
 * Framed AEAD has a well-known set of attacks that per-frame authentication
 * alone does not close; each AAD field closes exactly one:
 *
 * - **Truncation.** Chopping trailing frames off a stream of independently
 *   sealed AEAD frames normally goes undetected: every surviving frame still
 *   authenticates on its own. Binding `finalFlag` means a truncated archive
 *   has no frame whose AAD claims to be final, so nothing ever satisfies
 *   `ArchiveReader.assertComplete()` — the reader has no way to mistake "ran
 *   out of frames" for "reached the end". This is why an archive with an
 *   EMPTY payload still writes exactly one final frame (a zero-length
 *   plaintext, 16 bytes of tag): without it, an empty archive would have no
 *   final frame to check, and the truncation guard would be conditional
 *   instead of unconditional.
 * - **Reordering or dropping a middle frame.** `frameIndex` is authenticated
 *   (and also drives the nonce, see below), so decrypting frame *k*'s bytes
 *   while expecting frame *j* fails the tag check the instant `j !== k`.
 * - **Splicing a frame from a different archive.** `headerHash` differs
 *   between two archives (different salt, different `noncePrefix`, generally
 *   different everything), so a frame sealed under one header fails
 *   authentication against a reader built on another, even with the same key.
 * - **Header tampering** — e.g. lowering the declared KDF cost, or swapping
 *   the salt for one the attacker knows a key for. The header itself is
 *   cleartext (a reader has no key yet when it first reads it), but its hash
 *   is baked into every frame's AAD, so editing so much as one byte of it
 *   breaks every frame in the file at once.
 *
 * ## Why the nonce can never repeat
 *
 * Each frame's 12-byte nonce is `noncePrefix (8 bytes, fresh random per
 * archive) ‖ frameIndex (4 bytes, big-endian, starting at 0)`. AES-GCM's
 * security collapses completely if a nonce is ever reused under the same key,
 * so this needs to hold both within one archive and across every archive ever
 * written. Within an archive, `frameIndex` increments by exactly one per
 * frame and `createArchiveWriter` refuses to seal a frame index that would
 * not fit in 32 bits, so it cannot repeat there. Across archives, the key
 * itself is derived from a fresh random Argon2id salt every export (see
 * `deriveArchiveKey`), and `noncePrefix` is independently fresh random on top
 * of that — so even the pathological case of the same passphrase exporting
 * twice produces a different key, and even in the astronomically unlikely
 * event it didn't, a different `noncePrefix`.
 */

/** ASCII "NXA1" — the four bytes every well-formed container starts with. */
export const ARCHIVE_MAGIC = "NXA1";

/** The only header `version` this module understands today. */
export const ARCHIVE_FORMAT_VERSION = 1;

/**
 * Plaintext bytes per non-final frame (1 MiB). Not configurable per archive —
 * every `createArchiveWriter` call uses this value and records it in the
 * header purely for the reader's information; a reader never needs it to
 * decrypt (frames are already length-prefixed), only a caller who wants to
 * size its own read-ahead buffer.
 */
export const ARCHIVE_CHUNK_BYTES = 1_048_576;

/** The Argon2id salt's length in bytes — see `deriveArchiveKey`. */
export const ARCHIVE_SALT_BYTES = 16;

/** The random half of every frame's nonce; the other 4 bytes are the frame index. */
export const ARCHIVE_NONCE_PREFIX_BYTES = 8;

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const HEADER_HASH_BYTES = 32;
const FRAME_INDEX_BYTES = 4;
const FINAL_FLAG_BYTES = 1;
const FRAME_AAD_BYTES = HEADER_HASH_BYTES + FRAME_INDEX_BYTES + FINAL_FLAG_BYTES; // 37

const HEADER_PREFIX_BYTES = ARCHIVE_MAGIC.length + 4; // magic + headerLength
/** A hostile `headerLength` cannot be trusted to bound anything on its own — this is the hard ceiling regardless of what a file declares. */
const MAX_HEADER_JSON_BYTES = 8192;
/** The largest `chunkBytes` a header may declare. A policy ceiling, not a structural one — 31 bits of length prefix would reach 2 GiB — chosen far above `ARCHIVE_CHUNK_BYTES` so the format has room to grow, and far below anything that would strain a reader. */
const MAX_CHUNK_BYTES = 64 * 1024 * 1024;
const GCM_TAG_BYTES = 16;
/**
 * The hard ceiling on a frame body length read out of an untrusted prefix.
 * The caller's next move after `parseFramePrefix` is always to allocate a
 * buffer of exactly this many bytes and read into it, so an unbounded length
 * would make a four-byte edit anywhere in a file a memory-exhaustion attack on
 * whoever opens it — the same attack `validateKdfParams` bounds, at a
 * different layer. No writer can produce more than `MAX_CHUNK_BYTES` of
 * plaintext plus a tag, so nothing legitimate is ever refused here.
 */
const MAX_FRAME_BODY_BYTES = MAX_CHUNK_BYTES + GCM_TAG_BYTES;
const FRAME_FINAL_FLAG = 0x8000_0000;
const FRAME_LENGTH_MASK = 0x7fff_ffff;
/** `frameIndex` is a big-endian uint32; a writer or reader that reached this many frames has nowhere left to count. */
const MAX_FRAME_INDEX = 0xffff_ffff;

const MIN_KDF_MEMORY_KIB = 8192;
const MAX_KDF_MEMORY_KIB = 1024 * 1024;
const MIN_KDF_ITERATIONS = 1;
const MAX_KDF_ITERATIONS = 16;
const MIN_KDF_PARALLELISM = 1;
const MAX_KDF_PARALLELISM = 8;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Argon2id parameters, declared structurally here (not imported as
 * `auth/keyChain.ts`'s `KdfParams`) so this file — reachable from the `.`
 * barrel — never needs a path to `auth/`, which is the module that pulls in
 * `hash-wasm`. The two types are structurally identical by design: a header
 * built from `auth/keyChain.ts`'s `KdfParams` (as `deriveArchiveKey`'s caller
 * will pass) satisfies this interface without any adapting.
 */
export interface ArchiveKdfParams {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** The container's cleartext header. Its integrity comes from every frame's AAD, not from encryption — see the file header. */
export interface ArchiveHeader {
  format: "nexus-archive";
  version: 1;
  cipher: "AES-256-GCM";
  kdf: ArchiveKdfParams;
  /** Base64, decodes to exactly `ARCHIVE_SALT_BYTES` bytes — the Argon2id salt that produced the archive's key. */
  salt: string;
  /** Base64, decodes to exactly `ARCHIVE_NONCE_PREFIX_BYTES` bytes — fresh random per archive. */
  noncePrefix: string;
  /** Plaintext bytes per non-final frame, as recorded by the writer that produced this archive. */
  chunkBytes: number;
}

/**
 * A container that is not a Nexus archive at all, or is structurally
 * malformed: bad magic, an impossible length, unparseable or out-of-bounds
 * header JSON. Deliberately distinct from `ArchiveDecryptError` — this one is
 * knowable from the bytes alone, before a key even exists to try decrypting
 * anything, which matters most for `parseArchiveHeader`: it is the boundary
 * where this module first touches untrusted input, and it must reject a
 * hostile file cheaply, without ever calling into Argon2id or WebCrypto.
 */
export class ArchiveFormatError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArchiveFormatError";
  }
}

/**
 * A frame that does not authenticate: the wrong passphrase/key, edited bytes,
 * or a reordered, foreign, or truncated stream (see the file header's list of
 * attacks the AAD closes). AES-GCM's tag check cannot tell these apart from
 * each other, so this error doesn't pretend to either.
 */
export class ArchiveDecryptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArchiveDecryptError";
  }
}

// These small helpers deliberately do NOT annotate a `Uint8Array` return
// type: since TypeScript 5.7, the bare name `Uint8Array` means
// `Uint8Array<ArrayBufferLike>` (a supertype that also admits a
// `SharedArrayBuffer`-backed view), and writing it explicitly would widen
// what is otherwise a precisely-typed `Uint8Array<ArrayBuffer>` inferred
// from `new Uint8Array(...)`. That distinction only bites a *consumer*
// whose own tsconfig includes the DOM lib (this package's does not) and
// tries to hand the result straight to `crypto.subtle` — exactly what
// `createArchiveWriter`/`createArchiveReader` do below, hence
// `toArrayBufferBytes` at their public parameter boundary.
function randomBytes(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Base64-encodes a `Uint8Array` with no `Buffer` (this package is
 * platform-free) — the same technique as `auth/keyChain.ts`'s `toBase64`,
 * duplicated rather than imported: see the file header on why this module
 * never reaches into `auth/`.
 */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The inverse of `toBase64`. `atob` throws a bare `SyntaxError` on malformed
 * input; caught and re-thrown as `ArchiveFormatError` because a header field
 * that isn't valid base64 is untrusted-input territory (see that class's
 * doc), never a bare DOM/WebCrypto exception the caller has to guess about.
 */
function fromBase64(value: string) {
  let binary: string;
  try {
    binary = atob(value);
  } catch (error) {
    throw new ArchiveFormatError("Archive header contains invalid base64.", { cause: error });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Returns a fresh, concretely `ArrayBuffer`-backed copy of `bytes`. Every
 * public function in this module that accepts a caller-supplied `Uint8Array`
 * (`key`, `plaintext`, `body`, `headerBlock`) types it as the bare,
 * un-parameterized `Uint8Array` to match this module's spec — but bare
 * `Uint8Array` means `Uint8Array<ArrayBufferLike>`, which WebCrypto's
 * `BufferSource` (requiring `ArrayBufferView<ArrayBuffer>`) rejects under a
 * consumer's stricter, DOM-lib tsconfig even though nothing here touches the
 * DOM. Copying is the correct fix rather than a type assertion: the
 * assertion would be a lie if a caller ever did pass a `SharedArrayBuffer`
 * view, whereas an actual copy is what makes that safe.
 */
function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function writeUint32BE(target: Uint8Array, offset: number, value: number): void {
  new DataView(target.buffer, target.byteOffset, target.byteLength).setUint32(
    offset,
    value,
    false,
  );
}

function readUint32BE(source: Uint8Array, offset: number): number {
  return new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(
    offset,
    false,
  );
}

/** `noncePrefix (8 bytes) ‖ frameIndex (4 bytes, big-endian)` — see the file header on why this can never repeat. */
function buildNonce(noncePrefix: Uint8Array, frameIndex: number) {
  const nonce = new Uint8Array(GCM_NONCE_BYTES);
  nonce.set(noncePrefix, 0);
  writeUint32BE(nonce, ARCHIVE_NONCE_PREFIX_BYTES, frameIndex);
  return nonce;
}

/** `headerHash (32 bytes) ‖ frameIndex (4 bytes, big-endian) ‖ finalFlag (1 byte)` — see the file header on what each field closes. */
function buildAad(headerHash: Uint8Array, frameIndex: number, final: boolean) {
  const aad = new Uint8Array(FRAME_AAD_BYTES);
  aad.set(headerHash, 0);
  writeUint32BE(aad, HEADER_HASH_BYTES, frameIndex);
  aad[HEADER_HASH_BYTES + FRAME_INDEX_BYTES] = final ? 1 : 0;
  return aad;
}

function assertFrameIndexInRange(frameIndex: number): void {
  if (frameIndex > MAX_FRAME_INDEX) {
    throw new RangeError(
      "Archive frame index overflow: this archive has more frames than a 32-bit index can count.",
    );
  }
}

/** Big-endian: `bit31` = FINAL, `bits[0..30]` = body length. */
function buildFramePrefix(bodyLength: number, final: boolean) {
  const prefix = new Uint8Array(4);
  const flagged = final ? bodyLength | FRAME_FINAL_FLAG : bodyLength;
  writeUint32BE(prefix, 0, flagged);
  return prefix;
}

/**
 * Splits a frame prefix into its length and FINAL flag. Exported because the
 * reader's caller owns framing — it is reading a stream one prefix at a time,
 * not handed a whole buffer to slice up itself.
 *
 * Both bounds exist because this is the second untrusted-input boundary in the
 * module (`parseArchiveHeader` is the first), and the caller's very next move
 * is to allocate `bodyLength` bytes and read into them. A sealed frame always
 * carries at least its 16-byte GCM tag, so anything shorter cannot be a real
 * frame; and nothing legitimate exceeds `MAX_FRAME_BODY_BYTES` (see its doc on
 * the allocation attack an unbounded length would open).
 */
export function parseFramePrefix(prefix: Uint8Array): { bodyLength: number; final: boolean } {
  if (prefix.length !== 4) {
    throw new ArchiveFormatError(
      `Frame prefix must be exactly 4 bytes, got ${prefix.length}.`,
    );
  }
  const value = readUint32BE(prefix, 0);
  const final = (value & FRAME_FINAL_FLAG) !== 0;
  const bodyLength = value & FRAME_LENGTH_MASK;
  if (bodyLength < GCM_TAG_BYTES) {
    throw new ArchiveFormatError(
      `Frame body length ${bodyLength} is shorter than a ${GCM_TAG_BYTES}-byte GCM tag — it cannot be a sealed frame.`,
    );
  }
  if (bodyLength > MAX_FRAME_BODY_BYTES) {
    throw new ArchiveFormatError(
      `Frame body length ${bodyLength} exceeds the ${MAX_FRAME_BODY_BYTES}-byte cap.`,
    );
  }
  return { bodyLength, final };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expectRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ArchiveFormatError(`Archive header's ${fieldName} field is not an object.`);
  }
  return value;
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new ArchiveFormatError(`Archive header's ${fieldName} field is not a string.`);
  }
  return value;
}

function expectIntegerInRange(
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new ArchiveFormatError(
      `Archive header's ${fieldName} field must be an integer in [${min}, ${max}], got ${JSON.stringify(value)}.`,
    );
  }
  return value;
}

/**
 * Validates and decodes a base64 field to exactly `expectedLength` bytes,
 * returning the original (validated) base64 STRING — the header keeps these
 * fields as base64 text, not raw bytes.
 */
function expectFixedLengthBase64(
  value: unknown,
  fieldName: string,
  expectedLength: number,
): string {
  const text = expectString(value, fieldName);
  const decoded = fromBase64(text);
  if (decoded.length !== expectedLength) {
    throw new ArchiveFormatError(
      `Archive header's ${fieldName} field must decode to exactly ${expectedLength} bytes, got ${decoded.length}.`,
    );
  }
  return text;
}

/**
 * Bounds every Argon2id knob a hostile header could declare. A reader must
 * derive the key using whatever parameters the *file itself* declares before
 * it can authenticate a single byte — so an archive with, say,
 * `memoryKiB: 4_000_000_000` is a memory-exhaustion attack mounted on whoever
 * merely tries to open it, well before the passphrase is even checked.
 * Bounding every field here is what keeps "open a suspicious archive" safe.
 */
function validateKdfParams(value: unknown): ArchiveKdfParams {
  const kdf = expectRecord(value, "kdf");
  if (kdf.algorithm !== "argon2id") {
    throw new ArchiveFormatError(
      `Unsupported KDF algorithm: ${JSON.stringify(kdf.algorithm)}.`,
    );
  }
  const memoryKiB = expectIntegerInRange(
    kdf.memoryKiB,
    "kdf.memoryKiB",
    MIN_KDF_MEMORY_KIB,
    MAX_KDF_MEMORY_KIB,
  );
  const iterations = expectIntegerInRange(
    kdf.iterations,
    "kdf.iterations",
    MIN_KDF_ITERATIONS,
    MAX_KDF_ITERATIONS,
  );
  const parallelism = expectIntegerInRange(
    kdf.parallelism,
    "kdf.parallelism",
    MIN_KDF_PARALLELISM,
    MAX_KDF_PARALLELISM,
  );
  return { algorithm: "argon2id", memoryKiB, iterations, parallelism };
}

function validateHeaderShape(value: unknown): ArchiveHeader {
  const record = expectRecord(value, "(root)");
  if (record.format !== "nexus-archive") {
    throw new ArchiveFormatError(`Unsupported archive format: ${JSON.stringify(record.format)}.`);
  }
  if (record.version !== ARCHIVE_FORMAT_VERSION) {
    throw new ArchiveFormatError(
      `Unsupported archive version: ${JSON.stringify(record.version)}.`,
    );
  }
  if (record.cipher !== "AES-256-GCM") {
    throw new ArchiveFormatError(`Unsupported cipher: ${JSON.stringify(record.cipher)}.`);
  }
  const kdf = validateKdfParams(record.kdf);
  const salt = expectFixedLengthBase64(record.salt, "salt", ARCHIVE_SALT_BYTES);
  const noncePrefix = expectFixedLengthBase64(
    record.noncePrefix,
    "noncePrefix",
    ARCHIVE_NONCE_PREFIX_BYTES,
  );
  const chunkBytes = expectIntegerInRange(record.chunkBytes, "chunkBytes", 1, MAX_CHUNK_BYTES);

  return {
    format: "nexus-archive",
    version: ARCHIVE_FORMAT_VERSION,
    cipher: "AES-256-GCM",
    kdf,
    salt,
    noncePrefix,
    chunkBytes,
  };
}

/**
 * Reads the header block off the front of a container. Needs no key — the
 * header is cleartext, its integrity coming from every frame's AAD rather
 * than from encryption — and is the untrusted-input boundary for this whole
 * module: every rejection below throws `ArchiveFormatError` and happens
 * before a single call into WebCrypto, so a hostile file cannot use this
 * function to attack anything but the parser itself.
 *
 * Returns the parsed header and `blockLength`, the total length of the header
 * block — i.e. the byte offset of the first frame.
 */
export async function parseArchiveHeader(
  bytes: Uint8Array,
): Promise<{ header: ArchiveHeader; blockLength: number }> {
  if (bytes.length < HEADER_PREFIX_BYTES) {
    throw new ArchiveFormatError(
      `Container is too short to hold a magic and a header length (need at least ${HEADER_PREFIX_BYTES} bytes, got ${bytes.length}).`,
    );
  }
  const magic = textDecoder.decode(bytes.subarray(0, ARCHIVE_MAGIC.length));
  if (magic !== ARCHIVE_MAGIC) {
    throw new ArchiveFormatError(`Container does not start with the ${ARCHIVE_MAGIC} magic.`);
  }

  const headerLength = readUint32BE(bytes, ARCHIVE_MAGIC.length);
  if (headerLength > MAX_HEADER_JSON_BYTES) {
    throw new ArchiveFormatError(
      `Declared header length ${headerLength} exceeds the ${MAX_HEADER_JSON_BYTES}-byte cap.`,
    );
  }
  const blockLength = HEADER_PREFIX_BYTES + headerLength;
  if (bytes.length < blockLength) {
    throw new ArchiveFormatError(
      `Declared header length ${headerLength} overruns the container (only ${bytes.length - HEADER_PREFIX_BYTES} bytes available).`,
    );
  }

  const headerJsonBytes = bytes.subarray(HEADER_PREFIX_BYTES, blockLength);
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(headerJsonBytes));
  } catch (error) {
    throw new ArchiveFormatError("Archive header is not valid JSON.", { cause: error });
  }

  return { header: validateHeaderShape(parsed), blockLength };
}

/** What a caller must already have derived (e.g. via `auth/keyChain.ts`'s `deriveArchiveKey`) before writing an archive. */
export interface ArchiveWriterOptions {
  /** The 32-byte AES-256-GCM key. */
  key: Uint8Array;
  /** The Argon2id salt that produced `key` — recorded in the header so a reader can repeat the derivation. */
  salt: Uint8Array;
  /** The Argon2id parameters that produced `key` — likewise recorded. */
  kdf: ArchiveKdfParams;
}

/** Seals one archive's worth of frames, in order, under one fixed key/header. */
export interface ArchiveWriter {
  /** `magic + headerLength + headerJson`. Must be written to the output before any frame. */
  readonly headerBlock: Uint8Array;
  /** How many plaintext bytes belong in each non-final frame (informational — see `ARCHIVE_CHUNK_BYTES`). */
  readonly chunkBytes: number;
  /**
   * Seals the next frame IN ORDER and returns its length-prefixed bytes,
   * ready to write to the output. Throws once a final frame has already been
   * sealed — there is exactly one final frame per archive (see the file
   * header on why), so a second one is always a caller bug.
   */
  seal(plaintext: Uint8Array, final: boolean): Promise<Uint8Array>;
}

/**
 * Builds a fresh writer: generates a random `noncePrefix`, assembles and
 * hashes the header, and imports `key` once for reuse across every `seal`
 * call. The header is built as a literal in the exact field order
 * `ArchiveHeader` declares, so `JSON.stringify` always produces the same
 * bytes for the same values — required because those exact bytes are what
 * every frame's AAD is bound to (see the file header).
 */
export async function createArchiveWriter(
  options: ArchiveWriterOptions,
): Promise<ArchiveWriter> {
  const { key, salt, kdf } = options;
  if (key.length !== AES_KEY_BYTES) {
    throw new TypeError(`ArchiveWriterOptions.key must be ${AES_KEY_BYTES} bytes, got ${key.length}.`);
  }
  if (salt.length !== ARCHIVE_SALT_BYTES) {
    throw new TypeError(
      `ArchiveWriterOptions.salt must be ${ARCHIVE_SALT_BYTES} bytes, got ${salt.length}.`,
    );
  }

  const noncePrefix = randomBytes(ARCHIVE_NONCE_PREFIX_BYTES);
  const header: ArchiveHeader = {
    format: "nexus-archive",
    version: ARCHIVE_FORMAT_VERSION,
    cipher: "AES-256-GCM",
    kdf,
    salt: toBase64(salt),
    noncePrefix: toBase64(noncePrefix),
    chunkBytes: ARCHIVE_CHUNK_BYTES,
  };
  const headerJsonBytes = textEncoder.encode(JSON.stringify(header));
  const headerHash = new Uint8Array(await crypto.subtle.digest("SHA-256", headerJsonBytes));

  const headerBlock = new Uint8Array(HEADER_PREFIX_BYTES + headerJsonBytes.length);
  headerBlock.set(textEncoder.encode(ARCHIVE_MAGIC), 0);
  writeUint32BE(headerBlock, ARCHIVE_MAGIC.length, headerJsonBytes.length);
  headerBlock.set(headerJsonBytes, HEADER_PREFIX_BYTES);

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBufferBytes(key),
    "AES-GCM",
    false,
    ["encrypt"],
  );

  let frameIndex = 0;
  let sealedFinal = false;

  return {
    headerBlock,
    chunkBytes: ARCHIVE_CHUNK_BYTES,
    async seal(plaintext: Uint8Array, final: boolean): Promise<Uint8Array> {
      if (sealedFinal) {
        throw new TypeError("Cannot seal another frame after the final frame has been sealed.");
      }
      assertFrameIndexInRange(frameIndex);

      const nonce = buildNonce(noncePrefix, frameIndex);
      const aad = buildAad(headerHash, frameIndex, final);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce, additionalData: aad },
          cryptoKey,
          toArrayBufferBytes(plaintext),
        ),
      );

      const framed = new Uint8Array(4 + ciphertext.length);
      framed.set(buildFramePrefix(ciphertext.length, final), 0);
      framed.set(ciphertext, 4);

      frameIndex += 1;
      if (final) sealedFinal = true;
      return framed;
    },
  };
}

/** Opens one archive's worth of frames, in order, under one fixed key/header. */
export interface ArchiveReader {
  /**
   * Feeds the next frame body IN ORDER (without its length prefix); `final`
   * is whatever the caller read out of that prefix's high bit. Returns the
   * frame's plaintext, or throws `ArchiveDecryptError` — see that class's doc
   * for the attacks a failed tag check can mean.
   *
   * Refuses any frame after the final one, mirroring the writer's own refusal
   * to seal a second: an archive has exactly one end, so bytes appended past
   * it are never payload, and a caller whose loop does not happen to stop on
   * `final` must not be able to decrypt them into its output.
   */
  openFrame(body: Uint8Array, final: boolean): Promise<Uint8Array>;
  /**
   * Throws `ArchiveDecryptError` unless a final frame has already been
   * opened. THE truncation check (see the file header) — a caller that skips
   * this re-opens the exact hole the final flag exists to close, because
   * every frame up to a cut point still authenticates perfectly well on its
   * own.
   */
  assertComplete(): void;
}

/**
 * Builds a reader bound to one header block. `headerBlock` must be exactly
 * the bytes `parseArchiveHeader` measured (its `blockLength`), because its
 * SHA-256 is the `headerHash` every frame's AAD is checked against — handing
 * in a different slice (extra trailing bytes, or bytes from elsewhere) would
 * silently produce a reader that can never authenticate a single real frame.
 */
export async function createArchiveReader(
  key: Uint8Array,
  headerBlock: Uint8Array,
): Promise<ArchiveReader> {
  const { header, blockLength } = await parseArchiveHeader(headerBlock);
  if (headerBlock.length !== blockLength) {
    throw new ArchiveFormatError(
      `headerBlock must be exactly the parsed header block (${blockLength} bytes), got ${headerBlock.length}.`,
    );
  }

  const headerJsonBytes = toArrayBufferBytes(headerBlock.subarray(HEADER_PREFIX_BYTES));
  const headerHash = new Uint8Array(await crypto.subtle.digest("SHA-256", headerJsonBytes));
  const noncePrefix = fromBase64(header.noncePrefix);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    toArrayBufferBytes(key),
    "AES-GCM",
    false,
    ["decrypt"],
  );

  let frameIndex = 0;
  let complete = false;

  return {
    async openFrame(body: Uint8Array, final: boolean): Promise<Uint8Array> {
      if (complete) {
        throw new ArchiveDecryptError(
          "Archive frames continue past the final frame — the container has trailing bytes it should not have.",
        );
      }
      assertFrameIndexInRange(frameIndex);

      const nonce = buildNonce(noncePrefix, frameIndex);
      const aad = buildAad(headerHash, frameIndex, final);

      let plaintext: Uint8Array;
      try {
        plaintext = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: nonce, additionalData: aad },
            cryptoKey,
            toArrayBufferBytes(body),
          ),
        );
      } catch (error) {
        throw new ArchiveDecryptError(
          "Could not open archive frame: wrong passphrase, edited bytes, or a reordered, foreign, or truncated stream.",
          { cause: error },
        );
      }

      frameIndex += 1;
      if (final) complete = true;
      return plaintext;
    },
    assertComplete(): void {
      if (!complete) {
        throw new ArchiveDecryptError(
          "Archive stream ended without a final frame — it may have been truncated.",
        );
      }
    },
  };
}
