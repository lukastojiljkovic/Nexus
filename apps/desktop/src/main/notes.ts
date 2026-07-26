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
 * Idle debounce (ms) before a note's pending updates are folded into a fresh
 * snapshot even below `COMPACTION_THRESHOLD` (ADR-021 / PRD 08 SRCH-002). A
 * note's searchable BODY comes from `note_snapshots.plaintext`, which
 * otherwise only refreshes once `COMPACTION_THRESHOLD` updates pile up — an
 * entire session's worth of typing, against SRCH-002's "updates within 1 s of
 * an edit" (titles are always current; they come from `notes:append-update`'s
 * own `title` argument, never from the snapshot). Scheduled from
 * `notesAppendUpdate` via `scheduleIdleCompaction` and reset on every further
 * keystroke, so continuous typing keeps pushing it out until the user
 * actually pauses.
 */
export const IDLE_COMPACTION_MS = 2_000;

/**
 * Shared merge/capture body for `compactIfNeeded` and `compactNow`: reads the
 * pending updates, merges them purely with the stored snapshot, hands the
 * result to the store's atomic `compact` with the last update's seq as the
 * new `covered_seq`, and self-heals the version-history checkpoint (ADR-015)
 * on top — if the note has no checkpoint yet, or its latest one is older
 * than `VERSION_MIN_AGE_MS`, the freshly merged snapshot is captured as a new
 * version too. A no-op when there is nothing pending.
 */
function runCompaction(store: NoteStore, noteId: string): void {
  const { snapshot, updates } = store.readForCompaction(noteId);
  const last = updates.at(-1);
  if (!last) return; // nothing pending — nothing to fold

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
 * Folds a note's pending updates into a fresh snapshot once they reach
 * `COMPACTION_THRESHOLD` — called after every `notes:append-update`, so the
 * log never grows unboundedly. A no-op below the threshold. See
 * `runCompaction` for what the fold itself does, including the
 * version-history self-heal.
 */
export function compactIfNeeded(store: NoteStore, noteId: string): void {
  if (store.countPendingUpdates(noteId) < COMPACTION_THRESHOLD) return;
  runCompaction(store, noteId);
}

/**
 * The same fold `compactIfNeeded` does, WITHOUT the `COMPACTION_THRESHOLD`
 * gate — run once `IDLE_COMPACTION_MS` has passed since the note's last edit
 * (`scheduleIdleCompaction`), so a note's searchable body catches up even in
 * a session that never crosses the threshold. This changes compaction
 * CADENCE only: the version-history capture inside `runCompaction` keeps its
 * own `VERSION_MIN_AGE_MS` gate untouched, and a note with nothing pending is
 * still a no-op (never rewrites a snapshot for nothing).
 */
export function compactNow(store: NoteStore, noteId: string): void {
  runCompaction(store, noteId);
}

/**
 * Per-key debounce timers for `scheduleIdleCompaction`/`cancelIdleCompactions`.
 * Deliberately owns no store reference — only a caller-defined key (main uses
 * `${profileId}:${noteId}`) and the callback to run — so `cancelIdleCompactions`
 * can drop every pending timer on lock without needing to know anything about
 * what each one would have done or which database it targeted.
 */
const idleCompactionTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Schedules `run` to fire after `IDLE_COMPACTION_MS`, replacing any timer
 * already pending for the same `key` — continuous typing on the same note
 * keeps pushing its idle compaction out rather than piling up duplicate
 * timers.
 */
export function scheduleIdleCompaction(key: string, run: () => void): void {
  const existing = idleCompactionTimers.get(key);
  if (existing) clearTimeout(existing);
  idleCompactionTimers.set(
    key,
    setTimeout(() => {
      idleCompactionTimers.delete(key);
      try {
        run();
      } catch (error) {
        // A throw inside a timer is an uncaughtException — it takes the whole
        // main process down, with no renderer call to surface it to. And this
        // one is reachable by an ordinary action: edit a note, delete it
        // within the debounce, and the compaction finds no active note.
        // Losing one background compaction is nothing; the next edit (or the
        // threshold path) folds those updates anyway.
        console.error(`Idle compaction for "${key}" failed:`, error);
      }
    }, IDLE_COMPACTION_MS),
  );
}

/**
 * Clears every pending idle-compaction timer. Called on lock (and app quit):
 * a timer left running would otherwise fire against a database the lock just
 * closed, throwing where nothing can observe it AND holding open exactly the
 * kind of background work a lock is supposed to stop.
 */
export function cancelIdleCompactions(): void {
  for (const timer of idleCompactionTimers.values()) clearTimeout(timer);
  idleCompactionTimers.clear();
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
