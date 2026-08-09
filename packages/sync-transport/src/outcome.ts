/**
 * Every way a write can end, named — because the alternative is a status code
 * and a string, and the engine's correct response differs for each.
 *
 * ─── The mapping is measured, not inferred ──────────────────────────────────
 *
 * PostgREST turns a SQLSTATE it does not recognise into HTTP 400 and passes
 * `code`/`message`/`details`/`hint` through verbatim, so the `NX0xx` codes the
 * guard trigger raises arrive intact. That sentence is easy to write and was
 * checked against the running server rather than trusted: NX001 and NX007 come
 * back as 400 with `code` set, a duplicate primary key comes back as 409 with
 * `23505` and a `message` naming the constraint, and a PATCH matching no row
 * comes back as **200 with an empty array**. The last one is the reason this
 * file exists at all.
 *
 * ─── Why `absent` is a first-class outcome ──────────────────────────────────
 *
 * There is no error anywhere in the „PATCH matched nothing" path. PostgREST is
 * satisfied, the trigger never runs, the transaction commits. A client that
 * looked only at the status would mark the row synced and move on, and the edit
 * would be gone with no record that it ever failed. So an empty representation
 * is converted here into a named outcome, and the engine has to decide about it
 * like any other.
 */

import { type PostgrestFailure } from "./http.js";

/** How a single-row write ended. */
export type PushCode =
  /** Stored at the version that was sent. */
  | "accepted"
  /**
   * NX001 — the stored version is not the one this push was planned against.
   * Somebody else wrote first, or this is a retry of a push that was accepted
   * and whose response was lost. The two are told apart by re-reading, not by
   * retrying: migration 003's header spells out that a server row byte-identical
   * to what was sent is a success that already happened.
   */
  | "conflict"
  /**
   * The object this update names is not on the server: a PATCH that matched
   * nothing, or NX002 (a creation arriving at a version above 1 for an object
   * the server has never held). The local version counter is ahead of a row that
   * does not exist, so the repair is to pull and re-plan from zero.
   */
  | "absent"
  /** 23505 on the primary key — a creation of an object that already exists. Pull, then re-plan. */
  | "duplicate"
  /**
   * NX003 — the ciphertext did not change with the version. Always this client's
   * bug: `sealRow` draws a fresh nonce every call, so identical bytes at a new
   * version mean the same sealed row was submitted twice.
   */
  | "stale-bytes"
  /**
   * NX005, or 23505 on `sync_objects_nonce_unique` — a nonce this key has
   * already used. An ALARM, not a retry: reuse under XChaCha20-Poly1305
   * publishes the plaintext XOR and the Poly1305 forging key. The engine must
   * stop pushing this profile and surface it.
   */
  | "nonce-reuse"
  /** NX007 — the row names a content-key generation whose `ck_under_mk` wrap was never stored. */
  | "no-epoch"
  /** Any other refusal by the server's own rules: a CHECK (23514), NX004, NX006. */
  | "rejected"
  /** 401/403/42501 — the session is dead, revoked, or was never entitled to this row. */
  | "forbidden"
  /** 5xx, a timeout, an unparseable body — nothing was learned about the row. Retry later. */
  | "unavailable";

export interface PushResult {
  readonly code: PushCode;
  readonly collection: string;
  readonly objectId: string;
  /** The server's new log position, when it told us. Only ever set on `accepted`. */
  readonly seq: number | null;
  /** The SQLSTATE, when there was one. Kept so a log can say which rule fired. */
  readonly sqlstate: string | null;
  /** The server's own sentence, for a human. Never parsed for control flow. */
  readonly message: string | null;
}

/**
 * The primary key's constraint name, and the nonce index's.
 *
 * Matched against `message`, which is where PostgreSQL puts the constraint name
 * for a 23505 (`duplicate key value violates unique constraint "…"`). This is
 * the ONE place in the package that reads an error string, and it is confined to
 * telling two 23505s apart: everything else keys off `code`. A rename on the
 * server makes both fall through to `rejected`, which is loud and wrong-way-safe
 * — never `accepted`.
 */
const PRIMARY_KEY_CONSTRAINT = "sync_objects_pkey";
const NONCE_CONSTRAINT = "sync_objects_nonce_unique";

/** The trigger's own codes, mapped to what the engine should do about them. */
const BY_SQLSTATE: ReadonlyMap<string, PushCode> = new Map<string, PushCode>([
  ["NX001", "conflict"],
  ["NX002", "absent"],
  ["NX003", "stale-bytes"],
  ["NX004", "rejected"],
  ["NX005", "nonce-reuse"],
  ["NX006", "rejected"],
  ["NX007", "no-epoch"],
  ["23514", "rejected"],
  ["42501", "forbidden"],
]);

/**
 * An HTTP status and a failure body, as one outcome.
 *
 * Status is consulted only where the body cannot answer: a 5xx or a 401 carries
 * no SQLSTATE, and a body that did not parse carries nothing at all. Everywhere
 * else the code decides, because a code is a rule and a status is a category.
 */
export function classifyPush(status: number, failure: PostgrestFailure): PushCode {
  if (failure.code === "23505") {
    const message = failure.message ?? "";
    if (message.includes(NONCE_CONSTRAINT)) return "nonce-reuse";
    if (message.includes(PRIMARY_KEY_CONSTRAINT)) return "duplicate";
    return "rejected";
  }
  const mapped = failure.code === null ? undefined : BY_SQLSTATE.get(failure.code);
  if (mapped !== undefined) return mapped;
  if (status === 401 || status === 403) return "forbidden";
  if (status >= 500) return "unavailable";
  // A 4xx this file has no rule for is the server refusing on grounds nobody
  // here anticipated. `rejected` rather than `unavailable`, because retrying it
  // would be a loop: the same bytes will be refused the same way.
  if (status >= 400) return "rejected";
  return "unavailable";
}

/** Whether an outcome means „stop and re-read", as opposed to „stop and shout". */
export function needsReread(code: PushCode): boolean {
  return code === "conflict" || code === "absent" || code === "duplicate";
}
