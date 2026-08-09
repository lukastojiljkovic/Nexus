/**
 * A swept `RowState` becomes a row the server will accept — or it is refused
 * here, where the reason can still be named.
 *
 * ─── The version arithmetic, which is the whole of the contract ─────────────
 *
 * `RowState.version` is what this device last saw the SERVER hold for the
 * object: `0` for one it has never pushed, the accepted version after a push,
 * `max(local, remote)` after a merge. A push is submitted at `version + 1` —
 * migration 003's NX001 is a compare-and-swap, not a „strictly greater", and its
 * hint says so in as many words: „Re-read the row, merge, and write
 * observed_version + 1." A never-pushed object therefore submits `0 + 1`, which
 * is exactly what NX002 demands of a creation; the two rules meet at 1 and this
 * file needs no separate case for it.
 *
 * The server does NOT increment. It cannot: the version is inside the AEAD
 * associated data, so a number the server chose would not be a number the
 * ciphertext authenticates. That is the reason the counter is the client's to
 * advance and the reason a lost race (`NX001`) is not retried but re-merged.
 *
 * One consequence the engine owns rather than this file: a push the server
 * ACCEPTED but whose response was lost comes back as NX001 on retry, because the
 * version it carries is now the stored one. That is a duplicate, not a race, and
 * the engine tells them apart by re-reading — a server row byte-identical to
 * what was sent is a success that already happened.
 *
 * ─── Every push is a fresh seal, at the CURRENT content-key epoch ───────────
 *
 * There is no re-use of a previously sealed ciphertext anywhere in this file,
 * and there cannot be: `sealRow` draws 24 fresh bytes on every call, the version
 * it binds has just changed, and migration 003's NX005 rejects a write whose
 * nonce equals the one before it. Sealing at the current epoch rather than the
 * one the row was stored under is what makes a content-key rotation an ordinary
 * push: raise the epoch, mark every object dirty, and the rewrite happens on the
 * path that already exists. NX006 accepts it because an epoch only rises — and
 * NX007 requires that generation's `ck_under_mk` wrap to be STORED FIRST, so the
 * caller passing `ckEpoch` owes that ordering, not this function.
 *
 * ─── Both collection shapes take this path, and that is not an oversight ────
 *
 * `note_updates` is `shape: "updates"` — an append-only log of encrypted CRDT
 * updates, because concurrent edits to a long text are the one case where
 * last-write-wins loses a paragraph. It still pushes as a field map, because a
 * log ENTRY is written once and never edited: its `RowState` is created, sealed
 * and never touched again, so a field-level merge over it is a union of two
 * identical states. The shape distinction decides how a note's TEXT is
 * reconstructed (in `seq` order, by Yjs) and it has nothing to say about how one
 * immutable row reaches the server.
 */

import {
  encodeRowState,
  sealRowFields,
  utf8,
  type CryptoPort,
  type RowIdentity,
  type RowState,
} from "@nexus/sync-crypto/web";

import {
  COLLECTION_PATTERN,
  MAX_OBJECT_ID_BYTES,
  MAX_PARENT_ID_BYTES,
  MAX_VERSION,
  type PushRow,
} from "./wire.js";

/** Who is pushing, and into which profile. Both are bound into every AAD. */
export interface SyncScope {
  readonly userId: string;
  readonly profileId: string;
}

/** One object the sweeper decided is worth sending. */
export interface PushCandidate {
  readonly collection: string;
  readonly objectId: string;
  /**
   * The owning object's id, or `null` for a root. A hint for the server's
   * „give me this note's blocks" query — the authoritative parent travels inside
   * the ciphertext, and `row.ts` binds this into the AAD so the hint cannot
   * disagree with it silently.
   */
  readonly parentId: string | null;
  /** What this device holds. Its `version` is the OBSERVED one; this file adds the step. */
  readonly state: RowState;
}

