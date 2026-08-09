/**
 * Column names on one side, the client's names on the other, and nothing else
 * allowed through in either direction.
 *
 * `wire.ts` deliberately names its fields `objectId` and `ckEpoch` rather than
 * `object_id` and `ck_epoch`: those are the shapes `@nexus/sync` produces and
 * consumes, and the fact that a Postgres column is spelled differently is not
 * something the merge layer should ever have to know. This file is the whole of
 * that knowledge.
 *
 * ─── The select list is explicit, and that is load-bearing ──────────────────
 *
 * `sync_objects` has thirteen columns and {@link PulledRow} has nine. Asking for
 * `*` would bring back `user_id`, `created_at` and `updated_at` as well, and
 * `parsePulledRow` REJECTS UNKNOWN KEYS — so every pull would fail as malformed.
 * Naming the nine also means a column added to the server tomorrow does not
 * quietly start arriving in this client's parser.
 *
 * ─── What is NOT sent, and why the absence is checked ───────────────────────
 *
 * `SealedRow` carries `v: 2`. It is not a column and must not become one:
 * `wire.ts`'s header sets out why the format version is carried structurally
 * (by the 24-byte nonce CHECK and by the AAD label compiled into `row.ts`)
 * rather than as a field the server states and the client must then ignore. So
 * the mapping drops it, and `rows.test.ts` asserts the drop — because „the
 * transport forgot a field" and „the transport correctly omitted a field" look
 * identical from inside this file.
 */

import { parsePulledRow, type PulledRow, type PushRow, type SyncScope } from "@nexus/sync";

import { base64urlToBytea, byteaToBase64url } from "./bytea.js";

/**
 * The nine columns a pull asks for, in the order `PulledRow` declares them.
 *
 * `user_id` and `profile_id` are absent because they are the request's own
 * filter — a row that came back through a `user_id=eq.…&profile_id=eq.…` query
 * cannot be from another tenant, and re-reading them would only invite a client
 * to trust the echo instead of the filter. The AAD binds both anyway, out of
 * {@link SyncScope}, which is the client's own belief and not the server's.
 */
export const PULL_COLUMNS = [
  "collection",
  "object_id",
  "parent_id",
  "version",
  "deleted",
  "ck_epoch",
  "seq",
  "nonce",
  "ciphertext",
] as const;

/** The same list as PostgREST wants it: comma-separated, no spaces. */
export const PULL_SELECT = PULL_COLUMNS.join(",");

/** The four columns that identify a row, and the only ones a PATCH may filter on. */
export const IDENTITY_COLUMNS = ["user_id", "profile_id", "collection", "object_id"] as const;

/**
 * A creation, as the ten columns migration 002 grants `authenticated` on INSERT.
 *
 * Exactly ten: any eleventh would be a column the role has no INSERT privilege
 * for, and PostgREST answers that with 42501 for the whole statement — a
 * permission error naming the table, which reads like an RLS problem and is not
 * one.
 */
export function toInsert(scope: SyncScope, row: PushRow): Record<string, unknown> {
  return {
    user_id: scope.userId,
    profile_id: scope.profileId,
    collection: row.collection,
    object_id: row.objectId,
    parent_id: row.parentId,
    version: row.version,
    deleted: row.deleted,
    ck_epoch: row.ckEpoch,
    nonce: base64urlToBytea(row.sealed.nonce),
    ciphertext: base64urlToBytea(row.sealed.ciphertext),
  };
}

/**
 * An update, as the six columns migration 002 grants on UPDATE.
 *
 * The four identity columns are missing because the grant withholds them: they
 * are the AEAD associated data, and a statement that names them dies at the
 * parser with 42501 before a row is examined. They travel in the FILTER instead,
 * which is a `where` and not a `set`.
 */
export function toPatch(row: PushRow): Record<string, unknown> {
  return {
    parent_id: row.parentId,
    version: row.version,
    deleted: row.deleted,
    ck_epoch: row.ckEpoch,
    nonce: base64urlToBytea(row.sealed.nonce),
    ciphertext: base64urlToBytea(row.sealed.ciphertext),
  };
}

const COLUMN_KEYS: ReadonlySet<string> = new Set(PULL_COLUMNS);

/**
 * One row of a PostgREST response, as a {@link PulledRow} — or `null`.
 *
 * Every bound lives in `parsePulledRow`, which this hands off to rather than
 * re-checking: one parser, already tested against the server's own CHECKs, and
 * a second copy here would be a second thing to keep in step. What this adds is
 * only the two things that parser cannot see — the column names, and the fact
 * that `nonce`/`ciphertext` arrive as hex `bytea` rather than base64url.
 *
 * An UNKNOWN COLUMN is a refusal, not a field to ignore. The select list above
 * names nine; a tenth key in the response means the server answered a question
 * it was not asked, and „the server invented a column" is exactly the signal
 * `parsePulledRow` refuses unknown keys to preserve.
 */
export function fromColumns(value: unknown): PulledRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!COLUMN_KEYS.has(key)) return null;
  }

  const nonce = byteaToBase64url(record["nonce"]);
  const ciphertext = byteaToBase64url(record["ciphertext"]);
  if (nonce === null || ciphertext === null) return null;

  return parsePulledRow({
    collection: record["collection"],
    objectId: record["object_id"],
    parentId: record["parent_id"] ?? null,
    version: record["version"],
    deleted: record["deleted"],
    ckEpoch: record["ck_epoch"],
    seq: record["seq"],
    nonce,
    ciphertext,
  });
}
