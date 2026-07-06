import type Database from "better-sqlite3-multiple-ciphers";
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
}

const COLUMNS =
  "id, profile_id, parent_id, title, description, status, priority, " +
  "due_date, start_date, created_at, updated_at, completed_at";

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

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
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
             due_date = ?, start_date = ?, completed_at = ?, updated_at = ?
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
    const parentId = this.resolveParent(input.parentId);
    const now = new Date().toISOString();
    const completedAt = status === "done" ? now : null;
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, parentId, title, description, status, priority,
      dueDate, startDate, now, now, completedAt,
    );

    return {
      id, profileId: this.profileId, parentId, title, description, status,
      priority, done: status === "done", dueDate, startDate,
      createdAt: now, updatedAt: now, completedAt,
    };
  }

  /** Applies a partial field patch to an active task (TASK-001 editing). */
  update(id: string, fields: UpdateTaskFields): Task {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      title: fields.title !== undefined ? validateTitle(fields.title) : current.title,
      description:
        fields.description !== undefined
          ? normalizeOptional(fields.description)
          : current.description,
      status: fields.status !== undefined ? validateStatus(fields.status) : current.status,
      priority:
        fields.priority !== undefined ? validatePriority(fields.priority) : current.priority,
      dueDate:
        fields.dueDate !== undefined ? validateDate(fields.dueDate, "dueDate") : current.dueDate,
      startDate:
        fields.startDate !== undefined
          ? validateDate(fields.startDate, "startDate")
          : current.startDate,
    });
  }

  /**
   * Checks a task off or reopens it (TASK-008). `true` sets status 'done';
   * `false` reverts to 'todo'. The completion timestamp follows (PRD §7).
   */
  setDone(id: string, done: boolean): Task {
    const current = this.requireActive(id);
    return this.writeFields(current, {
      title: current.title,
      description: current.description,
      status: done ? "done" : "todo",
      priority: current.priority,
      dueDate: current.dueDate,
      startDate: current.startDate,
    });
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
   * status/completed_at invariant the schema also CHECKs.
   */
  private writeFields(current: Task, next: Required<UpdateTaskFields>): Task {
    const now = new Date().toISOString();
    const completedAt =
      next.status === "done" ? (current.completedAt ?? now) : null;

    this.updateFields.run(
      next.title, next.description, next.status, next.priority,
      next.dueDate, next.startDate, completedAt, now,
      current.id, this.profileId,
    );

    return {
      ...current,
      ...next,
      done: next.status === "done",
      completedAt,
      updatedAt: now,
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

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
