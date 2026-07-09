import type Database from "better-sqlite3-multiple-ciphers";
import { planBlockDates } from "@nexus/core";
import { PlanNotFoundError, PlanValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A study plan as the store returns it: camelCase keys, its exam carried by id. */
export interface StudyPlan {
  id: string;
  profileId: string;
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Fields accepted when creating a plan; all four are required (STUDY exam planner). */
export interface CreatePlanInput {
  examId: string;
  dailyMinutes: number;
  startDate: string;
  examWeekBoost: boolean;
}

/** A partial patch of a plan's own fields; an omitted key is left untouched. */
export interface UpdatePlanFields {
  dailyMinutes?: number;
  startDate?: string;
  examWeekBoost?: boolean;
}

/** Closed study-block status domain (migration 007 CHECK). `missed` is only ever set by `sync`. */
export type StudyBlockStatus = "planned" | "done" | "missed";

/** Study-block statuses in wire order; the UI maps each onto a status chip. `missed` cannot be set by hand — see `setBlockStatus`. */
export const STUDY_BLOCK_STATUSES: readonly StudyBlockStatus[] = ["planned", "done", "missed"];

/** A single generated study session, as the store returns it. */
export interface StudyBlock {
  id: string;
  planId: string;
  profileId: string;
  blockDate: string;
  minutes: number;
  status: StudyBlockStatus;
  createdAt: string;
  updatedAt: string;
}

/** A block joined with its plan's exam id — for the calendar-merge read path (`listBlocksInRange`). */
export interface StudyBlockWithExam extends StudyBlock {
  examId: string;
}

interface StudyPlanRow {
  id: string;
  profile_id: string;
  exam_id: string;
  daily_minutes: number;
  start_date: string;
  exam_week_boost: number;
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
  created_at: string;
  updated_at: string;
}

interface StudyBlockWithExamRow extends StudyBlockRow {
  exam_id: string;
}

const PLAN_COLUMNS =
  "id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost, created_at, updated_at";

const BLOCK_COLUMNS =
  "id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at";

const MIN_DAILY_MINUTES = 15;
const MAX_DAILY_MINUTES = 480;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Accepts a full ISO-8601 date-time (the `now` the caller stamps every bookkeeping write with). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/** The only statuses `setBlockStatus` accepts; `missed` is set exclusively by `sync`. */
const SETTABLE_BLOCK_STATUSES: readonly StudyBlockStatus[] = ["planned", "done"];

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
  private readonly selectBlockDatesForPlan: Database.Statement;
  private readonly deleteFuturePlannedBlocks: Database.Statement;
  private readonly markPastPlannedMissed: Database.Statement;
  private readonly updateBlockStatus: Database.Statement;
  private readonly selectActivePlanIdsWithActiveExam: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertPlan = db.prepare(
      `INSERT INTO study_plans
         (id, profile_id, exam_id, daily_minutes, start_date, exam_week_boost,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
         SET daily_minutes = ?, start_date = ?, exam_week_boost = ?, updated_at = ?
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
         (id, plan_id, profile_id, block_date, minutes, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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
              b.created_at, b.updated_at, p.exam_id AS exam_id
         FROM study_blocks b
         JOIN study_plans p
           ON p.id = b.plan_id AND p.profile_id = b.profile_id AND p.deleted_at IS NULL
         JOIN exams e
           ON e.id = p.exam_id AND e.profile_id = b.profile_id AND e.deleted_at IS NULL
        WHERE b.profile_id = ? AND b.block_date >= ? AND b.block_date <= ?
        ORDER BY b.block_date, b.id`,
    );
    this.selectBlockDatesForPlan = db.prepare(
      `SELECT block_date FROM study_blocks WHERE plan_id = ? AND profile_id = ?`,
    );
    this.deleteFuturePlannedBlocks = db.prepare(
      `DELETE FROM study_blocks
       WHERE plan_id = ? AND profile_id = ? AND block_date >= ? AND status = 'planned'`,
    );
    this.markPastPlannedMissed = db.prepare(
      `UPDATE study_blocks SET status = 'missed', updated_at = ?
       WHERE plan_id = ? AND profile_id = ? AND block_date < ? AND status = 'planned'`,
    );
    this.updateBlockStatus = db.prepare(
      `UPDATE study_blocks SET status = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.selectActivePlanIdsWithActiveExam = db.prepare(
      `SELECT p.id AS id
         FROM study_plans p
         JOIN exams e ON e.id = p.exam_id AND e.profile_id = p.profile_id AND e.deleted_at IS NULL
        WHERE p.profile_id = ? AND p.deleted_at IS NULL`,
    );
  }

  /** Active plans for this profile ordered by start date (soft-deleted excluded). */
  listActive(): StudyPlan[] {
    const rows = this.selectActivePlans.all(this.profileId) as StudyPlanRow[];
    return rows.map(toPlan);
  }

  /**
   * Creates a plan against an active exam of this profile and generates its
   * blocks in one transaction. Rejects an exam that is not strictly in the
   * future, a start date on/after the exam date, an out-of-range
   * `dailyMinutes`, or a second active plan for the same exam.
   */
  createPlan(input: CreatePlanInput, now: string, today: string): StudyPlan {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const dailyMinutes = validateDailyMinutes(input.dailyMinutes);
    const startDate = validateBareDate(input.startDate, "startDate");
    const examWeekBoost = input.examWeekBoost;
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
        validNow,
        validNow,
      );

      const blocks = planBlockDates({
        examDate: exam.examDate,
        startDate,
        dailyMinutes,
        examWeekBoost,
        today: validToday,
      });
      for (const block of blocks) {
        this.insertBlock.run(
          uuidv7(),
          id,
          this.profileId,
          block.date,
          block.minutes,
          "planned",
          validNow,
          validNow,
        );
      }

      return {
        id,
        profileId: this.profileId,
        examId: exam.id,
        dailyMinutes,
        startDate,
        examWeekBoost,
        createdAt: validNow,
        updatedAt: validNow,
      };
    })();
  }

  /**
   * Applies a partial field patch to an active plan, then regenerates its
   * future blocks: existing `planned` blocks on/after `today` are dropped and
   * recomputed from the engine with the updated parameters, skipping any date
   * that still has a row (a `done`/`missed` block, or a past block) — all in
   * one transaction.
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

    this.assertPlannable(exam.examDate, startDate, validToday);

    return this.db.transaction((): StudyPlan => {
      this.updatePlanFields.run(
        dailyMinutes,
        startDate,
        examWeekBoost ? 1 : 0,
        validNow,
        current.id,
        this.profileId,
      );

      this.regenerateBlocks(
        current.id,
        exam.examDate,
        dailyMinutes,
        startDate,
        examWeekBoost,
        validToday,
        validNow,
      );

      return { ...current, dailyMinutes, startDate, examWeekBoost, updatedAt: validNow };
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

  /**
   * Idempotent per-plan sync, in one transaction: (1) past `planned` blocks
   * become `missed`; (2) future `planned` blocks are dropped; (3) unless the
   * exam date is on/before `today`, they are regenerated from the engine,
   * skipping any date that already has a row. Running this twice with the
   * same `today` leaves the block set unchanged.
   */
  sync(planId: string, now: string, today: string): void {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const current = this.requireActivePlan(planId);
    const exam = this.resolveActiveExam(current.examId);

    this.db.transaction((): void => {
      this.markPastPlannedMissed.run(validNow, current.id, this.profileId, validToday);
      this.regenerateBlocks(
        current.id,
        exam.examDate,
        current.dailyMinutes,
        current.startDate,
        current.examWeekBoost,
        validToday,
        validNow,
      );
    })();
  }

  /** Syncs every active plan of this profile whose exam is still active; returns how many were synced. */
  syncAll(now: string, today: string): number {
    const validNow = validateNow(now);
    const validToday = validateBareDate(today, "today");
    const ids = (
      this.selectActivePlanIdsWithActiveExam.all(this.profileId) as { id: string }[]
    ).map((row) => row.id);
    for (const id of ids) {
      this.sync(id, validNow, validToday);
    }
    return ids.length;
  }

  /**
   * Shared "drop future planned blocks, regenerate from the engine, skip dates
   * that already have a row" step used by both `updatePlan` and `sync`.
   * Regeneration is skipped entirely once the exam date is on/before `today`
   * (the caller's future-block drop still runs beforehand).
   */
  private regenerateBlocks(
    planId: string,
    examDate: string,
    dailyMinutes: number,
    startDate: string,
    examWeekBoost: boolean,
    today: string,
    now: string,
  ): void {
    this.deleteFuturePlannedBlocks.run(planId, this.profileId, today);

    if (dateKey(examDate) <= today) return; // exam passed/today: nothing to regenerate

    const existingDates = new Set(
      (this.selectBlockDatesForPlan.all(planId, this.profileId) as { block_date: string }[]).map(
        (row) => row.block_date,
      ),
    );

    const blocks = planBlockDates({ examDate, startDate, dailyMinutes, examWeekBoost, today });
    for (const block of blocks) {
      if (existingDates.has(block.date)) continue;
      this.insertBlock.run(
        uuidv7(),
        planId,
        this.profileId,
        block.date,
        block.minutes,
        "planned",
        now,
        now,
      );
    }
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toBlockWithExam(row: StudyBlockWithExamRow): StudyBlockWithExam {
  return { ...toBlock(row), examId: row.exam_id };
}

/** The bare "YYYY-MM-DD" prefix of a date-like string (exam dates may carry a time part). */
function dateKey(value: string): string {
  return value.slice(0, 10);
}

function validateDailyMinutes(value: number): number {
  if (!Number.isInteger(value) || value < MIN_DAILY_MINUTES || value > MAX_DAILY_MINUTES) {
    throw new PlanValidationError(
      `"dailyMinutes" must be an integer between ${MIN_DAILY_MINUTES} and ${MAX_DAILY_MINUTES}.`,
    );
  }
  return value;
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

/** better-sqlite3 raises `SQLITE_CONSTRAINT_UNIQUE` for a violated UNIQUE/partial-unique index. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE"
  );
}
