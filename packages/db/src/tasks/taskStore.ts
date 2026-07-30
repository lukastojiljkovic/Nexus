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
import { TASK_ORDER_GAP, placeBetween } from "./taskListStore.js";

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
 * ADR-028: the longest lead time one task reminder may carry — a year, in
 * DAYS. Exported (and re-exported from the package barrel) so the IPC validator
 * that guards this store from an untrusted renderer checks the very same bound
 * rather than a second copy of it.
 */
export const MAX_TASK_REMINDER_DAYS = 365;

/** ADR-028: how many reminders one task may carry. Exported for the same reason as the cap above. */
export const MAX_TASK_REMINDERS = 8;

/**
 * ADR-038: how many tasks one batch action may name. A batch is a single
 * transaction over rows the user picked by hand, so the bound is not about
 * memory but about what an untrusted caller may ask the database to rewrite
 * atomically. Exported (and re-exported from the package barrel) so the IPC
 * validator guarding this store checks the very same number.
 */
export const MAX_TASK_BULK_IDS = 500;

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
   * date the rule phases from (`assertDueDateAnchors`).
   */
  recurrence: RecurrenceRule | null;
  /**
   * Whole days before `dueDate` at which to remind (ADR-028), ascending. Never
   * non-empty without a bare-date `dueDate` either — the day the ladder counts
   * back FROM is the same anchor a rule phases from, so one helper upholds
   * both. Days rather than minutes because a task's deadline is a day, not an
   * instant: this is the document-expiry model, not the event one.
   */
  reminderOffsets: number[];
  /**
   * The list this task lives in (TASK-004 / ADR-029). Never null: migration 022
   * gave every task the profile's Inbox and every write path since sets one, so
   * a NULL column here is corruption rather than "no list", and is read as such.
   */
  listId: string;
  /** The section (a heading inside `listId`) this task sits under, or null for the list body. */
  sectionId: string | null;
  /** Sparse sort key within this task's (list, section) scope — see `TaskListStore.positionBetween`. */
  position: number;
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
  reminderOffsets?: number[];
  /** Where the task lands (TASK-004); absent means the profile's Inbox. Ignored when `parentId` is set — a subtask follows its parent. */
  listId?: string;
  /** A section of `listId`; absent or null puts the task in the list body. Ignored when `parentId` is set, for the same reason. */
  sectionId?: string | null;
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
  reminderOffsets?: number[];
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
  reminder_offsets: string;
  list_id: string | null;
  section_id: string | null;
  position: number;
}

const COLUMNS =
  "id, profile_id, parent_id, title, description, status, priority, " +
  "due_date, start_date, created_at, updated_at, completed_at, recurrence, reminder_offsets, " +
  "list_id, section_id, position";

/**
 * The one total order every task read uses (TASK-004): list, then the list BODY
 * before its sections (`section_id IS NOT NULL` is 0 for the body), then each
 * scope by its own sparse `position`. `created_at, id` break the remaining ties,
 * because equal positions inside one scope are legal — a promoted subtree keeps
 * its relative order rather than forcing a table-wide reshuffle. Sections
 * themselves are ordered by `task_sections.position`, which a task row cannot
 * see; the UI reads that order from `TaskListStore.listSections` and groups
 * these rows under it.
 */
const TASK_ORDER = "list_id, section_id IS NOT NULL, section_id, position, created_at, id";

