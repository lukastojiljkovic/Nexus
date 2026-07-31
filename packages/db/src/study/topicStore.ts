import type Database from "better-sqlite3-multiple-ciphers";
import {
  ExamNotFoundError,
  ExamTopicNotFoundError,
  ExamTopicValidationError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";
import { MATURE_THRESHOLD_DAYS } from "./statsStore.js";

type DatabaseHandle = Database.Database;

/** An exam topic as the store returns it: camelCase keys, `sort_order` surfaced as the user's RANK (0 = top). */
export interface ExamTopicRecord {
  id: string;
  profileId: string;
  examId: string;
  name: string;
  /** The user's rank: 0 = the list's top = most important — curriculum order AND scope-cut priority (ADR-063). Contiguous per exam. */
  rank: number;
  /** The user's own 0-100 self-assessment, or null for unknown. */
  confidence: number | null;
  /** The flashcard deck this topic is drilled from, or null for none. */
  deckId: string | null;
  /** Set ONLY via `PlanStore.acceptScopeCut`, cleared ONLY via `PlanStore.restoreScopeCut` — never by the machine, never by this store's writes. */
  cut: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A topic with its EFFECTIVE confidence resolved: manual when set, else derived from a LIVE deck, else null. */
export interface EffectiveExamTopic extends ExamTopicRecord {
  effectiveConfidence: number | null;
  /**
   * True when `deckId` is set but no longer names an ACTIVE deck of this
   * profile — the deck was deleted after the link was made (`setDeck` validates
   * only at set time). The link is left standing exactly as stored, but a dead
   * deck derives nothing: this flag and `effectiveConfidence` always agree, so
   * a row that says „Nedostupan špil" never also shows a number that came from
   * the deck the user deleted.
   */
  deckMissing: boolean;
}

/** Fields accepted when creating a topic; the rank is always "the bottom of the exam's list". */
export interface CreateExamTopicInput {
  examId: string;
  name: string;
  confidence?: number | null;
  deckId?: string | null;
}

interface ExamTopicRow {
  id: string;
  profile_id: string;
  exam_id: string;
  name: string;
  sort_order: number;
  confidence: number | null;
  deck_id: string | null;
  cut: number;
  created_at: string;
  updated_at: string;
}

const TOPIC_COLUMNS =
  "id, profile_id, exam_id, name, sort_order, confidence, deck_id, cut, created_at, updated_at";

const MAX_NAME_LENGTH = 200;

/** How far back the deck-derived weakness looks for its Again-rate (ADR-063). */
const RECENT_REVIEW_WINDOW_DAYS = 30;

/**
 * The pinned blend behind a deck-derived confidence (ADR-063): how much of it
 * is "how often did recent reviews fail" versus "how much of the deck has
 * matured". Chosen, not sacred — the topic-store tests pin the resulting
 * numbers, and these two constants are the only place the blend lives.
 */
const AGAIN_RATE_WEIGHT = 0.6;
const MATURITY_WEIGHT = 0.4;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a full ISO-8601 date-time (the `now` the caller stamps every bookkeeping write with) — `PlanStore`'s own shape. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

const MS_PER_DAY = 86_400_000;

/**
 * Exam-topic persistence for a single profile (ADR-063, STUDY-004), over
 * prepared, parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `PlanStore`/`DeckStore`: construct one per profile,
 * reuse it. Inputs are revalidated here because the renderer is untrusted
 * (SEC-EL-02), and every statement is scoped by `profile_id` — including the
 * exam and deck references, which must resolve to active rows in THIS profile.
 *
 * The RANK invariant this store keeps: within one exam, live topics'
 * `sort_order` is contiguous 0..n-1 at all times — `create` appends at n,
 * `moveTopic` renumbers, `softDelete` closes the gap — so a rank IS a list
 * position and the scope-cut walk ("from the bottom") needs no ordering
 * arithmetic of its own. `cut` has deliberately NO setter here: the only path
 * that ever sets it is `PlanStore.acceptScopeCut`, which is what makes "cut
 * only by explicit user acceptance" a structural fact rather than a
 * convention (its inverse, `PlanStore.restoreScopeCut`, is the only path that
 * ever clears it again).
 *
 * This store also OWNS the FSRS-derived weakness read (ADR-063): a topic
 * without a manual confidence but with a link to a LIVE deck gets one derived
 * from that deck's recent Again-rate and mature-card fraction — see
 * `deriveDeckConfidence` for the pinned blend. Derivation is store-side so the
 * plan engine stays pure and takes numbers.
 */
export class TopicStore {
  private readonly insertTopic: Database.Statement;
  private readonly selectActiveByExam: Database.Statement;
  private readonly selectAllActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly selectActiveExam: Database.Statement;
  private readonly selectActiveDeck: Database.Statement;
  private readonly updateName: Database.Statement;
  private readonly updateConfidence: Database.Statement;
  private readonly updateDeck: Database.Statement;
  private readonly updateRank: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly promoteBlocksTopicNull: Database.Statement;
  private readonly selectLiveLinkedDecks: Database.Statement;
  private readonly selectDeckCensus: Database.Statement;
  private readonly selectDeckRecentReviews: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertTopic = db.prepare(
      `INSERT INTO exam_topics
         (id, profile_id, exam_id, name, sort_order, confidence, deck_id, cut,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL)`,
    );
    this.selectActiveByExam = db.prepare(
      `SELECT ${TOPIC_COLUMNS} FROM exam_topics
       WHERE exam_id = ? AND profile_id = ? AND deleted_at IS NULL
       ORDER BY sort_order, id`,
    );
    this.selectAllActive = db.prepare(
      `SELECT ${TOPIC_COLUMNS} FROM exam_topics
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY exam_id, sort_order, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${TOPIC_COLUMNS} FROM exam_topics
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveExam = db.prepare(
      `SELECT id FROM exams WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveDeck = db.prepare(
      `SELECT id FROM decks WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateName = db.prepare(
      `UPDATE exam_topics SET name = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateConfidence = db.prepare(
      `UPDATE exam_topics SET confidence = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateDeck = db.prepare(
      `UPDATE exam_topics SET deck_id = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateRank = db.prepare(
      `UPDATE exam_topics SET sort_order = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE exam_topics SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The soft-delete promotion (ADR-063): the FK's SET NULL only fires on a
    // HARD delete (restore wipe, profile cascade); a soft delete has to move
    // the blocks off the topic itself, or they would keep serving a row no
    // list shows.
    this.promoteBlocksTopicNull = db.prepare(
      `UPDATE study_blocks SET topic_id = NULL, updated_at = ?
       WHERE topic_id = ? AND profile_id = ?`,
    );
    // Deck LIVENESS for a whole exam's topics in ONE query (ADR-063): the
    // distinct deck ids the exam's live topics link to that still resolve to an
    // active deck of this profile. The join carries both scopes, so a foreign
    // or deleted deck simply produces no row — and the caller both marks every
    // linked topic missing from this set as `deckMissing` AND refuses to derive
    // its confidence. Deliberately batch: a per-topic existence check would be
    // the N+1 `listEffectiveByExam` already avoids for the derivation.
    this.selectLiveLinkedDecks = db.prepare(
      `SELECT DISTINCT t.deck_id AS deck_id
         FROM exam_topics t
         JOIN decks d
           ON d.id = t.deck_id AND d.profile_id = t.profile_id AND d.deleted_at IS NULL
        WHERE t.exam_id = ? AND t.profile_id = ? AND t.deleted_at IS NULL AND t.deck_id IS NOT NULL`,
    );
    // Maturity is a census of the LIVE deck (deleted cards leave it), read
    // through the same threshold `StatsStore` counts maturity by.
    this.selectDeckCensus = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN scheduled_days >= ? THEN 1 ELSE 0 END) AS mature
         FROM cards
        WHERE profile_id = ? AND deck_id = ? AND deleted_at IS NULL`,
    );
    // The Again-rate reads the LOG through the card join and deliberately does
    // NOT filter deleted cards — a review that happened, happened
    // (`StatsStore`'s REVIEW_SUBJECT_JOIN reasoning, one hop shorter).
    this.selectDeckRecentReviews = db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN rl.rating = 1 THEN 1 ELSE 0 END) AS again
         FROM review_log rl
         JOIN cards c ON c.id = rl.card_id AND c.profile_id = rl.profile_id
        WHERE rl.profile_id = ? AND c.deck_id = ? AND rl.review >= ?`,
    );
  }

  /** Active topics of one active exam in this profile, in rank order. */
  listByExam(examId: string): ExamTopicRecord[] {
    this.requireActiveExam(examId);
    const rows = this.selectActiveByExam.all(examId, this.profileId) as ExamTopicRow[];
    return rows.map(toTopic);
  }

  /** Every active topic of this profile, grouped by exam in rank order — the gather/export read. */
  listAll(): ExamTopicRecord[] {
    const rows = this.selectAllActive.all(this.profileId) as ExamTopicRow[];
    return rows.map(toTopic);
  }

  /**
   * `listByExam` with each topic's EFFECTIVE confidence resolved (ADR-063):
   * the manual value when set, else the LIVE deck's derived one, else null. What
   * `PlanStore` feeds the engine, and what the topic list renders as the
   * weakness column.
   *
   * Each row also carries `deckMissing` — a link whose deck has since been
   * deleted — resolved for the WHOLE listed set by one `selectLiveLinkedDecks`
   * query, beside the derivation's own per-deck memo. That same set GATES the
   * derivation: a soft-deleted deck feeds nothing, so a stale link falls back
   * to the topic's manual confidence and otherwise to null — the very answer a
   * topic with no link at all gives. Flag and number therefore always agree.
   * The stored link is untouched by all of this: liveness is a read rule, and
   * because the deck's delete is soft, restoring the deck restores the derived
   * number with no further action.
   */
  listEffectiveByExam(examId: string, today: string): EffectiveExamTopic[] {
    const validToday = validateBareDate(today, "today");
    const topics = this.listByExam(examId);
    const liveDecks = this.liveLinkedDeckIds(examId);
    const derivedByDeck = new Map<string, number | null>();
    return topics.map((topicRecord) => {
      const deckMissing = topicRecord.deckId !== null && !liveDecks.has(topicRecord.deckId);
      if (topicRecord.confidence !== null) {
        return { ...topicRecord, effectiveConfidence: topicRecord.confidence, deckMissing };
      }
      if (topicRecord.deckId === null || deckMissing) {
        return { ...topicRecord, effectiveConfidence: null, deckMissing };
      }
      let derived = derivedByDeck.get(topicRecord.deckId);
      if (derived === undefined) {
        derived = this.deriveDeckConfidence(topicRecord.deckId, validToday);
        derivedByDeck.set(topicRecord.deckId, derived);
      }
      return { ...topicRecord, effectiveConfidence: derived, deckMissing };
    });
  }

  /** Appends a topic at the bottom rank of an active exam of this profile. */
  create(input: CreateExamTopicInput, now: string): ExamTopicRecord {
    const validNow = validateNow(now);
    const name = validateName(input.name);
    const confidence = validateConfidence(input.confidence ?? null);
    const examId = this.requireActiveExam(input.examId);
    const deckId = input.deckId !== undefined ? this.resolveDeck(input.deckId) : null;

    const rank = (this.selectActiveByExam.all(examId, this.profileId) as ExamTopicRow[]).length;
    const id = uuidv7();
    this.insertTopic.run(id, this.profileId, examId, name, rank, confidence, deckId, validNow, validNow);

    return {
      id,
      profileId: this.profileId,
      examId,
      name,
      rank,
      confidence,
      deckId,
      cut: false,
      createdAt: validNow,
      updatedAt: validNow,
    };
  }

  /** Renames an active topic (trimmed, capped — the same rule as `create`). */
  rename(id: string, name: string, now: string): ExamTopicRecord {
    const validNow = validateNow(now);
    const validName = validateName(name);
    this.requireActive(id);
    this.updateName.run(validName, validNow, id, this.profileId);
    return this.requireActive(id);
  }

  /** Sets (0-100) or clears (null) the manual confidence. */
  setConfidence(id: string, confidence: number | null, now: string): ExamTopicRecord {
    const validNow = validateNow(now);
    const valid = validateConfidence(confidence);
    this.requireActive(id);
    this.updateConfidence.run(valid, validNow, id, this.profileId);
    return this.requireActive(id);
  }

  /** Sets or clears the topic ↔ deck link; a set deck must be active in this profile. */
  setDeck(id: string, deckId: string | null, now: string): ExamTopicRecord {
    const validNow = validateNow(now);
    this.requireActive(id);
    const valid = this.resolveDeck(deckId);
    this.updateDeck.run(valid, validNow, id, this.profileId);
    return this.requireActive(id);
  }

  /**
   * Moves a topic to `toRank` within its exam and renumbers the exam's live
   * topics contiguously — only rows whose rank actually changes are written.
   * Returns the exam's topics in their new order.
   */
  moveTopic(id: string, toRank: number, now: string): ExamTopicRecord[] {
    const validNow = validateNow(now);
    const moved = this.requireActive(id);
    const siblings = this.listByExam(moved.examId);
    if (!Number.isInteger(toRank) || toRank < 0 || toRank >= siblings.length) {
      throw new ExamTopicValidationError(
        `"toRank" must be an integer between 0 and ${siblings.length - 1}.`,
      );
    }

    const reordered = siblings.filter((topicRecord) => topicRecord.id !== id);
    reordered.splice(toRank, 0, moved);

    this.db.transaction((): void => {
      reordered.forEach((topicRecord, index) => {
        if (topicRecord.rank === index) return;
        this.updateRank.run(index, validNow, topicRecord.id, this.profileId);
      });
    })();

    return this.listByExam(moved.examId);
  }

  /**
   * Soft-deletes a topic, promotes its blocks' `topic_id` to NULL (they
   * become undifferentiated blocks rather than orphans of a hidden row), and
   * renumbers the exam's survivors contiguously — one transaction.
   */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const current = this.requireActive(id);

    this.db.transaction((): void => {
      const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
      if (changes === 0) {
        throw new ExamTopicNotFoundError(`No active exam topic "${id}" to delete in this profile.`);
      }
      this.promoteBlocksTopicNull.run(validNow, id, this.profileId);
      const survivors = this.selectActiveByExam.all(current.examId, this.profileId) as ExamTopicRow[];
      survivors.forEach((row, index) => {
        if (row.sort_order === index) return;
        this.updateRank.run(index, validNow, row.id, this.profileId);
      });
    })();
  }

  /**
   * A deck's derived confidence 0-100, or null for a deck with no live cards
   * (nothing to know anything from). The pinned blend (ADR-063):
   *
   *   `round(100 × (0.6 × (1 − againRate) + 0.4 × matureFraction))`
   *
   * where `againRate` is the fraction of the deck's reviews in the last 30
   * days rated Again (0 when it was not reviewed at all — an unreviewed
   * mature deck is not failing), and `matureFraction` is the live deck's
   * share of cards at or past `MATURE_THRESHOLD_DAYS`. Both signals are
   * facts the stats page already reads, blended here once.
   *
   * The blend is a RAW per-deck read: it does not itself check that the deck is
   * still live, because its one caller — `listEffectiveByExam` — resolves
   * liveness for a whole exam in a single query and never asks about a dead
   * deck. Any future caller has to make that same decision consciously rather
   * than inherit it by accident.
   */
  deriveDeckConfidence(deckId: string, today: string): number | null {
    const validToday = validateBareDate(today, "today");
    const census = this.selectDeckCensus.get(MATURE_THRESHOLD_DAYS, this.profileId, deckId) as {
      total: number;
      mature: number | null;
    };
    if (census.total === 0) return null;
    const matureFraction = (census.mature ?? 0) / census.total;

    const cutoff = recentCutoffIso(validToday);
    const reviews = this.selectDeckRecentReviews.get(this.profileId, deckId, cutoff) as {
      total: number;
      again: number | null;
    };
    const againRate = reviews.total === 0 ? 0 : (reviews.again ?? 0) / reviews.total;

    const blended = Math.round(
      100 * (AGAIN_RATE_WEIGHT * (1 - againRate) + MATURITY_WEIGHT * matureFraction),
    );
    return Math.min(100, Math.max(0, blended));
  }

  /** The exam's linked deck ids that still resolve to an active deck of this profile — one query for the whole list. */
  private liveLinkedDeckIds(examId: string): Set<string> {
    const rows = this.selectLiveLinkedDecks.all(examId, this.profileId) as { deck_id: string }[];
    return new Set(rows.map((row) => row.deck_id));
  }

  /** Reads an active topic in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): ExamTopicRecord {
    const row = this.selectActiveById.get(id, this.profileId) as ExamTopicRow | undefined;
    if (!row) {
      throw new ExamTopicNotFoundError(`No active exam topic "${id}" in this profile.`);
    }
    return toTopic(row);
  }

  /** Validates an exam id references a non-deleted exam in THIS profile — the container gate, `TaskAttachmentStore`'s idiom. */
  private requireActiveExam(examId: string): string {
    const row = this.selectActiveExam.get(examId, this.profileId);
    if (!row) {
      throw new ExamNotFoundError(`No active exam "${examId}" in this profile.`);
    }
    return examId;
  }

  /** Validates a deck id (when non-null) references a non-deleted deck in THIS profile. */
  private resolveDeck(deckId: string | null): string | null {
    if (deckId === null) return null;
    const row = this.selectActiveDeck.get(deckId, this.profileId);
    if (!row) {
      throw new ExamTopicValidationError(
        `deckId "${deckId}" does not reference an active deck in this profile.`,
      );
    }
    return deckId;
  }
}

function toTopic(row: ExamTopicRow): ExamTopicRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    examId: row.exam_id,
    name: row.name,
    rank: row.sort_order,
    confidence: row.confidence,
    deckId: row.deck_id,
    cut: row.cut === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The first instant of `today - RECENT_REVIEW_WINDOW_DAYS` as an ISO string — comparable as text against `review_log.review`. */
function recentCutoffIso(today: string): string {
  const [year, month, day] = today.split("-");
  const ms =
    Date.UTC(Number(year), Number(month) - 1, Number(day)) -
    RECENT_REVIEW_WINDOW_DAYS * MS_PER_DAY;
  return new Date(ms).toISOString();
}

function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ExamTopicValidationError("Topic name must not be empty.");
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    throw new ExamTopicValidationError(`Topic name must be at most ${MAX_NAME_LENGTH} characters.`);
  }
  return trimmed;
}

function validateConfidence(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new ExamTopicValidationError('"confidence" must be an integer between 0 and 100, or null.');
  }
  return value;
}

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new ExamTopicValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new ExamTopicValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
