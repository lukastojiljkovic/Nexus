/**
 * The row as it crosses the wire, and the parser that treats it as hostile.
 *
 * `sync_objects` has eleven columns and the client may write nine of them. This
 * file is the one place that says which nine, in what shapes, and what a client
 * does when the server hands back something that is not a row.
 *
 * ─── There is no format-version COLUMN, and that is deliberate ──────────────
 *
 * `@nexus/sync-crypto`'s {@link SealedRow} carries `v: 2`, which exists so a
 * parser can refuse a downgrade to the AES-256-GCM/12-byte format this product
 * used before it shipped anything. `sync_objects` has nowhere to put that field
 * and does not need one: the version is carried STRUCTURALLY, twice over.
 *
 *  - The server's `sync_objects_nonce_len` CHECK pins the nonce at 24 bytes, so
 *    a v1 row cannot be stored at all.
 *  - The AAD label `nexus/sync/row/v2` is compiled into `row.ts` and fed to the
 *    tag. A v1 ciphertext therefore does not authenticate under v2 rules, and
 *    could not be talked into doing so by anything the server says.
 *
 * A column would have been strictly worse. It would be a value the SERVER sets
 * and the client must then ignore — because the label the client uses comes from
 * its own source, never from the row — and a field that looks authoritative and
 * is not is the kind of thing a later reader wires up by mistake.
 *
 * ─── Why the limits are restated here ───────────────────────────────────────
 *
 * Every bound below already exists as a CHECK constraint on the server. Copying
 * them is not redundancy: a client that discovers a 300-byte object id by
 * receiving `23514` from PostgREST has already spent a round trip, cannot say
 * which of its rows was at fault when it batched them, and — worse — learns
 * nothing at all on the PULL side, where the constraints do not run. A row the
 * server serves is input, and the fact that the server's own CHECKs would have
 * refused to store it is a statement about a database this client does not
 * control.
 */

import { utf8, type SealedRow } from "@nexus/sync-crypto/web";

/** `sync_objects_collection_shape`: a lowercase identifier, at most 64 characters. */
export const COLLECTION_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * `sync_objects_object_id_len`: at most 255 BYTES, with no floor — the six
 * per-profile singletons identify their one object by the empty string.
 */
export const MAX_OBJECT_ID_BYTES = 255;

/** `sync_objects_parent_id_len`: 1..255 bytes when present. A parent named by nothing is not a parent. */
export const MAX_PARENT_ID_BYTES = 255;

/** `sync_objects_ciphertext_len`: one byte of plaintext plus the 16-byte tag, up to 4 MiB. */
export const MIN_CIPHERTEXT_BYTES = 17;
export const MAX_CIPHERTEXT_BYTES = 4 * 1024 * 1024;

/** `sync_objects_nonce_len`. Restated rather than imported so this file lists the whole row. */
export const NONCE_BYTES = 24;

/**
 * `sync_objects_version_range`, which is `Number.MAX_SAFE_INTEGER` written out
 * in SQL.
 *
 * There is no companion step bound, and there used to be. Migration 003 now
 * pins every update to `old.version + 1` (NX001) and every creation to exactly
 * 1 (NX002), so the version space cannot be jumped by any amount at all — a
 * „steps of at most 65 536" rule would be an argument about how much of an
 * unrepresentable attack to permit.
 */
export const MAX_VERSION = Number.MAX_SAFE_INTEGER;

/**
 * What a client submits for one object.
 *
 * The names are the client's, not the column names: this is the shape
 * `@nexus/sync` produces, and mapping it onto PostgREST's JSON — including how
 * `bytea` is spelled — is the transport's business and nobody else's.
 */
export interface PushRow {
  readonly collection: string;
  readonly objectId: string;
  /** A query hint for the server, never the authority: the real parent is inside the ciphertext. */
  readonly parentId: string | null;
  /** The version this row will be STORED at — the observed version plus one. */
  readonly version: number;
  readonly deleted: boolean;
  readonly ckEpoch: number;
  /** The AEAD output, base64url. `v` is not sent; see the file header. */
  readonly sealed: SealedRow;
}

