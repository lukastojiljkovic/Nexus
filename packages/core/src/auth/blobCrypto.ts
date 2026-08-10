import { bytesToHex, hexToBytes } from "../bytes.js";

/**
 * Attachment blob crypto (ADR-019): encryption and naming for the NOTE
 * attachment blob store, which lives on disk *outside* the encrypted SQLite
 * database (content-addressed: `<userData>/attachments/<sha256[0:2]>/<sha256>`)
 * and so is not protected by the ADR-018 data key on its own.
 *
 *   dataKey --HKDF-SHA256(salt=empty, info=v1 strings)--> contentKey, nameKey
 *   plaintext --AES-256-GCM(contentKey, aad=sha256Hex)--> NXB1 container
 *   sha256Hex --HMAC-SHA256(nameKey)--> storage name
 *
 * — using only WebCrypto (`globalThis.crypto`), so this module runs unchanged
 * in Node (Vitest), the Electron main process, and a browser: no `node:*`
 * import, no `Buffer`, no DOM API.
 *
 * Two properties fall out of this design. Deduplication survives because the
 * storage name is still a deterministic function of the content (same file,
 * same HMAC, same name). The offline confirmation oracle does not: today a
 * blob is named by the plain SHA-256 of its plaintext, so anyone holding the
 * disk can hash a candidate file and learn whether this machine stores it.
 * Naming by an HMAC under a key derived from the data key keeps the name
 * deterministic while making it unguessable without that key.
 */

/** The two subkeys the blob store runs on, both derived from the ADR-018 data key. */
export interface BlobKeys {
  /** AES-256-GCM key for blob contents (32 bytes). */
  readonly contentKey: Uint8Array;
  /** HMAC-SHA256 key for storage names (32 bytes). */
  readonly nameKey: Uint8Array;
}

/** Thrown for any container that does not authenticate: wrong key, wrong identity, edited bytes, or a foreign/absent header. */
export class BlobDecryptError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BlobDecryptError";
  }
}

const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

/** A fixed magic lets `decryptBlob` reject a foreign file before it ever reaches WebCrypto — and makes the container self-describing for a future format version. */
const MAGIC_BYTES = new TextEncoder().encode("NXB1");
const HEADER_BYTES = MAGIC_BYTES.length + GCM_NONCE_BYTES;

/**
 * HKDF's empty salt is not a shortcut: RFC 5869 permits skipping the extract
 * salt precisely when the input keying material is already a uniformly random
 * key of full strength, which the ADR-018 data key is. The versioned `info`
 * strings, not a salt, are what let a future blob-crypto format coexist with
 * this one instead of silently reinterpreting an old blob under a new scheme.
 */
const EMPTY_SALT = new Uint8Array(0);
const CONTENT_KEY_INFO = new TextEncoder().encode("nexus/blob-content/v1");
const NAME_KEY_INFO = new TextEncoder().encode("nexus/blob-name/v1");

const DATA_KEY_HEX_PATTERN = /^[0-9a-fA-F]{64}$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

const textEncoder = new TextEncoder();

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function randomNonce(): Uint8Array {
  const nonce = new Uint8Array(GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);
  return nonce;
}

/** A malformed `sha256Hex` is always a programming error in the caller, never a runtime "this blob is bad" — hence `TypeError`, not `BlobDecryptError`. */
function assertSha256Hex(sha256Hex: string): void {
  if (!SHA256_HEX_PATTERN.test(sha256Hex)) {
    throw new TypeError(
      `sha256Hex must be 64 lower-case hex characters, got: ${JSON.stringify(sha256Hex)}`,
    );
  }
}

/**
 * Both subkeys derive from the same 256-bit data key via HKDF-SHA256, keyed
 * apart only by `info` so a leak of one never reveals the other. Case is
 * normalized inside `hexToBytes` — it has to be, because `@nexus/db`'s own key
 * guard accepts either case: two differently-cased spellings of one key must
 * not derive two different `nameKey`s, which would rename every blob and
 * silently break deduplication.
 */
