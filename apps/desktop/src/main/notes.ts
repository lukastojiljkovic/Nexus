import { mergeNoteState } from "@nexus/core";
import type { NoteStore } from "@nexus/db";

/**
 * NOTE slice a1's compaction policy (ADR-012) plus NOTE-008's version-history
 * capture policy (ADR-015). This module is the seam where the two halves of
 * the note substrate meet — the same pure-logic/storage split IMEX uses: CRDT
 * semantics (how snapshot + updates merge, what plaintext they derive) live
 * in the pure `mergeNoteState` (`@nexus/core`), while `NoteStore` (`@nexus/db`)
 * stays CRDT-agnostic — opaque blobs, per-note seq ordering, an atomic
 * `compact` (snapshot upsert + covered-update delete in one transaction), and
 * a checkpoint mechanism (`captureVersion`: dedupe-by-PK insert + retention
 * prune). Main owns *when* to compact and *when* to checkpoint, and stamps
 * the clock for both; the renderer never controls seq assignment,
 * compaction, or checkpoint cadence (SEC-EL-02).
 */

/** How many pending updates a note may accumulate before main folds them into a new snapshot. */
export const COMPACTION_THRESHOLD = 32;

/** Minimum age (ms) of a note's latest checkpoint before compaction takes another — ADR-015's ~10-minute cadence. */
export const VERSION_MIN_AGE_MS = 600_000;

/**
 * Folds a note's pending updates into a fresh snapshot once they reach the
 * threshold: read snapshot + pending updates, merge them purely, then hand
 * the result back to the store's atomic `compact` with the last update's seq
 * as the new `covered_seq`. A no-op below the threshold — called after every
 * `notes:append-update`, so the log never grows unboundedly.
 *
 * After a successful compaction, this doubles as the version-history cadence
 * (ADR-015): if the note has no checkpoint yet, or its latest one is older
 * than `VERSION_MIN_AGE_MS`, the freshly merged snapshot is captured as a new
 * version too. Compaction stays the primary duty — a checkpoint missed here
 * (e.g. a note edited in a single burst under the threshold) self-heals at
 * the next compaction that does cross it, so no separate scheduler is needed.
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
  const now = new Date();
  store.compact(noteId, merged.snapshot, merged.plaintext, last.seq, now.toISOString());

  const latest = store.latestVersion(noteId);
  if (!latest || now.getTime() - Date.parse(latest.createdAt) >= VERSION_MIN_AGE_MS) {
    store.captureVersion(noteId, merged.snapshot, last.seq, now.toISOString());
  }
}

/**
 * The explicit pre-restore checkpoint (`notes:version-capture`, ADR-015): no
 * age gate — a user action (about to restore an old version), not a cadence
 * — but the PK dedupe still makes a repeat call idempotent. Merges only
 * *stored* state (snapshot + pending updates already in the DB); no renderer
 * bytes are involved, so spamming this channel churns at most the
 * `MAX_NOTE_VERSIONS` retention window and requires real appends between
 * calls to produce a new row — the same bounded-harm shape as
 * `notes:append-update` itself.
 *
 * A note with no persisted state yet (`coveredSeq` would be 0) is a no-op:
 * there is nothing to checkpoint before the first content ever lands.
 */
export function captureNoteVersion(store: NoteStore, noteId: string): void {
  const read = store.readForCompaction(noteId);
  const last = read.updates.at(-1);
  const coveredSeq = last?.seq ?? read.coveredSeq;
  if (coveredSeq === 0) return; // nothing persisted yet — nothing to checkpoint

  const now = new Date().toISOString();
  if (!last) {
    // coveredSeq > 0 with no pending updates implies a stored snapshot
    // (readForCompaction's own invariant) — checked explicitly for TS and
    // honesty rather than casting the null away.
    if (!read.snapshot) {
      throw new Error("Invariant violated: a positive coveredSeq implies a stored snapshot.");
    }
    store.captureVersion(noteId, read.snapshot, coveredSeq, now);
    return;
  }

  const merged = mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );
  store.captureVersion(noteId, merged.snapshot, coveredSeq, now);
}
