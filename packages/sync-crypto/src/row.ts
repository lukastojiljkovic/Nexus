/**
 * Row encryption. **This is the ONLY place in the whole product that encrypts
 * a synced row.** Not "the recommended helper", not "the shared utility" — the
 * only one. If a second implementation ever appears, delete it; if a caller
 * needs a shape this does not offer, widen this.
 *
 * ─── Why that rule, and what it prevents ────────────────────────────────────
 *
 * XChaCha20-Poly1305 is a stream cipher with a one-time MAC, and both halves
 * collapse if a nonce is ever used twice under one key.
 *
 *  - The keystream repeats, so the XOR of the two plaintexts falls straight out
 *    of the XOR of the two ciphertexts. Two versions of the same row differ in
 *    a handful of bytes, so that XOR is very close to a plaintext.
 *  - Far worse, the authentication collapses. Poly1305's one-time key `(r, s)`
 *    is derived from the key and the nonce alone, so two messages authenticated
 *    under one pair give two linear equations in `r` and `s` — recover them and
 *    an attacker forges a valid tag for ANY message under that pair. One repeat
 *    does not leak one row; it ends the integrity of everything sealed at that
 *    nonce.
 *
 * A nonce is safe here for exactly one reason: it is 24 fresh bytes from
 * `CryptoPort.randomBytes` on every single seal, and there is one function
 * that does it. Spread the same logic over four call sites and one of them
 * eventually caches a nonce, or reuses the one it just parsed while
 * re-encrypting, or takes it from the row id "so re-encryption is idempotent".
 * Every one of those is a plausible commit; none of them is survivable.
 *
 * ─── Why 192 bits and not 96 ────────────────────────────────────────────────
 *
 * `port.ts`'s {@link AEAD_NONCE_BYTES} carries the argument in full. In one
 * line: with a 96-bit random nonce the safe seal budget is a per-KEY number
 * that no single device can observe, because a content key is shared by every
 * device the user owns — and the only remedy for approaching it is re-encrypting
 * the entire profile. 192 bits removes the question rather than bounding it.
 *
 * ─── The AAD ────────────────────────────────────────────────────────────────
 *
 *   "nexus/sync/row/v2" ‖ user_id ‖ profile_id ‖ collection ‖ object_id
 *                       ‖ version ‖ deleted ‖ parent_id ‖ ck_epoch
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
 *  - `ck_epoch` — serve a row sealed under the retired content key as though it
 *    were current. See below; this is the one that also buys something the
 *    others do not.
 *
 * Binding them into the AAD does not stop the server DOING any of that; it
 * guarantees the client notices, because `openRow` rebuilds the AAD from the
 * metadata the server just claimed and the tag check fails when the claim and
 * the ciphertext disagree.
 *
 * ─── Why `ck_epoch` is in there, and why there is no per-row commitment ─────
 *
 * XChaCha20-Poly1305 is not key-committing, exactly as AES-GCM is not: a tag
 * proves „someone holding *a* key produced this", not „the key you just tried
 * is the one that produced this". `wrap.ts` therefore carries an explicit
 * 32-byte commitment, because the keys it protects are derived from a PASSWORD
 * and a low-entropy secret is what a partitioning oracle partitions.
 *
 * A row is different: a content key is 256 random bits, so there is no candidate
 * set to search. What a row needed instead was a guarantee that a client never
 * has to TRY more than one key — and that guarantee did not hold. Rotating a
 * content key is this product's only real revocation (a browser that already has
 * CK_p keeps it), and a rotation re-encrypts a profile row by row, so during one
 * both keys are live. Without an epoch, a client meeting a row would trial CK_old
 * and then CK_new, and a half-finished rotation would be invisible.
 *
 * With `ck_epoch` in the clear AND in the AAD, the row names its own key: one
 * attempt, always; a row re-wrapped but not re-encrypted fails loudly rather
 * than quietly; and „what is left to rotate" is a WHERE clause. That is strictly
 * more than a 16-byte commitment tag would have bought, and it costs no
 * ciphertext at all.
 *
 * ─── What this does NOT protect, stated so nobody assumes it does ───────────
 *
 * Every row is authenticated; the SET of rows is not. A hostile server can drop
 * the tail of an append-only collection, withhold a collection entirely, or
 * serve one device a view that omits another device's writes, and every AAD
 * check here still passes — the rows it does serve are genuine. Detecting that
 * needs a signed, monotonic manifest over `(object_id, version, ck_epoch)` per
 * profile and collection, which is a new table and not a change to this file.
 * `ck_epoch` is in the AAD partly so that manifest can be added later without
 * breaking the wire format a second time.
 */

