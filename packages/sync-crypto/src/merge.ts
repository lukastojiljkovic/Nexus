/**
 * Field-level last-write-wins over a hybrid logical clock.
 *
 * The rule everything here serves: **a conflict is between FIELDS, not between
 * rows.** Two devices that edit the same task at the same time are, almost
 * always, editing different things about it — one renames it on the desktop
 * while the other ticks the due date on the phone. Row-level LWW throws one of
 * those away and calls it a resolution; the user experiences it as the app
 * silently undoing their work. Field-level LWW keeps both, and only actually
 * chooses when the two devices wrote the SAME field.
 *
 * The price is that every field carries its own stamp, so a row's state is a
 * map from field name to (value, HLC) rather than a plain object. That map is
 * what `row.ts` seals — see {@link encodeRowState} — so the clocks travel
 * inside the ciphertext, where a hostile server cannot rewrite them and thereby
 * decide every conflict it likes.
 *
 * Three properties make this a merge rather than a heuristic, and all three are
 * tested: it is COMMUTATIVE (the order two devices sync in cannot change the
 * result), ASSOCIATIVE (three devices converge no matter how the merges pair
 * up), and IDEMPOTENT (re-delivering a row a second time is a no-op, which
 * matters because at-least-once delivery is the only kind a sync protocol
 * actually gets). Together they are what "eventually consistent" means
 * concretely: every device that has seen the same set of writes holds byte-for-
 * byte the same state, whatever order it saw them in.
 *
 * Deletion is a field too. A tombstone is `deleted: true` with its own stamp,
 * so "device A deleted it at 10:00, device B edited it at 10:05" resolves the
 * only way that does not lose data: the row stays deleted (nothing restored
 * it), and B's edit is still there for when someone does. A row is never
 * actually forgotten by this module; reclaiming tombstones is a retention
 * decision for the sync engine, taken long after every device has seen them.
 *
 * ─── What this deliberately does NOT handle ─────────────────────────────────
 *
 * Note bodies. Concurrent edits to a long text are the one case where LWW is
 * genuinely the wrong answer — losing a paragraph is not a merge — and they go
 * through Yjs as an append-only log of encrypted CRDT updates instead. Every
 * other row in the product is a handful of scalar fields, and for those a
 * field-level LWW is both correct and enormously simpler than a CRDT.
 */

import { isSafeFieldName } from "./bytes.js";
import { canonicalJson, isJsonObject, type JsonObject, type JsonValue } from "./json.js";
import { compareHlc, formatHlc, parseHlc, type Hlc } from "./hlc.js";

/** One field's value and the stamp of the write that set it. */
export interface FieldState {
  readonly value: JsonValue;
  readonly at: Hlc;
}

/** A row's fields. Field names are validated on the way in; see `isSafeFieldName`. */
export type FieldStates = Readonly<Record<string, FieldState>>;

/** The tombstone flag, stamped like any other field. */
export interface DeletedState {
  readonly value: boolean;
  readonly at: Hlc;
}

/** A row as this module understands it. Immutable; every operation returns a new one. */
export interface RowState {
  /**
   * The server's optimistic-concurrency counter, carried here only so a merge
   * can report the greater of the two. **This module never invents the next
   * version.** A merged row is submitted with the version it was based on; the
   * server accepts and increments, or rejects, and a rejection means another
   * device got there first and the caller must re-fetch and merge again. That
   * loop is the sync engine's, not this module's.
   */
  readonly version: number;
  readonly fields: FieldStates;
  readonly deleted: DeletedState;
}

/** A row that exists and has nothing in it yet. */
export function emptyRowState(at: Hlc): RowState {
  return { version: 0, fields: {}, deleted: { value: false, at } };
}

/** The plain value map, for a store or a UI that does not care about clocks. */
export function rowFields(row: RowState): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const [name, state] of Object.entries(row.fields)) {
    out[name] = state.value;
  }
  return out;
}

/**
 * Stamps every field in `patch` with `at`.
 *
 * Stamps them all, including a field whose value did not change. That is
 * deliberate: "I looked at this and it is still X, now" is a real assertion, and
 * suppressing it would let a stale value from another device beat a deliberate
 * re-confirmation. The cost is a slightly newer stamp on an unchanged field,
 * which changes nothing about what the user sees.
 */
export function applyEdit(row: RowState, patch: JsonObject, at: Hlc): RowState {
  const fields: Record<string, FieldState> = { ...row.fields };
  for (const [name, value] of Object.entries(patch)) {
    if (!isSafeFieldName(name)) {
      throw new TypeError(`Refusing a field named ${JSON.stringify(name)} — see isSafeFieldName.`);
    }
    fields[name] = { value, at };
  }
  return { ...row, fields };
}

/** Sets the tombstone. The fields are left exactly as they are — see the file header. */
export function markDeleted(row: RowState, at: Hlc): RowState {
  return { ...row, deleted: { value: true, at } };
}

/** Clears the tombstone. */
export function markRestored(row: RowState, at: Hlc): RowState {
  return { ...row, deleted: { value: false, at } };
}

/**
 * Picks the winner of two writes to one field.
 *
 * Ordinarily the greater HLC wins. The tie case — identical wall clock,
 * counter AND node id — should be impossible, since a node's own counter makes
 * its stamps strictly increasing; reaching it means something upstream is
 * broken (a restored backup replaying a node id, two installs sharing one id).
 * It still needs an answer, and the answer must be the SAME answer on every
 * device, or the two of them diverge permanently over a row neither can fix.
 * Comparing canonical serialisations gives that: deterministic, total, and
 * independent of which side happened to call the merge.
 */
