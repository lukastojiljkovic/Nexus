/**
 * A database row on one side, a `RowState` on the other — and the sweep that
 * turns a local edit into something worth pushing (ADR-083 §3).
 *
 * Nothing here touches SQLite. It takes the row somebody else read, the previous
 * `RowState` somebody else stored, and a clock; it returns the next `RowState`
 * or `null` for "nothing to say". That is what lets it be tested without a
 * database and reused by the web client, which has no database at all.
 *
 * **Why a diff rather than `applyEdit` over the whole row.** `applyEdit` stamps
 * every field it is given, on purpose — its own header explains that "I looked
 * at this and it is still X" is a real assertion. That is right for a user
 * pressing Save. It is wrong for a sweep, because a sweep does not know whether
 * a user pressed anything: a trigger fires on any UPDATE, including one that
 * rewrote a row with identical values (a bulk re-save, a migration, a restore).
 * Stamping every field there would let a no-op write beat a genuine edit made on
 * another device a second earlier, and the user would watch their typing vanish.
 * So the sweep stamps only what actually differs, and a write that changed
 * nothing produces nothing.
 */

import {
  applyEdit,
  canonicalJson,
  compareHlc,
  emptyRowState,
  markDeleted,
  markRestored,
  rowFields,
  type Hlc,
  type JsonObject,
  type JsonValue,
  type RowState,
} from "@nexus/sync-crypto/web";
import type { SyncCollection } from "./collections.js";
import { repairCoupled } from "./repair.js";

/**
 * Columns no collection ever puts in its field map, because something else
 * decides them when a merged row is applied. Each entry says what.
 */
export const UNIVERSAL_DERIVED: Readonly<Record<string, string>> = {
  updated_at:
    "A shadow of the merge itself. Last-write-wins on it would be circular — it is set on apply from the newest field stamp the merged row carries.",
  deleted_at:
    "A shadow of the tombstone, which `merge.ts` carries as a stamped field of its own. Syncing both would let a row be deleted and not deleted at once.",
};

/**
 * Columns one particular collection does not send, beyond the universal two.
 *
 * A column earns a place here only when it is RECONSTRUCTIBLE from something
 * that does travel. That is a narrow test and it is the point: not sending a
 * column that cannot be rebuilt would lose the user's data, so this is not the
 * general answer to „two columns are bound by a CHECK" — see
 * {@link COLLECTION_COUPLED} for the pairs where derivation is not available.
 */
export const COLLECTION_DERIVED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  tasks: {
    completed_at:
      "Migration 002's CHECK binds it to `status`: a task is done exactly when it carries a completion time. Field-level LWW moves the two independently and can produce `status='done'` with a null timestamp, which SQLite REFUSES — so the row could not be applied at all. Derivable because the value is a TIME and the winning `status` carries its own stamp: the moment the write that said `done` was made (ADR-082 §3.2).",
  },
};

/** One CHECK that ties two synced columns together, and the illegal row it refuses. */
export interface CoupledCheck {
  /** The field columns the constraint reads together. Both travel; both merge alone. */
  readonly columns: readonly string[];
  /** The concrete illegal combination a field-level merge can produce. */
  readonly why: string;
}

/**
 * Every table-level CHECK over a synced collection that reads TWO OR MORE
 * columns which both travel as fields — and therefore every place where a merge
 * of two honest edits can produce a row the local database refuses to write.
 *
 * Field-level LWW decides each column on its own, so nothing in `merge.ts` can
 * see that a semester now ends before it starts. The row still authenticates,
 * still converges, still passes every test in `@nexus/sync` — and the INSERT
 * fails.
 *
 * Derivation, the answer for `tasks.completed_at`, is not available for any of
 * these: every one of them pairs two columns a user typed, and a column that
 * cannot be rebuilt from what travelled must not be dropped from the field map.
 * So the answer lives one step later, in `repair.ts`: the merged state is stored
 * and pushed exactly as it merged, and the row WRITTEN LOCALLY is a legal
 * projection of it. Every table named here has a repair, and
 * `repair.test.ts` fails if one is added here without one.
 *
 * Collections only. A `parent-field` table — `fit_routine_items` inside its
 * routine, `fit_workout_sets` inside its workout — travels as ONE ordered JSON
 * array under one field name, carrying one stamp, so LWW takes the whole array
 * from one device or the other and never interleaves two writers' columns. Its
 * internal CHECKs cannot be broken this way, and listing them here would claim a
 * risk that the shape has already ruled out.
 *
 * The reason this table exists NOW, before the repair does: it is checked
 * against the real schema by `@nexus/db`'s `collectionGuard.test.ts`, which
 * fails on any coupled CHECK that is not listed here. A future migration adding
 * one silently is exactly how this class stays invisible — twelve of these
 * shipped without anyone naming the first.
 */
