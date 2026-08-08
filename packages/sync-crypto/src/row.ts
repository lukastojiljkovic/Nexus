/**
 * Row encryption. **This is the ONLY place in the whole product that encrypts
 * a synced row.** Not "the recommended helper", not "the shared utility" — the
 * only one. If a second implementation ever appears, delete it; if a caller
 * needs a shape this does not offer, widen this.
 *
 * ─── Why that rule, and what it prevents ────────────────────────────────────
 *
 * AES-GCM is a counter mode with a polynomial MAC, and both halves collapse if
 * a nonce is ever used twice under one key.
 *
 *  - The keystream repeats, so the XOR of the two plaintexts falls straight out
 *    of the XOR of the two ciphertexts. Two versions of the same row differ in
 *    a handful of bytes, so that XOR is very close to a plaintext.
 *  - Far worse, the authentication collapses. Two ciphertexts under one
 *    (key, nonce) pair give a polynomial equation in GHASH's subkey H whose
 *    roots can be enumerated; recovering H lets an attacker forge a valid tag
 *    for ANY message under that key. One repeat does not leak one row — it
 *    ends the integrity of every row that key ever protects.
 *
 * A nonce is safe here for exactly one reason: it is 12 fresh bytes from
 * `CryptoPort.randomBytes` on every single seal, and there is one function
 * that does it. Spread the same logic over four call sites and one of them
 * eventually caches a nonce, or reuses the one it just parsed while
 * re-encrypting, or takes it from the row id "so re-encryption is idempotent".
 * Every one of those is a plausible commit; none of them is survivable.
 *
 * ─── The birthday bound, in numbers ─────────────────────────────────────────
 *
 * Random 96-bit nonces collide by the birthday paradox: over q seals under one
 * key, P(collision) ≈ q² / 2^97.
 *
 *      q = 2^32  (≈ 4.3 × 10^9)   →  P ≈ 2^-33  ≈ 1.2 × 10^-10
 *      q = 2^40  (≈ 1.1 × 10^12)  →  P ≈ 2^-17  ≈ 7.6 × 10^-6
 *      q = 2^48  (≈ 2.8 × 10^14)  →  P ≈ 0.5
 *
 * NIST SP 800-38D §8.3 draws the line at **2^32 invocations per key with
 * random IVs**, which is the 2^-33 row above. That is the number to hold onto:
 * **one content key may seal about 4.3 billion row-versions.** A Nexus profile
 * writes maybe 10^5–10^6 row-versions in its life, so there are roughly four
 * orders of magnitude of headroom, and CK_p is per profile, which divides the
 * count again.
 *
 * The bound stops being comfortable the day a row is sealed by something other
 * than a human editing an object — telemetry, a per-keystroke CRDT update log,
 * an import that rewrites every row on a schedule. **If sealing rate ever
 * becomes machine-driven, this construction must change before it ships**, and
 * the change is one of: XChaCha20-Poly1305, whose 192-bit nonce makes random
 * selection safe past any plausible volume; or a deterministic nonce built from
 * a per-device counter, which removes the birthday bound entirely at the cost
 * of having to guarantee the counter never rewinds across a restore-from-backup
 * (a guarantee an offline-first product cannot actually make, which is why the
 * 192-bit nonce is the likely answer). Both are a change to `CryptoPort` and to
 * this file, and to nothing else.
 *
 * ─── The AAD ────────────────────────────────────────────────────────────────
 *
 *   "nexus/sync/row/v1" ‖ user_id ‖ profile_id ‖ collection ‖ object_id
 *                       ‖ version ‖ deleted
 *
 * each field length-framed (see `bytes.ts`'s `encodeStruct` for why plain
 * concatenation is a vulnerability and not a style choice). The server stores
 * every one of those fields in the clear and is assumed hostile, so each is
 * something it might try to change:
 *
 *  - `user_id` — hand Ana's ciphertext to Marko's client.
 *  - `profile_id` — move a row out of a local-only profile into a synced one.
 *  - `collection` — serve a note as a task, landing attacker-shaped data in a
 *    parser that never expected it.
 *  - `object_id` — swap two rows so an edit lands on the wrong object.
 *  - `version` — roll a row back to a version whose contents the user deleted.
 *  - `deleted` — strip a tombstone and resurrect deleted data.
 *  - `parent_id` — reparent a row: move a transaction under another account, or
 *    slide a live object beneath a tombstone so the cascade reaps it. This one
 *    was missing from this list and from the AAD while every other clear column
 *    was bound, which is exactly the shape a hostile operator looks for.
 *
 * Binding them into the AAD does not stop the server DOING any of that; it
 * guarantees the client notices, because `openRow` rebuilds the AAD from the
 * metadata the server just claimed and the tag check fails when the claim and
 * the ciphertext disagree.
 */

