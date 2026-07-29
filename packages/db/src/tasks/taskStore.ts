import type Database from "better-sqlite3-multiple-ciphers";
import {
  isValidDayKey,
  nextOccurrenceDate,
  serializeRecurrenceRule,
  validateRecurrenceRule,
} from "@nexus/core";
import type { RecurrenceRule } from "@nexus/core";
import { TaskNotFoundError, TaskValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/**
 * Closed status domain (migration 002 CHECK). The one field that serves both
 * list check-off — a task is done exactly when its status is 'done' — and
 * kanban columns, since the views engine groups on a select field (TASK-005).
 */
export type TaskStatus = "todo" | "doing" | "done";

/** Closed priority domain — the four levels of TASK-001. */
export type TaskPriority = "none" | "low" | "medium" | "high";

/** Status options in kanban-column order; the UI maps them onto a select field. */
export const TASK_STATUSES: readonly TaskStatus[] = ["todo", "doing", "done"];

/** Priority options in ascending order; the UI maps them onto a select field. */
export const TASK_PRIORITIES: readonly TaskPriority[] = ["none", "low", "medium", "high"];

/**
 * A task as the store returns it: camelCase keys that map straight onto a views
 * engine `CollectionSchema` (status/priority → select, dueDate → date, title →
 * text, done → boolean) with no adapter. `done` is derived from `status`.
 */
export interface Task {
  id: string;
  profileId: string;
  parentId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** Derived (`status === 'done'`): the list check-off state (TASK-008). */
  done: boolean;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /**
   * The rule this task advances by when an occurrence is completed (ADR-024),
   * or null for a one-off. Never non-null without a bare-date `dueDate` — the
   * date the rule phases from (`assertRecurrenceAnchor`).
   */
  recurrence: RecurrenceRule | null;
}

/** Fields accepted when creating a task; only `title` is required (TASK-001). */
export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  parentId?: string | null;
  recurrence?: RecurrenceRule | null;
}

/**
 * A partial patch of a task's own fields. An omitted key is left untouched; an
 * explicit `null` clears a nullable field. Structural moves (reparenting,
 * soft delete) have their own methods.
 */
export interface UpdateTaskFields {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  dueDate?: string | null;
  startDate?: string | null;
  recurrence?: RecurrenceRule | null;
}

interface TaskRow {
  id: string;
  profile_id: string;
  parent_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  recurrence: string | null;
}

const COLUMNS =
  "id, profile_id, parent_id, title, description, status, priority, " +
  "due_date, start_date, created_at, updated_at, completed_at, recurrence";

/** Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned (PRD §7). */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Task persistence for a single profile, over prepared, parameterized statements
 * (SEC-API-03; every value is bound, never interpolated). Mirrors
 * `SqliteFlagStore`: construct one per profile, reuse it. Inputs are revalidated
 * here because the renderer is untrusted (SEC-EL-02), and every statement is
 * scoped by `profile_id` so one profile's tasks are invisible to another's store.
 */
export class TaskStore {
  private readonly insert: Database.Statement;
  private readonly selectActive: Database.Statement;
  private readonly selectActiveById: Database.Statement;
  private readonly updateFields: Database.Statement;
  private readonly markDeleted: Database.Statement;
  private readonly markRestored: Database.Statement;
  private readonly reopenSubtasks: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, recurrence, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM tasks
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY created_at, id`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM tasks
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE tasks
         SET title = ?, description = ?, status = ?, priority = ?,
             due_date = ?, start_date = ?, recurrence = ?, completed_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markDeleted = db.prepare(
      `UPDATE tasks SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markRestored = db.prepare(
      `UPDATE tasks SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    // A fresh occurrence starts with a fresh checklist: every live subtask goes
    // back to open, whatever it was. `deleted_at IS NULL` is what keeps a
    // subtask the user deleted from being resurrected by the next occurrence.
    this.reopenSubtasks = db.prepare(
      `UPDATE tasks SET status = 'todo', completed_at = NULL, updated_at = ?
       WHERE parent_id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
  }

