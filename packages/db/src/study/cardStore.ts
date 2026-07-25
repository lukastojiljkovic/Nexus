import type Database from "better-sqlite3-multiple-ciphers";
import type { Card as FsrsCard, CardInput, ReviewLogInput } from "ts-fsrs";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { CardNotFoundError, CardValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed FSRS rating domain (ts-fsrs `Grade`): Again, Hard, Good, Easy. Manual (0) is never accepted. */
export type CardRating = 1 | 2 | 3 | 4;

/** Card ratings in Again..Easy order, matching ts-fsrs's `Rating` enum values. */
export const CARD_RATINGS: readonly CardRating[] = [1, 2, 3, 4];

/** Closed FSRS card-state domain (ts-fsrs `State`): New, Learning, Review, Relearning. */
export type CardState = 0 | 1 | 2 | 3;

/**
 * A flashcard as the store returns it: camelCase keys, `front`/`back` plus one
 * field per ts-fsrs `Card` property (STUDY flashcards / FSRS). `lastReview` is
 * `null` before the first review (ts-fsrs leaves it `undefined`).
 */
export interface Card {
  id: string;
  profileId: string;
  deckId: string;
  front: string;
  back: string;
  /** The note this card was generated from, or null for a hand-made card (NOTE-006). */
  sourceNoteId: string | null;
  /** The source note's block key this card reconciles against, or null for a hand-made card (NOTE-006). */
  sourceBlockKey: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  state: CardState;
  lastReview: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a card; scheduling state is seeded from `createEmptyCard`. */
export interface CreateCardInput {
  deckId: string;
  front: string;
  back: string;
}

/**
 * A partial patch of a card's own content/placement fields. An omitted key is
 * left untouched. This never touches FSRS scheduling state — only `review`,
 * `undoLastReview` do that. Soft delete/restore have their own methods.
 */
export interface UpdateCardFields {
  deckId?: string;
  front?: string;
  back?: string;
}

/** The four would-be next due dates for a card, one per rating, without persisting anything. */
export interface PreviewIntervals {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

/** One generated card as the renderer reports it (mirrors `@nexus/core`'s `NoteCardSpec`). */
export interface NoteCardSpecInput {
  key: string;
  front: string;
  back: string;
}

/** What one reconcile changed. A restored-and-rewritten card counts as `updated`. */
export interface SyncFromNoteResult {
  created: number;
  updated: number;
  removed: number;
}

/** Optional scope for `dueQueue`: at most one of `deckId`/`subjectId`, plus a cap on New cards. */
export interface DueQueueOptions {
  deckId?: string;
  subjectId?: string;
  newLimit?: number;
}

/** Per-deck review-queue badge counts (STUDY flashcards). */
export interface DeckCounts {
  deckId: string;
  newCount: number;
  dueCount: number;
}

/**
 * One `review_log` row as the store returns it: camelCase keys, one field per
 * `ts-fsrs` `ReviewLog` property plus the row's own id/card id (IMEX export;
 * mirrors `Card`'s field-for-field idiom for the same reasons).
 */
export interface ReviewLogEntry {
  id: string;
  profileId: string;
  cardId: string;
  rating: CardRating;
  state: CardState;
  due: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  lastElapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  review: string;
  createdAt: string;
}

interface CardRow {
  id: string;
  profile_id: string;
  deck_id: string;
  front: string;
  back: string;
  source_note_id: string | null;
  source_block_key: string | null;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  state: CardState;
  last_review: string | null;
  created_at: string;
  updated_at: string;
}

interface ReviewLogRow {
  id: string;
  card_id: string;
  rating: CardRating;
  state: CardState;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  review: string;
}

interface ReviewLogFullRow extends ReviewLogRow {
  profile_id: string;
  created_at: string;
}

/** One existing generated card, as `syncFromNote`'s reconcile needs to see it — not the full `Card` shape. */
interface SourceCardRow {
  id: string;
  deck_id: string;
  front: string;
  back: string;
  deleted_at: string | null;
  source_block_key: string | null;
}

const CARD_COLUMNS =
  `id, profile_id, deck_id, front, back, source_note_id, source_block_key, due, stability, ` +
  `difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, state, last_review, ` +
  `created_at, updated_at`;

const REVIEW_LOG_FULL_COLUMNS =
  "id, profile_id, card_id, rating, state, due, stability, difficulty, elapsed_days, " +
  "last_elapsed_days, scheduled_days, learning_steps, review, created_at";

const REVIEW_LOG_COLUMNS =
  "id, card_id, rating, state, due, stability, difficulty, elapsed_days, " +
  "last_elapsed_days, scheduled_days, learning_steps, review";

const MAX_TEXT_LENGTH = 10000;
const DEFAULT_NEW_LIMIT = 20;
const MAX_NEW_LIMIT = 100;

/** The renderer batches generated-card specs below this in one `syncFromNote` call; re-checked here (SEC-EL-02). */
const MAX_NOTE_CARD_SPECS = 500;

/** A generated card's reconcile key is a note-authored string, not a uuid — capped, not format-checked. */
const MAX_CARD_KEY_LENGTH = 200;

/** Accepts a full ISO-8601 date-time (the `now` the caller stamps every scheduling call with). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** The FSRS scheduler, at the library's default parameters (default request retention) — no custom tuning (STUDY). */
const scheduler = fsrs();

/**
 * Card + FSRS-review persistence for a single profile, over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `ExamStore`/`DeckStore`: construct one per profile,
 * reuse it. Inputs are revalidated here because the renderer is untrusted
 * (SEC-EL-02), and every statement is scoped by `profile_id` so one profile's
 * cards are invisible to another's store — including the deck foreign key, which
 * must resolve to a non-deleted deck in THIS profile.
 *
 * Every scheduling-related method takes an explicit `now: string` parameter; the
 * store never reads the clock for scheduling decisions, only for `created_at` /
 * `updated_at` bookkeeping stamps (same as every other store).
 */
export class CardStore {
  private readonly insert: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectActiveByDeck: Database.Statement;
  private readonly selectDeck: Database.Statement;
  private readonly selectSubjectActive: Database.Statement;
  private readonly selectNoteActive: Database.Statement;
  private readonly selectCardsBySource: Database.Statement;
  private readonly updateContentFields: Database.Statement;
  private readonly restoreWithContent: Database.Statement;
  private readonly updateScheduling: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly insertReviewLog: Database.Statement;
  private readonly selectLatestReviewLog: Database.Statement;
  private readonly selectAllReviewLog: Database.Statement;
  private readonly deleteReviewLog: Database.Statement;
  private readonly countsByDeckStatement: Database.Statement;
  private readonly dueNoScope: Database.Statement;
  private readonly dueByDeck: Database.Statement;
  private readonly dueBySubject: Database.Statement;
  private readonly newNoScope: Database.Statement;
  private readonly newByDeck: Database.Statement;
  private readonly newBySubject: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, source_note_id, source_block_key,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${CARD_COLUMNS} FROM cards
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveByDeck = db.prepare(
      `SELECT ${CARD_COLUMNS} FROM cards
       WHERE deck_id = ? AND profile_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`,
    );
    this.selectDeck = db.prepare(
      `SELECT id FROM decks WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSubjectActive = db.prepare(
      `SELECT id FROM subjects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The deliberate cross-module read `syncFromNote` needs: a note is untrusted
    // renderer input like any other id, so its existence in THIS profile is
    // re-checked here rather than trusted from the caller (mirrors `selectDeck`).
    this.selectNoteActive = db.prepare(
      `SELECT id FROM notes WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Every row this note has ever generated, active or soft-deleted — `syncFromNote`
    // needs both to tell "restore" apart from "create" and "no-op" apart from "update".
    this.selectCardsBySource = db.prepare(
      `SELECT id, deck_id, front, back, deleted_at, source_block_key FROM cards
       WHERE profile_id = ? AND source_note_id = ?`,
    );
    this.updateContentFields = db.prepare(
      `UPDATE cards SET deck_id = ?, front = ?, back = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Restore + rewrite in one statement (rule 3 of `syncFromNote`'s reconcile):
    // undoing a deleted paragraph brings the same key back, and this is what
    // returns its FSRS state (untouched here) along with the row.
    this.restoreWithContent = db.prepare(
      `UPDATE cards SET deck_id = ?, front = ?, back = ?, deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.updateScheduling = db.prepare(
      `UPDATE cards
         SET due = ?, stability = ?, difficulty = ?, elapsed_days = ?,
             scheduled_days = ?, learning_steps = ?, reps = ?, lapses = ?,
             state = ?, last_review = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE cards SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE cards SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.insertReviewLog = db.prepare(
      `INSERT INTO review_log
         (id, profile_id, card_id, rating, state, due, stability, difficulty,
          elapsed_days, last_elapsed_days, scheduled_days, learning_steps,
          review, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectLatestReviewLog = db.prepare(
      `SELECT ${REVIEW_LOG_COLUMNS} FROM review_log
       WHERE card_id = ? AND profile_id = ?
       ORDER BY review DESC, id DESC
       LIMIT 1`,
    );
    this.selectAllReviewLog = db.prepare(
      `SELECT ${REVIEW_LOG_FULL_COLUMNS} FROM review_log
       WHERE profile_id = ?
       ORDER BY review, id`,
    );
    this.deleteReviewLog = db.prepare(`DELETE FROM review_log WHERE id = ? AND profile_id = ?`);
    this.countsByDeckStatement = db.prepare(
      `SELECT d.id AS deck_id,
              SUM(CASE WHEN c.id IS NOT NULL AND c.state = 0 THEN 1 ELSE 0 END) AS new_count,
              SUM(CASE WHEN c.id IS NOT NULL AND c.state != 0 AND c.due <= ? THEN 1 ELSE 0 END) AS due_count
         FROM decks d
         LEFT JOIN cards c ON c.deck_id = d.id AND c.profile_id = d.profile_id AND c.deleted_at IS NULL
        WHERE d.profile_id = ? AND d.deleted_at IS NULL
        GROUP BY d.id
        ORDER BY d.name, d.id`,
    );

    const dueBase = (scope: string) =>
      `SELECT ${CARD_COLUMNS} FROM cards
       WHERE profile_id = ? AND deleted_at IS NULL AND state != 0 AND due <= ? ${scope}
       ORDER BY due, id`;
    const newBase = (scope: string) =>
      `SELECT ${CARD_COLUMNS} FROM cards
       WHERE profile_id = ? AND deleted_at IS NULL AND state = 0 ${scope}
       ORDER BY created_at, id
       LIMIT ?`;
    const deckScope = "AND deck_id = ?";
    const subjectScope =
      "AND deck_id IN (SELECT id FROM decks WHERE subject_id = ? AND profile_id = ? AND deleted_at IS NULL)";

    this.dueNoScope = db.prepare(dueBase(""));
    this.dueByDeck = db.prepare(dueBase(deckScope));
    this.dueBySubject = db.prepare(dueBase(subjectScope));
    this.newNoScope = db.prepare(newBase(""));
    this.newByDeck = db.prepare(newBase(deckScope));
    this.newBySubject = db.prepare(newBase(subjectScope));
  }

  /** Active cards of one active deck in this profile, ordered by creation (STUDY flashcards). */
  listByDeck(deckId: string): Card[] {
    this.resolveDeck(deckId);
    const rows = this.selectActiveByDeck.all(deckId, this.profileId) as CardRow[];
    return rows.map(toCard);
  }

  /** Inserts a card against a deck in this profile, seeded with a fresh FSRS state at `now`. */
  create(input: CreateCardInput, now: string): Card {
    const validNow = validateNow(now);
    const front = validateText(input.front, "front");
    const back = validateText(input.back, "back");
    const deckId = this.resolveDeck(input.deckId);
    const empty = createEmptyCard(validNow);
    const bookkeepingNow = new Date().toISOString();
    const id = uuidv7();

    this.insert.run(
      id,
      this.profileId,
      deckId,
      front,
      back,
      null,
      null,
      empty.due.toISOString(),
      empty.stability,
      empty.difficulty,
      empty.elapsed_days,
      empty.scheduled_days,
      empty.learning_steps,
      empty.reps,
      empty.lapses,
      empty.state,
      empty.last_review ? empty.last_review.toISOString() : null,
      bookkeepingNow,
      bookkeepingNow,
    );

    return {
      id,
      profileId: this.profileId,
      deckId,
      front,
      back,
      sourceNoteId: null,
      sourceBlockKey: null,
      due: empty.due.toISOString(),
      stability: empty.stability,
      difficulty: empty.difficulty,
      elapsedDays: empty.elapsed_days,
      scheduledDays: empty.scheduled_days,
      learningSteps: empty.learning_steps,
      reps: empty.reps,
      lapses: empty.lapses,
      state: empty.state as CardState,
      lastReview: empty.last_review ? empty.last_review.toISOString() : null,
      createdAt: bookkeepingNow,
      updatedAt: bookkeepingNow,
    };
  }

  /** Applies a partial content/placement patch to an active card; never touches FSRS scheduling state. */
  update(id: string, fields: UpdateCardFields): Card {
    const current = this.requireActive(id);
    const deckId = fields.deckId !== undefined ? this.resolveDeck(fields.deckId) : current.deckId;
    const front = fields.front !== undefined ? validateText(fields.front, "front") : current.front;
    const back = fields.back !== undefined ? validateText(fields.back, "back") : current.back;
    const now = new Date().toISOString();

    this.updateContentFields.run(deckId, front, back, now, current.id, this.profileId);

    return { ...current, deckId, front, back, updatedAt: now };
  }

  /**
   * Reconciles this note's generated cards against `specs` — the renderer's
   * current read of its card-syntax blocks (mirrors `@nexus/core`'s
   * `collectNoteCards`) — inside one transaction, keyed by `source_block_key`,
   * never by any id the renderer supplies (SEC-EL-02): the renderer only ever
   * names a *slot* inside a note it already owns, never a row's own primary
   * key. This is what lets editing a card's text update the same row, FSRS
   * history intact, instead of deleting and recreating it.
   *
   * Reconcile rules, against exactly this `(profile, note)`'s existing rows:
   * a key with no existing row is a fresh card in `deckId`; a key matching an
   * active row rewrites `front`/`back`/`deck_id` only when one of them
   * actually changed (a no-op sync must not disturb `updated_at`); a key
   * matching a *soft-deleted* row restores it with the new content — this is
   * what makes editor undo work, since undoing a deleted paragraph brings the
   * same key back and the card returns with its full review history; a row
   * whose key is no longer present is soft-deleted (`review_log` survives —
   * it is only ever removed by `undoLastReview`). FSRS scheduling columns are
   * never touched by any of these branches.
   *
   * `noteId` is resolved against `notes` directly — the deliberate
   * cross-module read named in `NoteStore.setCardDeck`'s own doc comment —
   * because the renderer is untrusted and the foreign key alone does not
   * scope by profile.
   */
  syncFromNote(
    noteId: string,
    deckId: string,
    specs: readonly NoteCardSpecInput[],
    now: string,
  ): SyncFromNoteResult {
    const validNow = validateNow(now);
    const validNoteId = this.resolveNote(noteId);
    const validDeckId = this.resolveDeck(deckId);
    const validSpecs = validateNoteCardSpecs(specs);

    return this.db.transaction((): SyncFromNoteResult => {
      const existingRows = this.selectCardsBySource.all(
        this.profileId,
        validNoteId,
      ) as SourceCardRow[];
      const byKey = new Map(existingRows.map((row) => [row.source_block_key, row]));
      const incomingKeys = new Set(validSpecs.map((spec) => spec.key));
      const bookkeepingNow = new Date().toISOString();

      let created = 0;
      let updated = 0;
      let removed = 0;

      for (const spec of validSpecs) {
        const row = byKey.get(spec.key);
        if (!row) {
          const empty = createEmptyCard(validNow);
          this.insert.run(
            uuidv7(),
            this.profileId,
            validDeckId,
            spec.front,
            spec.back,
            validNoteId,
            spec.key,
            empty.due.toISOString(),
            empty.stability,
            empty.difficulty,
            empty.elapsed_days,
            empty.scheduled_days,
            empty.learning_steps,
            empty.reps,
            empty.lapses,
            empty.state,
            empty.last_review ? empty.last_review.toISOString() : null,
            bookkeepingNow,
            bookkeepingNow,
          );
          created += 1;
        } else if (row.deleted_at !== null) {
          this.restoreWithContent.run(
            validDeckId,
            spec.front,
            spec.back,
            bookkeepingNow,
            row.id,
            this.profileId,
          );
          updated += 1;
        } else if (row.deck_id !== validDeckId || row.front !== spec.front || row.back !== spec.back) {
          this.updateContentFields.run(
            validDeckId,
            spec.front,
            spec.back,
            bookkeepingNow,
            row.id,
            this.profileId,
          );
          updated += 1;
        }
      }

      for (const row of existingRows) {
        if (row.deleted_at === null && row.source_block_key !== null && !incomingKeys.has(row.source_block_key)) {
          this.markDeleted.run(bookkeepingNow, bookkeepingNow, row.id, this.profileId);
          removed += 1;
        }
      }

      return { created, updated, removed };
    })();
  }

  /** Soft-deletes an active card (reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new CardNotFoundError(`No active card "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted card (undo of a delete). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new CardNotFoundError(`No deleted card "${id}" to restore in this profile.`);
    }
  }

  /**
   * Grades a review: schedules the card via ts-fsrs at `now`, persists the
   * resulting FSRS fields, and appends the corresponding `review_log` row — all
   * in one transaction.
   */
  review(id: string, rating: CardRating, now: string): Card {
    const validRating = validateRating(rating);
    const validNow = validateNow(now);
    const current = this.requireActive(id);

    return this.db.transaction((): Card => {
      const { card: nextCard, log } = scheduler.next(toCardInput(current), validNow, validRating);
      const bookkeepingNow = new Date().toISOString();

      this.updateScheduling.run(
        nextCard.due.toISOString(),
        nextCard.stability,
        nextCard.difficulty,
        nextCard.elapsed_days,
        nextCard.scheduled_days,
        nextCard.learning_steps,
        nextCard.reps,
        nextCard.lapses,
        nextCard.state,
        nextCard.last_review ? nextCard.last_review.toISOString() : null,
        bookkeepingNow,
        current.id,
        this.profileId,
      );

      this.insertReviewLog.run(
        uuidv7(),
        this.profileId,
        current.id,
        log.rating,
        log.state,
        log.due.toISOString(),
        log.stability,
        log.difficulty,
        log.elapsed_days,
        log.last_elapsed_days,
        log.scheduled_days,
        log.learning_steps,
        log.review.toISOString(),
        bookkeepingNow,
      );

      return fsrsCardToCard(current, nextCard, bookkeepingNow);
    })();
  }

  /**
   * Undoes the most recent review of a card: reconstructs the pre-review FSRS
   * state via ts-fsrs's `rollback` and removes the corresponding log row — all in
   * one transaction.
   */
  undoLastReview(id: string, now: string): Card {
    validateNow(now);
    const current = this.requireActive(id);
    const logRow = this.selectLatestReviewLog.get(current.id, this.profileId) as
      | ReviewLogRow
      | undefined;
    if (!logRow) {
      throw new CardValidationError(`No review to undo for card "${id}" in this profile.`);
    }

    return this.db.transaction((): Card => {
      const prevCard = scheduler.rollback(toCardInput(current), toReviewLogInput(logRow));
      const bookkeepingNow = new Date().toISOString();

      this.updateScheduling.run(
        prevCard.due.toISOString(),
        prevCard.stability,
        prevCard.difficulty,
        prevCard.elapsed_days,
        prevCard.scheduled_days,
        prevCard.learning_steps,
        prevCard.reps,
        prevCard.lapses,
        prevCard.state,
        prevCard.last_review ? prevCard.last_review.toISOString() : null,
        bookkeepingNow,
        current.id,
        this.profileId,
      );

      this.deleteReviewLog.run(logRow.id, this.profileId);

      return fsrsCardToCard(current, prevCard, bookkeepingNow);
    })();
  }

  /** The four would-be next due dates for this card at `now`, without persisting anything. */
  previewIntervals(id: string, now: string): PreviewIntervals {
    const validNow = validateNow(now);
    const current = this.requireActive(id);
    const preview = scheduler.repeat(toCardInput(current), validNow);

    return {
      again: preview[Rating.Again].card.due.toISOString(),
      hard: preview[Rating.Hard].card.due.toISOString(),
      good: preview[Rating.Good].card.due.toISOString(),
      easy: preview[Rating.Easy].card.due.toISOString(),
    };
  }

  /**
   * The review queue at `now`: active due (non-New) cards first (by due, id),
   * then up to `newLimit` New cards (by creation order). Optionally scoped to one
   * deck or one subject (via its decks), both same-profile.
   */
  dueQueue(options: DueQueueOptions = {}, now: string): Card[] {
    const validNow = validateNow(now);
    const newLimit = validateNewLimit(options.newLimit);

    if (options.deckId !== undefined) {
      const deckId = this.resolveDeck(options.deckId);
      const dueRows = this.dueByDeck.all(this.profileId, validNow, deckId) as CardRow[];
      const newRows = this.newByDeck.all(this.profileId, deckId, newLimit) as CardRow[];
      return [...dueRows.map(toCard), ...newRows.map(toCard)];
    }

    if (options.subjectId !== undefined) {
      const subjectId = this.resolveSubject(options.subjectId);
      const dueRows = this.dueBySubject.all(
        this.profileId,
        validNow,
        subjectId,
        this.profileId,
      ) as CardRow[];
      const newRows = this.newBySubject.all(
        this.profileId,
        subjectId,
        this.profileId,
        newLimit,
      ) as CardRow[];
      return [...dueRows.map(toCard), ...newRows.map(toCard)];
    }

    const dueRows = this.dueNoScope.all(this.profileId, validNow) as CardRow[];
    const newRows = this.newNoScope.all(this.profileId, newLimit) as CardRow[];
    return [...dueRows.map(toCard), ...newRows.map(toCard)];
  }

  /** Per active deck of this profile: New-state card count, and non-New cards due by `now`. */
  countsByDeck(now: string): DeckCounts[] {
    const validNow = validateNow(now);
    const rows = this.countsByDeckStatement.all(validNow, this.profileId) as {
      deck_id: string;
      new_count: number;
      due_count: number;
    }[];
    return rows.map((row) => ({
      deckId: row.deck_id,
      newCount: row.new_count,
      dueCount: row.due_count,
    }));
  }

  /**
   * Every `review_log` row of this profile (IMEX full export), ordered by
   * review timestamp then id. `review_log` already carries its own
   * `profile_id` column (migration 006), so this scopes directly rather than
   * joining through cards/decks/subjects.
   */
  listReviewLog(): ReviewLogEntry[] {
    const rows = this.selectAllReviewLog.all(this.profileId) as ReviewLogFullRow[];
    return rows.map(toReviewLogEntry);
  }

  /** Reads an active card in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Card {
    const row = this.selectActiveById.get(id, this.profileId) as CardRow | undefined;
    if (!row) {
      throw new CardNotFoundError(`No active card "${id}" in this profile.`);
    }
    return toCard(row);
  }

  /**
   * Validates a deck id references a non-deleted deck in this profile (mirrors
   * `ExamStore.resolveSubject`): the same-profile scope on the lookup is what
   * stops a card from pointing at another profile's deck.
   */
  private resolveDeck(deckId: string): string {
    const deck = this.selectDeck.get(deckId, this.profileId);
    if (!deck) {
      throw new CardValidationError(`deckId "${deckId}" does not reference a deck in this profile.`);
    }
    return deckId;
  }

  /** Validates a subject id references a non-deleted subject in this profile (for `dueQueue`'s subject filter). */
  private resolveSubject(subjectId: string): string {
    const subject = this.selectSubjectActive.get(subjectId, this.profileId);
    if (!subject) {
      throw new CardValidationError(
        `subjectId "${subjectId}" does not reference a subject in this profile.`,
      );
    }
    return subjectId;
  }

  /** Validates a note id references a non-deleted note in this profile (`syncFromNote`'s cross-module read). */
  private resolveNote(noteId: string): string {
    const note = this.selectNoteActive.get(noteId, this.profileId);
    if (!note) {
      throw new CardValidationError(`noteId "${noteId}" does not reference a note in this profile.`);
    }
    return noteId;
  }
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    profileId: row.profile_id,
    deckId: row.deck_id,
    front: row.front,
    back: row.back,
    sourceNoteId: row.source_note_id,
    sourceBlockKey: row.source_block_key,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    lastReview: row.last_review,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toReviewLogEntry(row: ReviewLogFullRow): ReviewLogEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    cardId: row.card_id,
    rating: row.rating,
    state: row.state,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsedDays: row.elapsed_days,
    lastElapsedDays: row.last_elapsed_days,
    scheduledDays: row.scheduled_days,
    learningSteps: row.learning_steps,
    review: row.review,
    createdAt: row.created_at,
  };
}

/** Builds a ts-fsrs `CardInput` from our stored card row (dates pass through as ISO strings). */
function toCardInput(card: Card): CardInput {
  return {
    due: card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    learning_steps: card.learningSteps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.lastReview,
  };
}

/** Builds a ts-fsrs `ReviewLogInput` from our stored review_log row (dates pass through as ISO strings). */
function toReviewLogInput(row: ReviewLogRow): ReviewLogInput {
  return {
    rating: row.rating,
    state: row.state,
    due: row.due,
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: row.elapsed_days,
    last_elapsed_days: row.last_elapsed_days,
    scheduled_days: row.scheduled_days,
    learning_steps: row.learning_steps,
    review: row.review,
  };
}

/** Merges a ts-fsrs `Card` scheduling result back onto our stored fields (id/content untouched). */
function fsrsCardToCard(previous: Card, next: FsrsCard, updatedAt: string): Card {
  return {
    ...previous,
    due: next.due.toISOString(),
    stability: next.stability,
    difficulty: next.difficulty,
    elapsedDays: next.elapsed_days,
    scheduledDays: next.scheduled_days,
    learningSteps: next.learning_steps,
    reps: next.reps,
    lapses: next.lapses,
    state: next.state as CardState,
    lastReview: next.last_review ? next.last_review.toISOString() : null,
    updatedAt,
  };
}

function validateText(value: string, field: "front" | "back"): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CardValidationError(`Card "${field}" must not be empty.`);
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new CardValidationError(`Card "${field}" must be at most ${MAX_TEXT_LENGTH} characters.`);
  }
  return trimmed;
}

function validateNow(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new CardValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}

function validateRating(value: CardRating): CardRating {
  if (!(CARD_RATINGS as readonly number[]).includes(value)) {
    throw new CardValidationError(`"${value}" is not a valid review rating (expected 1-4).`);
  }
  return value;
}

/**
 * Revalidates one `syncFromNote` call's specs end to end before anything is
 * written (SEC-EL-02 — `@nexus/core`'s parser already guarantees all of
 * this, but the renderer is untrusted): a bounded batch, each key a non-empty
 * bounded string, each side through the existing `validateText`, and no two
 * specs sharing a key — a duplicate would make the reconcile's per-key
 * dedupe silently drop one of the caller's edits.
 */
function validateNoteCardSpecs(specs: readonly NoteCardSpecInput[]): NoteCardSpecInput[] {
  if (specs.length > MAX_NOTE_CARD_SPECS) {
    throw new CardValidationError(`A note may sync at most ${MAX_NOTE_CARD_SPECS} cards in one call.`);
  }

  const seenKeys = new Set<string>();
  return specs.map((spec) => {
    if (
      typeof spec.key !== "string" ||
      spec.key.length === 0 ||
      spec.key.length > MAX_CARD_KEY_LENGTH
    ) {
      throw new CardValidationError(
        `A generated card key must be a non-empty string of at most ${MAX_CARD_KEY_LENGTH} characters.`,
      );
    }
    if (seenKeys.has(spec.key)) {
      throw new CardValidationError(`Duplicate generated card key "${spec.key}" in one syncFromNote call.`);
    }
    seenKeys.add(spec.key);

    return { key: spec.key, front: validateText(spec.front, "front"), back: validateText(spec.back, "back") };
  });
}

function validateNewLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_NEW_LIMIT;
  if (!Number.isInteger(value) || value < 0 || value > MAX_NEW_LIMIT) {
    throw new CardValidationError(`"newLimit" must be an integer between 0 and ${MAX_NEW_LIMIT}.`);
  }
  return value;
}