export const COLLECTION_COUPLED: Readonly<Record<string, readonly CoupledCheck[]>> = {
  cards: [
    {
      columns: ["kind", "cloze_text"],
      why: "`(kind = 'cloze') = (cloze_text IS NOT NULL)`. One device turns a cloze card into a basic one while another edits its cloze text: the merge is `kind='basic'` with text still present, or `kind='cloze'` with the text cleared.",
    },
    {
      columns: ["kind", "cloze_ordinal"],
      why: "The same pair one column over — the ordinal that says WHICH deletion this card is. A card that stops being a cloze while its ordinal survives is refused.",
    },
    {
      columns: ["kind", "problem_steps"],
      why: "`problem_steps IS NULL OR kind = 'basic'`. Worked steps written on one device meet a change to `kind='cloze'` made on another, and the row carries steps a cloze card may not have.",
    },
  ],
  focus_sessions: [
    {
      columns: ["started_at", "ended_at"],
      why: "`ended_at > started_at`. Two devices correcting the same session's clock from opposite ends — one moves the start later, the other moves the end earlier — merge into a session that ended before it began.",
    },
  ],
  calendar_settings: [
    {
      columns: ["semester_start", "semester_end"],
      why: "`semester_start <= semester_end`. A per-profile singleton, so both devices edit the same row: one pushes the start forward, the other pulls the end back, and the two dates cross.",
    },
  ],
  dashboard_settings: [
    {
      columns: ["background_hash", "background_mime"],
      why: "`(background_hash IS NULL) = (background_mime IS NULL)`. The wallpaper is three columns holding one fact. A device that clears it while another replaces it merges into a hash with no MIME type, or a MIME type naming no file.",
    },
    {
      columns: ["background_hash", "background_size_bytes"],
      why: "`(background_hash IS NULL) = (background_size_bytes IS NULL)`. The wallpaper's third column, refused by the same merge: a size describing no file, or a file whose size the row will not admit to.",
    },
  ],
  fin_transactions: [
    {
      columns: ["account_id", "counter_account_id"],
      why: "`counter_account_id <> account_id`. A transfer re-pointed on one device and its counter-account re-pointed on another merge into a transfer from an account to itself, which would count twice in every balance.",
    },
    {
      columns: ["counter_account_id", "category_id"],
      why: "`counter_account_id IS NULL OR category_id IS NULL`. One device makes the transaction a transfer; another files it under a category. A transfer is neither income nor expense, so the merged row claims something no report can honour.",
    },
  ],
  habits: [
    {
      columns: ["target", "unit"],
      why: "`unit IS NULL OR target IS NOT NULL`. One device clears the numeric target (making the habit a plain tick) while another names the unit it is measured in, and the merged row has a unit with nothing to measure.",
    },
  ],
  fit_measurements: [
    {
      columns: ["muscle_unit", "muscle_value"],
      why: "`(muscle_unit IS NULL) = (muscle_value IS NULL)`. A reading and its unit are one measurement; clearing one on a device that never saw the other set leaves half a reading.",
    },
  ],
  circuit_chassis: [
    {
      columns: ["wheel_width_cm", "wheel_track_cm"],
      why: "`wheel_track_cm > wheel_width_cm`. Track is centre-to-centre, so wheels no further apart than they are wide overlap through the middle of the machine. One device narrows the track after re-measuring the axle while another widens the tyres, and the merged machine is one SQLite refuses to write.",
    },
  ],
};

