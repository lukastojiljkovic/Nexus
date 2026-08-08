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
  emptyRowState,
  markDeleted,
  markRestored,
  rowFields,
  type Hlc,
  type JsonObject,
  type JsonValue,
  type RowState,
} from "@nexus/sync-crypto";
import type { SyncCollection } from "./collections.js";

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
 * Every one of these is a column bound to another column by a database CHECK, so
 * merging the pair independently can produce a row SQLite refuses to write —
 * which would make the whole row unappliable rather than merely wrong.
 */
export const COLLECTION_DERIVED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  tasks: {
    completed_at:
      "Migration 002's CHECK binds it to `status`: a task is done exactly when it carries a completion time. Field-level LWW moves the two independently and can produce `status='done'` with a null timestamp, which SQLite REFUSES — so the row could not be applied at all. Derived from `status` on apply (ADR-082 §3.2).",
  },
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
  /** The row as the database holds it, or `null` when it is gone. */
  readonly row: Readonly<Record<string, JsonValue>> | null;
  /** What this device last sealed or merged for this object, or `null` for one it has never seen. */
  readonly previous: RowState | null;
  /** The stamp for fields that actually changed. */
  readonly now: Hlc;
}

/**
 * The next `RowState` for one dirty object, or `null` when the change turned out
 * to be no change at all.
 *
 * Four cases, and the two involving absence are the ones worth stating:
 *
 * - **Gone, and never known.** A row created and deleted between two sweeps.
 *   Nothing is pushed, because there is nothing another device could need: it
 *   never saw the row, and a tombstone for an object it has no record of is
 *   noise it would have to keep forever.
 * - **Gone, already tombstoned.** Idempotent — the journal is a dirty set and an
 *   entry can legitimately be resolved twice.
 * - **Present, previously tombstoned.** An undelete. The tombstone is cleared at
 *   `now` and the fields are diffed as usual, so restoring a row does not also
 *   silently re-assert every field it happens to hold.
 * - **Present.** Only differing fields are stamped; identical values keep the
 *   stamp they already had.
 */
export function sweepRow(input: SweepInput): RowState | null {
  const { collection, columns, row, previous, now } = input;

  if (row === null) {
    if (previous === null) return null;
    if (previous.deleted.value) return null;
    return markDeleted(previous, now);
  }

  const projected = projectRow(collection, columns, row);
  const base = previous ?? emptyRowState(now);
  const before = rowFields(base);

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

  const restoring = previous !== null && previous.deleted.value;
  if (Object.keys(patch).length === 0 && !restoring && previous !== null) return null;

  const edited = applyEdit(base, patch, now);
  return restoring ? markRestored(edited, now) : edited;
}