/** Why one candidate could not be turned into a row. */
export type PushRefusalReason =
  /** The collection name is not one the server's CHECK would accept. */
  | "collection-shape"
  /** The object id is longer than 255 bytes, which is an identifier used as a payload. */
  | "object-id-too-long"
  /** The parent id is empty or longer than 255 bytes. */
  | "parent-id-shape"
  /** The observed version is not a non-negative safe integer, or the step would overflow. */
  | "version-range";

export interface PushRefusal {
  readonly ok: false;
  readonly collection: string;
  readonly objectId: string;
  readonly reason: PushRefusalReason;
}

export interface PushAccepted {
  readonly ok: true;
  readonly row: PushRow;
  /**
   * The state to store locally IF the server accepts — the same fields and
   * tombstone, stamped with the version that was submitted.
   *
   * Returned rather than recomputed by the caller because the two must agree
   * exactly: a local copy left at the observed version would push the same
   * number twice and be refused with `NX001` forever, and one advanced past the
   * accepted version would skip a number the server never saw.
   */
  readonly next: RowState;
}

export type PushOutcome = PushAccepted | PushRefusal;

/** BYTES, because the server's CHECKs are `octet_length` — see `wire.ts`'s header. */
const utf8Length = (value: string): number => utf8(value).length;

/**
 * Seals every candidate, in order, refusing the ones the server would refuse.
 *
 * **A refusal is returned, never thrown.** A push batch is dozens of objects
 * swept out of a dirty set, and one malformed id must not cost the other
 * thirty-nine their round trip — nor should it be silently dropped, which is
 * what a `filter` would do. The caller pushes the accepted rows and has the
 * refused ones, by name and reason, to quarantine and surface.
 */
export async function planPush(
  port: CryptoPort,
  scope: SyncScope,
  contentKey: Uint8Array,
  ckEpoch: number,
  candidates: readonly PushCandidate[],
): Promise<readonly PushOutcome[]> {
  const outcomes: PushOutcome[] = [];
  for (const candidate of candidates) {
    outcomes.push(await planOne(port, scope, contentKey, ckEpoch, candidate));
  }
  return outcomes;
}

async function planOne(
  port: CryptoPort,
  scope: SyncScope,
  contentKey: Uint8Array,
  ckEpoch: number,
  candidate: PushCandidate,
): Promise<PushOutcome> {
  const { collection, objectId, parentId, state } = candidate;
  const refuse = (reason: PushRefusalReason): PushRefusal => ({
    ok: false,
    collection,
    objectId,
    reason,
  });

  if (!COLLECTION_PATTERN.test(collection)) return refuse("collection-shape");
  if (utf8Length(objectId) > MAX_OBJECT_ID_BYTES) return refuse("object-id-too-long");
  if (parentId !== null) {
    const length = utf8Length(parentId);
    if (length < 1 || length > MAX_PARENT_ID_BYTES) return refuse("parent-id-shape");
  }
  if (!Number.isSafeInteger(state.version) || state.version < 0) return refuse("version-range");
  const version = state.version + 1;
  if (version > MAX_VERSION) return refuse("version-range");

  const identity: RowIdentity = {
    userId: scope.userId,
    profileId: scope.profileId,
    collection,
    objectId,
    version,
    deleted: state.deleted.value,
    parentId,
    ckEpoch,
  };

  // THE PLAINTEXT IS `encodeRowState`, not `rowFields` — the STAMPED form,
  // clocks and all. That is the reason field-level merge is safe against the
  // party holding the database: a server that could read or rewrite the HLCs
  // would decide every conflict on the account, so they travel inside the
  // ciphertext. `sealRowFields` is the right call because that encoded form IS a
  // JSON object, and it canonicalises — two devices holding the same state
  // produce the same bytes, which is what makes an idempotent redelivery cheap
  // to recognise.
  const sealed = await sealRowFields(port, contentKey, identity, encodeRowState(state));

  return {
    ok: true,
    row: {
      collection,
      objectId,
      parentId,
      version,
      deleted: identity.deleted,
      ckEpoch,
      sealed,
    },
    next: { ...state, version },
  };
}
