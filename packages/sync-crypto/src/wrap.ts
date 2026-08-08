/**
 * Key wrapping: the master key (MK) under each of the three keys that may open
 * it, and each per-profile content key (CK_p) under MK.
 *
 * The key hierarchy this serves, stated once so the constraints below read as
 * consequences rather than taste:
 *
 *   DK          the EXISTING local SQLCipher data key. Untouched by this
 *               package; it only appears here as one of MK's wrapping keys.
 *   MK          256 random bits, NEVER derived from a password. Wrapped under
 *               DK on the desktop, under K_wrap (see `kdf.ts`) on the server,
 *               and under Argon2id(sync recovery code) as the way back.
 *               **MK MUST NEVER ENTER A BROWSER** — and note where that rule
 *               is actually kept: not here. `unwrapKey` will open an
 *               `mk/web-password` wrap for anyone holding K_wrap, and the
 *               server hands that wrap to any signed-in session. The rule
 *               survives only because a browser never derives K_wrap; see
 *               `kdf.ts`'s header on `deriveWebAuthPassword` and on the bundle
 *               constraint the web app owes.
 *   CK_p        256 random bits per profile, wrapped under MK. A browser
 *               session receives only the CK_p of profiles the user marked
 *               web-enabled. A profile marked local-only is enforced by NEVER
 *               WRAPPING its CK_p under MK — so "this profile stays on my
 *               computer" is a fact about which ciphertexts exist, not a
 *               boolean somebody can flip.
 *
 * ─── Why every wrap carries an explicit key-commitment tag ───────────────────
 *
 * **AES-GCM is not key-committing.** Its tag proves "someone holding *a* key
 * produced this", not "the key you just tried is the key that produced this".
 * Given a ciphertext, an adversary who knows the plaintext can construct a
 * SECOND key under which the same ciphertext authenticates and decrypts to a
 * different, chosen plaintext — the GHASH polynomial has enough freedom to
 * arrange it (the "invisible salamander" / partitioning-oracle family of
 * attacks). Worse, the construction generalises: a single ciphertext can be
 * built that opens successfully under *many* candidate keys at once.
 *
 * What that would allow here, concretely. MK's web wrap is opened by a key
 * derived from the user's password. A hostile server hands the client a
 * ciphertext crafted to open under a thousand candidate passwords. The client
 * says "that worked" or "that failed", and one answer eliminates a thousand
 * guesses instead of one — an online guessing attack accelerated by three
 * orders of magnitude, against exactly the key Argon2id was paid for to
 * protect. The same trick against the recovery-code wrap turns a single probe
 * into a thousand.
 *
 * The fix is to commit to the key explicitly. From the wrapping key we derive
 * TWO independent subkeys with HKDF: `K_enc`, which does the AEAD, and
 * `K_commit`, which is stored in the clear beside the ciphertext. Opening
 * recomputes `K_commit` from the candidate key and compares it in (as near as
 * JavaScript gets to) constant time before touching the AEAD at all. Producing
 * a second wrapping key with the same `K_commit` means finding an HMAC-SHA256
 * preimage, so a wrap now binds to exactly ONE key. Publishing `K_commit`
 * costs nothing: HKDF-Expand outputs are computationally independent, so it
 * reveals neither the wrapping key nor `K_enc`.
 *
 * ─── Why the context is inside the derivation, not just the AAD ─────────────
 *
 * `K_enc` and `K_commit` are derived over the FULL AAD — version, purpose, user
 * id and (for a content key) profile id. So a `mk/web-password` wrap and a
 * `mk/sync-recovery` wrap of the same MK under the same key material use
 * different encryption keys entirely. Opening one as the other is not a check
 * that could be deleted; it is arithmetic that does not come out. The `purpose`
 * comparison at the top of `unwrapKey` exists only to produce a legible error
 * instead of an opaque one.
 */

import {
  bytesToBase64url,
  base64urlToBytes,
  concatBytes,
  constantTimeEqual,
  encodeStruct,
  utf8,
} from "./bytes.js";
import { SyncCryptoError } from "./errors.js";
import {
  AEAD_KEY_BYTES,
  AEAD_NONCE_BYTES,
  AEAD_TAG_BYTES,
  SHA256_BYTES,
  type CryptoPort,
} from "./port.js";

/** What a wrap is FOR. Part of the AAD and of the key derivation, never decoration. */
export type WrapPurpose =
  /** MK under the desktop's existing local data key (DK). Never leaves the device. */
  | "mk/local-data-key"
  /** MK under K_wrap from the web password. Stored server-side; the server never sees MK. */
  | "mk/web-password"
  /** MK under Argon2id(sync recovery code). The documented way back. */
  | "mk/sync-recovery"
  /** CK_p under MK. Absent for a local-only profile, and that absence is the enforcement. */
  | "ck/master-key";