/** The columns of `table` that travel as fields, in the order they were given. */
export function fieldColumns(
  collection: SyncCollection,
  columns: readonly string[],
): readonly string[] {
  const identity = new Set(collection.identity);
  const derived = COLLECTION_DERIVED[collection.table] ?? {};
  return columns.filter(
    (column) =>
      column !== "profile_id" &&
      !identity.has(column) &&
      !(column in UNIVERSAL_DERIVED) &&
      !(column in derived),
  );
}

/** The field map a row projects to — the values only, with no clocks yet. */
export function projectRow(
  collection: SyncCollection,
  columns: readonly string[],
  row: Readonly<Record<string, JsonValue>>,
): JsonObject {
  const out: Record<string, JsonValue> = {};
  for (const column of fieldColumns(collection, columns)) {
    out[column] = row[column] ?? null;
  }
  return out;
}

/** What the sweeper is given for one dirty object. */
export interface SweepInput {
  readonly collection: SyncCollection;
  /** Every column of the table, so the projection can subtract rather than guess. */
  readonly columns: readonly string[];
  /** The row as the database holds it, or `null` when it is physically gone. */
  readonly row: Readonly<Record<string, JsonValue>> | null;
  /** What this device last sealed or merged for this object, or `null` for one it has never seen. */
  readonly previous: RowState | null;
  /** The stamp for fields that actually changed. */
  readonly now: Hlc;
}

/**
 * **Deleted means "the user cannot see it any more", not "the row is absent".**
 * Most of this schema soft-deletes: `deleted_at` is set and the row stays right
 * where it was, which is an UPDATE. Since `deleted_at` is subtracted from the
 * field map as derived (it is a shadow of the tombstone `merge.ts` carries as a
 * stamped field of its own), a sweep that only looked for an absent row would
 * find no field change at all in a soft delete and push NOTHING — the deletion
 * would simply never travel, and the user's evidence for the bug would be the
 * thing they deleted coming back on their other device.
 *
 * `!= null` rather than `!== null` on purpose: a table without the column at all
 * reads as `undefined`, which is not a tombstone.
 */
function isTombstoned(row: Readonly<Record<string, JsonValue>>): boolean {
  return row["deleted_at"] != null;
}