  /** Active tasks for this profile in stable creation order (soft-deleted excluded). */
  listActive(): Task[] {
    const rows = this.selectActive.all(this.profileId) as TaskRow[];
    return rows.map(toTask);
  }

  /** Inserts a task, applying defaults, and returns the stored row (TASK-001). */
  create(input: CreateTaskInput): Task {
    const title = validateTitle(input.title);
    const status = validateStatus(input.status ?? "todo");
    const priority = validatePriority(input.priority ?? "none");
    const description = normalizeOptional(input.description);
    const dueDate = validateDate(input.dueDate, "dueDate");
    const startDate = validateDate(input.startDate, "startDate");
    const recurrence = validateRecurrence(input.recurrence);
    assertRecurrenceAnchor(recurrence, dueDate);
    const parentId = this.resolveParent(input.parentId);
    const now = new Date().toISOString();
    const completedAt = status === "done" ? now : null;
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, parentId, title, description, status, priority,
      dueDate, startDate, now, now, completedAt, serializeRecurrence(recurrence),
    );

    return {
      id, profileId: this.profileId, parentId, title, description, status,
      priority, done: status === "done", dueDate, startDate,
      createdAt: now, updatedAt: now, completedAt, recurrence,
    };
  }

  /** Applies a partial field patch to an active task (TASK-001 editing). */
  update(id: string, fields: UpdateTaskFields): Task {
    const current = this.requireActive(id);
    const status = fields.status !== undefined ? validateStatus(fields.status) : current.status;
    const recurrence =
      fields.recurrence !== undefined ? validateRecurrence(fields.recurrence) : current.recurrence;
    // The same refusal `setDone` makes, against the MERGED pair: the generic
    // field editor is the kanban drag's write path, and dragging a recurring
    // task into Done means "this occurrence is done", never "end the series".
    // Only the transition is refused — an already-done task (an exhausted
    // series keeps its rule as inert history) still takes ordinary edits.
    if (status === "done" && current.status !== "done" && recurrence !== null) {
      throw new TaskValidationError(
        `Task "${id}" recurs; complete this occurrence with completeOccurrence instead.`,
      );
    }
    return this.writeFields(current, {
      title: fields.title !== undefined ? validateTitle(fields.title) : current.title,
      description:
        fields.description !== undefined
          ? normalizeOptional(fields.description)
          : current.description,
      status,
      priority:
        fields.priority !== undefined ? validatePriority(fields.priority) : current.priority,
      dueDate:
        fields.dueDate !== undefined ? validateDate(fields.dueDate, "dueDate") : current.dueDate,
      startDate:
        fields.startDate !== undefined
          ? validateDate(fields.startDate, "startDate")
          : current.startDate,
      recurrence,
    });
  }

  /**
   * Checks a task off or reopens it (TASK-008). `true` sets status 'done';
   * `false` reverts to 'todo'. The completion timestamp follows (PRD §7).
   *
   * Checking off a **recurring** task is refused outright: what the user means
   * there is "this occurrence is done", which is `completeOccurrence` — a
   * different write entirely (ADR-024). Every caller of this method predates
   * recurrence, so failing loudly is what stops one of them from silently
   * ending a series the user only meant to tick off for today. Reopening
   * (`false`) is never ambiguous and stays available.
   */
  setDone(id: string, done: boolean): Task {
    const current = this.requireActive(id);
    if (done && current.recurrence !== null) {
      throw new TaskValidationError(
        `Task "${id}" recurs; complete this occurrence with completeOccurrence instead.`,
      );
    }
    return this.writeFields(current, {
      ...ownFields(current),
      status: done ? "done" : "todo",
    });
  }

  /**
   * Completes the *current occurrence* of a task (ADR-024, the Todoist model:
   * a recurring task advances in place rather than spawning rows). Returns the
   * task as it now stands — for a series that continues, that is the same row
   * carrying its next `dueDate`, which is what a caller reports to the user.
   *
   * `now` is the caller's clock (every write below shares it, so the parent
   * and its subtasks carry the same stamp).
   *
   * Three outcomes:
   *  - No rule: exactly `setDone(id, true)`, delegated so there is one
   *    completion path and not two.
   *  - Rule exhausted (`nextOccurrenceDate` returns null, or a `count` with
   *    nothing left after this one): the task genuinely completes, and **keeps
   *    its rule** as inert history — clearing it would erase what the task was.
   *  - Otherwise: one transaction moves `dueDate` to the next occurrence, ticks
   *    a `count` end down by one, resets the task's own status to `todo` (a
   *    fresh occurrence has not been started, so `doing` cycles back), and
   *    reopens every live subtask — recurrence copies structure, never
   *    completion state.
   *
   * The anchor is the task's *current* `dueDate`, so each advance re-anchors:
   * moving a recurring task moves the rest of its series with it.
   */
  completeOccurrence(id: string, now: string): Task {
    const current = this.requireActive(id);
    const rule = current.recurrence;
    if (rule === null) return this.setDone(id, true);

    // Every write path upholds rule-implies-due-date; re-read as a value here
    // because the type cannot say so, and because a hand-edited row must not
    // reach the engine (which throws `TypeError` on a non-day-key anchor).
    const anchor = requireRecurrenceAnchor(current.dueDate);

    const next = nextOccurrenceDate(rule, anchor, anchor);
    // `total - 1`, or null when the rule does not end by count. A count of 1
    // normally makes `next` null on its own; the guard also covers the rule
    // whose anchor sits outside its own pattern, where the engine still finds a
    // later occurrence and a plain decrement would store an invalid `total` 0.
    const remaining = rule.end.kind === "count" ? rule.end.total - 1 : null;
    if (next === null || (remaining !== null && remaining < 1)) {
      return this.writeFields(current, { ...ownFields(current), status: "done" }, now);
    }

    return this.db.transaction((): Task => {
      const advanced = this.writeFields(
        current,
        {
          ...ownFields(current),
          status: "todo",
          dueDate: next,
          recurrence:
            remaining === null ? rule : { freq: rule.freq, end: { kind: "count", total: remaining } },
        },
        now,
      );
      this.reopenSubtasks.run(now, id, this.profileId);
      return advanced;
    })();
  }

  /** Soft-deletes an active task (PRD delete semantics; reversible via `restore`). */
  softDelete(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new TaskNotFoundError(`No active task "${id}" to delete in this profile.`);
    }
  }

  /** Restores a soft-deleted task (undo of a delete, TASK-011). */
  restore(id: string): void {
    const now = new Date().toISOString();
    const { changes } = this.markRestored.run(now, id, this.profileId);
    if (changes === 0) {
      throw new TaskNotFoundError(`No deleted task "${id}" to restore in this profile.`);
    }
  }

  /** Reads an active task in this profile or throws — enforces scope + existence. */
  private requireActive(id: string): Task {
    const row = this.selectActiveById.get(id, this.profileId) as TaskRow | undefined;
    if (!row) {
      throw new TaskNotFoundError(`No active task "${id}" in this profile.`);
    }
    return toTask(row);
  }

  /**
   * Writes a fully-resolved field set, deriving the completion timestamp from the
   * target status: stamped when a task becomes done (its original stamp kept if
   * it already was), cleared otherwise — the single place that upholds the
   * status/completed_at invariant the schema also CHECKs, and (since the schema
   * cannot) the rule/due-date invariant against the MERGED pair, so a patch that
   * clears the date of a recurring task is caught just as a patch that adds a
   * rule to a dateless one is.
   *
   * `at` defaults to the wall clock; `completeOccurrence` passes its caller's
   * `now` so a parent and its subtasks carry one stamp.
   */
  private writeFields(
    current: Task,
    next: Required<UpdateTaskFields>,
    at: string = new Date().toISOString(),
  ): Task {
    assertRecurrenceAnchor(next.recurrence, next.dueDate);
    const completedAt = next.status === "done" ? (current.completedAt ?? at) : null;

    this.updateFields.run(
      next.title, next.description, next.status, next.priority,
      next.dueDate, next.startDate, serializeRecurrence(next.recurrence), completedAt, at,
      current.id, this.profileId,
    );

    return {
      ...current,
      ...next,
      done: next.status === "done",
      completedAt,
      updatedAt: at,
    };
  }

  /** Validates an optional parent id belongs to an active task in this profile. */
  private resolveParent(parentId: string | null | undefined): string | null {
    if (parentId === undefined || parentId === null) return null;
    const parent = this.selectActiveById.get(parentId, this.profileId);
    if (!parent) {
      throw new TaskValidationError(
        `parentId "${parentId}" does not reference a task in this profile.`,
      );
    }
    return parentId;
  }
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    profileId: row.profile_id,
    parentId: row.parent_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    done: row.status === "done",
    dueDate: row.due_date,
    startDate: row.start_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    recurrence: parseStoredRecurrence(row.recurrence, row.id),
  };
}