const MK_PURPOSES: readonly WrapPurpose[] = [
  "mk/local-data-key",
  "mk/web-password",
  "mk/sync-recovery",
];

const ALL_PURPOSES: readonly WrapPurpose[] = [...MK_PURPOSES, "ck/master-key"];

/**
 * Everything the wrap is bound to.
 *
 * A discriminated union rather than one interface with an optional
 * `profileId`, because the two cases genuinely differ: a content-key wrap
 * without a profile id is meaningless, and a master-key wrap with one is a
 * caller who has confused the two layers. Making the illegal combinations
 * unrepresentable is cheaper than validating them.
 */
export type WrapContext =
  | { readonly purpose: "mk/local-data-key" | "mk/web-password" | "mk/sync-recovery"; readonly userId: string }
  | { readonly purpose: "ck/master-key"; readonly userId: string; readonly profileId: string };

/**
 * A wrapped 256-bit key, in the shape that goes into a database column or a
 * server row: plain JSON, every byte field unpadded base64url.
 */
export interface SealedKey {
  /** Format version. A second version coexists with this one; it never reinterprets it. */
  readonly v: 1;
  /** Repeated in the clear only so a wrong-purpose open produces a legible error. */
  readonly purpose: WrapPurpose;
  /** The key-commitment tag, 32 bytes. Public by design — see the file header. */
  readonly commitment: string;
  /** AEAD nonce, 12 bytes, fresh for every wrap. */
  readonly nonce: string;
  /** AEAD output over the 32-byte key, 48 bytes: ciphertext followed by the tag. */
  readonly ciphertext: string;
}

const WRAP_AAD_LABEL = "nexus/sync/wrap/v1";
const ENC_INFO_LABEL = "nexus/sync/wrap/enc/v1";
const COMMIT_INFO_LABEL = "nexus/sync/wrap/commit/v1";

/** The exact byte length of a sealed 32-byte key: plaintext plus the AEAD tag. */
const SEALED_KEY_BYTES = AEAD_KEY_BYTES + AEAD_TAG_BYTES;

/** HKDF over a full-entropy IKM legitimately skips the extract salt (RFC 5869 §3.1). */
const EMPTY_SALT = new Uint8Array(0);

/**
 * The authenticated context, framed so that distinct contexts always produce
 * distinct bytes (see `encodeStruct` on why plain concatenation is not enough
 * when ids are attacker-influenced strings).
 */
function wrapAad(context: WrapContext): Uint8Array {
  const profileId = context.purpose === "ck/master-key" ? context.profileId : "";
  return encodeStruct([
    utf8(WRAP_AAD_LABEL),
    utf8(context.purpose),
    utf8(context.userId),
    utf8(profileId),
  ]);
}

interface WrapSubkeys {
  readonly encKey: Uint8Array;
  readonly commitment: Uint8Array;
}

async function deriveWrapSubkeys(
  port: CryptoPort,
  kek: Uint8Array,
  aad: Uint8Array,
): Promise<WrapSubkeys> {
  const [encKey, commitment] = await Promise.all([
    port.hkdfSha256({
      ikm: kek,
      salt: EMPTY_SALT,
      info: concatBytes(utf8(ENC_INFO_LABEL), aad),
      outputBytes: AEAD_KEY_BYTES,
    }),
    port.hkdfSha256({
      ikm: kek,
      salt: EMPTY_SALT,
      info: concatBytes(utf8(COMMIT_INFO_LABEL), aad),
      outputBytes: SHA256_BYTES,
    }),
  ]);
  return { encKey, commitment };
}

function assertKeyLength(bytes: Uint8Array, what: string): void {
  if (bytes.length !== AEAD_KEY_BYTES) {
    throw new TypeError(`${what} must be ${AEAD_KEY_BYTES} bytes, got ${bytes.length}`);
  }
}

/** 32 random bytes — the master key. Never derived from anything, ever. */
export function generateMasterKey(port: CryptoPort): Uint8Array {
  return port.randomBytes(AEAD_KEY_BYTES);
}

/** 32 random bytes — one profile's content key. */
export function generateContentKey(port: CryptoPort): Uint8Array {
  return port.randomBytes(AEAD_KEY_BYTES);
}

/**
 * Wraps a 256-bit key under `kek`, bound to `context`. A fresh nonce every
 * call, drawn from the port — this function never reuses one, and it is the
 * only place in the package that wraps a key.
 */
