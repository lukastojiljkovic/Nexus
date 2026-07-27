import * as Y from "yjs";
import { collectNoteCards, mergeNoteState } from "@nexus/core";
import type { NoteCardSpec } from "@nexus/core";
import { CardValidationError } from "@nexus/db";
import type { CardStore, NoteMeta, NoteStore } from "@nexus/db";
import { NOTE_CARDS_MAX_COUNT } from "../shared/ipc.js";

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
 *
 * `healNote`/`healNotes` are a third policy living here for the same reason: a
 * one-time repair sweep for what a since-fixed bug in the text walks left
 * corrupted — mark-up leaking into `note_snapshots.plaintext` (which SRCH
 * indexes and snippets directly) and into the text of generated flashcards —
 * in notes the edit-triggered paths will never revisit because nobody happens
 * to edit them again.
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

/** One profile's stores, as the healing sweep needs them: notes to re-derive from, cards to repair. */
export interface HealingStores {
  notes: NoteStore;
  cards: CardStore;
}

/**
 * Heals one note's two *derived* artefacts from its own persisted state —
 * snapshot + pending updates already in the DB, no renderer bytes involved,
 * the same shape `captureNoteVersion` reads. The document is merged once and
 * both derivations are recomputed from it:
 *
 * - the stored plaintext SRCH indexes and snippets from, rewritten only when
 *   it actually differs. Comparing first — rather than always recompacting —
 *   is what keeps this from churning migration 017's FTS triggers (every
 *   `note_snapshots` write fires them) on every launch once a note is healed.
 * - the flashcards the note's blocks generate, when it is mapped to a deck.
 *   Reconciled by `source_block_key`, so a repaired side updates the same row
 *   with its FSRS history intact (ADR-017), and an already-correct note
 *   reconciles to nothing — `syncFromNote` leaves `updated_at` alone when
 *   neither side changed.
 *
 * Deliberately does NOT capture a version checkpoint the way `runCompaction`
 * does: this repairs derived data, it is not a user edit, and manufacturing a
 * checkpoint for it would misrepresent the note's actual history.
 *
 * Returns whether anything was written.
 */
export function healNote(stores: HealingStores, note: NoteMeta): boolean {
  const read = stores.notes.readForCompaction(note.id);
  const coveredSeq = read.updates.at(-1)?.seq ?? read.coveredSeq;
  if (coveredSeq === 0) return false; // nothing persisted yet — nothing to derive from

  const merged = mergeNoteState(
    read.snapshot,
    read.updates.map((update) => update.bytes),
  );

  let wrote = false;
  if (merged.plaintext !== stores.notes.storedPlaintext(note.id)) {
    stores.notes.compact(
      note.id,
      merged.snapshot,
      merged.plaintext,
      coveredSeq,
      new Date().toISOString(),
    );
    wrote = true;
  }

  if (note.cardDeckId !== null) {
    wrote = healNoteCards(stores.cards, note.id, note.cardDeckId, merged.snapshot) || wrote;
  }
  return wrote;
}

/**
 * The card half of `healNote`, kept separate for its one load-bearing rule:
 * an EMPTY parse is never synced. `syncFromNote` soft-deletes every card whose
 * key the specs no longer carry — correct when the editor reports it, because
 * the user really did delete those blocks, but here the specs come from a
 * background re-read, and anything that made this document parse to nothing
 * (a merge that failed, a schema we no longer understand) would silently empty
 * the note's deck. A note that genuinely lost its last card block is
 * reconciled by its next edit, exactly as before this sweep existed.
 */
function healNoteCards(
  cards: CardStore,
  noteId: string,
  deckId: string,
  state: Uint8Array,
): boolean {
  const specs = parseCardsFromState(state);
  if (specs.length === 0) return false;

  try {
    const result = cards.syncFromNote(noteId, deckId, specs, new Date().toISOString());
    return result.created + result.updated + result.removed > 0;
  } catch (error) {
    // A note still pointing at a deck the user has since deleted: soft-deleting
    // a deck leaves `notes.card_deck_id` alone (no FK action fires on it), so
    // this is an ordinary, permanent state — not a fault worth logging on
    // every unlock for the rest of the note's life. Anything else is.
    if (error instanceof CardValidationError) return false;
    throw error;
  }
}

/** The cards a merged snapshot's blocks author, capped exactly as the editor caps its own report, with the throwaway document always released. */
function parseCardsFromState(state: Uint8Array): NoteCardSpec[] {
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    return collectNoteCards(doc).slice(0, NOTE_CARDS_MAX_COUNT);
  } finally {
    doc.destroy();
  }
}

/**
 * Walks every note of every profile once, healing each (`healNote`) — the
 * one-time repair for whatever a since-fixed derivation walk left corrupted in
 * `note_snapshots.plaintext` and in generated flashcard text, for notes nobody
 * happens to edit again (which would otherwise never revisit the editor's own
 * report path and so would carry the corruption forever).
 *
 * `stillThisSession` is checked before every single note — not just once per
 * store — and the pass yields to the event loop between notes, so a sweep
 * across thousands of notes can never block the main process, and stops the
 * instant the database it is reading has been locked (or superseded by a newer
 * unlock) out from under it: the same background-work-outliving-a-lock hazard
 * `cancelIdleCompactions` exists for. A per-note failure (the note was deleted
 * concurrently, say) is logged and skipped rather than aborting the whole
 * sweep. Returns how many notes were actually written to.
 */
export async function healNotes(
  stores: Iterable<HealingStores>,
  stillThisSession: () => boolean,
): Promise<number> {
  let healed = 0;
  for (const profileStores of stores) {
    // Guarded before `list()` too, not only per note: a lock during the
    // previous profile's sweep would otherwise make this read throw against a
    // closed connection rather than simply stopping.
    if (!stillThisSession()) return healed;
    for (const note of profileStores.notes.list()) {
      if (!stillThisSession()) return healed;
      try {
        if (healNote(profileStores, note)) healed++;
      } catch (error) {
        console.error(`Healing note "${note.id}" failed:`, error);
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
  return healed;
}