import {
  base64urlToBytes,
  booleanByte,
  bytesToBase64url,
  encodeStruct,
  fromUtf8,
  uint64BE,
  utf8,
} from "./bytes.js";
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
  /** The optimistic-concurrency token: exactly one more than the stored version, per object. */
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
  /**
   * Which generation of this profile's content key sealed the row. Starts at 1
   * and only ever rises; see the file header on why it is authenticated.
   */
  readonly ckEpoch: number;
}

/**
 * A sealed row, JSON-shaped for a database column or a request body.
 *
 * **`v: 2`, and there is deliberately no reader for `v: 1`.** Version 1 was
 * AES-256-GCM with a 12-byte nonce and an AAD that bound neither `parent_id` nor
 * `ck_epoch`. Nothing has ever synced, so no v1 ciphertext exists anywhere in
 * the world — and a package that could read both would carry a version-dependent
 * nonce length, a version-dependent label and a branch nobody exercises, which
 * is the branch that rots. {@link parseSealedRow} rejects anything that is not 2.
 */
export interface SealedRow {
  readonly v: 2;
  /** 24 bytes, fresh for every seal. */
  readonly nonce: string;
  /** AEAD output: ciphertext followed by the 16-byte tag. */
  readonly ciphertext: string;
}

const ROW_AAD_LABEL = "nexus/sync/row/v2";

function assertIdentity(identity: RowIdentity): void {
  // `objectId` IS NOT IN THIS LIST, and that is a decision rather than an
  // oversight. It was, and it would have rejected six collections outright: the
  // per-profile singletons (`calendar_settings`, `ntf_settings`, …) whose
  // primary key is the profile alone, so their object id is the empty string —
  // the honest spelling of „this collection holds exactly one object per
  // profile". The rule the old check was reaching for („an empty identifier
  // cannot bind anything") is not true here, because `encodeStruct` LENGTH-FRAMES
  // every field: an empty `objectId` inside collection `calendar_settings` of
  // profile P produces a different AAD from every other row in the account, and
  // no two distinct objects can share the four values. The other three stay
  // required — an empty user, profile or collection really would bind nothing.
  for (const [name, value] of [
    ["userId", identity.userId],
    ["profileId", identity.profileId],
    ["collection", identity.collection],
  ] as const) {
    if (value.length === 0) {
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
  if (!Number.isSafeInteger(identity.ckEpoch) || identity.ckEpoch < 1) {
    throw new TypeError(
      `RowIdentity.ckEpoch must be an integer >= 1, got: ${String(identity.ckEpoch)}`,
    );
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
    uint64BE(identity.ckEpoch),
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
  // AN EMPTY PLAINTEXT IS REFUSED, and the reason is on the server. Sealing zero
  // bytes yields exactly the 16-byte tag, and `sync_objects_ciphertext_len`
  // floors the column at 17 — one byte of plaintext plus the tag — so such a row
  // would be built, encrypted, sent, and rejected by a CHECK constraint whose
  // message says nothing a client could act on. Refusing it here turns a
  // confusing round trip into a caller bug named at the point it was made. It is
  // also not a shape this product has: a row always seals a field map, and the
  // smallest of those is `{}`.
  if (plaintext.length === 0) {
    throw new TypeError("Refusing to seal an empty row plaintext — see sealRow.");
  }

  const nonce = port.randomBytes(AEAD_NONCE_BYTES);
  const ciphertext = await port.aeadSeal({
    key: contentKey,
    nonce,
    plaintext,
    aad: rowAad(identity),
  });
  return { v: 2, nonce: bytesToBase64url(nonce), ciphertext: bytesToBase64url(ciphertext) };
}

/**
 * Opens a sealed row, or throws `SyncCryptoError`.
 *
 * `identity` must be the metadata the SERVER supplied for this row, not what
 * the caller wishes it were — rebuilding the AAD from the server's own claim
 * is what turns a relocation into a visible failure instead of a silent
 * success. A `row/aead-failed` here means one of: the wrong content key (this
 * profile's key does not open this row), edited bytes, or a server that moved
 * the ciphertext. The AEAD cannot tell those apart and this does not pretend to.
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
  if (value["v"] !== 2) return null;

  const nonce = value["nonce"];
  const ciphertext = value["ciphertext"];
  if (typeof nonce !== "string" || typeof ciphertext !== "string") return null;

  const nonceBytes = base64urlToBytes(nonce);
  const ciphertextBytes = base64urlToBytes(ciphertext);
  if (nonceBytes === null || nonceBytes.length !== AEAD_NONCE_BYTES) return null;
  if (ciphertextBytes === null || ciphertextBytes.length < AEAD_TAG_BYTES) return null;

  return { v: 2, nonce, ciphertext };
}