export async function deriveBlobKeys(dataKeyHex: string): Promise<BlobKeys> {
  // The pattern and the decode are one expression on purpose. The pattern is
  // the format contract with `@nexus/db` — exactly 64 hex characters, no
  // whitespace, which the shared decoder would otherwise tolerate — and the
  // decode is the only thing that can produce the bytes. Written as two
  // separate guards, the second would be a branch nothing can reach, which is
  // the shape that rots the day the first one is loosened.
  const dataKey = DATA_KEY_HEX_PATTERN.test(dataKeyHex) ? hexToBytes(dataKeyHex) : null;
  if (dataKey === null) {
    throw new TypeError(
      `dataKeyHex must be 64 hex characters (the @nexus/db data key), got: ${JSON.stringify(dataKeyHex)}`,
    );
  }

  const ikm = await crypto.subtle.importKey("raw", dataKey, "HKDF", false, ["deriveBits"]);

  const contentKeyBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: CONTENT_KEY_INFO },
    ikm,
    256,
  );
  const nameKeyBits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: EMPTY_SALT, info: NAME_KEY_INFO },
    ikm,
    256,
  );

  return { contentKey: new Uint8Array(contentKeyBits), nameKey: new Uint8Array(nameKeyBits) };
}

/** Deterministic by construction (HMAC has no nonce): the same key and hash always name the same file, which is what makes deduplication work. */
export async function blobStorageName(nameKey: Uint8Array, sha256Hex: string): Promise<string> {
  assertSha256Hex(sha256Hex);
  const key = await crypto.subtle.importKey(
    "raw",
    nameKey,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(sha256Hex));
  return bytesToHex(new Uint8Array(signature));
}

/**
 * Produces the `NXB1` container: magic (4 bytes) + fresh random nonce
 * (12 bytes) + AES-256-GCM ciphertext with its 16-byte tag appended. The
 * content hash is bound in as additional authenticated data — not encrypted,
 * since the caller already knows it, but authenticated — so a blob swapped
 * or renamed between storage names fails the tag check instead of quietly
 * serving the wrong bytes under the wrong identity.
 */
export async function encryptBlob(
  contentKey: Uint8Array,
  plaintext: Uint8Array,
  sha256Hex: string,
): Promise<Uint8Array> {
  assertSha256Hex(sha256Hex);

  const nonce = randomNonce();
  const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: textEncoder.encode(sha256Hex) },
      key,
      plaintext,
    ),
  );

  const container = new Uint8Array(HEADER_BYTES + ciphertext.length);
  container.set(MAGIC_BYTES, 0);
  container.set(nonce, MAGIC_BYTES.length);
  container.set(ciphertext, HEADER_BYTES);
  return container;
}

/**
 * Throws `BlobDecryptError` for anything short of a fully authenticated
 * match: too short to hold a header and a tag, a magic that isn't `NXB1`, or
 * a GCM tag mismatch (wrong content key, wrong `sha256Hex`, edited bytes).
 * AES-GCM's tag check cannot tell those apart, so this doesn't pretend to.
 *
 * A wrong magic is a hard failure, never a "maybe this is still a legacy
 * plaintext blob" guess — the calling slice tells the legacy, unencrypted
 * store apart by which DIRECTORY a file lives in, not by sniffing its bytes,
 * so a foreign header here means this file simply isn't an NXB1 container.
 */
export async function decryptBlob(
  contentKey: Uint8Array,
  container: Uint8Array,
  sha256Hex: string,
): Promise<Uint8Array> {
  assertSha256Hex(sha256Hex);

  if (container.length < HEADER_BYTES + GCM_TAG_BYTES) {
    throw new BlobDecryptError("Blob container is too short to be a valid NXB1 container.");
  }
  if (!bytesEqual(container.subarray(0, MAGIC_BYTES.length), MAGIC_BYTES)) {
    throw new BlobDecryptError("Blob container does not start with the NXB1 magic.");
  }

  const nonce = container.subarray(MAGIC_BYTES.length, HEADER_BYTES);
  const ciphertext = container.subarray(HEADER_BYTES);

  try {
    const key = await crypto.subtle.importKey("raw", contentKey, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce, additionalData: textEncoder.encode(sha256Hex) },
      key,
      ciphertext,
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw new BlobDecryptError(
      "Could not decrypt blob: the content key is wrong, the sha256 identity does not match the container, or the bytes were edited.",
      { cause: error },
    );
  }
}