/** A task's own patchable fields as they currently stand — the base every full-row write starts from. */
function ownFields(task: Task): Required<UpdateTaskFields> {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    dueDate: task.dueDate,
    startDate: task.startDate,
    recurrence: task.recurrence,
  };
}

function validateTitle(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TaskValidationError("Task title must not be empty.");
  }
  return trimmed;
}

function validateStatus(value: TaskStatus): TaskStatus {
  if (!TASK_STATUSES.includes(value)) {
    throw new TaskValidationError(`Unknown task status "${value}".`);
  }
  return value;
}

function validatePriority(value: TaskPriority): TaskPriority {
  if (!TASK_PRIORITIES.includes(value)) {
    throw new TaskValidationError(`Unknown task priority "${value}".`);
  }
  return value;
}

function validateDate(value: string | null | undefined, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (!ISO_8601.test(value)) {
    throw new TaskValidationError(`"${field}" must be an ISO-8601 date or date-time.`);
  }
  return value;
}

/**
 * Structural validation of a recurrence rule from an untrusted caller
 * (SEC-EL-02), returning the canonical form the column stores. An already-typed
 * rule object goes through the validator too: the type says nothing about an
 * interval of 0 or a `count` of 5000.
 */
function validateRecurrence(value: RecurrenceRule | null | undefined): RecurrenceRule | null {
  if (value === undefined || value === null) return null;
  const rule = validateRecurrenceRule(value);
  if (rule === null) {
    throw new TaskValidationError('"recurrence" is not a valid recurrence rule.');
  }
  return rule;
}