/** Accepts ISO-8601 date ('2026-07-08') or date-time, optionally zoned (PRD §7). */
const ISO_8601 =
  /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * A full ISO-8601 date-time — the `now` the TASK-004 placement mutators take
 * (the `NoteStore`/`TaskListStore` idiom, so one structural edit stamps one
 * moment across every row it touches). The older methods above predate that
 * idiom and read the wall clock themselves.
 */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

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
  private readonly selectInbox: Database.Statement;
  private readonly selectActiveList: Database.Statement;
  private readonly selectSectionOfList: Database.Statement;
  private readonly selectSiblingPosition: Database.Statement;
  private readonly selectMaxPosition: Database.Statement;
  private readonly selectScopeIds: Database.Statement;
  private readonly selectLiveSubtreeIds: Database.Statement;
  private readonly updatePlacement: Database.Statement;
  private readonly updatePosition: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insert = db.prepare(
      `INSERT INTO tasks
         (id, profile_id, parent_id, title, description, status, priority,
          due_date, start_date, created_at, updated_at, completed_at, recurrence,
          reminder_offsets, list_id, section_id, position, deleted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    );
    this.selectActive = db.prepare(
      `SELECT ${COLUMNS} FROM tasks
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY ${TASK_ORDER}`,
    );
    this.selectActiveById = db.prepare(
      `SELECT ${COLUMNS} FROM tasks
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.updateFields = db.prepare(
      `UPDATE tasks
         SET title = ?, description = ?, status = ?, priority = ?,
             due_date = ?, start_date = ?, recurrence = ?, reminder_offsets = ?,
             completed_at = ?, updated_at = ?
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

    // --- Placement (TASK-004 / ADR-029) ---------------------------------
    // Lists and sections belong to `TaskListStore`; a task only ever READS
    // them, through these four scoping statements, so this store never has to
    // duplicate that store's rules — only respect them.
    this.selectInbox = db.prepare(
      `SELECT id FROM task_lists
       WHERE profile_id = ? AND is_inbox = 1 AND deleted_at IS NULL
       ORDER BY position, id LIMIT 1`,
    );
    this.selectActiveList = db.prepare(
      `SELECT id FROM task_lists WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectSectionOfList = db.prepare(
      `SELECT s.id FROM task_sections s JOIN task_lists l ON l.id = s.list_id
       WHERE s.id = ? AND s.list_id = ? AND l.profile_id = ?`,
    );
    this.selectSiblingPosition = db.prepare(
      `SELECT position FROM tasks
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL
         AND list_id = ? AND section_id IS ?`,
    );
    // Position bookkeeping (the scope maximum, a renumber) deliberately spans
    // soft-deleted rows too, so restoring a task puts it back where it was
    // rather than on top of a live one.
    this.selectMaxPosition = db.prepare(
      `SELECT max(position) AS maxPosition FROM tasks
       WHERE profile_id = ? AND list_id = ? AND section_id IS ?`,
    );
    this.selectScopeIds = db.prepare(
      `SELECT id FROM tasks
       WHERE profile_id = ? AND list_id = ? AND section_id IS ?
       ORDER BY position, created_at, id`,
    );
    // `UNION` (never `UNION ALL`) so a hand-corrupted parent chain ends the
    // walk instead of running forever.
    this.selectLiveSubtreeIds = db.prepare(
      `WITH RECURSIVE subtree(tid) AS (
         SELECT ?
         UNION
         SELECT t.id FROM tasks t JOIN subtree ON t.parent_id = subtree.tid
         WHERE t.deleted_at IS NULL
       )
       SELECT t.id FROM tasks t
       WHERE t.id IN (SELECT tid FROM subtree) AND t.profile_id = ? AND t.deleted_at IS NULL
       ORDER BY t.position, t.created_at, t.id`,
    );
    this.updatePlacement = db.prepare(
      `UPDATE tasks SET list_id = ?, section_id = ?, position = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // A renumber re-spaces rows the user did not touch, so it leaves their
    // `updated_at` alone (`NoteOrgStore`'s promoted-notes reasoning).
    this.updatePosition = db.prepare(
      `UPDATE tasks SET position = ? WHERE id = ? AND profile_id = ?`,
    );
  }

  /** Active tasks for this profile in the placement order `TASK_ORDER` defines (soft-deleted excluded). */
  listActive(): Task[] {
    const rows = this.selectActive.all(this.profileId) as TaskRow[];
    return rows.map(toTask);
  }

  /**
   * Inserts a task, applying defaults, and returns the stored row (TASK-001).
   *
   * Placement (TASK-004): a task with a `parentId` INHERITS its parent's list
   * and section, and any `listId`/`sectionId` given alongside is ignored — a
   * subtask lives where its parent lives, and the alternative (a subtask filed
   * in a different list from the parent it is rendered under) is not a state the
   * UI could ever show honestly. Otherwise `listId` decides, defaulting to the
   * profile's Inbox. The row is appended at the end of whichever scope it lands
   * in.
   */
  create(input: CreateTaskInput): Task {
    const title = validateTitle(input.title);
    const status = validateStatus(input.status ?? "todo");
    const priority = validatePriority(input.priority ?? "none");
    const description = normalizeOptional(input.description);
    const dueDate = validateDate(input.dueDate, "dueDate");
    const startDate = validateDate(input.startDate, "startDate");
    const recurrence = validateRecurrence(input.recurrence);
    const reminderOffsets = validateReminderOffsets(input.reminderOffsets);
    assertDueDateAnchors(recurrence, reminderOffsets, dueDate);
    const parent = this.resolveParent(input.parentId);
    const { listId, sectionId } =
      parent !== null
        ? { listId: parent.listId, sectionId: parent.sectionId }
        : this.resolveScope(input.listId, input.sectionId);
    const position = this.appendPosition(listId, sectionId);
    const now = new Date().toISOString();
    const completedAt = status === "done" ? now : null;
    const id = uuidv7();

    this.insert.run(
      id, this.profileId, parent?.id ?? null, title, description, status, priority,
      dueDate, startDate, now, now, completedAt, serializeRecurrence(recurrence),
      JSON.stringify(reminderOffsets), listId, sectionId, position,
    );

    return {
      id, profileId: this.profileId, parentId: parent?.id ?? null, title, description, status,
      priority, done: status === "done", dueDate, startDate,
      createdAt: now, updatedAt: now, completedAt, recurrence, reminderOffsets,
      listId, sectionId, position,
    };
  }

  /**
   * Moves a task — and its whole LIVE subtree — into another list, clearing
   * every section along the way and appending each row at the end of the target
   * list's body, in their current order. One transaction.
   *
   * The subtree travels because "a subtask lives where its parent lives" is the
   * invariant `create` establishes, and a move is the only other thing that
   * could break it. Sections are not part of that invariant — they are headings
   * WITHIN one list, and the UI renders a subtask under its parent whichever
   * heading it carries — which is why `moveToSection` moves the one task only.
   */
  moveToList(id: string, listId: string, now: string): Task {
    const current = this.requireActive(id);
    const validNow = validateDateTime(now);
    this.requireList(listId);

    return this.db.transaction((): Task => {
      const ids = (this.selectLiveSubtreeIds.all(id, this.profileId) as { id: string }[]).map(
        (row) => row.id,
      );
      let position = this.appendPosition(listId, null);
      let movedPosition = position;
      for (const taskId of ids) {
        this.updatePlacement.run(listId, null, position, validNow, taskId, this.profileId);
        if (taskId === id) movedPosition = position;
        position += TASK_ORDER_GAP;
      }
      return { ...current, listId, sectionId: null, position: movedPosition, updatedAt: validNow };
    })();
  }

  /**
   * Moves a task between the sections of the list it is already in (`null` = the
   * list body), appended at the end of the target scope. Refuses a section
   * belonging to any other list: changing list is `moveToList`'s job, and doing
   * both at once would silently skip the subtree rule that move upholds.
   */
  moveToSection(id: string, sectionId: string | null, now: string): Task {
    const current = this.requireActive(id);
    const validNow = validateDateTime(now);
    if (sectionId !== null) this.requireSectionOfList(sectionId, current.listId);

    const position = this.appendPosition(current.listId, sectionId);
    this.updatePlacement.run(
      current.listId, sectionId, position, validNow, id, this.profileId,
    );
    return { ...current, sectionId, position, updatedAt: validNow };
  }

  /**
   * Re-orders a task within its own (list, section) scope, between two live
   * neighbours there — either null at an end of the scope. Both must share the
   * task's exact scope: a neighbour from another list or another section
   * describes a move, not a reorder, and the two have different rules.
   */
  reorder(id: string, beforeId: string | null, afterId: string | null, now: string): Task {
    const current = this.requireActive(id);
    const validNow = validateDateTime(now);
    if (beforeId === id || afterId === id) {
      throw new TaskValidationError("A task cannot be ordered against itself.");
    }

    // One transaction, because a renumber and the move it made room for are one
    // edit: half of them is a scope re-spaced for a row that never arrived.
    return this.db.transaction((): Task => {
      const position = placeBetween(
        (siblingId) => {
          const row = this.selectSiblingPosition.get(
            siblingId, this.profileId, current.listId, current.sectionId,
          ) as { position: number } | undefined;
          if (!row) {
            throw new TaskValidationError(
              `No active task "${siblingId}" to order against in this scope.`,
            );
          }
          return row.position;
        },
        () => {
          const ids = this.selectScopeIds.all(
            this.profileId, current.listId, current.sectionId,
          ) as { id: string }[];
          ids.forEach((row, index) => {
            this.updatePosition.run((index + 1) * TASK_ORDER_GAP, row.id, this.profileId);
          });
        },
        beforeId,
        afterId,
      );
      if (position === null) {
        throw new TaskValidationError(
          '"beforeId" and "afterId" do not describe a gap in this scope.',
        );
      }

      this.updatePlacement.run(
        current.listId, current.sectionId, position, validNow, id, this.profileId,
      );
      return { ...current, position, updatedAt: validNow };
    })();
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
      reminderOffsets:
        fields.reminderOffsets !== undefined
          ? validateReminderOffsets(fields.reminderOffsets)
          : current.reminderOffsets,
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
    const anchor = requireDueDateAnchor(current.dueDate, "a recurrence rule");

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
          // `ownFields` carries the reminder ladder through the advance like
          // every other field, and that is all the reminder logic an advance
          // needs (ADR-028): the ladder counts days back from `dueDate`, and
          // the engine keys each occurrence by that same date — so moving the
          // date below re-anchors AND re-keys the next occurrence's reminders
          // in one step, with nothing to reset and no stale key left behind.
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

  /**
   * Soft-deletes an active task (PRD delete semantics; reversible via
   * `restore`). `at` defaults to the wall clock; `bulkSoftDelete` passes one
   * stamp for a whole batch — the `writeFields` idiom, and the same equality
   * `TaskListStore.deleteList`/`restoreList` rely on: rows removed together
   * carry the same `deleted_at`.
   */
  softDelete(id: string, at: string = new Date().toISOString()): void {
    const now = validateDateTime(at);
    const { changes } = this.markDeleted.run(now, now, id, this.profileId);
    if (changes === 0) {
      throw new TaskNotFoundError(`No active task "${id}" to delete in this profile.`);
    }
  }

  /**
   * Restores a soft-deleted task (undo of a delete, TASK-011).
   *
   * If the list the task points at has meanwhile been deleted — the per-task
   * undo offered right after `deleteList(…, "delete-tasks")` is exactly that
   * case — the row is re-placed into the profile's Inbox body through
   * `moveToList`, so the whole live subtree travels and lands appended in
   * order. Without it the undo would "work" while putting the task in a list no
   * view can reach, which is indistinguishable from the delete not being undone
   * at all.
   *
   * One transaction: a fallback that cannot run (a profile with no Inbox is
   * corruption, `requireInbox`) takes the un-delete down with it rather than
   * leaving the task alive somewhere invisible.
   *
   * `at` defaults to the wall clock, like `softDelete`'s, so `bulkRestore` can
   * stamp one moment across a whole undo.
   */
  restore(id: string, at: string = new Date().toISOString()): void {
    const now = validateDateTime(at);
    this.db.transaction((): void => {
      const { changes } = this.markRestored.run(now, id, this.profileId);
      if (changes === 0) {
        throw new TaskNotFoundError(`No deleted task "${id}" to restore in this profile.`);
      }
      const restored = this.requireActive(id);
      if (!this.selectActiveList.get(restored.listId, this.profileId)) {
        this.moveToList(id, this.requireInbox(), now);
      }
    })();
  }

  // --- Batch operations (ADR-038) -----------------------------------------
  //
  // Five actions over a hand-picked set of tasks. Each is ONE transaction that
  // calls this store's own single-row methods per id, so not one invariant is
  // re-spelled here: a batch move is a run of `moveToList`s, a batch edit a run
  // of `update`s, and whatever those refuse, a batch refuses too.
  //
  // Refuse-on-any-error, atomically: a batch that half-applied would leave the
  // user with no way to say which half, so the first failing id takes the whole
  // run down with it (better-sqlite3 rolls a transaction back on a throw) and
  // the error names that id.

  /**
   * Moves every named task into `listId` (subtrees and all, `moveToList`), then
   * — when `sectionId` is given — files each named task under that heading.
   *
   * The two steps are in that order because a section belongs to a list: the
   * heading can only be accepted once the row is actually in the list that owns
   * it, which is the same check `moveToSection` makes for a single task. Only
   * the NAMED tasks take the heading; a subtask that travelled with its parent
   * stays in the list body, exactly as a single `moveToSection` leaves it.
   */
  bulkMoveToList(
    ids: readonly string[],
    listId: string,
    sectionId: string | null,
    now: string,
  ): Task[] {
    return this.batch(ids, (id) => {
      const moved = this.moveToList(id, listId, now);
      return sectionId === null ? moved : this.moveToSection(id, sectionId, now);
    });
  }

  /** Sets one priority across the batch. */
  bulkSetPriority(ids: readonly string[], priority: TaskPriority): Task[] {
    const valid = validatePriority(priority);
    return this.batch(ids, (id) => this.update(id, { priority: valid }));
  }

  /**
   * Sets (or, with `null`, clears) one due date across the batch. Clearing is
   * refused for a task whose recurrence rule or reminder ladder anchors on that
   * date — `update`'s own rule — and that refusal takes the whole batch with it.
   */
  bulkSetDueDate(ids: readonly string[], dueDate: string | null): Task[] {
    const valid = validateDate(dueDate, "dueDate");
    return this.batch(ids, (id) => this.update(id, { dueDate: valid }));
  }

  /**
   * Soft-deletes the batch under ONE shared `deleted_at`, which is returned:
   * rows removed by one action carry one stamp, the property
   * `TaskListStore.restoreList` already reads a list's own deletion by.
   */
  bulkSoftDelete(ids: readonly string[]): string {
    const at = new Date().toISOString();
    this.batch(ids, (id) => this.softDelete(id, at));
    return at;
  }

  /** Restores the batch, each row by `restore`'s own semantics — Inbox fallback included. */
  bulkRestore(ids: readonly string[]): void {
    const at = new Date().toISOString();
    this.batch(ids, (id) => this.restore(id, at));
  }

  /**
   * The one batch runner: validates the id list, then applies `run` to each
   * distinct id inside a single transaction, naming the id a failure stopped at.
   *
   * Duplicates are collapsed rather than refused — naming a task twice is what
   * a selection can honestly produce, and the second pass over the same row
   * would otherwise fail as "already deleted" and abort a batch that asked for
   * nothing impossible.
   */
  private batch<T>(ids: readonly string[], run: (id: string) => T): T[] {
    const unique = validateBulkIds(ids);
    return this.db.transaction((): T[] =>
      unique.map((id) => {
        try {
          return run(id);
        } catch (error) {
          throw namingTask(error, id);
        }
      }),
    )();
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
   * cannot) the rule-or-ladder/due-date invariant against the MERGED pair, so a
   * patch that clears the date of a recurring or reminded task is caught just as
   * a patch that adds a rule or a ladder to a dateless one is.
   *
   * `at` defaults to the wall clock; `completeOccurrence` passes its caller's
   * `now` so a parent and its subtasks carry one stamp.
   */
  private writeFields(
    current: Task,
    next: Required<UpdateTaskFields>,
    at: string = new Date().toISOString(),
  ): Task {
    assertDueDateAnchors(next.recurrence, next.reminderOffsets, next.dueDate);
    const completedAt = next.status === "done" ? (current.completedAt ?? at) : null;

    this.updateFields.run(
      next.title, next.description, next.status, next.priority,
      next.dueDate, next.startDate, serializeRecurrence(next.recurrence),
      JSON.stringify(next.reminderOffsets), completedAt, at,
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

  /** Validates an optional parent id belongs to an active task in this profile, returning that parent (a subtask inherits its placement). */
  private resolveParent(parentId: string | null | undefined): Task | null {
    if (parentId === undefined || parentId === null) return null;
    const parent = this.selectActiveById.get(parentId, this.profileId) as TaskRow | undefined;
    if (!parent) {
      throw new TaskValidationError(
        `parentId "${parentId}" does not reference a task in this profile.`,
      );
    }
    return toTask(parent);
  }

  /**
   * Where a top-level task lands: the given list or the profile's Inbox, plus a
   * section that must belong to it. A profile with no Inbox is refused rather
   * than papered over — migration 022 and `TaskListStore.ensureInbox` between
   * them guarantee one, so its absence means a database nobody should be
   * writing tasks into.
   */
  private resolveScope(
    listId: string | undefined,
    sectionId: string | null | undefined,
  ): { listId: string; sectionId: string | null } {
    const resolvedList = listId === undefined ? this.requireInbox() : this.requireList(listId);
    const resolvedSection = sectionId ?? null;
    if (resolvedSection !== null) this.requireSectionOfList(resolvedSection, resolvedList);
    return { listId: resolvedList, sectionId: resolvedSection };
  }

  private requireInbox(): string {
    const row = this.selectInbox.get(this.profileId) as { id: string } | undefined;
    if (!row) {
      throw new TaskValidationError("This profile has no Inbox list to place a task in.");
    }
    return row.id;
  }

  private requireList(listId: string): string {
    const row = this.selectActiveList.get(listId, this.profileId) as { id: string } | undefined;
    if (!row) {
      throw new TaskValidationError(
        `listId "${listId}" does not reference an active list in this profile.`,
      );
    }
    return row.id;
  }

  private requireSectionOfList(sectionId: string, listId: string): void {
    const row = this.selectSectionOfList.get(sectionId, listId, this.profileId);
    if (!row) {
      throw new TaskValidationError(
        `sectionId "${sectionId}" does not reference a section of list "${listId}".`,
      );
    }
  }

  /** The end of one (list, section) scope — every insert and every move appends there. */
  private appendPosition(listId: string, sectionId: string | null): number {
    const row = this.selectMaxPosition.get(this.profileId, listId, sectionId) as {
      maxPosition: number | null;
    };
    return row.maxPosition === null ? TASK_ORDER_GAP : row.maxPosition + TASK_ORDER_GAP;
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
    reminderOffsets: parseStoredOffsets(row.reminder_offsets, row.id),
    listId: requireStoredListId(row.list_id, row.id),
    sectionId: row.section_id,
    position: row.position,
  };
}

/**
 * Reads `tasks.list_id` back. The column is NULLable only because SQLite cannot
 * add a NOT NULL column with a `REFERENCES` clause to a populated table
 * (migration 022); migration 022's own backfill and every write path since fill
 * it, so a NULL here is a hand-edited or half-restored row rather than a task
 * without a list. Reading it as "unfiled" would quietly hide the task from every
 * list the UI draws, so it throws naming the row — the same reasoning
 * `parseStoredRecurrence` gives for its own column.
 */
function requireStoredListId(listId: string | null, id: string): string {
  if (listId === null) {
    throw new TaskValidationError(`Task "${id}" carries no list; its row is corrupt.`);
  }
  return listId;
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
    reminderOffsets: task.reminderOffsets,
  };
}

/**
 * A batch's id list (ADR-038): non-empty, within `MAX_TASK_BULK_IDS`, returned
 * distinct. The cap is checked against what the caller actually sent, before
 * the dedupe — a payload naming ten thousand ids is refused rather than quietly
 * shrunk into an acceptable one.
 */
function validateBulkIds(ids: readonly string[]): string[] {
  if (ids.length === 0) {
    throw new TaskValidationError("A batch action must name at least one task.");
  }
  if (ids.length > MAX_TASK_BULK_IDS) {
    throw new TaskValidationError(
      `A batch action may name at most ${MAX_TASK_BULK_IDS} tasks (got ${ids.length}).`,
    );
  }
  return [...new Set(ids)];
}

/**
 * The same failure, said again with the task the batch stopped at named. The
 * class is preserved — a caller telling "no such task" from "that edit is not
 * allowed" must go on being able to — and anything this store does not own
 * (a SQLite error, say) travels untouched.
 */
function namingTask(error: unknown, id: string): unknown {
  const prefix = `Batch action stopped at task "${id}": `;
  if (error instanceof TaskNotFoundError) return new TaskNotFoundError(prefix + error.message);
  if (error instanceof TaskValidationError) return new TaskValidationError(prefix + error.message);
  return error;
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

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new TaskValidationError('"now" must be an ISO-8601 date-time.');
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
 * The bare calendar day a task's day-phased features anchor on. A recurrence
 * rule phases FROM the due date (ADR-024) and a reminder ladder counts days
 * BACK from it (ADR-028) — one anchor, two readers — so there must BE one, and
 * it must be a day the engine can work in: a timestamped due date has no place
 * in day-to-day arithmetic (and is not what the interchange contract declares
 * for a task's `dueDate` either). `needs` names the feature that requires it,
 * so the refusal says which of the two the caller tripped. Returns the anchor,
 * so the one caller that needs it as a value gets it without re-narrowing.
 */
function requireDueDateAnchor(dueDate: string | null, needs: string): string {
  if (dueDate === null) {
    throw new TaskValidationError(`A task with ${needs} must have a dueDate to anchor on.`);
  }
  if (!isValidDayKey(dueDate)) {
    throw new TaskValidationError(
      `A task with ${needs} must have a bare calendar date as its dueDate (got "${dueDate}").`,
    );
  }
  return dueDate;
}

/**
 * The same invariant as a precondition on a write, checked for each feature
 * that carries it: only a task that actually HAS a rule or a ladder needs the
 * anchor, so clearing both frees the due date again.
 */
function assertDueDateAnchors(
  rule: RecurrenceRule | null,
  reminderOffsets: readonly number[],
  dueDate: string | null,
): void {
  if (rule !== null) requireDueDateAnchor(dueDate, "a recurrence rule");
  if (reminderOffsets.length > 0) requireDueDateAnchor(dueDate, "reminders");
}

/**
 * A reminder ladder from an untrusted caller (SEC-EL-02), returning the
 * canonical form the column stores: ascending, so the ladder reads the same
 * however the user entered it. Absent means "no reminders", the default. The
 * rules — unique, whole days, 0..`MAX_TASK_REMINDER_DAYS`, at most
 * `MAX_TASK_REMINDERS` of them — cannot be a SQL CHECK over a JSON column, so
 * this function is the gate (with `parseImportArchive`'s twin covering the one
 * other way a value reaches the column). Mirrors `EventStore`'s own validator,
 * in days rather than minutes.
 */
function validateReminderOffsets(value: readonly number[] | undefined): number[] {
  if (value === undefined) return [];
  if (value.length > MAX_TASK_REMINDERS) {
    throw new TaskValidationError(
      `A task may carry at most ${MAX_TASK_REMINDERS} reminders (got ${value.length}).`,
    );
  }
  for (const offset of value) {
    if (!isReminderOffset(offset)) {
      throw new TaskValidationError(
        `"reminderOffsets" must hold whole days between 0 and ${MAX_TASK_REMINDER_DAYS} (got ${offset}).`,
      );
    }
  }
  if (new Set(value).size !== value.length) {
    throw new TaskValidationError('"reminderOffsets" must not repeat the same lead time.');
  }
  return [...value].sort((a, b) => a - b);
}

/** One lead time's own shape — shared by the write validator above and the stored-value reader below. */
function isReminderOffset(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= MAX_TASK_REMINDER_DAYS;
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

/** Same reasoning as `parseStoredRecurrence`: only this store writes the column, and it writes a list of whole-day lead times. */
function parseStoredOffsets(text: string, id: string): number[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }
  const invalid = new TaskValidationError(
    `Task "${id}" carries stored reminder offsets that are not a list of whole-day lead times.`,
  );
  if (!Array.isArray(parsed)) throw invalid;
  const entries: readonly unknown[] = parsed;
  const offsets: number[] = [];
  for (const entry of entries) {
    if (typeof entry !== "number" || !isReminderOffset(entry)) throw invalid;
    offsets.push(entry);
  }
  return offsets;
}

/** Normalizes an optional string: absent/empty/whitespace-only collapses to null. */
function normalizeOptional(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  return value;
}