import { base64urlToBytes, booleanByte, bytesToBase64url, encodeStruct, fromUtf8, uint64BE, utf8 } from "./bytes.js";
import { SyncCryptoError } from "./errors.js";
import { canonicalJson, isJsonObject, parseJsonValue, type JsonObject } from "./json.js";
import { AEAD_KEY_BYTES, AEAD_NONCE_BYTES, AEAD_TAG_BYTES, type CryptoPort } from "./port.js";

/**
 * Everything a row is bound to. Every field is server-visible metadata; that
 * is precisely why every field is authenticated.
 */
export interface RowIdentity {
  readonly userId: string;
  readonly profileId: string;
  readonly collection: string;
  readonly objectId: string;
  /** Monotonic per object. Also the optimistic-concurrency token the server checks. */
  readonly version: number;
  /** A tombstone is a row like any other; the flag is authenticated, never inferred. */
  readonly deleted: boolean;
  /**
   * The owning object, or `null` for a root. Authenticated for the same reason
   * every other clear column is, and it was the ONE that was not.
   *
   * `sync_objects.parent_id` is a clear, server-writable column, and this AAD
   * bound `version` and `deleted` while leaving it out. That asymmetry is the
   * whole finding: an untrusted operator rewrites `parent_id` with a single
   * UPDATE, the AEAD tag is untouched because it never covered that byte, and
   * every client on earth accepts the new parent as fact. Silent, key-free
   * reparenting — move a transaction under a different account, or slide a live
   * row beneath a tombstone and let the cascade reap it.
   *
   * `null` and the empty string are DIFFERENT values here and the encoding keeps
   * them apart (see `rowAad`): „this is a root" and „this hangs off an object
   * whose id is empty" must not produce the same tag, or the server can turn one
   * into the other for free.
   *
   * The column stays in the schema because the server needs it to answer
   * queries, but no client tree-walk or GC pass may trust it: the authoritative
   * parent travels INSIDE the ciphertext, and the column is a hint that has to
   * agree with it.
   */
  readonly parentId: string | null;
}

/** A sealed row, JSON-shaped for a database column or a request body. */
export interface SealedRow {
  readonly v: 1;
  /** 12 bytes, fresh for every seal. */
  readonly nonce: string;
  /** AEAD output: ciphertext followed by the 16-byte tag. */
  readonly ciphertext: string;
}

const ROW_AAD_LABEL = "nexus/sync/row/v1";

function assertIdentity(identity: RowIdentity): void {
  for (const [name, value] of [
    ["userId", identity.userId],
    ["profileId", identity.profileId],
    ["collection", identity.collection],
    ["objectId", identity.objectId],
  ] as const) {
    if (value.length === 0) {
      // An empty identifier cannot bind anything, and an AAD that binds
      // nothing is an AAD that lets the server move the row freely.
      throw new TypeError(`RowIdentity.${name} must not be empty.`);
    }
  }
  if (!Number.isSafeInteger(identity.version) || identity.version < 0) {
    throw new TypeError(
      `RowIdentity.version must be a non-negative safe integer, got: ${String(identity.version)}`,
    );
  }
  // `null` says „root"; `""` says nothing at all. The AAD encoding keeps them
  // apart, but an empty parent id is a caller bug either way and it is cheaper
  // to refuse it than to store rows whose parent is unnameable.
  if (identity.parentId !== null && identity.parentId.length === 0) {
    throw new TypeError("RowIdentity.parentId must be a non-empty string or null.");
  }
}

/**
 * `parent_id` is nullable, and a null must not encode as an empty string.
 *
 * `encodeStruct` length-frames each field, so an empty string is a legal,
 * distinguishable field — but only from a field with content, not from
 * „absent". Without the presence byte, `parentId: null` and `parentId: ""`
 * would produce identical AADs, and the server could flip a root object into a
 * child of the empty id (or the reverse) with the tag still verifying. One
 * byte, and the two states stay two states.
 */
function parentField(parentId: string | null): Uint8Array {
  return parentId === null
    ? encodeStruct([booleanByte(false)])
    : encodeStruct([booleanByte(true), utf8(parentId)]);
}

function rowAad(identity: RowIdentity): Uint8Array {
  return encodeStruct([
    utf8(ROW_AAD_LABEL),
    utf8(identity.userId),
    utf8(identity.profileId),
    utf8(identity.collection),
    utf8(identity.objectId),
    uint64BE(identity.version),
    booleanByte(identity.deleted),
    parentField(identity.parentId),
  ]);
}

function assertContentKey(contentKey: Uint8Array): void {
  if (contentKey.length !== AEAD_KEY_BYTES) {
    throw new TypeError(`Content key must be ${AEAD_KEY_BYTES} bytes, got ${contentKey.length}`);
  }
}

