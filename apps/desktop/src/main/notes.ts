import { mergeNoteState } from "@nexus/core";
import type { NoteStore } from "@nexus/db";

/**
 * NOTE slice a1's compaction policy (ADR-012). This module is the seam where
 * the two halves of the note substrate meet — the same pure-logic/storage
 * split IMEX uses: CRDT semantics (how snapshot + updates merge, what
 * plaintext they derive) live in the pure `mergeNoteState` (`@nexus/core`),
 * while `NoteStore` (`@nexus/db`) stays CRDT-agnostic — opaque blobs, per-note
 * seq ordering, and an atomic `compact` (snapshot upsert + covered-update
 * delete in one transaction). Main owns *when* to compact and stamps the
 * clock; the renderer never controls seq assignment or compaction (SEC-EL-02).
 */

/** How many pending updates a note may accumulate before main folds them into a new snapshot. */
export const COMPACTION_THRESHOLD = 32;

/**
 * Folds a note's pending updates into a fresh snapshot once they reach the
 * threshold: read snapshot + pending updates, merge them purely, then hand
 * the result back to the store's atomic `compact` with the last update's seq
 * as the new `covered_seq`. A no-op below the threshold — called after every
 * `notes:append-update`, so the log never grows unboundedly.
 */
export function compactIfNeeded(store: NoteStore, noteId: string): void {
  if (store.countPendingUpdates(noteId) < COMPACTION_THRESHOLD) return;

  const { snapshot, updates } = store.readForCompaction(noteId);
  const last = updates.at(-1);
  if (!last) return; // nothing pending after all — racing appends cannot occur (main is single-threaded), but stay honest

  const merged = mergeNoteState(
    snapshot,
    updates.map((update) => update.bytes),
  );
  store.compact(noteId, merged.snapshot, merged.plaintext, last.seq, new Date().toISOString());
}
