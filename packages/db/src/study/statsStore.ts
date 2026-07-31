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

/**
 * One LOCAL calendar day of a subject's study log (STUDY-014). Every field is a
 * fact about that day and nothing else: how many cards of this subject were
 * reviewed, how many minutes of focus it held, how many minutes its study plans
 * asked for, and which of its exams fell on it. A day with all four at zero is
 * never in the log — the timeline is built from what happened, not from a
 * calendar.
 */
export interface StudyLogDay {
  day: string;
  reviews: number;
  focusMinutes: number;
  plannedMinutes: number;
  examIds: string[];
}

/**
 * A subject's study log over ONE bounded day range, newest day first, plus
 * whether the subject has anything at all before `fromDay`.
 *
 * `hasOlder` is the honest half of the bound: the caller pages by asking for
 * successively older ranges, and this is what tells it whether another page
 * exists — rather than inferring "nothing older" from one empty page, which a
 * summer between two semesters would make a lie.
 */
export interface SubjectStudyLog {
  days: StudyLogDay[];
  hasOlder: boolean;
}

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MINUTE_MS = 60_000;

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new FocusValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

/**
 * The instant a LOCAL calendar day starts, `offsetDays` days after `day`, as an
 * ISO-8601 string — built from wall-clock y/m/d fields exactly as
 * `CardStore.reviewsDoneToday` builds the daily cap's window, so the study log
 * and the cap agree on where a day begins. `day` has already passed
 * `validateBareDate`, so the three slices are always numbers.
 */
function localDayStart(day: string, offsetDays: number): string {
  const year = Number(day.slice(0, 4));
  const month = Number(day.slice(5, 7));
  const dayOfMonth = Number(day.slice(8, 10));
  return new Date(year, month - 1, dayOfMonth + offsetDays).toISOString();
}

/**
 * `review_log` -> its card -> its deck, because the deck is what carries the
 * subject; binds `profile_id` then `subject_id`, and leaves the WHERE open for
 * one more `AND`.
 *
 * Deliberately NOT filtered by `cards.deleted_at`/`decks.deleted_at`: a review
 * that happened, happened. Deleting the card afterwards does not unmake the
 * half hour spent on it, and dropping those rows would quietly shrink a day
 * the user remembers studying. (`activityDays`/`reviewCounts` above never
 * filter them either — they simply never need the join.)
 */
const REVIEW_SUBJECT_JOIN = `
        FROM review_log rl
        JOIN cards c ON c.id = rl.card_id AND c.profile_id = rl.profile_id
        JOIN decks d ON d.id = c.deck_id AND d.profile_id = c.profile_id
       WHERE rl.profile_id = ? AND d.subject_id = ?`;

/**
 * `study_blocks` -> its plan -> the plan's exam, because the exam is what
 * carries the subject; binds `profile_id` then `subject_id`, and leaves the
 * WHERE open for one more `AND`. Both hops are restricted to ACTIVE rows,
 * mirroring `blockTotals`: a soft-deleted plan is a plan the user withdrew, so
 * its blocks stop being minutes anyone ever planned.
 */
const BLOCK_SUBJECT_JOIN = `
        FROM study_blocks b
        JOIN study_plans p
          ON p.id = b.plan_id AND p.profile_id = b.profile_id AND p.deleted_at IS NULL
        JOIN exams e
          ON e.id = p.exam_id AND e.profile_id = b.profile_id AND e.deleted_at IS NULL
       WHERE b.profile_id = ? AND e.subject_id = ?`;

/**
 * The LOCAL calendar day an instant falls in, as a bare "YYYY-MM-DD" — the
 * bucketing counterpart of `localDayStart`, read off the instant's own
 * `getFullYear()/getMonth()/getDate()` rather than a UTC slice (which misdates
 * the last hours of every day in a positive-offset timezone, Belgrade
 * included). `null` for an unparseable instant, which is then simply not
 * bucketed: a row the log cannot date is never silently filed under today.
 */
function localDayKey(instant: string): string | null {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return null;
  const month = String(at.getMonth() + 1).padStart(2, "0");
  const day = String(at.getDate()).padStart(2, "0");
  return `${at.getFullYear()}-${month}-${day}`;
}

