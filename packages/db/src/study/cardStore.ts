import type Database from "better-sqlite3-multiple-ciphers";
import type { Card as FsrsCard, CardInput, ReviewLogInput } from "ts-fsrs";
import { createEmptyCard, fsrs, Rating } from "ts-fsrs";
import { findClozeRuns, renderClozeCard, renderProblemBack, splitProblemSteps } from "@nexus/core";
import { CardNotFoundError, CardValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { MAX_NEW_PER_DAY, StudySettingsStore } from "./studySettingsStore.js";

type DatabaseHandle = Database.Database;

/**
 * Closed card-kind domain, mirroring the `cards.kind` CHECK of migration 031
 * (ADR-042). A `cloze` card keeps rendered `front`/`back` like any other card
 * — that is what lets the search index, the palette, the deck list and every
 * export keep reading cards without knowing this kind exists.
 */
export type CardKind = "basic" | "cloze";

/** Card kinds in schema order. */
export const CARD_KINDS: readonly CardKind[] = ["basic", "cloze"];

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
  /** What kind of card this row is (ADR-042). `basic` for a plain front/back card. */
  kind: CardKind;
  /**
   * For a `cloze` card: the raw `{{…}}` template `front`/`back` are DERIVED
   * from, and the only text the user ever edits. Null for a `basic` card —
   * both cloze fields are set exactly when `kind` is `cloze`.
   */
  clozeText: string | null;
  /** For a `cloze` card: which deletion of `clozeText` this row asks (0-based). */
  clozeOrdinal: number | null;
  /**
   * A problem card's worked solution in the `--` grammar of `@nexus/core`'s
   * `problemSteps.ts` — the SOURCE `back` is derived from (ADR-046). Null for
   * a card with no worked solution; never set on a `cloze` card, whose back
   * already has a source. A problem card is a `basic` card with this column
   * set, not a third kind.
   */
  problemSteps: string | null;
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
 *
 * `front`/`back` and `clozeText` are mutually exclusive by KIND, not by call
 * (ADR-042): a `basic` card takes the first pair and refuses the second, a
 * `cloze` card takes only `clozeText` and re-derives its own sides from it.
 * `deckId` applies to both.
 */
export interface UpdateCardFields {
  deckId?: string;
  front?: string;
  back?: string;
  /** A cloze card's new template. Its own ordinal must still exist in it, or the update is refused. */
  clozeText?: string;
  /**
   * A basic card's worked solution (ADR-046). A string SETS the steps and
   * re-derives `back` from them; `null` CLEARS them, leaving a plain basic
   * card — no kind changes either way, because a problem card minus its steps
   * is a basic card. Refused on a `cloze` card.
   */
  problemSteps?: string | null;
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
  kind: CardKind;
  clozeText: string | null;
  clozeOrdinal: number | null;
}

/** What one reconcile changed. A restored-and-rewritten card counts as `updated`. */
export interface SyncFromNoteResult {
  created: number;
  updated: number;
  removed: number;
}

/**
 * Optional scope for `dueQueue`: at most one of `deckId`/`subjectId`/`deckIds`
 * — supplying two is refused, not silently resolved in favour of one — plus the
 * problems-only filter and a cap on New cards.
 */
export interface DueQueueOptions {
  deckId?: string;
  subjectId?: string;
  /**
   * A SET of decks to draw from (ADR-047, interleaved practice): the topic-shaped
   * selection the practice dialog builds. Ids that name no live deck of this
   * profile simply match nothing — a selection assembled in the renderer can go
   * stale between opening the dialog and pressing „Počni".
   */
  deckIds?: readonly string[];
  /**
   * Keep only problem cards — rows with a worked solution (ADR-046). It cannot
   * be expressed as a `kind` filter: a problem card's kind is `basic`, and the
   * steps column is what makes it a problem.
   */
  problemsOnly?: boolean;
  /**
   * How many New cards the queue may offer. OMITTED means the profile's own
   * stored `new_per_day` (STUDY-007), which is what the reviewer always sends —
   * an explicit value is an override for a caller that knows better, and is
   * bounded by the same 0..`MAX_NEW_PER_DAY` the setting is.
   */
  newLimit?: number;
}

/**
 * What one `dueQueue` call answers with: the cards, and whether the profile's
 * daily review cap (STUDY-007) cut the due section short.
 *
 * `capReached` is a fact about the QUEUE, not about the setting: it is true only
 * when a cap is set AND there were more due cards than today's remaining
 * allowance. A profile that simply has nothing due gets `false` — "you are
 * finished" and "you have hit your ceiling" are different things to tell
 * someone, and the end-of-session summary says the second one out loud.
 */
export interface ReviewQueue {
  cards: Card[];
  capReached: boolean;
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
  kind: CardKind;
  cloze_text: string | null;
  cloze_ordinal: number | null;
  problem_steps: string | null;
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
  kind: CardKind;
  cloze_text: string | null;
  cloze_ordinal: number | null;
  problem_steps: string | null;
  deleted_at: string | null;
  source_block_key: string | null;
}

const CARD_COLUMN_NAMES = [
  "id", "profile_id", "deck_id", "front", "back", "source_note_id", "source_block_key",
  "kind", "cloze_text", "cloze_ordinal", "problem_steps", "due", "stability", "difficulty",
  "elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses", "state",
  "last_review", "created_at", "updated_at",
] as const;

const CARD_COLUMNS = CARD_COLUMN_NAMES.join(", ");

/** The same list qualified for the queue's `cards c JOIN decks d` (see `queueSql`). */
const QUEUE_CARD_COLUMNS = CARD_COLUMN_NAMES.map((name) => `c.${name}`).join(", ");

const REVIEW_LOG_FULL_COLUMNS =
  "id, profile_id, card_id, rating, state, due, stability, difficulty, elapsed_days, " +
  "last_elapsed_days, scheduled_days, learning_steps, review, created_at";

const REVIEW_LOG_COLUMNS =
  "id, card_id, rating, state, due, stability, difficulty, elapsed_days, " +
  "last_elapsed_days, scheduled_days, learning_steps, review";

const MAX_TEXT_LENGTH = 10000;

/**
 * The most decks one `deckIds` practice scope may name (ADR-047). The dialog
 * offers a single subject's decks, so this is headroom rather than a limit
 * anyone meets — it exists so an untrusted caller cannot ask for an unbounded
 * `IN (…)` placeholder run.
 */
export const MAX_QUEUE_DECK_IDS = 100;

/**
 * Both queue sections read `cards` JOINED to `decks`, so a soft-deleted deck's
 * cards can never reach a session — not even an UNSCOPED one, which used to
 * skip the join entirely and surface them (the `statsStore` join idiom). An
 * ARCHIVED subject is deliberately NOT filtered: archiving hides a subject from
 * the hub, it does not retire what it taught.
 */
const QUEUE_FROM =
  `FROM cards c
     JOIN decks d ON d.id = c.deck_id AND d.profile_id = c.profile_id AND d.deleted_at IS NULL`;

/** Due (non-New) cards at `now`, oldest due first: `(profileId, now, …scope)`. */
const dueQueueSql = (scope: string): string =>
  `SELECT ${QUEUE_CARD_COLUMNS} ${QUEUE_FROM}
    WHERE c.profile_id = ? AND c.deleted_at IS NULL AND c.state != 0 AND c.due <= ? ${scope}
    ORDER BY c.due, c.id`;

/**
 * The same due section under a daily review cap (STUDY-007): `(profileId, now,
 * …scope, limit)`. A separate shape rather than a `LIMIT -1` on the one above,
 * so an uncapped profile's statement is byte-identical to what it always was —
 * and so the capped one asks the database for what it will actually hand out
 * plus the single row that proves there was more.
 */
const cappedDueQueueSql = (scope: string): string => `${dueQueueSql(scope)}\n    LIMIT ?`;

/** New cards in creation order, capped: `(profileId, …scope, newLimit)`. */
const newQueueSql = (scope: string): string =>
  `SELECT ${QUEUE_CARD_COLUMNS} ${QUEUE_FROM}
    WHERE c.profile_id = ? AND c.deleted_at IS NULL AND c.state = 0 ${scope}
    ORDER BY c.created_at, c.id
    LIMIT ?`;

/** ADR-046: a problem card is a `basic` card that carries a worked solution, so this is the only predicate that can name one. */
const PROBLEMS_ONLY_SCOPE = "AND c.problem_steps IS NOT NULL";

/** The renderer batches generated-card specs below this in one `syncFromNote` call; re-checked here (SEC-EL-02). */
const MAX_NOTE_CARD_SPECS = 500;

/** A generated card's reconcile key is a note-authored string, not a uuid — capped, not format-checked. */
const MAX_CARD_KEY_LENGTH = 200;

/** Accepts a full ISO-8601 date-time (the `now` the caller stamps every scheduling call with). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** A configured ts-fsrs scheduler. Named off `fsrs` itself so nothing here depends on which class the library exports. */
type Scheduler = ReturnType<typeof fsrs>;

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
  /**
   * The queue's statements, keyed by their own SQL. Unlike every statement
   * above, `dueQueue`'s shape varies — with which scope it was asked for, with
   * whether it is problems-only, and with HOW MANY decks a deck-set scope names
   * (ADR-047) — so they cannot all be prepared up front. Each distinct shape is
   * still prepared exactly once and reused for the life of the store, and every
   * VALUE stays bound (SEC-API-03): the only thing built into the text is the
   * `?` placeholder run.
   */
  private readonly queueStatements = new Map<string, Database.Statement>();
  private readonly countReviewsInDay: Database.Statement;

  /**
   * This profile's scheduling preferences (STUDY-007). Read THROUGH on every
   * scheduling call rather than snapshotted in the constructor: main builds a
   * fresh `CardStore` per IPC call, so a snapshot would be no cache at all —
   * and a store that outlives a settings write must not keep scheduling at the
   * retention the user just changed.
   */
  private readonly settings: StudySettingsStore;

  /**
   * The scheduler built for the retention currently stored, kept until that
   * number changes. One slot, not a map: a store is scoped to one profile, and
   * one profile has one retention — so this is a memo of the ts-fsrs parameter
   * generation, not a cache with an invalidation problem. A settings write is
   * picked up on the very next call, because the KEY is the value itself.
   */
  private schedulerFor: { retention: number; instance: Scheduler } | null = null;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.settings = new StudySettingsStore(db, profileId);
    this.insert = db.prepare(
      `INSERT INTO cards
         (id, profile_id, deck_id, front, back, source_note_id, source_block_key,
          kind, cloze_text, cloze_ordinal, problem_steps,
          due, stability, difficulty, elapsed_days, scheduled_days, learning_steps,
          reps, lapses, state, last_review, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
      `SELECT id, deck_id, front, back, kind, cloze_text, cloze_ordinal, problem_steps,
              deleted_at, source_block_key
       FROM cards
       WHERE profile_id = ? AND source_note_id = ?`,
    );
    // Content and KIND move together: a note-derived cloze row upgrades in
    // place on its note's next sync (ADR-042), and an edit to a hand-made
    // cloze card rewrites the template plus the sides re-derived from it.
    // Nothing writes one without the other, which is what keeps the CHECK
    // constraints of migration 031 unreachable from here. `problem_steps`
    // (ADR-046) rides along for the same reason: it is the other source `back`
    // can be derived from, so it must never be left over from a previous one.
    this.updateContentFields = db.prepare(
      `UPDATE cards
         SET deck_id = ?, front = ?, back = ?, kind = ?, cloze_text = ?, cloze_ordinal = ?,
             problem_steps = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // Restore + rewrite in one statement (rule 3 of `syncFromNote`'s reconcile):
    // undoing a deleted paragraph brings the same key back, and this is what
    // returns its FSRS state (untouched here) along with the row.
    this.restoreWithContent = db.prepare(
      `UPDATE cards
         SET deck_id = ?, front = ?, back = ?, kind = ?, cloze_text = ?, cloze_ordinal = ?,
             problem_steps = ?, deleted_at = NULL, updated_at = ?
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
    // The daily review cap's own count (STUDY-007), over migration 034's
    // `review_log_profile_review` index. A half-open window, so a review logged
    // at exactly midnight belongs to the day that starts there and to no other.
    this.countReviewsInDay = db.prepare(
      `SELECT count(*) AS n FROM review_log
        WHERE profile_id = ? AND review >= ? AND review < ?`,
    );
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
    const bookkeepingNow = new Date().toISOString();

    return this.insertNew(
      { deckId, front, back, kind: "basic", clozeText: null, clozeOrdinal: null },
      validNow,
      bookkeepingNow,
    );
  }

  /**
   * Creates one card per `{{…}}` deletion of `text`, in ordinal order, inside
   * ONE transaction (ADR-042): a template that yields three deletions lands
   * three siblings or none at all — a partially-created cloze is a card set
   * the user would have to notice was incomplete.
   *
   * The caller supplies only the template. Every row's `front`/`back` is
   * DERIVED here, by the same `renderClozeCard` the note generator and the
   * reviewer read, so the sides a cloze row stores can never disagree with its
   * own template. Refuses a text with no deletion at all — that is not a cloze
   * card, it is a sentence — and re-checks every derived side, plus the
   * template itself, against the existing text cap.
   *
   * After creation the siblings are ordinary, independent rows: editing one
   * edits one. That is a deliberate divergence from Anki's linked siblings —
   * the card row is Nexus's unit of study, and a cross-row rewrite would mean
   * one edit silently rescheduling cards the user was not looking at.
   */
  createCloze(deckId: string, text: string, now: string): Card[] {
    const validNow = validateNow(now);
    const template = validateClozeText(text);
    const validDeckId = this.resolveDeck(deckId);
    const ordinals = findClozeRuns(template).map((_, ordinal) => ordinal);
    if (ordinals.length === 0) {
      throw new CardValidationError("A cloze card needs at least one {{…}} deletion.");
    }

    // Rendered and length-checked BEFORE the transaction opens: an over-long
    // side is a validation answer, not a rollback.
    const sides = ordinals.map((ordinal) => {
      const rendered = renderClozeCard(template, ordinal);
      if (rendered === null) {
        throw new CardValidationError(`Cloze deletion ${ordinal} is not present in this text.`);
      }
      return {
        ordinal,
        front: validateText(rendered.front, "front"),
        back: validateText(rendered.back, "back"),
      };
    });

    return this.db.transaction((): Card[] => {
      // One millisecond apart, ascending by ordinal, rather than one shared
      // stamp for the whole transaction. `listByDeck` orders by
      // `(created_at, id)`, and `uuidv7`'s sub-millisecond bits are random —
      // identical stamps would leave siblings in an ARBITRARY order in the
      // deck list, which for a three-blank template is simply wrong on screen.
      // Creation order is also the true answer here: ordinal 0 was authored
      // first.
      const base = Date.now();
      return sides.map((side) =>
        this.insertNew(
          {
            deckId: validDeckId,
            front: side.front,
            back: side.back,
            kind: "cloze",
            clozeText: template,
            clozeOrdinal: side.ordinal,
          },
          validNow,
          new Date(base + side.ordinal).toISOString(),
        ),
      );
    })();
  }

  /**
   * Creates a problem card (ADR-046): a `basic` card whose worked solution is
   * kept in `problem_steps`, with `back` DERIVED from it here by the same
   * `renderProblemBack` the editor counts steps with and the reviewer reveals
   * them by. The caller sends the statement and the solution; it never sends a
   * `back`, exactly as `createCloze`'s caller never sends the sides.
   *
   * There is no third kind and no atomicity problem to solve: one call makes
   * one row. What it does refuse is a solution holding no step at all — a
   * text of nothing but separators renders an empty `back`, which is not a
   * card — and anything past the existing per-column text cap.
   */
  createProblem(deckId: string, front: string, stepsText: string, now: string): Card {
    const validNow = validateNow(now);
    const validFront = validateText(front, "front");
    const steps = validateProblemSteps(stepsText);
    const validDeckId = this.resolveDeck(deckId);
    const back = validateText(renderProblemBack(steps), "back");

    return this.insertNew(
      {
        deckId: validDeckId,
        front: validFront,
        back,
        kind: "basic",
        clozeText: null,
        clozeOrdinal: null,
        problemSteps: steps,
      },
      validNow,
      new Date().toISOString(),
    );
  }

  /**
   * Applies a partial content/placement patch to an active card; never touches
   * FSRS scheduling state.
   *
   * Which text fields are accepted is decided by the ROW's kind, not by the
   * caller (ADR-042). A `cloze` card's sides are derived, so it refuses a
   * direct `front`/`back` write and takes `clozeText` instead, re-deriving its
   * own two sides from the new template — and refuses a template in which its
   * own ordinal no longer exists, because a card must not silently die under
   * an edit. A `basic` card is untouched by any of this and refuses
   * `clozeText`.
   *
   * A `basic` card additionally takes `problemSteps` (ADR-046), which sets or
   * clears its worked solution and re-derives `back` when it sets one. Both
   * directions are ordinary edits of one row, not identity changes: a problem
   * card minus its steps IS a basic card, so nothing about the question this
   * row's FSRS history belongs to has moved.
   */
  update(id: string, fields: UpdateCardFields): Card {
    const current = this.requireActive(id);
    const deckId = fields.deckId !== undefined ? this.resolveDeck(fields.deckId) : current.deckId;
    const content = this.resolveUpdatedContent(current, fields);
    const now = new Date().toISOString();

    this.updateContentFields.run(
      deckId,
      content.front,
      content.back,
      current.kind,
      content.clozeText,
      current.clozeOrdinal,
      content.problemSteps,
      now,
      current.id,
      this.profileId,
    );

    return { ...current, deckId, ...content, updatedAt: now };
  }

  /** The `front`/`back`/`clozeText`/`problemSteps` an `update` lands, per the row's own kind. */
  private resolveUpdatedContent(
    current: Card,
    fields: UpdateCardFields,
  ): { front: string; back: string; clozeText: string | null; problemSteps: string | null } {
    if (current.kind !== "cloze") {
      if (fields.clozeText !== undefined) {
        throw new CardValidationError('"clozeText" may only be set on a cloze card.');
      }
      const front =
        fields.front !== undefined ? validateText(fields.front, "front") : current.front;

      // Steps GIVEN: they own the back, so an explicit `back` in the same call
      // would be a second, contradicting answer for one card.
      if (typeof fields.problemSteps === "string") {
        if (fields.back !== undefined) {
          throw new CardValidationError(
            'A problem card\'s "back" is derived from its steps and cannot be set in the same update.',
          );
        }
        const steps = validateProblemSteps(fields.problemSteps);
        return {
          front,
          back: validateText(renderProblemBack(steps), "back"),
          clozeText: null,
          problemSteps: steps,
        };
      }

      // Steps CLEARED (null) or untouched (omitted). Clearing keeps the answer
      // the user could already see: the derived solution simply becomes an
      // ordinary hand-editable `back`.
      return {
        front,
        back: fields.back !== undefined ? validateText(fields.back, "back") : current.back,
        clozeText: null,
        problemSteps: fields.problemSteps === undefined ? current.problemSteps : null,
      };
    }

    if (fields.front !== undefined || fields.back !== undefined) {
      throw new CardValidationError(
        'A cloze card\'s "front"/"back" are derived from its text and cannot be set directly.',
      );
    }
    if (fields.problemSteps !== undefined) {
      throw new CardValidationError('"problemSteps" may only be set on a basic card.');
    }
    if (fields.clozeText === undefined) {
      return {
        front: current.front,
        back: current.back,
        clozeText: current.clozeText,
        problemSteps: null,
      };
    }

    const template = validateClozeText(fields.clozeText);
    // `clozeOrdinal` is never null on a cloze row (migration 031's CHECK), but
    // the type says it can be — `?? -1` names no run, so a corrupt row is
    // refused rather than silently re-derived off ordinal 0.
    const rendered = renderClozeCard(template, current.clozeOrdinal ?? -1);
    if (rendered === null) {
      throw new CardValidationError(
        `This card asks cloze deletion ${current.clozeOrdinal}, which the new text does not contain.`,
      );
    }
    return {
      front: validateText(rendered.front, "front"),
      back: validateText(rendered.back, "back"),
      clozeText: template,
      problemSteps: null,
    };
  }

  /**
   * The one place a `cards` row is born: `create`, `createCloze`,
   * `createProblem` and `syncFromNote` all seed a fresh FSRS state at `now`
   * and differ only in the content columns above it. `problemSteps` is
   * optional here because exactly one of those four sets it.
   */
  private insertNew(
    content: {
      deckId: string;
      front: string;
      back: string;
      kind: CardKind;
      clozeText: string | null;
      clozeOrdinal: number | null;
      problemSteps?: string | null;
      sourceNoteId?: string;
      sourceBlockKey?: string;
    },
    now: string,
    bookkeepingNow: string,
  ): Card {
    const empty = createEmptyCard(now);
    const id = uuidv7();
    const sourceNoteId = content.sourceNoteId ?? null;
    const sourceBlockKey = content.sourceBlockKey ?? null;
    const problemSteps = content.problemSteps ?? null;

    this.insert.run(
      id,
      this.profileId,
      content.deckId,
      content.front,
      content.back,
      sourceNoteId,
      sourceBlockKey,
      content.kind,
      content.clozeText,
      content.clozeOrdinal,
      problemSteps,
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
      deckId: content.deckId,
      front: content.front,
      back: content.back,
      sourceNoteId,
      sourceBlockKey,
      kind: content.kind,
      clozeText: content.clozeText,
      clozeOrdinal: content.clozeOrdinal,
      problemSteps,
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
      const stampBase = Date.now();
      const bookkeepingNow = new Date(stampBase).toISOString();

      let created = 0;
      let updated = 0;
      let removed = 0;

      for (const spec of validSpecs) {
        const row = byKey.get(spec.key);
        if (!row) {
          this.insertNew(
            {
              deckId: validDeckId,
              front: spec.front,
              back: spec.back,
              kind: spec.kind,
              clozeText: spec.clozeText,
              clozeOrdinal: spec.clozeOrdinal,
              sourceNoteId: validNoteId,
              sourceBlockKey: spec.key,
            },
            validNow,
            // One millisecond apart, ascending, so `listByDeck`'s
            // `(created_at, id)` order is the note's DOCUMENT order — `specs`
            // arrives in it. A shared stamp would leave it to `uuidv7`, whose
            // sub-millisecond bits are random, and a note's cards would land
            // in the deck list shuffled. Only inserts are staggered; the
            // update/restore/delete branches keep the transaction's own stamp.
            new Date(stampBase + created).toISOString(),
          );
          created += 1;
        } else if (row.deleted_at !== null) {
          this.restoreWithContent.run(
            validDeckId,
            spec.front,
            spec.back,
            spec.kind,
            spec.clozeText,
            spec.clozeOrdinal,
            null,
            bookkeepingNow,
            row.id,
            this.profileId,
          );
          updated += 1;
        } else if (
          row.deck_id !== validDeckId ||
          row.front !== spec.front ||
          row.back !== spec.back ||
          // The kind fields join the comparison so an existing note-derived
          // cloze row upgrades in place on the next sync of its note (ADR-042),
          // FSRS history intact — and so a template edit whose rendered sides
          // happen to be unchanged still lands.
          row.kind !== spec.kind ||
          row.cloze_text !== spec.clozeText ||
          row.cloze_ordinal !== spec.clozeOrdinal ||
          // A note has no syntax for problem steps (ADR-046 section 6), so a
          // generated row's steps are always NULL. Comparing anyway is what
          // clears a stale solution a direct edit left behind: the note owns
          // this row's content, and a second source for its `back` would
          // otherwise survive every future sync.
          row.problem_steps !== null
        ) {
          this.updateContentFields.run(
            validDeckId,
            spec.front,
            spec.back,
            spec.kind,
            spec.clozeText,
            spec.clozeOrdinal,
            null,
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
   * The scheduler this profile's CURRENT target retention describes (STUDY-007).
   *
   * The pinned semantics, and the whole reason this is a read-through rather
   * than something computed once: **grading and preview use the retention
   * stored at that moment, and existing cards are never retro-rescheduled.** A
   * change to the setting therefore shows up on the next review of each card,
   * as its own next interval — never as a silent, profile-wide rewrite of every
   * `due` the user has already seen. (ts-fsrs offers `reschedule` for that; it
   * is deliberately not called anywhere.)
   */
  private scheduler(): Scheduler {
    const { targetRetention } = this.settings.get();
    if (this.schedulerFor === null || this.schedulerFor.retention !== targetRetention) {
      this.schedulerFor = {
        retention: targetRetention,
        instance: fsrs({ request_retention: targetRetention }),
      };
    }
    return this.schedulerFor.instance;
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
    const scheduler = this.scheduler();

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
    const scheduler = this.scheduler();

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
    const preview = this.scheduler().repeat(toCardInput(current), validNow);

    return {
      again: preview[Rating.Again].card.due.toISOString(),
      hard: preview[Rating.Hard].card.due.toISOString(),
      good: preview[Rating.Good].card.due.toISOString(),
      easy: preview[Rating.Easy].card.due.toISOString(),
    };
  }

  /**
   * The review queue at `now`: active due (non-New) cards first (by due, id),
   * then up to `newLimit` New cards (by creation order). Optionally scoped to
   * one deck, one subject (via its decks) or a SET of decks (ADR-047) — at most
   * one of the three — and optionally narrowed to problem cards alone. Both
   * filters apply to both sections; ordering the two sections into one
   * interleaved practice run is `@nexus/core`'s `interleavePractice`, not this
   * store's: the queue answers what is studiable, never in what mood.
   *
   * Both of the profile's daily caps (STUDY-007) apply here, and they are
   * deliberately SEPARATE budgets. `new_per_day` bounds the New section — it is
   * what an omitted `newLimit` resolves to. `max_reviews_per_day`, when set,
   * bounds the DUE section by what is left of today: `cap` minus the reviews
   * already logged inside today's local calendar day. New cards are not counted
   * against it and are not truncated by it — a card seen for the first time is
   * not a repetition, and the two ceilings exist precisely so one can be spent
   * without spending the other.
   */
  dueQueue(options: DueQueueOptions = {}, now: string): ReviewQueue {
    const validNow = validateNow(now);
    const settings = this.settings.get();
    // An explicit `newLimit` wins, and is bounded exactly as the stored setting
    // is; omitted means the profile's own choice. The reviewer never sends one.
    const newLimit =
      options.newLimit === undefined ? settings.newPerDay : validateNewLimit(options.newLimit);
    const scope = this.resolveQueueScope(options);
    const predicate =
      options.problemsOnly === true ? `${scope.sql} ${PROBLEMS_ONLY_SCOPE}` : scope.sql;

    const due = this.dueSection(predicate, scope.params, settings.maxReviewsPerDay, validNow);
    const newRows = this.queueStatement(newQueueSql(predicate)).all(
      this.profileId,
      ...scope.params,
      newLimit,
    ) as CardRow[];
    return {
      cards: [...due.rows.map(toCard), ...newRows.map(toCard)],
      capReached: due.capReached,
    };
  }

  /** The due half of the queue, under the daily review cap when the profile has one. */
  private dueSection(
    predicate: string,
    params: readonly string[],
    cap: number | null,
    now: string,
  ): { rows: CardRow[]; capReached: boolean } {
    if (cap === null) {
      return {
        rows: this.queueStatement(dueQueueSql(predicate)).all(
          this.profileId,
          now,
          ...params,
        ) as CardRow[],
        capReached: false,
      };
    }

    const allowance = Math.max(0, cap - this.reviewsDoneToday(now));
    // One row past the allowance: enough to know the queue was cut short,
    // never a row the caller is offered. An allowance of 0 therefore still
    // asks for a single row, which is exactly how "the cap is spent AND there
    // was something left" is told apart from "there is nothing due".
    const rows = this.queueStatement(cappedDueQueueSql(predicate)).all(
      this.profileId,
      now,
      ...params,
      allowance + 1,
    ) as CardRow[];
    return { rows: rows.slice(0, allowance), capReached: rows.length > allowance };
  }

  /**
   * How many reviews this profile has logged inside the LOCAL calendar day
   * containing `now`.
   *
   * The day boundary is local wall clock, not UTC — the `localTodayKey` idiom
   * the study planner, the calendar and the dashboard all already use. A daily
   * cap is a promise about the user's day, and a user in UTC+2 whose ceiling
   * lifted at 02:00 would rightly call that broken. The window is computed from
   * `now`'s own y/m/d fields and compared as ISO text, which is what every other
   * `review_log` ordering in this store already does.
   */
  private reviewsDoneToday(now: string): number {
    const at = new Date(now);
    const dayStart = new Date(at.getFullYear(), at.getMonth(), at.getDate());
    const nextDay = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 1);
    const { n } = this.countReviewsInDay.get(
      this.profileId,
      dayStart.toISOString(),
      nextDay.toISOString(),
    ) as { n: number };
    return n;
  }

  /** Prepares one queue shape, or returns the one already prepared for it. */
  private queueStatement(sql: string): Database.Statement {
    const existing = this.queueStatements.get(sql);
    if (existing) return existing;
    const statement = this.db.prepare(sql);
    this.queueStatements.set(sql, statement);
    return statement;
  }

  /**
   * The SQL fragment and bound values of the ONE scope this queue was asked
   * for. Two scopes at once is a refusal rather than a precedence rule: a
   * caller that names both a deck and a subject does not know what it is asking
   * for, and silently honouring one of them would study the wrong cards.
   */
  private resolveQueueScope(options: DueQueueOptions): { sql: string; params: string[] } {
    const named = (["deckId", "subjectId", "deckIds"] as const).filter(
      (key) => options[key] !== undefined,
    );
    if (named.length > 1) {
      throw new CardValidationError(
        `A review queue takes at most one scope, but ${named.join(" and ")} were given.`,
      );
    }

    if (options.deckId !== undefined) {
      return { sql: "AND c.deck_id = ?", params: [this.resolveDeck(options.deckId)] };
    }
    if (options.subjectId !== undefined) {
      // `d` is the joined `decks` row, so the subject filter needs no subquery
      // and no second profile binding — the join already carries both.
      return { sql: "AND d.subject_id = ?", params: [this.resolveSubject(options.subjectId)] };
    }
    if (options.deckIds !== undefined) {
      const deckIds = validateDeckIds(options.deckIds);
      const placeholders = deckIds.map(() => "?").join(", ");
      return { sql: `AND c.deck_id IN (${placeholders})`, params: deckIds };
    }
    return { sql: "", params: [] };
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
    kind: row.kind,
    clozeText: row.cloze_text,
    clozeOrdinal: row.cloze_ordinal,
    problemSteps: row.problem_steps,
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

/**
 * A cloze TEMPLATE: non-empty after trimming and under the same cap a rendered
 * side lives under — it is stored in a column of the same table, and a
 * template nobody can save is a card nobody can edit. Trimmed, so the stored
 * text matches what `renderClozeCard` measured.
 */
function validateClozeText(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CardValidationError('Card "clozeText" must not be empty.');
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new CardValidationError(
      `Card "clozeText" must be at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }
  return trimmed;
}

/**
 * A problem card's SOLUTION text (ADR-046): non-empty after trimming, under
 * the same per-column cap every card text lives under, and holding at least
 * one actual step — a text of nothing but `--` separators renders an empty
 * `back`, which is not a card. Trimmed, so what is stored is what
 * `renderProblemBack` measured, and so migration 033's `length(…) > 0` CHECK
 * can never be reached from here.
 */
function validateProblemSteps(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new CardValidationError('Card "problemSteps" must not be empty.');
  }
  if (trimmed.length > MAX_TEXT_LENGTH) {
    throw new CardValidationError(
      `Card "problemSteps" must be at most ${MAX_TEXT_LENGTH} characters.`,
    );
  }
  if (splitProblemSteps(trimmed).length === 0) {
    throw new CardValidationError("A problem card needs at least one step.");
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
 *
 * The ADR-042 kind fields get the same treatment: the pair rule migration 031
 * puts in a CHECK is enforced here first, so a bad spec is a
 * `CardValidationError` rather than a raw SQLite constraint error mid-reconcile,
 * and a cloze spec's ordinal is re-checked against its own template by the
 * same grammar that rendered it.
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

    return {
      key: spec.key,
      front: validateText(spec.front, "front"),
      back: validateText(spec.back, "back"),
      ...validateSpecKind(spec),
    };
  });
}