/**
 * A recurring task phases from its own due date, so there must BE one, and it
 * must be a bare calendar day the engine can anchor on — a timestamped due date
 * has no place in a day-to-day series (and is not what the interchange contract
 * declares for a task's `dueDate` either). Returns it, so the one caller that
 * needs the anchor as a value gets it without re-narrowing.
 */
function requireRecurrenceAnchor(dueDate: string | null): string {
  if (dueDate === null) {
    throw new TaskValidationError("A recurring task must have a dueDate for its rule to advance.");
  }
  if (!isValidDayKey(dueDate)) {
    throw new TaskValidationError(
      `A recurring task's dueDate must be a bare calendar date (got "${dueDate}").`,
    );
  }
  return dueDate;
}

/** The same invariant as a precondition on a write: only a ruled task needs an anchor. */
function assertRecurrenceAnchor(rule: RecurrenceRule | null, dueDate: string | null): void {
  if (rule !== null) requireRecurrenceAnchor(dueDate);
}

function serializeRecurrence(rule: RecurrenceRule | null): string | null {
  return rule === null ? null : serializeRecurrenceRule(rule);
}

/**
 * Reads the stored column back. This store writes only `serializeRecurrenceRule`
 * output, so anything that fails to validate is corruption (a hand-edited file,
 * a bad restore) rather than input to be coerced — reading it as `null` would
 * silently turn a user's series into a one-off, so it throws naming the row.
 */
function parseStoredRecurrence(text: string | null, id: string): RecurrenceRule | null {
  if (text === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const rule = validateRecurrenceRule(parsed);
  if (rule === null) {
    throw new TaskValidationError(`Task "${id}" carries a stored recurrence rule that is not valid.`);
  }
  return rule;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
