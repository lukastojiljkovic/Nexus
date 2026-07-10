import type Database from "better-sqlite3-multiple-ciphers";
import { FocusValidationError } from "../errors.js";

type DatabaseHandle = Database.Database;

/** Total active focus-session minutes for one subject in a date range. */
export interface SubjectMinutes {
  subjectId: string;
  minutes: number;
}

/** Review counts per local day in a range, plus the range's total. */
export interface ReviewCounts {
  total: number;
  perDay: Array<{ day: string; count: number }>;
}

/** Done/missed study-block counts in a range, over blocks of active plans. */
export interface BlockTotals {
  done: number;
  missed: number;
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new FocusValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

/**
 * Read-only STUDY statistics for a single profile, over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `PlanStore`/`FocusStore`: construct one per profile,
 * reuse it. Date-range params are bare "YYYY-MM-DD" and validated the same way
 * as `PlanStore.listBlocksInRange`.
 *
 * Every query buckets by `date(x, 'localtime')` — the underlying timestamps
 * are UTC ISO-8601 instants, but stats are read as the user's own local
 * calendar days, mirroring `PlanStore`'s local-calendar `today` idiom.
 */
export class StatsStore {
  private readonly subjectMinutesStatement: Database.Statement;
  private readonly activityDaysReviewLog: Database.Statement;
  private readonly activityDaysFocusSessions: Database.Statement;
  private readonly activityDaysStudyBlocks: Database.Statement;
  private readonly reviewCountsStatement: Database.Statement;
  private readonly blockTotalsStatement: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.subjectMinutesStatement = db.prepare(`
      SELECT subject_id, SUM((julianday(ended_at) - julianday(started_at)) * 1440) AS minutes
        FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
         AND date(started_at, 'localtime') BETWEEN ? AND ?
       GROUP BY subject_id
       ORDER BY minutes DESC, subject_id
    `);

    this.activityDaysReviewLog = db.prepare(`
      SELECT DISTINCT date(review, 'localtime') AS day
        FROM review_log
       WHERE profile_id = ?
         AND date(review, 'localtime') BETWEEN ? AND ?
    `);

    this.activityDaysFocusSessions = db.prepare(`
      SELECT DISTINCT date(started_at, 'localtime') AS day
        FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
         AND date(started_at, 'localtime') BETWEEN ? AND ?
    `);

    this.activityDaysStudyBlocks = db.prepare(`
      SELECT DISTINCT date(b.updated_at, 'localtime') AS day
        FROM study_blocks b
        JOIN study_plans p
          ON p.id = b.plan_id AND p.profile_id = b.profile_id AND p.deleted_at IS NULL
       WHERE b.profile_id = ? AND b.status = 'done'
         AND date(b.updated_at, 'localtime') BETWEEN ? AND ?
    `);

    this.reviewCountsStatement = db.prepare(`
      SELECT date(review, 'localtime') AS day, COUNT(*) AS count
        FROM review_log
       WHERE profile_id = ?
         AND date(review, 'localtime') BETWEEN ? AND ?
       GROUP BY day
       ORDER BY day ASC
    `);

    this.blockTotalsStatement = db.prepare(`
      SELECT
        SUM(CASE WHEN b.status = 'done' THEN 1 ELSE 0 END) AS done,
        SUM(CASE WHEN b.status = 'missed' THEN 1 ELSE 0 END) AS missed
        FROM study_blocks b
        JOIN study_plans p
          ON p.id = b.plan_id AND p.profile_id = b.profile_id AND p.deleted_at IS NULL
       WHERE b.profile_id = ?
         AND b.block_date BETWEEN ? AND ?
    `);
  }

  /**
   * Total active focus-session minutes per subject whose local start day falls
   * in `[fromDate, toDate]`, rounded to the nearest integer minute; subjects
   * with zero time in range are simply absent. Ordered by minutes descending,
   * then subject id.
   */
  subjectMinutes(fromDate: string, toDate: string): SubjectMinutes[] {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const rows = this.subjectMinutesStatement.all(this.profileId, validFrom, validTo) as {
      subject_id: string;
      minutes: number;
    }[];
    return rows.map((row) => ({ subjectId: row.subject_id, minutes: Math.round(row.minutes) }));
  }

  /**
   * Distinct, sorted local days with any study activity in `[fromDate, toDate]`
   * — the union of review days (`review_log`), active focus-session start days,
   * and days a study block was marked done (`updated_at`, joined through active
   * plans; a documented approximation — re-toggling a block moves its activity
   * day).
   */
  activityDays(fromDate: string, toDate: string): string[] {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const days = new Set<string>();
    for (const statement of [
      this.activityDaysReviewLog,
      this.activityDaysFocusSessions,
      this.activityDaysStudyBlocks,
    ]) {
      for (const row of statement.all(this.profileId, validFrom, validTo) as { day: string }[]) {
        days.add(row.day);
      }
    }
    return [...days].sort();
  }

  /** Review counts per local day in `[fromDate, toDate]`, ascending, plus the range's total. */
  reviewCounts(fromDate: string, toDate: string): ReviewCounts {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const rows = this.reviewCountsStatement.all(this.profileId, validFrom, validTo) as {
      day: string;
      count: number;
    }[];
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    return { total, perDay: rows.map((row) => ({ day: row.day, count: row.count })) };
  }

  /** Done/missed study-block counts joined through active plans, ranged on `block_date`. */
  blockTotals(fromDate: string, toDate: string): BlockTotals {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const row = this.blockTotalsStatement.get(this.profileId, validFrom, validTo) as {
      done: number | null;
      missed: number | null;
    };
    return { done: row.done ?? 0, missed: row.missed ?? 0 };
  }
}