/** The kind half of one `syncFromNote` spec: the pair rule, plus "this ordinal exists in this template". */
function validateSpecKind(
  spec: NoteCardSpecInput,
): Pick<NoteCardSpecInput, "kind" | "clozeText" | "clozeOrdinal"> {
  if (!(CARD_KINDS as readonly string[]).includes(spec.kind)) {
    throw new CardValidationError(`"${spec.kind}" is not a valid card kind.`);
  }
  if (spec.kind !== "cloze") {
    if (spec.clozeText !== null || spec.clozeOrdinal !== null) {
      throw new CardValidationError("A basic card must carry neither clozeText nor clozeOrdinal.");
    }
    return { kind: spec.kind, clozeText: null, clozeOrdinal: null };
  }
  if (spec.clozeText === null || spec.clozeOrdinal === null) {
    throw new CardValidationError("A cloze card must carry both clozeText and clozeOrdinal.");
  }
  const clozeText = validateClozeText(spec.clozeText);
  if (renderClozeCard(clozeText, spec.clozeOrdinal) === null) {
    throw new CardValidationError(
      `Cloze deletion ${spec.clozeOrdinal} is not present in this card's text.`,
    );
  }
  return { kind: "cloze", clozeText, clozeOrdinal: spec.clozeOrdinal };
}

