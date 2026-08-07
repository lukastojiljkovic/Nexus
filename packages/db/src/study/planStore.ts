import type Database from "better-sqlite3-multiple-ciphers";
import {
  distributeBacklog,
  distributeBacklogCapped,
  planBlockDates,
  planDayCapacity,
} from "@nexus/core";
import type { PlanBlockDate, PlanCapacitySpec, PlanTopic } from "@nexus/core";
import { ExamTopicNotFoundError, PlanNotFoundError, PlanValidationError, isUniqueConstraintViolation } from "../errors.js";
import { uuidv7 } from "../ids.js";
import { TopicStore } from "./topicStore.js";

type DatabaseHandle = Database.Database;

/** A study plan as the store returns it: camelCase keys, its exam carried by id. */
export interface StudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  /** Mon..Sun capacity vector (ADR-063), or null for "every day = dailyMinutes". */
  weekdayMinutes: readonly number[] | null;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a plan (STUDY exam planner); `weekdayMinutes` is optional — absent or null means the scalar. */
export interface CreatePlanInput {
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  weekdayMinutes?: readonly number[] | null;
}

/** A partial patch of a plan's own fields; an omitted key is left untouched, and `weekdayMinutes: null` clears the vector. */
export interface UpdatePlanFields {
  dailyMinutes?: number;
  startDate?: string;
  examWeekBoost?: boolean;
  weekdayMinutes?: readonly number[] | null;
}

/** Closed study-block status domain (migration 007 CHECK). `missed` is only ever set by `sync`. */
export type StudyBlockStatus = "planned" | "done" | "missed";

/** Study-block statuses in wire order; the UI maps each onto a status chip. `missed` cannot be set by hand — see `setBlockStatus`. */
export const STUDY_BLOCK_STATUSES: readonly StudyBlockStatus[] = ["planned", "done", "missed"];

/** Closed study-block kind domain (migration 046 CHECK; ADR-063). */
export type StudyBlockKind = "coverage" | "revision" | "recall";

/** Study-block kinds in wire order; the UI maps each onto its chip. */
export const STUDY_BLOCK_KINDS: readonly StudyBlockKind[] = ["coverage", "revision", "recall"];

/** A single generated study session, as the store returns it. */
export interface StudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: StudyBlockStatus;
  /** The topic this block serves (ADR-063), or null on an undifferentiated block. */
  topicId: string | null;
  kind: StudyBlockKind;
  /** A pinned block survives regeneration exactly as done/missed rows do — the user's own hold on a slot. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A block joined with its plan's exam id — for the calendar-merge read path (`listBlocksInRange`). */
export interface StudyBlockWithExam extends StudyBlock {
  examId: string;
}

/**
 * One plan's honesty report (ADR-063 invariant 5), returned by every `sync`:
 * `overflowMinutes` is the backlog no remaining day could absorb (the
 * scope-cut conversation's trigger, STUDY-004), and
 * `examPassedBacklogMinutes` is the missed time a plan whose exam already
 * passed will never absorb at all. Never both non-zero: a passed exam
 * regenerates nothing, so it has no distributor to overflow.
 */
export interface PlanHealth {
  planId: string;
  overflowMinutes: number;
  examPassedBacklogMinutes: number;
}

/**
 * One plan's scope-cut proposal (STUDY-004): the lowest-ranked topics whose
 * removal brings the remaining load inside the remaining capacity. A pure
 * COMPUTATION — nothing is written until the user explicitly accepts it
 * through `acceptScopeCut`, which is the only path that ever sets `cut`.
 */
export interface ScopeCutProposal {
  planId: string;
  /** Σ `planDayCapacity` over the remaining days (effective start .. exam-eve). */
  capacityMinutes: number;
  /** Remaining non-done minutes: future planned blocks plus the missed backlog. */
  loadMinutes: number;
  /** Topic ids to cut, walking the rank list from the bottom; empty when the load already fits. */
  topicIds: readonly string[];
  /** The non-done minutes those cuts would free. */
  freedMinutes: number;
}

interface StudyPlanRow {
  id: string;
  profile_id: string;
  exam_id: string;
  daily_minutes: number;
  start_date: string;
  exam_week_boost: number;
  weekday_minutes: string | null;
  created_at: string;
  updated_at: string;
}

interface StudyBlockRow {
  id: string;
  plan_id: string;
  profile_id: string;
  block_date: string;
  minutes: number;
  status: StudyBlockStatus;
  topic_id: string | null;
  kind: StudyBlockKind;
  pinned: number;
  created_at: string;
  updated_at: string;
}

