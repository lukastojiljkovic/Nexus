/**
 * One row to the server, and the outcome named.
 *
 * ─── An upsert is not available to this client, and that is not a preference ─
 *
 * The obvious shape is `POST … Prefer: resolution=merge-duplicates`, and
 * migration 003's header assumes it. It does not work, and the reason is the
 * schema's own doing. PostgREST compiles that into `insert … on conflict do
 * update set <every column in the payload>`, which requires the UPDATE privilege
 * on every one of them — including `user_id`, `profile_id`, `collection` and
 * `object_id`, which migration 002 deliberately WITHHOLDS because they are the
 * AEAD associated data. Measured against the running server as the
 * `authenticated` role: every upsert, creation and update alike, comes back
 * `403 42501 permission denied for table sync_objects`. The column grants that
 * make a row's identity immutable are what close the upsert path.
 *
 * So a push is two verbs, chosen by a fact the client already knows rather than
 * guessed:
 *
 *  - `version === 1` — this device has never had an accepted push for the
 *    object, so it is a CREATION: `POST`, ten columns, the ten the INSERT grant
 *    names.
 *  - `version > 1` — an UPDATE: `PATCH` filtered by the four identity columns,
 *    setting the six the UPDATE grant names.
 *
 * Both failure modes are loud and distinguishable. A creation of a row that
 * already exists is `409 23505` on `sync_objects_pkey`. An update of a row that
 * does not exist is `200 []` — which is the silent one, and is why every request
 * here asks for `return=representation` and why an empty array is converted into
 * {@link PushCode} `absent` rather than read as success.
 *
 * ─── One row per request, and the measurement behind it ─────────────────────
 *
 * A bulk `POST` of several rows is ONE statement, so one bad row aborts all of
 * them: pushing a good row and a row at an illegal version together stores
 * neither — verified, not assumed. The error does name the offender in
 * `details` (`object bad: first version 5`), so a batch could in principle be
 * retried minus the offender — but that would make this client's progress depend
 * on parsing an English sentence the server never promised to keep stable. Under
 * optimistic concurrency the honest unit is the row, because the row is what
 * NX001 accepts or refuses.
 *
 * Sequential rather than concurrent for the same reason: the first conflict
 * means the local state is stale, and rows pushed after it were planned against
 * that same stale state.
 */

import { type PushRow, type SyncScope } from "@nexus/sync";

import { jsonHeaders, parseFailure, parseRows, postgrestPath, type HttpPort } from "./http.js";
import { classifyPush, needsReread, type PushCode, type PushResult } from "./outcome.js";
import { PULL_SELECT, toInsert, toPatch } from "./rows.js";

/**
 * `return=representation` on every write, and it is not for convenience.
 *
 * On a PATCH it is the only way to learn that nothing matched. On a POST it
 * returns the row as stored, which carries the server-assigned `seq` — the value
 * the cursor is made of, and one the client can get no other way without a
 * second round trip that could race with another device's write.
 */
const WRITE_PREFER = "return=representation";

/** Push one row. Never throws for a server answer; a thrown port error becomes `unavailable`. */
export async function pushRow(
  http: HttpPort,
  scope: SyncScope,
  row: PushRow,
): Promise<PushResult> {
  const result = (code: PushCode, seq: number | null, sqlstate: string | null, message: string | null): PushResult => ({
    code,
    collection: row.collection,
    objectId: row.objectId,
    seq,
    sqlstate,
    message,
  });

  const creation = row.version === 1;
  const path = creation
    ? postgrestPath("sync_objects", [["select", PULL_SELECT]])
    : postgrestPath("sync_objects", [
        ["user_id", `eq.${scope.userId}`],
        ["profile_id", `eq.${scope.profileId}`],
        ["collection", `eq.${row.collection}`],
        ["object_id", `eq.${row.objectId}`],
        ["select", PULL_SELECT],
      ]);

  let response;
  try {
    response = await http({
      method: creation ? "POST" : "PATCH",
      path,
      headers: jsonHeaders(WRITE_PREFER),
      // A creation is wrapped in an array because PostgREST's insert takes a
      // collection; a PATCH is a bare object because it takes a single set of
      // assignments. Sending an array to a PATCH is a 400 that reads like a
      // schema error.
      body: JSON.stringify(creation ? [toInsert(scope, row)] : toPatch(row)),
    });
  } catch (error) {
    // A port that threw told us nothing about the row: the request may have been
    // refused before it left, or accepted and lost on the way back. `unavailable`
    // is the only honest answer, and the retry that follows is safe because a
    // duplicate arrives as NX001 and is resolved by re-reading.
    return result("unavailable", null, null, error instanceof Error ? error.message : null);
  }

  if (response.status < 200 || response.status >= 300) {
    const failure = parseFailure(response.body);
    return result(classifyPush(response.status, failure), null, failure.code, failure.message);
  }

  const rows = parseRows(response.body);
  if (rows === null) {
    return result("unavailable", null, null, "the body of a write was not a JSON array");
  }
  if (rows.length === 0) {
    // The silent one. A PATCH that matched nothing; on a POST this cannot happen
    // (a creation either stores a row or raises), so it is reported the same way
    // rather than being treated as a shape this client understands.
    return result("absent", null, null, null);
  }

  return result("accepted", seqOf(rows[0]), null, null);
}

/**
 * A batch, one request at a time, stopping at the first outcome that makes the
 * rest of the plan stale.
 *
 * `conflict`, `absent` and `duplicate` all mean the same thing about the batch:
 * this device's picture of the server is out of date, and every row still
 * unpushed was planned against that picture. Pushing them anyway would either
 * fail the same way or — worse — succeed at a version derived from a state the
 * server has already moved past. So the loop stops and the caller pulls.
 *
 * `nonce-reuse` also stops it, and for a much sharper reason: it means this
 * device drew a nonce it had already used under the live content key. Continuing
 * would push more rows from the same generator.
 *
 * Every other outcome — `rejected`, `forbidden`, `unavailable`, `stale-bytes`,
 * `no-epoch` — is about ONE row and does not stop the batch.
 *
 * The result array is therefore as long as the number of rows ATTEMPTED, not as
 * long as the input, and the two differ exactly when the loop stopped early.
 * Results are in input order, so `results.length` names the row that stopped it
 * and everything from that index on is still owed.
 */
export async function pushRows(
  http: HttpPort,
  scope: SyncScope,
  rows: readonly PushRow[],
): Promise<readonly PushResult[]> {
  const results: PushResult[] = [];
  for (const row of rows) {
    const result = await pushRow(http, scope, row);
    results.push(result);
    if (needsReread(result.code) || result.code === "nonce-reuse") break;
  }
  return results;
}

/** The `seq` out of a returned row, when it is a number this client can hold exactly. */
function seqOf(value: unknown): number | null {
  if (typeof value !== "object" || value === null) return null;
  const seq = (value as Record<string, unknown>)["seq"];
  return typeof seq === "number" && Number.isSafeInteger(seq) && seq >= 1 ? seq : null;
}