/**
 * A practice scope's deck SET (ADR-047), checked structurally only: a non-empty
 * array of at most `MAX_QUEUE_DECK_IDS` non-empty strings. Whether an id names
 * a live deck of this profile is NOT asked here — unlike single-deck scope,
 * where naming a missing deck is a caller bug. A multi-deck selection is built
 * in the renderer and can go stale, so the join and the `IN (…)` do the
 * filtering and a stale entry contributes no cards instead of failing the whole
 * session.
 */
function validateDeckIds(deckIds: readonly string[]): string[] {
  if (!Array.isArray(deckIds) || deckIds.length === 0) {
    throw new CardValidationError('"deckIds" must name at least one deck.');
  }
  if (deckIds.length > MAX_QUEUE_DECK_IDS) {
    throw new CardValidationError(
      `"deckIds" may name at most ${MAX_QUEUE_DECK_IDS} decks (got ${deckIds.length}).`,
    );
  }
  if (!deckIds.every((deckId) => typeof deckId === "string" && deckId.length > 0)) {
    throw new CardValidationError('"deckIds" must hold only non-empty deck ids.');
  }
  return [...deckIds];
}

/** An EXPLICIT `newLimit` override, bounded by the same range the stored `new_per_day` is (migration 034's CHECK). Omission is resolved by `dueQueue` itself, from the profile's settings. */
function validateNewLimit(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_NEW_PER_DAY) {
    throw new CardValidationError(`"newLimit" must be an integer between 0 and ${MAX_NEW_PER_DAY}.`);
  }
  return value;
}