interface StudyBlockWithExamRow extends StudyBlockRow {
  exam_id: string;
}

const PLAN_COLUMNS =
  "id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, weekday_minutes, created_at, updated_at";

const BLOCK_COLUMNS =
  "id, plan_id, profile_id, block_date, minutes, status, topic_id, kind, pinned, created_at, updated_at";

const MIN_DAILY_MINUTES = 15;
const MAX_DAILY_MINUTES = 480;

/** The vector's own bounds (ADR-063): a day may be free (0) but never longer than the scalar's cap. */
const MAX_WEEKDAY_MINUTES = 480;
const WEEKDAY_VECTOR_LENGTH = 7;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a full ISO-8601 date-time (the `now` the caller stamps every bookkeeping write with). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** The only statuses `setBlockStatus` accepts; `missed` is set exclusively by `sync`. */
const SETTABLE_BLOCK_STATUSES: readonly StudyBlockStatus[] = ["planned", "done"];

const MS_PER_DAY = 86_400_000;

/**
 * Study-plan + study-block persistence for a single profile, over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `ExamStore`/`CardStore`: construct one per profile,
 * reuse it. Inputs are revalidated here because the renderer is untrusted
 * (SEC-EL-02), and every statement is scoped by `profile_id` so one profile's
 * plans/blocks are invisible to another's store — including the exam foreign
 * key, which must resolve to a non-deleted exam in THIS profile.
 *
 * Every method that stamps a timestamp takes an explicit `now: string`
 * (bookkeeping) and, where date math is involved, an explicit `today: string`
 * (bare "YYYY-MM-DD") — the store never reads the clock itself, so block
 * generation stays fully deterministic and testable (mirrors `planBlockDates`,
 * the pure engine this store calls into from `@nexus/core`).
 *
 * Since ADR-063 generation is TOPIC-AWARE: the store reads the exam's live
 * topics through its own `TopicStore` (the `RestoreStore`→`TaskListStore`
 * composition idiom), resolves each topic's effective confidence, and feeds
 * the engine `{id, rank, confidence, cut}` — the engine stays pure and takes
 * numbers. A plan whose exam has no live, uncut topics keeps the pre-ADR-063
 * undifferentiated schedule byte for byte, including the no-cap backlog
 * stretch (the compatibility contract this store's own tests pin).
 */
