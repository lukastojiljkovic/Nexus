/**
 * An object's id on the wire, and the parent it hangs off.
 *
 * **Why the encoding moved here.** An object id is a row's identity columns
 * joined by the ASCII unit separator, and until now that sentence was written in
 * three places and owned by none of them: migration 063's triggers compose it in
 * SQL, `@nexus/db`'s journal took it apart in TypeScript, and `wire.ts` bounds
 * its length without knowing what is inside. The browser will have to take one
 * apart with no `@nexus/db` in sight — it is a wire fact, so it belongs in the
 * package that owns the wire, and `@nexus/db` now adopts it rather than keeping
 * a second copy.
 *
 * The separator is U+001F because it is the one byte that cannot appear in any
 * identity value the product produces — UUIDv7s, integers, ISO dates and module
 * ids are all printable — so the join is unambiguous without escaping. It is
 * written as a code point rather than a string escape because a control
 * character that renders as nothing is one a reviewer cannot see and a diff
 * cannot show — the same rule `check:invisibles` enforces everywhere else. The
 * test asserts the code point independently rather than importing this constant,
 * which is the only way a test can notice this file changing it.
 *
 * **The parent derivation, and the trap in it.** `parentId` is the hint the
 * server answers „give me this note's blocks" from, and `row.ts` binds it into
 * the AAD so the hint cannot disagree with the ciphertext. The parent it names
 * is the one the map already declares — `profileVia` — and nothing else: that is
 * the only parent relationship in `collections.ts` that `@nexus/db`'s guard
 * checks against a real foreign key, and inventing a second one here (a task's
 * list, say) would be asserting a relationship the map never states.
 *
 * The trap is that `profileVia.key` does not live in one place. `fieldColumns`
 * SUBTRACTS the identity columns from the field map, so for `note_versions` and
 * `note_updates` — whose identity is `["note_id", …]` — `note_id` is not a field
 * of the state and never will be. A derivation that read `state.fields[key]`
 * would answer `undefined` for two of the eight parented collections, every
 * time, and the only symptom would be a hint that is quietly null. So the key is
 * read from wherever the collection actually keeps it, and which of the two that
 * is comes from the map rather than from a list maintained here.
 */

import type { RowState } from "@nexus/sync-crypto/web";
import type { SyncCollection } from "./collections.js";

/** The byte an object id's identity values are joined by. ASCII 31. */
export const UNIT_SEPARATOR = String.fromCharCode(0x1f);

/**
 * One object id back into the identity values it was composed from, in the map's
 * identity order.
 *
 * Throws on a part count that disagrees with the map, because the only writers
 * are migration 063's triggers and the wire: a mismatch means the schema and the
 * map disagree about what identifies an object, and a silent skip there is a row
 * that never syncs and never says why.
 */
export function splitObjectId(
  objectId: string,
  collection: SyncCollection,
): readonly string[] {
  if (collection.identity.length === 0) return [];
  const parts = objectId.split(UNIT_SEPARATOR);
  if (parts.length !== collection.identity.length) {
    throw new TypeError(
      `Object id for ${collection.table} has ${String(parts.length)} identity ` +
        `part${parts.length === 1 ? "" : "s"}, expected ${String(collection.identity.length)}.`,
    );
  }
  return parts;
}

/**
 * The object id of the row this one hangs off, or `null` for a root.
 *
 * Both directions derive it from the same place, which is the point of it being
 * one function: a push that sealed a different parent into the AAD than the pull
 * rebuilds would fail to open, and the failure would look like a corrupt row.
 */
export function parentIdOf(
  collection: SyncCollection,
  objectId: string,
  state: RowState,
): string | null {
  const via = collection.profileVia;
  if (via === undefined) return null;

  const index = collection.identity.indexOf(via.key);
  if (index !== -1) {
    // The identity is the id, so the parent is already in it — and has to be
    // taken from there, since it is exactly the case the field map excludes.
    return splitObjectId(objectId, collection)[index]!;
  }

  const value = state.fields[via.key]?.value;
  if (typeof value !== "string" || value === "") {
    // A `profileVia` column is NOT NULL by the guard test's construction and is
    // projected into the fields on the very first sweep, where it stays even
    // through a tombstone. Missing here means the local state is malformed, and
    // returning null instead would push a row whose hint the server can never
    // use — indistinguishable, on the wire, from a genuine root.
    throw new TypeError(
      `A ${collection.table} object has no ${via.key} to name its parent with ` +
        `(object ${objectId}).`,
    );
  }
  return value;
}
