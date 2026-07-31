/**
 * The private-note sealed containers (ADR-057): every private note is stored
 * as ONE opaque `NXP1` blob, and every private attachment as one `NXPB` blob,
 * both invisible to the rest of the app — no FTS row, no plaintext column, no
 * attachment table. Everything the app would normally normalize into tables
 * travels INSIDE the note's sealed envelope instead.
 *
 *   privDek --HKDF-SHA256(salt=empty, info=v1 strings)--> noteKey, blobKey
 *   envelope JSON --AES-256-GCM(noteKey, aad=noteId‖seq)--> NXP1 container
 *   attachment bytes --AES-256-GCM(blobKey, aad=attachmentId)--> NXPB container
 *
 * — using only WebCrypto (`globalThis.crypto`), so this module runs unchanged
 * in Node (Vitest), the Electron main process, and a browser: no `node:*`
 * import, no `Buffer`, no DOM API. It must also never import `hash-wasm`
 * (directly or transitively): this file is exported from the `.` barrel, and
 * pulling Argon2id's WASM into that bundle would defeat the whole reason
 * `auth/` lives behind its own subpath. Key derivation from a credential is
 * the caller's job (`priv/privKeys.ts`); this module only ever receives the
 * already-unwrapped 32-byte PRIV DEK — the same division `archiveContainer.ts`
 * keeps with `deriveArchiveKey`.
 *
 * HKDF's empty extract salt is `blobCrypto.ts`'s reasoning verbatim: the PRIV
 * DEK is already a full-strength uniformly random key (RFC 5869's condition
 * for skipping the salt), and the versioned `info` strings are what key the
 * note and blob uses apart — a leak of one subkey reveals nothing about the
 * other or the DEK itself.
 *
 * ## Container byte layout (both magics)
 *
 * ```
 * magic       4 bytes   ASCII "NXP1" (note) / "NXPB" (attachment blob)
 * nonce      12 bytes   fresh random per seal
 * ciphertext  N bytes   AES-256-GCM, 16-byte tag appended
 * ```
 *
 * ## What the AAD binds (SEC-CR-04)
 *
 * A note container's AAD is `UTF-8(noteId) ‖ uint32be(seq)` — the note's row
 * identity and its monotonic version sequence, concatenated in that order.
 * Neither is encrypted (the caller knows both before it can decrypt anything),
 * but binding them means AES-GCM's tag fails the moment either is wrong:
 *
 * - **noteId** makes a sealed blob unswappable between rows — note A's bytes
 *   copied into note B's row fail authentication instead of quietly opening
 *   as B.
 * - **seq** makes a row unrollbackable between versions — an old container
 *   pasted over a newer one fails against the row's current sequence instead
 *   of silently reviving the version the user overwrote.
 *
 * A blob container's AAD is `UTF-8(attachmentId)` alone: the caller names the
 * file on disk by that random id, and binding it means two attachments'
 * files cannot be swapped for each other. There is deliberately NO
 * content-addressing anywhere here — `blobCrypto.ts`'s dedup-by-hash is an
 * existence oracle PRIV must not have, so blobs are named by random id and
 * sealing the same bytes twice yields two unrelated containers.
 *
 * A failed open throws the one named `PrivSealError`: AES-GCM's tag check
 * cannot distinguish a wrong key from a swapped identity, a rolled-back
 * sequence, or edited bytes, so this module doesn't pretend to.
 */

/** One attachment's metadata, INSIDE the sealed envelope by design — the list's existence, names, and sizes are all invisible without the PRIV DEK (no table). */
export interface PrivAttachmentRef {
  /** The random id the caller names the sealed blob file by. */
  id: string;
  fileName: string;
  mime: string;
  sizeBytes: number;
}

/** A private note's entire payload, serialized as JSON inside the NXP1 container. */
export interface PrivNoteEnvelope {
  title: string;
  /** The note's Yjs document state, base64 — this module treats it as an opaque string. */
  yjsState: string;
  /** The flat text mirror the in-memory search index folds at unlock (SEC-ZK-05). */
  plaintext: string;
  attachments: PrivAttachmentRef[];
}

/** Thrown for any container that does not open: wrong key, wrong identity or sequence, edited bytes, a foreign/absent magic, or an authenticated payload that is not a v1 envelope. */
export class PrivSealError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrivSealError";
  }
}

const KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;
const SEQ_BYTES = 4;
/** `seq` is bound into the AAD as a big-endian uint32; a caller counting past this has nowhere left to count. */
const MAX_SEQ = 0xffff_ffff;

const NOTE_MAGIC = new TextEncoder().encode("NXP1");
const BLOB_MAGIC = new TextEncoder().encode("NXPB");
const HEADER_BYTES = NOTE_MAGIC.length + GCM_NONCE_BYTES;