/**
 * Read-only STUDY statistics for a single profile, over prepared,
 * parameterized statements (SEC-API-03; every value is bound, never
 * interpolated). Mirrors `PlanStore`/`FocusStore`: construct one per profile,
 * reuse it. Date-range params are bare "YYYY-MM-DD" and validated the same way
 * as `PlanStore.listBlocksInRange`.
 *
 * Every query reads the user's own LOCAL calendar days, mirroring `PlanStore`'s
 * local-calendar `today` idiom — the underlying timestamps are UTC ISO-8601
 * instants. The summary reads (`subjectMinutes`, `activityDays`,
 * `reviewCounts`) let SQLite do it with `date(x, 'localtime')`, since they only
 * ever need the day as a grouping key. `studyLogForSubject` does it in
 * TypeScript instead, off each instant's own y/m/d — see its own note: it
 * composes four sources onto shared day keys, and those keys must be built the
 * one way `CardStore`'s daily cap already builds them.
 */
export class StatsStore {
  private readonly subjectMinutesStatement: Database.Statement;
  private readonly activityDaysReviewLog: Database.Statement;
  private readonly activityDaysFocusSessions: Database.Statement;
  private readonly activityDaysStudyBlocks: Database.Statement;
  private readonly reviewCountsStatement: Database.Statement;
  private readonly blockTotalsStatement: Database.Statement;
  private readonly logReviews: Database.Statement;
  private readonly logFocusSessions: Database.Statement;
  private readonly logBlocks: Database.Statement;
  private readonly logExams: Database.Statement;
  /**
   * The four "is there anything before this range" probes behind `hasOlder`,
   * each `LIMIT 1`. They are kept as a list because they are asked the same
   * question in the same order and answered by the first one that says yes;
   * `bound` only records which kind of cutoff each takes — an instant for the
   * two instant-stamped tables, a bare day for the two date-stamped ones.
   */
  private readonly olderProbes: ReadonlyArray<{
    statement: Database.Statement;
    bound: "instant" | "day";
  }>;

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

    // --- The per-subject study log (STUDY-014) ------------------------------
    // Four reads, one per source, each scoped to profile AND subject; the
    // bucketing itself is done in TypeScript (see `studyLogForSubject`), so
    // these hand back the raw fields and nothing else.
    this.logReviews = db.prepare(`
      SELECT rl.review AS review ${REVIEW_SUBJECT_JOIN} AND rl.review >= ? AND rl.review < ?
    `);
    this.logFocusSessions = db.prepare(`
      SELECT started_at, ended_at
        FROM focus_sessions
       WHERE profile_id = ? AND subject_id = ? AND deleted_at IS NULL
         AND started_at >= ? AND started_at < ?
    `);
    this.logBlocks = db.prepare(`
      SELECT b.block_date AS day, b.minutes AS minutes
        ${BLOCK_SUBJECT_JOIN} AND b.block_date BETWEEN ? AND ?
    `);
    this.logExams = db.prepare(`
      SELECT id, exam_date
        FROM exams
       WHERE profile_id = ? AND subject_id = ? AND deleted_at IS NULL
         AND substr(exam_date, 1, 10) BETWEEN ? AND ?
       ORDER BY exam_date, id
    `);

    this.olderProbes = [
      {
        bound: "instant",
        statement: db.prepare(`SELECT 1 AS x ${REVIEW_SUBJECT_JOIN} AND rl.review < ? LIMIT 1`),
      },
      {
        bound: "instant",
        statement: db.prepare(`
          SELECT 1 AS x FROM focus_sessions
           WHERE profile_id = ? AND subject_id = ? AND deleted_at IS NULL AND started_at < ?
           LIMIT 1
        `),
      },
      {
        bound: "day",
        statement: db.prepare(`SELECT 1 AS x ${BLOCK_SUBJECT_JOIN} AND b.block_date < ? LIMIT 1`),
      },
      {
        bound: "day",
        statement: db.prepare(`
          SELECT 1 AS x FROM exams
           WHERE profile_id = ? AND subject_id = ? AND deleted_at IS NULL
             AND substr(exam_date, 1, 10) < ?
           LIMIT 1
        `),
      },
    ];
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