function pickField(left: FieldState, right: FieldState): FieldState {
  const order = compareHlc(left.at, right.at);
  if (order > 0) return left;
  if (order < 0) return right;
  return canonicalJson(left.value) >= canonicalJson(right.value) ? left : right;
}

/** Field-by-field LWW over the union of both sides' field names. */
export function mergeFields(local: FieldStates, remote: FieldStates): FieldStates {
  const merged: Record<string, FieldState> = { ...local };
  for (const [name, remoteState] of Object.entries(remote)) {
    if (!isSafeFieldName(name)) {
      throw new TypeError(`Refusing a field named ${JSON.stringify(name)} — see isSafeFieldName.`);
    }
    const localState = merged[name];
    merged[name] = localState === undefined ? remoteState : pickField(localState, remoteState);
  }
  return merged;
}

/**
 * Merges two views of one row. Commutative, associative and idempotent — the
 * three properties that make convergence a fact rather than a hope.
 */
export function mergeRows(local: RowState, remote: RowState): RowState {
  const deletedOrder = compareHlc(local.deleted.at, remote.deleted.at);
  const deleted =
    deletedOrder > 0
      ? local.deleted
      : deletedOrder < 0
        ? remote.deleted
        : // Same stamp: prefer the tombstone. Keeping a row that one side
          // deleted is recoverable; dropping a row the user deleted is not.
          local.deleted.value || remote.deleted.value
          ? { value: true, at: local.deleted.at }
          : local.deleted;

  return {
    version: Math.max(local.version, remote.version),
    fields: mergeFields(local.fields, remote.fields),
    deleted,
  };
}

/**
 * What the authenticated row envelope says about this row.
 *
 * Structurally a subset of `row.ts`'s `RowIdentity`, so a caller passes the very
 * identity it just rebuilt the AAD from — there is nothing to keep in step.
 * Deliberately NOT an import of `RowIdentity`: this module knows nothing about
 * AEAD, and a shared shape is all the coupling the check needs.
 */
export interface RowEnvelope {
  readonly version: number;
  readonly deleted: boolean;
}

/**
 * The wire form: `{ f: { <field>: { v, t } }, d: { v, t } }`, where `t` is
 * `formatHlc`. Short keys because this is sealed and stored for every row of
 * every profile, and the field names are already carrying the meaning.
 *
 * **The version is deliberately absent.** It lives in the row envelope, where
 * the server can read it (it needs to, for optimistic concurrency) and where
 * `row.ts` binds it into the AAD — so it is authenticated without being
 * secret. Putting it in the plaintext as well would create two copies that can
 * disagree, and the interesting question would become which one to believe.
 *
 * `deleted` is the one value that genuinely has to exist in both places, and it
 * is the exception that proves the rule above. The envelope needs it in the
 * clear (the server filters tombstones without being able to read them, and
 * `row.ts` binds it into the AAD so it cannot be stripped); the plaintext needs
 * it stamped, because a tombstone with no clock cannot be merged against a
 * concurrent restore. Two copies exist, so {@link decodeRowState} compares them
 * — see there.
 */
export function encodeRowState(row: RowState): JsonObject {
  const fields: Record<string, JsonValue> = {};
  for (const [name, state] of Object.entries(row.fields)) {
    fields[name] = { v: state.value, t: formatHlc(state.at) };
  }
  return { f: fields, d: { v: row.deleted.value, t: formatHlc(row.deleted.at) } };
}

function decodeStamped(value: JsonValue | undefined): FieldState | null {
  if (!isJsonObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("v") || !keys.includes("t")) return null;
  const text = value["t"];
  const inner = value["v"];
  if (typeof text !== "string" || inner === undefined) return null;
  const at = parseHlc(text);
  if (at === null) return null;
  return { value: inner, at };
}

/**
 * The inverse, or `null`. Takes the authenticated `envelope` separately because
 * that is where the version and the tombstone flag actually come from.
 *
 * Strict about everything, including unknown keys and prototype-poisoning
 * field names, for the reason that governs every parser in this package: the
 * bytes came out of an AEAD, so they are authentic, but "authentic" only means
 * "written by someone holding the content key". A compromised or buggy peer is
 * still a peer, and a value this client cannot fully understand is a value it
 * must not store and re-emit.
 *
 * **And it rejects a plaintext whose tombstone disagrees with the envelope's.**
 * `deleted` is stored twice — once in the clear where `row.ts` binds it into the
 * AAD, once stamped inside the ciphertext where the merge needs its clock — and
 * two copies of one fact are only safe while something compares them. Nothing
 * did. A peer holding CK_p could seal a row the server files as live and every
 * client merges as deleted, or the reverse: the server would show one answer in
 * its indexes and the clients another, permanently, with no error anywhere. The
 * comparison costs a line and turns that into a refusal at the door.
 */
export function decodeRowState(value: JsonObject, envelope: RowEnvelope): RowState | null {
  const { version, deleted: envelopeDeleted } = envelope;
  if (!Number.isSafeInteger(version) || version < 0) return null;
  if (typeof envelopeDeleted !== "boolean") return null;

  const keys = Object.keys(value);
  if (keys.length !== 2 || !keys.includes("f") || !keys.includes("d")) return null;

  const rawFields = value["f"];
  if (!isJsonObject(rawFields)) return null;

  const fields: Record<string, FieldState> = {};
  for (const name of Object.keys(rawFields)) {
    if (!isSafeFieldName(name)) return null;
    const decoded = decodeStamped(rawFields[name]);
    if (decoded === null) return null;
    fields[name] = decoded;
  }

  const rawDeleted = decodeStamped(value["d"]);
  if (rawDeleted === null || typeof rawDeleted.value !== "boolean") return null;
  if (rawDeleted.value !== envelopeDeleted) return null;

  return { version, fields, deleted: { value: rawDeleted.value, at: rawDeleted.at } };
}