/** Empty extract salt per RFC 5869 (see the module header); the versioned `info` strings carry the separation. */
const EMPTY_SALT = new Uint8Array(0);
const NOTE_KEY_INFO = new TextEncoder().encode("nexus/priv-note/v1");
const BLOB_KEY_INFO = new TextEncoder().encode("nexus/priv-blob/v1");

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * A fresh, concretely `ArrayBuffer`-backed copy for WebCrypto's `BufferSource`
 * at every public parameter boundary — `archiveContainer.ts`'s
 * `toArrayBufferBytes`, for its exact reasons (a DOM-lib consumer's stricter
 * `Uint8Array<ArrayBufferLike>` vs `BufferSource` mismatch, solved by a copy
 * rather than a type assertion that would lie about a `SharedArrayBuffer`).
 */
function toArrayBufferBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

function randomNonce() {
  const nonce = new Uint8Array(GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** A wrong-length key or empty id is always a programming error in the caller, never a runtime "this container is bad" — hence `TypeError`, not `PrivSealError` (`blobCrypto.ts`'s division). */
function assertKeyBytes(key: Uint8Array, name: string): void {
  if (key.length !== KEY_BYTES) {
    throw new TypeError(`${name} must be ${KEY_BYTES} bytes, got ${key.length}.`);
  }
}

function assertNonEmptyId(id: string, name: string): void {
  if (id.length === 0) {
    throw new TypeError(`${name} must be a non-empty string.`);
  }
}

function assertSeq(seq: number): void {
  if (!Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) {
    throw new TypeError(`seq must be an integer in [0, ${MAX_SEQ}], got ${JSON.stringify(seq)}.`);
  }
}

/** Both subkeys derive from the PRIV DEK via HKDF-SHA256, keyed apart only by `info` (see the module header). */
async function deriveSubkey(privDek: Uint8Array, info: Uint8Array) {
  const ikm = await crypto.subtle.importKey(
    "raw",
    toArrayBufferBytes(privDek),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: toArrayBufferBytes(info) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** AAD layout: `UTF-8(noteId) ‖ uint32be(seq)` — id bytes first, then the sequence as 4 big-endian bytes (see the module header on what each part closes). */
function buildNoteAad(noteId: string, seq: number) {
  const idBytes = textEncoder.encode(noteId);
  const aad = new Uint8Array(idBytes.length + SEQ_BYTES);
  aad.set(idBytes, 0);
  new DataView(aad.buffer).setUint32(idBytes.length, seq, false);
  return aad;
}

/** `magic ‖ nonce ‖ ciphertext+tag`, fresh random nonce per call. */
async function sealContainer(
  rawKey: Uint8Array,
  magic: Uint8Array,
  aad: Uint8Array,
  plaintext: Uint8Array,
) {
  const key = await crypto.subtle.importKey("raw", toArrayBufferBytes(rawKey), "AES-GCM", false, [
    "encrypt",
  ]);
  const nonce = randomNonce();
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: toArrayBufferBytes(aad) },
      key,
      toArrayBufferBytes(plaintext),
    ),
  );

  const container = new Uint8Array(HEADER_BYTES + ciphertext.length);
  container.set(magic, 0);
  container.set(nonce, magic.length);
  container.set(ciphertext, HEADER_BYTES);
  return container;
}

/**
 * The one open path both containers share: length and magic checks first —
 * knowable from the bytes alone, before WebCrypto is ever called — then the
 * tag-checked decrypt, every failure surfaced as `PrivSealError`.
 */
async function openContainer(
  rawKey: Uint8Array,
  magic: Uint8Array,
  magicName: string,
  aad: Uint8Array,
  container: Uint8Array,
) {
  if (container.length < HEADER_BYTES + GCM_TAG_BYTES) {
    throw new PrivSealError(`Container is too short to be a valid ${magicName} container.`);
  }
  if (!bytesEqual(container.subarray(0, magic.length), magic)) {
    throw new PrivSealError(`Container does not start with the ${magicName} magic.`);
  }

  const nonce = toArrayBufferBytes(container.subarray(magic.length, HEADER_BYTES));
  const ciphertext = toArrayBufferBytes(container.subarray(HEADER_BYTES));

  try {
    const key = await crypto.subtle.importKey("raw", toArrayBufferBytes(rawKey), "AES-GCM", false, [
      "decrypt",
    ]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: toArrayBufferBytes(aad) },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new PrivSealError(
      `Could not open ${magicName} container: the key is wrong, the bound identity does not match, or the bytes were edited.`,
      { cause: error },
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Rebuilds the envelope field by field — an authenticated container still carries untrusted-shape JSON (a caller bug or a future format), and unknown fields must not ride through. */
function validateEnvelopeShape(value: unknown): PrivNoteEnvelope {
  if (
    !isRecord(value) ||
    typeof value.title !== "string" ||
    typeof value.yjsState !== "string" ||
    typeof value.plaintext !== "string" ||
    !Array.isArray(value.attachments)
  ) {
    throw new PrivSealError("Decrypted payload is not a v1 private-note envelope.");
  }
  const attachments = value.attachments.map((entry): PrivAttachmentRef => {
    if (
      !isRecord(entry) ||
      typeof entry.id !== "string" ||
      typeof entry.fileName !== "string" ||
      typeof entry.mime !== "string" ||
      typeof entry.sizeBytes !== "number" ||
      !Number.isInteger(entry.sizeBytes) ||
      entry.sizeBytes < 0
    ) {
      throw new PrivSealError("Decrypted envelope carries a malformed attachment reference.");
    }
    return { id: entry.id, fileName: entry.fileName, mime: entry.mime, sizeBytes: entry.sizeBytes };
  });
  return {
    title: value.title,
    yjsState: value.yjsState,
    plaintext: value.plaintext,
    attachments,
  };
}

/**
 * Seals a note's envelope into an NXP1 container bound to (`noteId`, `seq`) —
 * see the module header for the layout and what the AAD closes. The note key
 * is HKDF-derived from the PRIV DEK per call; deriving is two WebCrypto calls
 * on a hot-enough path that caching would buy nothing but a place for key
 * material to linger.
 */
export async function sealPrivNote(
  privDek: Uint8Array,
  noteId: string,
  seq: number,
  envelope: PrivNoteEnvelope,
): Promise<Uint8Array> {
  assertKeyBytes(privDek, "privDek");
  assertNonEmptyId(noteId, "noteId");
  assertSeq(seq);

  const noteKey = await deriveSubkey(privDek, NOTE_KEY_INFO);
  const payload = textEncoder.encode(JSON.stringify(envelope));
  return sealContainer(noteKey, NOTE_MAGIC, buildNoteAad(noteId, seq), payload);
}

/**
 * The inverse of `sealPrivNote`: opens the container AS (`noteId`, `seq`) —
 * a container sealed for any other row or sequence throws `PrivSealError`,
 * as does any tamper, foreign magic, or an authenticated payload that fails
 * the envelope shape check.
 */
export async function openPrivNote(
  privDek: Uint8Array,
  noteId: string,
  seq: number,
  bytes: Uint8Array,
): Promise<PrivNoteEnvelope> {
  assertKeyBytes(privDek, "privDek");
  assertNonEmptyId(noteId, "noteId");
  assertSeq(seq);

  const noteKey = await deriveSubkey(privDek, NOTE_KEY_INFO);
  const plaintext = await openContainer(noteKey, NOTE_MAGIC, "NXP1", buildNoteAad(noteId, seq), bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(plaintext));
  } catch (error) {
    throw new PrivSealError("Decrypted payload is not valid JSON.", { cause: error });
  }
  return validateEnvelopeShape(parsed);
}

/**
 * The 32-byte key `sealPrivBlob`/`openPrivBlob` run on, derived once and
 * reused across a session's blob operations (an attachment can be large; the
 * per-call derivation `sealPrivNote` affords would just repeat work here).
 */
export async function derivePrivBlobKey(privDek: Uint8Array): Promise<Uint8Array> {
  assertKeyBytes(privDek, "privDek");
  return deriveSubkey(privDek, BLOB_KEY_INFO);
}

/** Seals attachment bytes into an NXPB container bound to `attachmentId` — the random id the caller names the file by (no content-addressing, see the module header). */
export async function sealPrivBlob(
  blobKey: Uint8Array,
  attachmentId: string,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  assertKeyBytes(blobKey, "blobKey");
  assertNonEmptyId(attachmentId, "attachmentId");
  return sealContainer(blobKey, BLOB_MAGIC, textEncoder.encode(attachmentId), plaintext);
}

/** The inverse of `sealPrivBlob`: opens the container AS `attachmentId`, throwing `PrivSealError` for a swapped id, tamper, or foreign magic. */
export async function openPrivBlob(
  blobKey: Uint8Array,
  attachmentId: string,
  bytes: Uint8Array,
): Promise<Uint8Array> {
  assertKeyBytes(blobKey, "blobKey");
  assertNonEmptyId(attachmentId, "attachmentId");
  return openContainer(blobKey, BLOB_MAGIC, "NXPB", textEncoder.encode(attachmentId), bytes);
}