  /**
   * One subject's study log over `[fromDay, toDay]` (STUDY-014): the reviews of
   * its cards, the focus time spent on it, the minutes its study plans asked
   * for, and the exams it holds — composed onto LOCAL calendar days, newest day
   * first, over data that already exists. Nothing is written and no table is
   * new; this read is the whole feature.
   *
   * **Where the day boundary comes from.** `review_log.review` and
   * `focus_sessions.started_at` are instants, and they are bucketed by each
   * row's OWN local y/m/d (`localDayKey`) — the reading `CardStore`'s daily cap
   * takes, because a day the user is shown must start where their day starts.
   * The range is therefore fetched as a half-open instant window
   * `[localDayStart(fromDay), localDayStart(toDay + 1))`, so a review logged at
   * exactly local midnight belongs to the day that starts there and to no
   * other. `study_blocks.block_date` and `exams.exam_date` are already local
   * calendar dates, so they are ranged and bucketed as text — no instant math
   * to get wrong.
   *
   * **Bounded, and honest about it.** The caller passes a window (the renderer
   * shows the last 60 days and widens it on demand); `hasOlder` says whether
   * the subject has anything at all before `fromDay`, so a widen offer is
   * withdrawn only when there is genuinely nothing left rather than after one
   * quiet stretch. An unknown or foreign `subjectId` is not an error here: every
   * statement is scoped by `profile_id` AND `subject_id`, so it can only ever
   * answer with an empty log.
   */
  studyLogForSubject(subjectId: string, fromDay: string, toDay: string): SubjectStudyLog {
    const from = validateBareDate(fromDay, "fromDay");
    const to = validateBareDate(toDay, "toDay");
    const rangeStart = localDayStart(from, 0);
    const rangeEnd = localDayStart(to, 1); // exclusive: the instant the day after `to` begins

    const days = new Map<string, StudyLogDay>();
    const entry = (day: string): StudyLogDay => {
      const existing = days.get(day);
      if (existing) return existing;
      const created: StudyLogDay = {
        day,
        reviews: 0,
        focusMinutes: 0,
        plannedMinutes: 0,
        examIds: [],
      };
      days.set(day, created);
      return created;
    };

    const reviewRows = this.logReviews.all(this.profileId, subjectId, rangeStart, rangeEnd) as {
      review: string;
    }[];
    for (const row of reviewRows) {
      const day = localDayKey(row.review);
      if (day !== null) entry(day).reviews += 1;
    }

    // Focus time is accumulated in milliseconds and rounded ONCE per day: two
    // sessions of 20 min and 25 min 40 s are 46 minutes of studying, not 20 + 26.
    const focusMs = new Map<string, number>();
    const focusRows = this.logFocusSessions.all(
      this.profileId,
      subjectId,
      rangeStart,
      rangeEnd,
    ) as { started_at: string; ended_at: string }[];
    for (const row of focusRows) {
      const day = localDayKey(row.started_at);
      if (day === null) continue;
      const ms = new Date(row.ended_at).getTime() - new Date(row.started_at).getTime();
      if (!Number.isFinite(ms) || ms <= 0) continue;
      focusMs.set(day, (focusMs.get(day) ?? 0) + ms);
    }
    for (const [day, ms] of focusMs) {
      // A day whose focus rounds to zero does not gain a row of its own: half a
      // minute of a timer started and stopped again is not a day of studying,
      // and a log line reading "0 min" would be noise. If the day is in the log
      // for another reason, its zero simply stays zero.
      const minutes = Math.round(ms / MINUTE_MS);
      if (minutes > 0) entry(day).focusMinutes = minutes;
    }

    // Every block of the day, whatever its status: the number being reported is
    // how many minutes the plan ASKED FOR that day, and a missed block asked
    // for its minutes just as loudly as a done one did.
    const blockRows = this.logBlocks.all(this.profileId, subjectId, from, to) as {
      day: string;
      minutes: number;
    }[];
    for (const row of blockRows) {
      entry(row.day).plannedMinutes += row.minutes;
    }

    const examRows = this.logExams.all(this.profileId, subjectId, from, to) as {
      id: string;
      exam_date: string;
    }[];
    for (const row of examRows) {
      entry(row.exam_date.slice(0, 10)).examIds.push(row.id);
    }

    return {
      days: [...days.values()].sort((a, b) => b.day.localeCompare(a.day)),
      hasOlder: this.olderProbes.some(
        (probe) =>
          probe.statement.get(
            this.profileId,
            subjectId,
            probe.bound === "instant" ? rangeStart : from,
          ) !== undefined,
      ),
    };
  }
}