/** What a client receives. Identical to {@link PushRow} plus the server's own cursor. */
export interface PulledRow {
  readonly collection: string;
  readonly objectId: string;
  readonly parentId: string | null;
  readonly version: number;
  readonly deleted: boolean;
  readonly ckEpoch: number;
  /** The server's log position. Re-stamped on every update, which is what makes it a cursor. */
  readonly seq: number;
  readonly nonce: string;
  readonly ciphertext: string;
}

const utf8Length = (value: string): number => utf8(value).length;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A base64url string of exactly / at least the given decoded byte length. */
function base64urlBytes(value: unknown): number | null {
  if (typeof value !== "string") return null;
  if (!/^[A-Za-z0-9_-]*$/.test(value)) return null;
  // Unpadded base64url: 4 characters per 3 bytes, and a remainder of 1 is
  // impossible. Counting rather than decoding keeps a 4 MiB payload from being
  // materialised twice just to learn its length.
  const remainder = value.length % 4;
  if (remainder === 1) return null;
  return Math.floor((value.length * 3) / 4);
}

function isPositiveSafeInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= max;
}

/**
 * One row from the server, or `null`.
 *
 * **Unknown keys are rejected**, the same rule `parseSealedRow` and
 * `parseSealedKey` follow: a field this client does not understand but stores
 * and re-emits anyway is a channel the server controls. Here it would also be a
 * column the server invented, which is a stronger signal still.
 *
 * The AEAD is not touched. Everything below is a statement about the SHAPE, and
 * a row that fails it never reaches a key — which matters, because reaching a
 * key is what costs a decryption and produces an indistinguishable failure.
 */
export function parsePulledRow(value: unknown): PulledRow | null {
  if (!isRecord(value)) return null;

  const allowed = new Set([
    "collection",
    "objectId",
    "parentId",
    "version",
    "deleted",
    "ckEpoch",
    "seq",
    "nonce",
    "ciphertext",
  ]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) return null;
  }

  const collection = value["collection"];
  if (typeof collection !== "string" || !COLLECTION_PATTERN.test(collection)) return null;

  const objectId = value["objectId"];
  if (typeof objectId !== "string" || utf8Length(objectId) > MAX_OBJECT_ID_BYTES) return null;

  const parentId = value["parentId"];
  if (parentId !== null && parentId !== undefined) {
    if (typeof parentId !== "string") return null;
    const length = utf8Length(parentId);
    if (length < 1 || length > MAX_PARENT_ID_BYTES) return null;
  }

  const version = value["version"];
  if (!isPositiveSafeInteger(version, MAX_VERSION)) return null;

  const deleted = value["deleted"];
  if (typeof deleted !== "boolean") return null;

  const ckEpoch = value["ckEpoch"];
  // `sync_objects_ck_epoch_range` is `>= 1` on a smallint, so 32 767 is the
  // column's own ceiling. Naming it here rather than `MAX_VERSION` is what makes
  // an epoch that could never have been stored a shape error rather than a key
  // lookup that fails for a reason nobody can explain.
  if (!isPositiveSafeInteger(ckEpoch, 32767)) return null;

  const seq = value["seq"];
  if (!isPositiveSafeInteger(seq, MAX_VERSION)) return null;

  const nonceBytes = base64urlBytes(value["nonce"]);
  if (nonceBytes !== NONCE_BYTES) return null;

  const ciphertextBytes = base64urlBytes(value["ciphertext"]);
  if (
    ciphertextBytes === null ||
    ciphertextBytes < MIN_CIPHERTEXT_BYTES ||
    ciphertextBytes > MAX_CIPHERTEXT_BYTES
  ) {
    return null;
  }

  return {
    collection,
    objectId,
    parentId: typeof parentId === "string" ? parentId : null,
    version,
    deleted,
    ckEpoch,
    seq,
    nonce: value["nonce"] as string,
    ciphertext: value["ciphertext"] as string,
  };
}