/** The fields whose value really differs, or `null` when none of them does. */
function changedFields(before: JsonObject, projected: JsonObject): JsonObject | null {
  const patch: Record<string, JsonValue> = {};
  for (const [name, value] of Object.entries(projected)) {
    // Canonical JSON rather than `===`, so an object or array field compares by
    // what it MEANS. Two encodings of the same value are one value, and a
    // spurious difference here is a spurious stamp that wins a merge it should
    // have lost.
    if (!(name in before) || canonicalJson(before[name] as JsonValue) !== canonicalJson(value)) {
      patch[name] = value;
    }
  }
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * The next `RowState` for one dirty object, or `null` when the change turned out
 * to be no change at all.
 *
 * The cases involving absence are the ones worth stating:
 *
 * - **Gone, and never known.** A row created and deleted between two sweeps.
 *   Nothing is pushed, because there is nothing another device could need: it
 *   never saw the row, and a tombstone for an object it has no record of is
 *   noise it would have to keep forever.
 * - **Gone, already tombstoned.** Idempotent — the journal is a dirty set and an
 *   entry can legitimately be resolved twice.
 * - **Soft-deleted.** The row is still readable, so its fields are diffed as
 *   usual and THEN the tombstone is set. An edit and a delete inside one sweep
 *   window keep both, which is what lets a restore on another device bring back
 *   the last thing the user actually typed rather than the last thing this
 *   device happened to have pushed.
 * - **Present, previously tombstoned.** An undelete. The tombstone is cleared at
 *   `now` and the fields are diffed as usual, so restoring a row does not also
 *   silently re-assert every field it happens to hold.
 * - **Present.** Only differing fields are stamped; identical values keep the
 *   stamp they already had.
 */
export function sweepRow(input: SweepInput): RowState | null {
  const { collection, columns, row, previous, now } = input;
  const gone = row === null || isTombstoned(row);

  if (gone && previous === null) return null;

  const base = previous ?? emptyRowState(now);
  const patch =
    row === null ? null : changedFields(rowFields(base), projectRow(collection, columns, row));

  if (gone) {
    // `previous` is non-null here — the never-known case returned above.
    const tombstoned = previous!.deleted.value;
    if (tombstoned && patch === null) return null;
    const edited = patch === null ? previous! : applyEdit(previous!, patch, now);
    return tombstoned ? edited : markDeleted(edited, now);
  }

  const restoring = previous !== null && previous.deleted.value;
  if (patch === null && !restoring && previous !== null) return null;

  const edited = patch === null ? base : applyEdit(base, patch, now);
  return restoring ? markRestored(edited, now) : edited;
}

/**
 * The newest stamp anywhere in a row — every field's, and the tombstone's.
 *
 * Exported because it is the definition of `updated_at`, and a caller that
 * reached for „the stamp of the field I just changed" would produce a column
 * that goes backwards when an older field arrives from another device.
 */
export function newestStamp(state: RowState): Hlc {
  let newest = state.deleted.at;
  for (const field of Object.values(state.fields)) {
    if (compareHlc(field.at, newest) > 0) newest = field.at;
  }
  return newest;
}

/**
 * An HLC as the local schema spells a timestamp.
 *
 * `wallMs` and nothing else: the counter and the node id are what make the
 * ORDER total, and they have no place in a column a human reads or a report
 * groups by. Two writes in the same millisecond therefore share an
 * `updated_at`, which is correct — the column has never claimed to be an
 * ordering, and `merge.ts` is where ordering lives.
 */
export function stampToIso(at: Hlc): string {
  return new Date(at.wallMs).toISOString();
}

/**
 * The inverse of {@link projectRow}: every column a merged row writes locally,
 * including the ones that never travelled.
 *
 * `projectRow` SUBTRACTS the derived columns on the way out, and something has
 * to add them back on the way in — otherwise a merged row arrives with a null
 * `updated_at`, an untracked tombstone, and (for `tasks`) a state SQLite
 * refuses outright. Both directions read the same two tables of rules, so a
 * column cannot be dropped from one and forgotten in the other.
 *
 * The last step is {@link repairCoupled}, and it is why this function returns a
 * PROJECTION rather than the state itself: twelve CHECKs read two synced columns
 * together, and a per-field merge can satisfy both fields and neither CHECK. The
 * repair belongs here and not in `merge.ts` precisely because this is the only
 * output that is not stored and not pushed — the state keeps both values and
 * both stamps, and only the local row is bent into a shape SQLite will take.
 *
 * Returns plain values. Applying them — the UPDATE, the profile scope, the
 * transaction — belongs to `@nexus/db`, which is the only thing here that knows
 * what a database is.
 */
export function deriveColumns(
  collection: SyncCollection,
  state: RowState,
): Readonly<Record<string, JsonValue>> {
  const out: Record<string, JsonValue> = { ...rowFields(state) };

  out["updated_at"] = stampToIso(newestStamp(state));
  // The tombstone's OWN stamp, not the newest one: `deleted_at` is when the row
  // was deleted, and an edit that arrived afterwards from a device that had not
  // seen the delete must not move it.
  out["deleted_at"] = state.deleted.value ? stampToIso(state.deleted.at) : null;

  if (collection.table === "tasks") {
    // Migration 002: `CHECK ((status = 'done') = (completed_at IS NOT NULL))`.
    // The two columns are one fact, and field-level LWW would move them
    // independently — so only `status` travels, and the timestamp is the moment
    // the winning `status` was stamped. That is also the honest answer to „when
    // was this finished": the write that said `done`.
    const status = state.fields["status"];
    out["completed_at"] =
      status !== undefined && status.value === "done" ? stampToIso(status.at) : null;
  }

  return repairCoupled(collection.table, out, state);
}