export async function wrapKey(
  port: CryptoPort,
  kek: Uint8Array,
  key: Uint8Array,
  context: WrapContext,
): Promise<SealedKey> {
  assertKeyLength(kek, "wrapping key");
  assertKeyLength(key, "wrapped key");

  const aad = wrapAad(context);
  const { encKey, commitment } = await deriveWrapSubkeys(port, kek, aad);
  const nonce = port.randomBytes(AEAD_NONCE_BYTES);
  const ciphertext = await port.aeadSeal({ key: encKey, nonce, plaintext: key, aad });

  return {
    v: 1,
    purpose: context.purpose,
    commitment: bytesToBase64url(commitment),
    nonce: bytesToBase64url(nonce),
    ciphertext: bytesToBase64url(ciphertext),
  };
}

/**
 * Opens a wrap, or throws `SyncCryptoError`. Three distinguishable outcomes,
 * and the distinction is deliberate because each needs a different sentence in
 * the UI:
 *
 *  - `wrap/purpose-mismatch` — a programming error: this record is not the one
 *    the caller thinks it is.
 *  - `wrap/commitment-mismatch` — the ordinary "wrong password / wrong recovery
 *    code / wrong account", and also the answer for a relabelled or
 *    relocated record.
 *  - `wrap/aead-failed` — the key was right and the bytes were edited. Rare,
 *    and it means storage corruption or tampering, not user error.
 *
 * Telling those apart leaks nothing an attacker does not already control: they
 * are distinctions about material the attacker supplied.
 */
export async function unwrapKey(
  port: CryptoPort,
  kek: Uint8Array,
  sealed: SealedKey,
  context: WrapContext,
): Promise<Uint8Array> {
  assertKeyLength(kek, "wrapping key");

  if (sealed.purpose !== context.purpose) {
    throw new SyncCryptoError(
      "wrap/purpose-mismatch",
      `This wrap is a "${sealed.purpose}" wrap; it was opened as "${context.purpose}".`,
    );
  }

  const nonce = base64urlToBytes(sealed.nonce);
  const ciphertext = base64urlToBytes(sealed.ciphertext);
  const storedCommitment = base64urlToBytes(sealed.commitment);
  if (
    nonce === null ||
    nonce.length !== AEAD_NONCE_BYTES ||
    ciphertext === null ||
    ciphertext.length !== SEALED_KEY_BYTES ||
    storedCommitment === null ||
    storedCommitment.length !== SHA256_BYTES
  ) {
    throw new SyncCryptoError("wrap/malformed", "The wrapped key record is not a valid wrap.");
  }

  const aad = wrapAad(context);
  const { encKey, commitment } = await deriveWrapSubkeys(port, kek, aad);

  // The commitment check comes FIRST and is what makes this construction
  // key-committing: a candidate key that fails here never reaches the AEAD, so
  // no crafted ciphertext can open under more than one key.
  if (!constantTimeEqual(commitment, storedCommitment)) {
    throw new SyncCryptoError(
      "wrap/commitment-mismatch",
      "This key does not open this wrap: wrong password, recovery code, account or profile.",
    );
  }

  const plaintext = await port.aeadOpen({ key: encKey, nonce, ciphertext, aad });
  if (plaintext === null) {
    throw new SyncCryptoError(
      "wrap/aead-failed",
      "The wrapped key authenticated its commitment but failed decryption — the record was edited.",
    );
  }
  if (plaintext.length !== AEAD_KEY_BYTES) {
    throw new SyncCryptoError("wrap/malformed", "The wrap did not contain a 256-bit key.");
  }
  return plaintext;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a `SealedKey` that arrived from somewhere untrusted — a server row,
 * an imported file — returning `null` rather than throwing, because a bad
 * record is data, not an exception.
 *
 * Rejects UNKNOWN KEYS as well as bad ones. That is not pedantry: the value is
 * re-serialised and stored, and silently carrying an attacker's extra field
 * through the system is how a server smuggles state into a client's database.
 */
export function parseSealedKey(value: unknown): SealedKey | null {
  if (!isRecord(value)) return null;

  const allowed = new Set(["v", "purpose", "commitment", "nonce", "ciphertext"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
  }

  if (value["v"] !== 1) return null;

  const purpose = value["purpose"];
  if (typeof purpose !== "string" || !ALL_PURPOSES.includes(purpose as WrapPurpose)) return null;

  const commitment = readBase64url(value["commitment"], SHA256_BYTES);
  const nonce = readBase64url(value["nonce"], AEAD_NONCE_BYTES);
  const ciphertext = readBase64url(value["ciphertext"], SEALED_KEY_BYTES);
  if (commitment === null || nonce === null || ciphertext === null) return null;

  return { v: 1, purpose: purpose as WrapPurpose, commitment, nonce, ciphertext };
}

/** `value` if it is a base64url string decoding to exactly `expectedBytes` bytes. */
function readBase64url(value: unknown, expectedBytes: number): string | null {
  if (typeof value !== "string") return null;
  const bytes = base64urlToBytes(value);
  return bytes !== null && bytes.length === expectedBytes ? value : null;
}
