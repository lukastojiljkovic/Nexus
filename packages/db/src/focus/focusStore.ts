import type Database from "better-sqlite3-multiple-ciphers";
import { FOCUS_OUTCOMES, FOCUS_PHASE_KINDS } from "@nexus/core";
import type { FocusOutcome, FocusPhaseKind } from "@nexus/core";
import { FocusNotFoundError, FocusValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * The ceiling on a planned phase — `validateFocusConfig`'s own widest bound
 * (`workMinutes` tops out at 180). A store is never the place that assumes its
 * caller validated the config, so the same line is drawn here.
 */
export const MAX_FOCUS_PLANNED_MINUTES = 180;

/**
 * How many phases one `cycle_index` may count. Not a semantic limit — nobody
 * runs a thousand Pomodoros in a sitting — but an untrusted integer going into a
 * column, and a bound is cheaper than discovering the absence of one
 * (`MAX_HABIT_COUNT`'s reasoning, one module over).
 */
export const MAX_FOCUS_CYCLE_INDEX = 9_999;

/** „Pisanje izveštaja", „Glava 4" — a label is a title, not a paragraph. Matches the note-title ceiling. */
export const MAX_FOCUS_LABEL_LENGTH = 200;

/** Accepts a full ISO-8601 date-time (the `now`/`startedAt`/`endedAt` every method takes). */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MS_PER_SECOND = 1000;

/**
 * One FINISHED focus session — the single row type behind the one focus timer
 * this product has (migration 057).
 *
 * **A focus session is a period of deliberate attention, optionally planned,
 * optionally attached to a subject or a task.** STUDY's open-ended study timer
 * is that sentence with `kind: "work"` and `plannedMinutes: null`; a Pomodoro
 * phase is the same sentence with a plan. One table, one store, one history —
 * the founder's rule: „nećemo da imamo više tajmera, mislim da je to loše".
 *
 * **One row is one PHASE, not one cycle** — see
 * `packages/core/src/focus/focusSession.ts` for why, which is that a phase's
 * duration is checkable against the wall clock and a cycle's is not.
 *
 * **Only finished sessions are ever rows.** A RUNNING one lives as
 * main-process runtime state (migration 008's decision, upheld), so a crash
 * loses the in-progress timer honestly instead of this store persisting a
 * duration nobody observed. That is why there is no `pausedAt` here, no
 * „running" state to reconcile, and no `abandoned` outcome: every row is a real,
 * observed, positive span, which is what lets the history be summed with no rule
 * about which outcomes are allowed to count.
 *
 * `pausedSeconds` is how much of that span was NOT attention. It accumulates in
 * memory while the phase runs and is written once, here, with the finished row —
 * so `endedAt - startedAt` is the wall span and the attention is the difference.
 */
export interface FocusSession {
  id: string;
  profileId: string;
  /** The subject studied, or null — a Pomodoro phase usually belongs to none. */
  subjectId: string | null;
  startedAt: string;
  endedAt: string;
  kind: FocusPhaseKind;
  /** The minutes the phase was set for, or null for an open-ended session. */
  plannedMinutes: number | null;
  /** Seconds of the span that were paused. Never more than the span itself. */
  pausedSeconds: number;
  /** How it ended, or null when nothing was recorded (every pre-057 row). */
  outcome: FocusOutcome | null;
  /** Which phase of the running cycle this was; 0 when the caller keeps no count. */
  cycleIndex: number;
  /** What was being worked on. Carries NO foreign key — see the field's note on `CreateFocusSessionInput`. */
  taskId: string | null;
  /** What the session was CALLED at the time — a snapshot, so the row stays readable once its task is gone. */
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Fields accepted when persisting a finished session. Only the two instants are
 * required: everything else describes a phase, and an omitted field means what
 * every pre-057 row already meant — a subjectless, unplanned, uncounted `work`
 * session.
 *
 * **`taskId` deliberately has no foreign key and is never resolved here.** A
 * focus session is a historical fact about time somebody actually spent, and it
 * must survive the deletion of whatever it pointed at: the half hour happened
 * whether or not the task still exists. `label` is the snapshot that keeps the
 * row readable afterwards. `subjectId` is the exception and keeps its key, because
 * it already had one and STUDY's stats read through it (migration 057's note).
 */
export interface CreateFocusSessionInput {
  startedAt: string;
  endedAt: string;
  subjectId?: string | null;
  kind?: FocusPhaseKind;
  plannedMinutes?: number | null;
  pausedSeconds?: number;
  outcome?: FocusOutcome | null;
  cycleIndex?: number;
  taskId?: string | null;
  label?: string | null;
}

interface FocusSessionRow {
  id: string;
  profile_id: string;
  subject_id: string | null;
  started_at: string;
  ended_at: string;
  kind: string;
  planned_minutes: number | null;
  paused_seconds: number;
  outcome: string | null;
  cycle_index: number;
  task_id: string | null;
  label: string | null;
  created_at: string;
  updated_at: string;
}

const COLUMNS =
  "id, profile_id, subject_id, started_at, ended_at, kind, planned_minutes, paused_seconds, " +
  "outcome, cycle_index, task_id, label, created_at, updated_at";

/**
 * Focus-session persistence for a single profile, over prepared, parameterized
 * statements (SEC-API-03; every value is bound, never interpolated). Construct
 * one per profile and reuse it. Inputs are revalidated here because the renderer
 * is untrusted (SEC-EL-02), and every statement is scoped by `profile_id` —
 * including the subject foreign key, which must resolve to a non-deleted subject
 * in THIS profile.
 *
 * This store lives under `focus/` rather than `study/` because it stopped being
 * STUDY's the moment one timer served both modules; nothing about its behaviour
 * changed in the move.
 *
 * **There is deliberately no per-kind aggregate here.** One existed
 * (`statsByKind`, a `GROUP BY kind` that subtracted `paused_seconds` in SQL) and
 * its doc claimed „what a Pomodoro history reads instead of walking `listRange`",
 * but no Pomodoro history ever read it: `FocusPage` groups and sums the rows
 * `listRange` returns, through the renderer's own `focusPhases.ts`, because the
 * page needs every kind present including the zeros and a SQL `GROUP BY` cannot
 * report a kind with no rows. Two definitions of „attention minutes", only one of
 * them exercised, is how the two drift apart — so the unread one is gone.
 */
export class FocusStore {
  private readonly insert: Database.Statement;
  private readonly selectSubjectActive: Database.Statement;
  private readonly selectInRange: Database.Statement;
  private readonly selectAllActive: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO focus_sessions
         (id, profile_id, subject_id, started_at, ended_at, kind, planned_minutes,
          paused_seconds, outcome, cycle_index, task_id, label, created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectSubjectActive = db.prepare(
      `SELECT id FROM subjects WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectInRange = db.prepare(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
         AND date(started_at, 'localtime') BETWEEN ? AND ?
       ORDER BY started_at DESC, id DESC`,
    );
    this.selectAllActive = db.prepare(
      `SELECT ${COLUMNS} FROM focus_sessions
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY started_at, id`,
    );
    this.markDeleted = db.prepare(
      `UPDATE focus_sessions SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE focus_sessions SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
  }

  /**
   * Persists a finished session. Rejects a malformed `now`/`startedAt`/`endedAt`,
   * an `endedAt` that does not strictly follow `startedAt`, a `subjectId` that
   * does not resolve to an active subject in this profile, and every phase field
   * outside its domain.
   *
   * `pausedSeconds` may not exceed the session's own wall span, which is the one
   * invariant no CHECK can state: a row whose pauses outlast its duration would
   * report NEGATIVE attention, and a focus total that can go below zero is worse
   * than no total at all.
   */
  create(input: CreateFocusSessionInput, now: string): FocusSession {
    const validNow = validateDateTime(now, "now");
    const startedAt = validateDateTime(input.startedAt, "startedAt");
    const endedAt = validateDateTime(input.endedAt, "endedAt");
    // Compared as STRINGS, mirroring migration 008's CHECK exactly, so this
    // refuses precisely what the database would.
    if (endedAt <= startedAt) {
      throw new FocusValidationError('"endedAt" must be strictly after "startedAt".');
    }

    const subjectId =
      input.subjectId === undefined || input.subjectId === null
        ? null
        : this.resolveSubject(input.subjectId);
    const kind = validateEnum(input.kind ?? "work", "kind", FOCUS_PHASE_KINDS);
    const plannedMinutes =
      input.plannedMinutes === undefined || input.plannedMinutes === null
        ? null
        : validateInt(input.plannedMinutes, "plannedMinutes", 1, MAX_FOCUS_PLANNED_MINUTES);
    const pausedSeconds = validateInt(
      input.pausedSeconds ?? 0,
      "pausedSeconds",
      0,
      spanSeconds(startedAt, endedAt),
    );
    const outcome =
      input.outcome === undefined || input.outcome === null
        ? null
        : validateEnum(input.outcome, "outcome", FOCUS_OUTCOMES);
    const cycleIndex = validateInt(input.cycleIndex ?? 0, "cycleIndex", 0, MAX_FOCUS_CYCLE_INDEX);
    const taskId = validateOptionalId(input.taskId ?? null, "taskId");
    const label = validateLabel(input.label ?? null);
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, subjectId, startedAt, endedAt, kind, plannedMinutes,
      pausedSeconds, outcome, cycleIndex, taskId, label, validNow, validNow,
    );

    return {
      id, profileId: this.profileId, subjectId, startedAt, endedAt, kind, plannedMinutes,
      pausedSeconds, outcome, cycleIndex, taskId, label,
      createdAt: validNow, updatedAt: validNow,
    };
  }

  /**
   * Active sessions of this profile whose local start day falls in
   * `[fromDate, toDate]`, newest first (started_at then id, both descending).
   * Every kind, so a Pomodoro history can group them itself.
   */
  listRange(fromDate: string, toDate: string): FocusSession[] {
    const validFrom = validateBareDate(fromDate, "fromDate");
    const validTo = validateBareDate(toDate, "toDate");
    const rows = this.selectInRange.all(this.profileId, validFrom, validTo) as FocusSessionRow[];
    return rows.map(toFocusSession);
  }

  /**
   * Every active session of this profile, no date bounds (IMEX full export),
   * ordered by start time then id — unlike `listRange`, never filtered to a
   * local-day window.
   */
  listActive(): FocusSession[] {
    const rows = this.selectAllActive.all(this.profileId) as FocusSessionRow[];
    return rows.map(toFocusSession);
  }

  /** Soft-deletes an active session (reversible via `restore`). */
  softDelete(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markDeleted.run(validNow, validNow, id, this.profileId);
    if (changes === 0) {
      throw new FocusNotFoundError(`No active focus session "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted session (undo of a delete). */
  restore(id: string, now: string): void {
    const validNow = validateDateTime(now, "now");
    const { changes } = this.markRestored.run(validNow, id, this.profileId);
    if (changes === 0) {
      throw new FocusNotFoundError(`No deleted focus session "${id}" to restore in this profile.`);
    }
  }

  /**
   * Validates a subject id references a non-deleted subject in this profile
   * (mirrors `ExamStore.resolveSubject`): the same-profile scope on the lookup
   * is what stops a session from pointing at another profile's subject.
   * Public so the desktop main process can check a subject before recording a
   * running timer, without duplicating this query.
   */
  resolveSubject(subjectId: string): string {
    const subject = this.selectSubjectActive.get(subjectId, this.profileId);
    if (!subject) {
      throw new FocusValidationError(
        `subjectId "${subjectId}" does not reference a subject in this profile.`,
      );
    }
    return subjectId;
  }
}

function toFocusSession(row: FocusSessionRow): FocusSession {
  return {
    id: row.id,
    profileId: row.profile_id,
    subjectId: row.subject_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    kind: row.kind as FocusPhaseKind,
    plannedMinutes: row.planned_minutes,
    pausedSeconds: row.paused_seconds,
    outcome: row.outcome as FocusOutcome | null,
    cycleIndex: row.cycle_index,
    taskId: row.task_id,
    label: row.label,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The session's wall span in whole seconds — the ceiling `pausedSeconds` is bounded by. */
function spanSeconds(startedAt: string, endedAt: string): number {
  return Math.floor((Date.parse(endedAt) - Date.parse(startedAt)) / MS_PER_SECOND);
}

function validateBareDate(value: string, field: string): string {
  if (!BARE_DATE.test(value)) {
    throw new FocusValidationError(`"${field}" must be a bare YYYY-MM-DD date.`);
  }
  return value;
}

function validateDateTime(value: string, field: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new FocusValidationError(`"${field}" must be an ISO-8601 date-time.`);
  }
  return value;
}

/** A whole number inside a closed range — never a float, for migration 057's typeof-integer CHECKs. */
function validateInt(value: number, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new FocusValidationError(`"${field}" must be a whole number between ${min} and ${max}.`);
  }
  return value;
}

function validateEnum<T extends string>(
  value: string,
  field: string,
  allowed: readonly T[],
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new FocusValidationError(`"${field}" must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

/** A reference this store deliberately does not resolve (see `CreateFocusSessionInput`) — only that it is not an empty string pretending to be one. */
function validateOptionalId(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (value.length === 0) {
    throw new FocusValidationError(`"${field}" must be a non-empty id or null.`);
  }
  return value;
}

/** Trims the label; absent/empty/whitespace-only collapses to null, and an over-long one is refused rather than truncated. */
function validateLabel(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_FOCUS_LABEL_LENGTH) {
    throw new FocusValidationError(
      `"label" must be at most ${MAX_FOCUS_LABEL_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}
