/**
 * The server's copy of each cursor — a convenience, and treated as one.
 *
 * `sync_state` exists so a device that has been reinstalled resumes instead of
 * re-downloading a lifetime of ciphertext. Migration 001 is explicit that the
 * client owns the authoritative copy and that a hostile server rewinding this
 * value must be harmless: `last_seq` is a FLOOR a client raises, never a number
 * it obeys. So {@link readCursors} returns what the server claims and every
 * caller is expected to take the greater of that and its own — which is exactly
 * `advanceCursor`, the same function the pull path uses, for the same reason.
 *
 * ─── Two verbs again, and for the same reason as `push.ts` ──────────────────
 *
 * Migration 002 grants `authenticated` INSERT on five columns of this table and
 * UPDATE on `last_seq` alone, so PostgREST's upsert is closed here as well: its
 * `on conflict do update` would have to assign the four primary-key columns it
 * was given, and the role has no UPDATE privilege on any of them. A cursor write
 * is therefore a PATCH, and a PATCH that matches nothing is the row's first
 * write, which is a POST. That order — update first, insert on the miss — is the
 * one that costs a single round trip in the steady state, which is every write
 * after the first.
 *
 * ─── `updated_at` is not sent ───────────────────────────────────────────────
 *
 * It is the server's fact, stamped by the trigger in migration 008. A client
 * that stated its own would be stating a clock nobody verified, on the one
 * column of this table a human might read as evidence that a device is alive.
 */

import { type SyncScope } from "@nexus/sync";

import { jsonHeaders, parseFailure, parseRows, postgrestPath, type HttpPort } from "./http.js";

export interface CursorRow {
  readonly collection: string;
  readonly lastSeq: number;
}

export type CursorFailureReason = "forbidden" | "unavailable" | "malformed";

export interface CursorFailure {
  readonly ok: false;
  readonly reason: CursorFailureReason;
  readonly status: number;
  readonly sqlstate: string | null;
  readonly message: string | null;
}

export interface CursorsRead {
  readonly ok: true;
  readonly cursors: readonly CursorRow[];
}

export interface CursorWritten {
  readonly ok: true;
  /** `true` when the row had to be created, i.e. this device had no cursor for the collection. */
  readonly created: boolean;
}

/** Every cursor this device has for one profile. */
export async function readCursors(
  http: HttpPort,
  scope: SyncScope,
  deviceId: string,
): Promise<CursorsRead | CursorFailure> {
  const path = postgrestPath("sync_state", [
    ["user_id", `eq.${scope.userId}`],
    ["device_id", `eq.${deviceId}`],
    ["profile_id", `eq.${scope.profileId}`],
    ["select", "collection,last_seq"],
  ]);

  const response = await http({ method: "GET", path, headers: jsonHeaders(), body: null });
  if (response.status !== 200) return failureOf(response.status, response.body);

  const raw = parseRows(response.body);
  if (raw === null) {
    return { ok: false, reason: "unavailable", status: response.status, sqlstate: null, message: "not a JSON array" };
  }

  const cursors: CursorRow[] = [];
  for (const value of raw) {
    const row = parseCursor(value);
    if (row === null) {
      return {
        ok: false,
        reason: "malformed",
        status: response.status,
        sqlstate: null,
        message: "a sync_state row is not a cursor",
      };
    }
    cursors.push(row);
  }
  return { ok: true, cursors };
}

/**
 * Raise one cursor.
 *
 * NOT idempotent in the sense of „safe to call with an older value": this writes
 * whatever it is given, because the server has no rule that a cursor only rises
 * and adding one would be a rule about a number the design already says nobody
 * may trust. The monotonicity lives in the caller, in `advanceCursor`.
 */
export async function writeCursor(
  http: HttpPort,
  scope: SyncScope,
  deviceId: string,
  collection: string,
  lastSeq: number,
): Promise<CursorWritten | CursorFailure> {
  const filter = postgrestPath("sync_state", [
    ["user_id", `eq.${scope.userId}`],
    ["device_id", `eq.${deviceId}`],
    ["profile_id", `eq.${scope.profileId}`],
    ["collection", `eq.${collection}`],
    ["select", "collection"],
  ]);

  const patch = async (): Promise<CursorWritten | CursorFailure | null> => {
    const patched = await http({
      method: "PATCH",
      path: filter,
      headers: jsonHeaders("return=representation"),
      body: JSON.stringify({ last_seq: lastSeq }),
    });
    if (patched.status < 200 || patched.status >= 300) return failureOf(patched.status, patched.body);

    const rows = parseRows(patched.body);
    if (rows === null) {
      return { ok: false, reason: "unavailable", status: patched.status, sqlstate: null, message: "not a JSON array" };
    }
    // `null` — not `created: false` — is the „matched nothing" answer, so the
    // caller below can tell „the row is not there yet" from „the row was
    // updated". Collapsing the two is the silent no-op this whole file is
    // arranged to avoid.
    return rows.length > 0 ? { ok: true, created: false } : null;
  };

  const first = await patch();
  if (first !== null) return first;

  const created = await http({
    method: "POST",
    path: postgrestPath("sync_state", [["select", "collection"]]),
    headers: jsonHeaders("return=representation"),
    body: JSON.stringify([
      {
        user_id: scope.userId,
        device_id: deviceId,
        profile_id: scope.profileId,
        collection,
        last_seq: lastSeq,
      },
    ]),
  });
  if (created.status >= 200 && created.status < 300) return { ok: true, created: true };

  // 23505 IS NOT A SERVER PROBLEM HERE, and reporting it as one would hide a
  // lost write. This table's only unique constraint is its primary key, so the
  // sole way to reach it is another writer holding the same
  // (user, device, profile, collection) — two browser tabs of one device, which
  // share a `devices` row and therefore share every cursor in it. Both miss on
  // the PATCH, both POST, and one loses.
  //
  // The tempting answer is „the row exists, call it done". That is false: the
  // winner wrote ITS `lastSeq`, not ours, and „done" would be a success report
  // for a value that was never stored. The row does exist now, though, which is
  // exactly the condition the first PATCH lacked — so it is re-issued, and this
  // time it matches. Once, not in a loop: a second 23505 is impossible, because
  // nothing deletes from this table (there is no DELETE grant and no policy).
  if (parseFailure(created.body).code === "23505") {
    const retried = await patch();
    if (retried !== null) return retried;
    return {
      ok: false,
      reason: "unavailable",
      status: created.status,
      sqlstate: "23505",
      message: "the cursor row conflicted on insert and then matched nothing on update",
    };
  }
  return failureOf(created.status, created.body);
}

function parseCursor(value: unknown): CursorRow | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== "collection" && key !== "last_seq") return null;
  }
  const collection = record["collection"];
  const lastSeq = record["last_seq"];
  if (typeof collection !== "string" || collection === "") return null;
  if (typeof lastSeq !== "number" || !Number.isSafeInteger(lastSeq) || lastSeq < 0) return null;
  return { collection, lastSeq };
}

function failureOf(status: number, body: string): CursorFailure {
  const failure = parseFailure(body);
  const forbidden = status === 401 || status === 403 || failure.code === "42501";
  return {
    ok: false,
    reason: forbidden ? "forbidden" : "unavailable",
    status,
    sqlstate: failure.code,
    message: failure.message,
  };
}