/** Seals `plaintext` for exactly this row identity, under this profile's content key. */
export async function sealRow(
  port: CryptoPort,
  contentKey: Uint8Array,
  identity: RowIdentity,
  plaintext: Uint8Array,
): Promise<SealedRow> {
  assertContentKey(contentKey);
  assertIdentity(identity);

  const nonce = port.randomBytes(AEAD_NONCE_BYTES);
  const ciphertext = await port.aeadSeal({
    key: contentKey,
    nonce,
    plaintext,
    aad: rowAad(identity),
  });
  return { v: 1, nonce: bytesToBase64url(nonce), ciphertext: bytesToBase64url(ciphertext) };
}

/**
 * Opens a sealed row, or throws `SyncCryptoError`.
 *
 * `identity` must be the metadata the SERVER supplied for this row, not what
 * the caller wishes it were — rebuilding the AAD from the server's own claim
 * is what turns a relocation into a visible failure instead of a silent
 * success. A `row/aead-failed` here means one of: the wrong content key (this
 * profile's key does not open this row), edited bytes, or a server that moved
 * the ciphertext. AES-GCM cannot tell those apart and this does not pretend to.
 */
export async function openRow(
  port: CryptoPort,
  contentKey: Uint8Array,
  identity: RowIdentity,
  sealed: SealedRow,
): Promise<Uint8Array> {
  assertContentKey(contentKey);
  assertIdentity(identity);

  const nonce = base64urlToBytes(sealed.nonce);
  const ciphertext = base64urlToBytes(sealed.ciphertext);
  if (
    nonce === null ||
    nonce.length !== AEAD_NONCE_BYTES ||
    ciphertext === null ||
    ciphertext.length < AEAD_TAG_BYTES
  ) {
    throw new SyncCryptoError("row/malformed", "The sealed row is not a valid sealed row.");
  }

  const plaintext = await port.aeadOpen({
    key: contentKey,
    nonce,
    ciphertext,
    aad: rowAad(identity),
  });
  if (plaintext === null) {
    throw new SyncCryptoError(
      "row/aead-failed",
      "The row did not authenticate: wrong content key, edited bytes, or metadata that does " +
        "not match the ciphertext.",
    );
  }
  return plaintext;
}

/**
 * The field-map form, and the one every module store should use.
 *
 * Canonical JSON rather than `JSON.stringify` so two devices holding the same
 * state produce the same plaintext — see `json.ts`. Offering this here, rather
 * than letting each caller serialise, is the other half of the "one place
 * encrypts a row" rule: one encoding as well as one nonce policy.
 */
export async function sealRowFields(
  port: CryptoPort,
  contentKey: Uint8Array,
  identity: RowIdentity,
  fields: JsonObject,
): Promise<SealedRow> {
  return sealRow(port, contentKey, identity, utf8(canonicalJson(fields)));
}

/** The inverse. Throws `row/bad-plaintext` if what came out is not a JSON object. */
export async function openRowFields(
  port: CryptoPort,
  contentKey: Uint8Array,
  identity: RowIdentity,
  sealed: SealedRow,
): Promise<JsonObject> {
  const plaintext = await openRow(port, contentKey, identity, sealed);

  let text: string;
  try {
    text = fromUtf8(plaintext);
  } catch (error) {
    throw new SyncCryptoError("row/bad-plaintext", "The row's plaintext is not valid UTF-8.", {
      cause: error,
    });
  }

  const parsed = parseJsonValue(text);
  if (parsed === null || !isJsonObject(parsed)) {
    throw new SyncCryptoError(
      "row/bad-plaintext",
      "The row's plaintext is not a JSON object (or carries a prototype-poisoning key).",
    );
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates a `SealedRow` from an untrusted source, rejecting unknown keys as
 * well as bad ones — the same reasoning as `parseSealedKey`: a field the client
 * does not understand but stores anyway is a channel the server controls.
 */
export function parseSealedRow(value: unknown): SealedRow | null {
  if (!isRecord(value)) return null;

  const allowed = new Set(["v", "nonce", "ciphertext"]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
  }
  if (value["v"] !== 1) return null;

  const nonce = value["nonce"];
  const ciphertext = value["ciphertext"];
  if (typeof nonce !== "string" || typeof ciphertext !== "string") return null;

  const nonceBytes = base64urlToBytes(nonce);
  const ciphertextBytes = base64urlToBytes(ciphertext);
  if (nonceBytes === null || nonceBytes.length !== AEAD_NONCE_BYTES) return null;
  if (ciphertextBytes === null || ciphertextBytes.length < AEAD_TAG_BYTES) return null;

  return { v: 1, nonce, ciphertext };
}