export class PlanStore {
  private readonly insertPlan: Database.Statement;
  private readonly selectActivePlans: Database.Statement;
  private readonly selectActivePlanById: Database.Statement;
  private readonly selectActivePlanByExam: Database.Statement;
  private readonly selectActiveExam: Database.Statement;
  private readonly updatePlanFields: Database.Statement;
  private readonly markPlanDeleted: Database.Statement;
  private readonly markPlanRestored: Database.Statement;
  private readonly insertBlock: Database.Statement;
  private readonly selectBlocksByPlan: Database.Statement;
  private readonly selectBlockById: Database.Statement;
  private readonly selectBlocksInRange: Database.Statement;
  private readonly selectMissedMinutesForPlan: Database.Statement;
  private readonly deleteFutureUnpinnedPlanned: Database.Statement;
  private readonly markPastPlannedMissed: Database.Statement;
  private readonly updateBlockStatus: Database.Statement;
  private readonly updateBlockPinned: Database.Statement;
  private readonly selectActivePlanIdsWithActiveExam: Database.Statement;
  private readonly selectRemainingMinutesByTopic: Database.Statement;
  private readonly selectTopicCutState: Database.Statement;
  private readonly markTopicCut: Database.Statement;
  private readonly markTopicUncut: Database.Statement;
  /** The exam's topic list and effective confidences — one owner (`TopicStore`), composed here. */
  private readonly topics: TopicStore;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertPlan = db.prepare(
      `INSERT INTO study_plans
         (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, weekday_minutes,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActivePlans = db.prepare(
      `SELECT ${PLAN_COLUMNS} FROM study_plans
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY start_date, id`,
    );
    this.selectActivePlanById = db.prepare(
      `SELECT ${PLAN_COLUMNS} FROM study_plans
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActivePlanByExam = db.prepare(
      `SELECT id FROM study_plans
       WHERE exam_id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectActiveExam = db.prepare(
      `SELECT id, exam_date FROM exams
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updatePlanFields = db.prepare(
      `UPDATE study_plans
         SET daily_minutes = ?, start_date = ?, exam_week_boost = ?, weekday_minutes = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markPlanDeleted = db.prepare(
      `UPDATE study_plans SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markPlanRestored = db.prepare(
      `UPDATE study_plans SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.insertBlock = db.prepare(
      `INSERT INTO study_blocks
         (id, plan_id, profile_id, block_date, minutes, status, topic_id, kind, pinned,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.selectBlocksByPlan = db.prepare(
      `SELECT ${BLOCK_COLUMNS} FROM study_blocks
       WHERE plan_id = ? AND profile_id = ?
       ORDER BY block_date, id`,
    );
    this.selectBlockById = db.prepare(
      `SELECT ${BLOCK_COLUMNS} FROM study_blocks WHERE id = ? AND profile_id = ?`,
    );
    this.selectBlocksInRange = db.prepare(
      `SELECT b.id, b.plan_id, b.profile_id, b.block_date, b.minutes, b.status,
              b.topic_id, b.kind, b.pinned,
              b.created_at, b.updated_at, p.exam_id AS exam_id
         FROM study_blocks b
         JOIN study_plans p
           ON p.id = b.plan_id AND p.profile_id = b.profile_id AND p.deleted_at IS NULL
         JOIN exams e
           ON e.id = p.exam_id AND e.profile_id = b.profile_id AND e.deleted_at IS NULL
        WHERE b.profile_id = ? AND b.block_date >= ? AND b.block_date <= ?
        ORDER BY b.block_date, b.id`,
    );
    this.selectMissedMinutesForPlan = db.prepare(
      `SELECT COALESCE(SUM(minutes), 0) AS backlog FROM study_blocks
       WHERE plan_id = ? AND profile_id = ? AND status = 'missed'`,
    );
    // A pinned block survives regeneration exactly as done/missed rows do
    // (ADR-063) — the delete leaves it standing beside them.
    this.deleteFutureUnpinnedPlanned = db.prepare(
      `DELETE FROM study_blocks
       WHERE plan_id = ? AND profile_id = ? AND block_date >= ? AND status = 'planned' AND pinned = 0`,
    );
    this.markPastPlannedMissed = db.prepare(
      `UPDATE study_blocks SET status = 'missed', updated_at = ?
       WHERE plan_id = ? AND profile_id = ? AND block_date < ? AND status = 'planned'`,
    );
    this.updateBlockStatus = db.prepare(
      `UPDATE study_blocks SET status = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.updateBlockPinned = db.prepare(
      `UPDATE study_blocks SET pinned = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.selectActivePlanIdsWithActiveExam = db.prepare(
      `SELECT p.id AS id
         FROM study_plans p
         JOIN exams e ON e.id = p.exam_id AND e.profile_id = p.profile_id AND e.deleted_at IS NULL
        WHERE p.profile_id = ? AND p.deleted_at IS NULL`,
    );
    // The scope-cut proposal's one read: remaining non-done minutes per topic
    // (missed rows are backlog wherever they sit; planned rows count from
    // `today` on). Grouped by topic_id with NULL as its own row.
    this.selectRemainingMinutesByTopic = db.prepare(
      `SELECT topic_id, COALESCE(SUM(minutes), 0) AS minutes
         FROM study_blocks
        WHERE plan_id = ? AND profile_id = ?
          AND (status = 'missed' OR (status = 'planned' AND block_date >= ?))
        GROUP BY topic_id`,
    );
    // The `cut` column's TWO writers, both here and both driven by an explicit
    // user decision (ADR-063: never the machine) — `TopicStore` deliberately
    // has no setter. `markTopicCut` is the only statement anywhere that sets
    // it; `markTopicUncut` the only one that clears it, and it reads the
    // current state first so „not cut" refuses by name rather than as a
    // zero-row no-op.
    this.selectTopicCutState = db.prepare(
      `SELECT cut FROM exam_topics
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markTopicCut = db.prepare(
      `UPDATE exam_topics SET cut = 1, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markTopicUncut = db.prepare(
      `UPDATE exam_topics SET cut = 0, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.topics = new TopicStore(db, profileId);
  }

  /** Active plans for this profile ordered by start date (soft-deleted excluded). */
  listActive(): StudyPlan[] {
    const rows = this.selectActivePlans.all(this.profileId) as StudyPlanRow[];
    return rows.map(toPlan);
  }

  /**
   * Creates a plan against an active exam of this profile and generates its
   * blocks in one transaction — topic-aware when the exam has live, uncut
   * topics. Rejects an exam that is not strictly in the future, a start date
   * on/after the exam date, an out-of-range `dailyMinutes`, a malformed
   * weekday vector, or a second active plan for the same exam.
   */
  createPlan(input: CreatePlanInput, now: string, today: string): StudyPlan {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const dailyMinutes = validateDailyMinutes(input.dailyMinutes);
    const startDate = validateBareDate(input.startDate, "startDate");
    const examWeekBoost = input.examWeekBoost;
    const weekdayMinutes = validateWeekdayMinutes(input.weekdayMinutes ?? null);
    const exam = this.resolveActiveExam(input.examId);

    this.assertPlannable(exam.examDate, startDate, validToday);

    const existing = this.selectActivePlanByExam.get(exam.id, this.profileId) as
      | { id: string }
      | undefined;
    if (existing) {
      throw new PlanValidationError(`Exam "${exam.id}" already has an active study plan.`);
    }

    const id = uuidv7();

    return this.db.transaction((): StudyPlan => {
      this.insertPlan.run(
        id,
        this.profileId,
        exam.id,
        dailyMinutes,
        startDate,
        examWeekBoost ? 1 : 0,
        weekdayMinutesText(weekdayMinutes),
        validNow,
        validNow,
      );

      const blocks = planBlockDates({
        examDate: exam.examDate,
        startDate,
        dailyMinutes,
        examWeekBoost,
        today: validToday,
        weekdayMinutes,
        topics: this.engineTopics(exam.id, validToday),
      });
      for (const block of blocks) {
        this.insertGeneratedBlock(id, block, validNow);
      }

      return {
        id,
        profileId: this.profileId,
        examId: exam.id,
        dailyMinutes,
        startDate,
        examWeekBoost,
        weekdayMinutes,
        createdAt: validNow,
        updatedAt: validNow,
      };
    })();
  }

  /**
   * Applies a partial field patch to an active plan, then regenerates its
   * future blocks: existing unpinned `planned` blocks on/after `today` are
   * dropped and recomputed from the engine with the updated parameters and
   * the exam's current topics, keeping done/missed/past/pinned rows — all in
   * one transaction (see `regenerateBlocks`).
   */
  updatePlan(id: string, changes: UpdatePlanFields, now: string, today: string): StudyPlan {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const current = this.requireActivePlan(id);
    const exam = this.resolveActiveExam(current.examId);

    const dailyMinutes =
      changes.dailyMinutes !== undefined
        ? validateDailyMinutes(changes.dailyMinutes)
        : current.dailyMinutes;
    const startDate =
      changes.startDate !== undefined
        ? validateBareDate(changes.startDate, "startDate")
        : current.startDate;
    const examWeekBoost =
      changes.examWeekBoost !== undefined ? changes.examWeekBoost : current.examWeekBoost;
    const weekdayMinutes =
      changes.weekdayMinutes !== undefined
        ? validateWeekdayMinutes(changes.weekdayMinutes)
        : current.weekdayMinutes;

    this.assertPlannable(exam.examDate, startDate, validToday);

    return this.db.transaction((): StudyPlan => {
      this.updatePlanFields.run(
        dailyMinutes,
        startDate,
        examWeekBoost ? 1 : 0,
        weekdayMinutesText(weekdayMinutes),
        validNow,
        current.id,
        this.profileId,
      );

      const updated: StudyPlan = {
        ...current,
        dailyMinutes,
        startDate,
        examWeekBoost,
        weekdayMinutes,
        updatedAt: validNow,
      };
      this.regenerateBlocks(updated, exam.examDate, validToday, validNow);
      return updated;
    })();
  }

  /** Soft-deletes an active plan (reversible via `restore`). */
  softDelete(id: string, now: string): void {
    const validNow = validateNow(now);
    const { changes } = this.markPlanDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new PlanNotFoundError(`No active study plan "${id}" to delete in this profile.`);
    }
  }

  /**
   * Restores a soft-deleted plan (undo of a delete). Surfaces a collision with
   * another active plan created for the same exam meanwhile as a
   * `PlanValidationError`, never a raw SQLite error.
   */
  restore(id: string, now: string): void {
    const validNow = validateNow(now);
    try {
      const { changes } = this.markPlanRestored.run(validNow, id, this.profileId);
      if (changes === 0) {
        throw new PlanNotFoundError(`No deleted study plan "${id}" to restore in this profile.`);
      }
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new PlanValidationError(
          `Cannot restore study plan "${id}": another active plan already exists for its exam.`,
        );
      }
      throw error;
    }
  }

  /** All blocks of an active plan in this profile, ordered by date then id. */
  listBlocks(planId: string): StudyBlock[] {
    this.requireActivePlan(planId);
    const rows = this.selectBlocksByPlan.all(planId, this.profileId) as StudyBlockRow[];
    return rows.map(toBlock);
  }

  /**
   * Blocks in `[fromDate, toDate]` joined through active plans and active
   * exams of this profile, each row carrying `planId`/`examId` (for the
   * calendar merge, STUDY-003), ordered by date then id.
   */
  listBlocksInRange(fromDate: string, toDate: string): StudyBlockWithExam[] {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const rows = this.selectBlocksInRange.all(
      this.profileId,
      validFrom,
      validTo,
    ) as StudyBlockWithExamRow[];
    return rows.map(toBlockWithExam);
  }

  /**
   * Sets a block's status to `done` or `planned` (never `missed` — that is
   * only ever set by `sync`). Any current status may transition to these
   * targets: a missed block marked done is a late completion; a block reset to
   * planned is re-marked missed by the next `sync` if it is still in the past.
   */
  setBlockStatus(blockId: string, status: StudyBlockStatus, now: string): StudyBlock {
    const validNow = validateNow(now);
    if (!SETTABLE_BLOCK_STATUSES.includes(status)) {
      throw new PlanValidationError(`"${status}" cannot be set by hand (only "done"/"planned").`);
    }
    const { changes } = this.updateBlockStatus.run(status, validNow, blockId, this.profileId);
    if (changes === 0) {
      throw new PlanNotFoundError(`No block "${blockId}" in this profile.`);
    }
    return this.requireBlock(blockId);
  }

  /** Pins or unpins a block (ADR-063): a pinned block survives regeneration exactly as done/missed rows do. */
  setBlockPinned(blockId: string, pinned: boolean, now: string): StudyBlock {
    const validNow = validateNow(now);
    const { changes } = this.updateBlockPinned.run(pinned ? 1 : 0, validNow, blockId, this.profileId);
    if (changes === 0) {
      throw new PlanNotFoundError(`No block "${blockId}" in this profile.`);
    }
    return this.requireBlock(blockId);
  }

  /**
   * Idempotent per-plan sync, in one transaction: (1) past `planned` blocks
   * become `missed`; (2) future unpinned `planned` blocks are dropped; (3)
   * unless the exam date is on/before `today`, they are regenerated from the
   * engine with the exam's current topics and the plan's weekday vector,
   * keeping done/missed/past/pinned rows (see `regenerateBlocks`). Running
   * this twice with the same `today` leaves the block set unchanged — it runs
   * before every page read, and that idempotence is what makes it safe to.
   *
   * RETURNS the plan's health (ADR-063 invariant 5): the backlog minutes the
   * capped replan could not fit anywhere (`overflowMinutes`), or — once the
   * exam has passed — the whole missed backlog nothing will ever absorb
   * (`examPassedBacklogMinutes`).
   */
  sync(planId: string, now: string, today: string): PlanHealth {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const current = this.requireActivePlan(planId);
    const exam = this.resolveActiveExam(current.examId);

    return this.db.transaction((): PlanHealth => {
      this.markPastPlannedMissed.run(validNow, current.id, this.profileId, validToday);
      const overflowMinutes = this.regenerateBlocks(current, exam.examDate, validToday, validNow);
      const examPassed = dateKey(exam.examDate) <= validToday;
      return {
        planId: current.id,
        overflowMinutes: examPassed ? 0 : overflowMinutes,
        examPassedBacklogMinutes: examPassed ? this.missedMinutes(current.id) : 0,
      };
    })();
  }

  /** Syncs every active plan of this profile whose exam is still active; returns one `PlanHealth` per synced plan. */
  syncAll(now: string, today: string): PlanHealth[] {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const ids = (
      this.selectActivePlanIdsWithActiveExam.all(this.profileId) as { id: string }[]
    ).map((row) => row.id);
    return ids.map((id) => this.sync(id, validNow, validToday));
  }

  /**
   * The scope-cut proposal (STUDY-004), computed and never written: remaining
   * capacity is `planDayCapacity` summed over the days still ahead, the load
   * is every non-done minute (future planned blocks plus the missed backlog),
   * and topics are walked FROM THE BOTTOM of the rank list — the user's own
   * scope-cut priority — dropping each one's remaining non-done minutes until
   * the load fits. A topic with nothing left to drop is skipped, not named.
   */
  scopeCutProposal(planId: string, today: string): ScopeCutProposal {
    const validToday = validateBareDate(today, "today");
    const current = this.requireActivePlan(planId);
    const exam = this.resolveActiveExam(current.examId);

    const spec = capacitySpec(current, exam.examDate);
    let capacityMinutes = 0;
    const examMs = utcDayMs(exam.examDate);
    const startMs = Math.max(utcDayMs(current.startDate), utcDayMs(validToday));
    for (let ms = startMs; ms < examMs; ms += MS_PER_DAY) {
      capacityMinutes += planDayCapacity(spec, utcDateKey(ms));
    }

    const remaining = this.selectRemainingMinutesByTopic.all(
      current.id,
      this.profileId,
      validToday,
    ) as { topic_id: string | null; minutes: number }[];
    const minutesByTopic = new Map(remaining.map((row) => [row.topic_id, row.minutes]));
    const loadMinutes = remaining.reduce((acc, row) => acc + row.minutes, 0);

    const liveTopics = this.topics.listByExam(current.examId).filter((t) => !t.cut);
    const topicIds: string[] = [];
    let freedMinutes = 0;
    let running = loadMinutes;
    for (const candidate of [...liveTopics].reverse()) {
      if (running <= capacityMinutes) break;
      const candidateMinutes = minutesByTopic.get(candidate.id) ?? 0;
      if (candidateMinutes === 0) continue;
      topicIds.push(candidate.id);
      freedMinutes += candidateMinutes;
      running -= candidateMinutes;
    }

    return { planId: current.id, capacityMinutes, loadMinutes, topicIds, freedMinutes };
  }

  /**
   * Marks the given topics cut — the ONLY path anywhere that ever sets `cut`
   * (ADR-063: explicit user acceptance, never the machine). One transaction;
   * an id that is not an active topic of this profile refuses the whole
   * acceptance. The caller re-syncs afterwards; a cut topic is then excluded
   * from generation entirely.
   */
  acceptScopeCut(topicIds: readonly string[], now: string): void {
    const validNow = validateNow(now);
    this.db.transaction((): void => {
      for (const topicId of topicIds) {
        const { changes } = this.markTopicCut.run(validNow, topicId, this.profileId);
        if (changes === 0) {
          throw new ExamTopicNotFoundError(`No active exam topic "${topicId}" in this profile.`);
        }
      }
    })();
  }

  /**
   * The inverse of `acceptScopeCut` — „Vrati u plan": clears `cut` on the named
   * topics, the ONLY path anywhere that ever does. Same shape as its sibling:
   * one transaction, the same `profile_id` scope on every statement, the same
   * explicit `now`, and the caller re-syncs afterwards, at which point the
   * restored topics are generated over again and the plan's health reports
   * whatever the wider scope now costs (ADR-063 invariant 5 — a restore may
   * well put the plan back over capacity, and that number is REPORTED, never
   * smoothed away).
   *
   * Every refusal is named, never a silent no-op: an id that is not an active
   * topic of this profile (`ExamTopicNotFoundError`), an id that is not cut,
   * and an empty restore — which is what an exam with no cut topics amounts to
   * — (`PlanValidationError`). A refusal anywhere rolls the whole restore back.
   */
  restoreScopeCut(topicIds: readonly string[], now: string): void {
    const validNow = validateNow(now);
    if (topicIds.length === 0) {
      throw new PlanValidationError("A scope-cut restore must name at least one cut topic.");
    }
    this.db.transaction((): void => {
      for (const topicId of topicIds) {
        const row = this.selectTopicCutState.get(topicId, this.profileId) as
          | { cut: number }
          | undefined;
        if (!row) {
          throw new ExamTopicNotFoundError(`No active exam topic "${topicId}" in this profile.`);
        }
        if (row.cut !== 1) {
          throw new PlanValidationError(
            `Exam topic "${topicId}" is not cut — there is nothing to restore.`,
          );
        }
        this.markTopicUncut.run(validNow, topicId, this.profileId);
      }
    })();
  }

  /**
   * Shared regeneration step of `updatePlan` and `sync` (ADR-063): drop the
   * future unpinned planned blocks, re-run the engine with the plan's weekday
   * vector and the exam's current topics (effective confidences resolved by
   * `TopicStore`), keep every row still standing — done, missed, past,
   * pinned — by skipping what would collide with one, and spread the missed
   * backlog over the fresh future blocks. Returns the overflow.
   *
   * Two backlog regimes, deliberately:
   * - TOPIC-AWARE plans go through `distributeBacklogCapped` against each
   *   day's remaining capacity (`planDayCapacity` minus the kept future rows
   *   already occupying it) — capacity is law, and what does not fit comes
   *   back as the overflow number instead of a stretched day.
   * - ZERO-TOPIC plans keep the pre-ADR-063 no-cap `distributeBacklog`
   *   byte for byte (the compatibility pin), and the overflow REPORTED is how
   *   far past the plan's own capacity that stretch went.
   *
   * Regeneration is skipped entirely once the exam date is on/before `today`
   * (the future-block drop still runs), in which case the backlog is left
   * untouched: nothing absorbs it, and `sync` reports it as
   * `examPassedBacklogMinutes`.
   */
  private regenerateBlocks(
    plan: StudyPlan,
    examDate: string,
    today: string,
    now: string,
  ): number {
    this.deleteFutureUnpinnedPlanned.run(plan.id, this.profileId, today);

    if (dateKey(examDate) <= today) return 0; // exam passed/today: nothing to regenerate

    const engineTopics = this.engineTopics(plan.examId, today);
    const generated = planBlockDates({
      examDate,
      startDate: plan.startDate,
      dailyMinutes: plan.dailyMinutes,
      examWeekBoost: plan.examWeekBoost,
      today,
      weekdayMinutes: plan.weekdayMinutes,
      topics: engineTopics,
    });

    const kept = this.selectBlocksByPlan.all(plan.id, this.profileId) as StudyBlockRow[];
    const backlog = this.missedMinutes(plan.id);
    const spec = capacitySpec(plan, examDate);

    let blocks: PlanBlockDate[];
    let overflow: number;
    if (engineTopics.some((t) => !t.cut)) {
      const keptKeys = new Set(kept.map((row) => slotKey(row.block_date, row.topic_id, row.kind)));
      const surviving = generated.filter(
        (block) => !keptKeys.has(slotKey(block.date, block.topicId, block.kind)),
      );
      // Kept rows still ahead of today (pinned, or done early) occupy their
      // day's capacity; the backlog may only fill what they leave.
      const keptFutureByDate = new Map<string, number>();
      for (const row of kept) {
        if (row.block_date < today) continue;
        keptFutureByDate.set(row.block_date, (keptFutureByDate.get(row.block_date) ?? 0) + row.minutes);
      }
      const capped = distributeBacklogCapped(surviving, backlog, (date) =>
        Math.max(0, planDayCapacity(spec, date) - (keptFutureByDate.get(date) ?? 0)),
      );
      blocks = capped.blocks;
      overflow = capped.overflowMinutes;
    } else {
      const existingDates = new Set(kept.map((row) => row.block_date));
      const surviving = generated.filter((block) => !existingDates.has(block.date));
      blocks = distributeBacklog(surviving, backlog);
      overflow = blocks.reduce(
        (acc, block) => acc + Math.max(0, block.minutes - planDayCapacity(spec, block.date)),
        0,
      );
    }

    for (const block of blocks) {
      this.insertGeneratedBlock(plan.id, block, now);
    }
    return overflow;
  }

  /**
   * One engine-shaped topic list for an exam: live topics with their effective
   * confidences resolved. A topic whose linked deck has since been deleted
   * derives nothing (ADR-063 read rule), so it reaches the engine as unknown —
   * the same shape as a topic with no signal at all.
   */
  private engineTopics(examId: string, today: string): PlanTopic[] {
    return this.topics.listEffectiveByExam(examId, today).map((topicRecord) => ({
      id: topicRecord.id,
      rank: topicRecord.rank,
      confidence: topicRecord.effectiveConfidence,
      cut: topicRecord.cut,
    }));
  }

  private insertGeneratedBlock(planId: string, block: PlanBlockDate, now: string): void {
    this.insertBlock.run(
      uuidv7(),
      planId,
      this.profileId,
      block.date,
      block.minutes,
      "planned",
      block.topicId,
      block.kind,
      0,
      now,
      now,
    );
  }

  /** The plan's current missed-minutes backlog (`SUM(minutes)` over its `missed` blocks). */
  private missedMinutes(planId: string): number {
    const { backlog } = this.selectMissedMinutesForPlan.get(planId, this.profileId) as {
      backlog: number;
    };
    return backlog;
  }

  /** Exam date strictly after `today`, and `startDate` strictly before the exam date — else `PlanValidationError`. */
  private assertPlannable(examDate: string, startDate: string, today: string): void {
    const examDateKey = dateKey(examDate);
    if (examDateKey <= today) {
      throw new PlanValidationError("The exam date must be strictly after today to plan against it.");
    }
    if (startDate >= examDateKey) {
      throw new PlanValidationError('"startDate" must be strictly before the exam date.');
    }
  }

  /** Reads an active plan in this profile or throws — enforces scope + existence. */
  private requireActivePlan(id: string): StudyPlan {
    const row = this.selectActivePlanById.get(id, this.profileId) as StudyPlanRow | undefined;
    if (!row) {
      throw new PlanNotFoundError(`No active study plan "${id}" in this profile.`);
    }
    return toPlan(row);
  }

  /** Reads a block in this profile or throws — enforces scope + existence. */
  private requireBlock(id: string): StudyBlock {
    const row = this.selectBlockById.get(id, this.profileId) as StudyBlockRow | undefined;
    if (!row) {
      throw new PlanNotFoundError(`No block "${id}" in this profile.`);
    }
    return toBlock(row);
  }

  /**
   * Validates an exam id references a non-deleted exam in this profile
   * (mirrors `ExamStore.resolveSubject`): the same-profile scope on the lookup
   * is what stops a plan from pointing at another profile's exam.
   */
  private resolveActiveExam(examId: string): { id: string; examDate: string } {
    const row = this.selectActiveExam.get(examId, this.profileId) as
      | { id: string; exam_date: string }
      | undefined;
    if (!row) {
      throw new PlanValidationError(
        `examId "${examId}" does not reference an active exam in this profile.`,
      );
    }
    return { id: row.id, examDate: row.exam_date };
  }
}

function toPlan(row: StudyPlanRow): StudyPlan {
  return {
    id: row.id,
    profileId: row.profile_id,
    examId: row.exam_id,
    dailyMinutes: row.daily_minutes,
    startDate: row.start_date,
    examWeekBoost: row.exam_week_boost === 1,
    weekdayMinutes: row.weekday_minutes === null ? null : (JSON.parse(row.weekday_minutes) as number[]),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBlock(row: StudyBlockRow): StudyBlock {
  return {
    id: row.id,
    planId: row.plan_id,
    profileId: row.profile_id,
    blockDate: row.block_date,
    minutes: row.minutes,
    status: row.status,
    topicId: row.topic_id,
    kind: row.kind,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBlockWithExam(row: StudyBlockWithExamRow): StudyBlockWithExam {
  return { ...toBlock(row), examId: row.exam_id };
}

/** The plan's capacity spec, the shape `planDayCapacity` reads — one construction, used by both backlog regimes. */
function capacitySpec(plan: StudyPlan, examDate: string): PlanCapacitySpec {
  return {
    examDate,
    dailyMinutes: plan.dailyMinutes,
    examWeekBoost: plan.examWeekBoost,
    weekdayMinutes: plan.weekdayMinutes,
  };
}

/** A kept/generated block's slot under migration 046's uniqueness: (date, topic, kind). */
function slotKey(date: string, topicId: string | null, kind: string): string {
  return `${date}\0${topicId ?? ""}\0${kind}`;
}

/** The bare "YYYY-MM-DD" prefix of a date-like string (exam dates may carry a time part). */
function dateKey(value: string): string {
  return value.slice(0, 10);
}

/** UTC-midnight ms for a bare "YYYY-MM-DD" (the engine's own day-arithmetic idiom). */
function utcDayMs(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-");
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/** Formats UTC-midnight ms back into a bare "YYYY-MM-DD" string. */
function utcDateKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}-${day}`;
}

function validateDailyMinutes(value: number): number {
  if (!Number.isInteger(value) || value < MIN_DAILY_MINUTES || value > MAX_DAILY_MINUTES) {
    throw new PlanValidationError(
      `"dailyMinutes" must be an integer between ${MIN_DAILY_MINUTES} and ${MAX_DAILY_MINUTES}.`,
    );
  }
  return value;
}

/**
 * The weekday vector's rule (ADR-063, migration 046's doc): exactly 7 entries
 * Mon..Sun, each an integer 0..480, at least one positive — a week of nothing
 * is not a plan. Null passes through: it means "every day = dailyMinutes".
 */
function validateWeekdayMinutes(value: readonly number[] | null): readonly number[] | null {
  if (value === null) return null;
  if (value.length !== WEEKDAY_VECTOR_LENGTH) {
    throw new PlanValidationError('"weekdayMinutes" must have exactly 7 entries (Mon..Sun).');
  }
  for (const entry of value) {
    if (!Number.isInteger(entry) || entry < 0 || entry > MAX_WEEKDAY_MINUTES) {
      throw new PlanValidationError(
        `"weekdayMinutes" entries must be integers between 0 and ${MAX_WEEKDAY_MINUTES}.`,
      );
    }
  }
  if (!value.some((entry) => entry > 0)) {
    throw new PlanValidationError('"weekdayMinutes" must have at least one positive entry.');
  }
  return value;
}

/** The vector as its column stores it: canonical JSON text, or NULL. */
function weekdayMinutesText(value: readonly number[] | null): string | null {
  return value === null ? null : JSON.stringify(value);
}

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new PlanValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

function validateNow(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new PlanValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
