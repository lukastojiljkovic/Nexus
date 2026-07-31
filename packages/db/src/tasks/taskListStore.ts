import type Database from "better-sqlite3-multiple-ciphers";
import {
  parseStoredTaskViewConfig,
  serializeTaskViewConfig,
  validateTaskViewConfig,
} from "@nexus/core";
import type { TaskViewConfig } from "@nexus/core";
import {
  TaskListNotFoundError,
  TaskListValidationError,
  TaskSectionNotFoundError,
} from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** Closed per-list view domain (migration 038 CHECK) — TASK-005's two shapes plus ADR-050's two. */
export const TASK_LIST_VIEWS = ["list", "kanban", "cards", "calendar"] as const;
export type TaskListView = (typeof TASK_LIST_VIEWS)[number];

/** Longest list/section name after trimming — the `note_folders` bound, for the same reason: a name is a label, not a body. */
export const MAX_TASK_LIST_NAME_LENGTH = 100;

/**
 * The spacing between two neighbours in one ordering scope (migration 022).
 * Sparse on purpose: an insert between two rows is the midpoint of their
 * positions — one UPDATE of the moved row — rather than a renumber of
 * everything after it. Ten inserts at the same spot exhaust the gap, and
 * `positionBetween` says so rather than silently colliding.
 */
export const TASK_ORDER_GAP = 1024;

/**
 * The position a row takes between two neighbours, or `null` when there is no
 * room left between them.
 *
 * `before`/`after` are the positions of the rows that will sit immediately
 * ABOVE and BELOW the placed row, `null` meaning "nothing there" — so
 * `(null, null)` is the only row in its scope, `(max, null)` is an append and
 * `(null, min)` is a prepend. Both endpoints step a whole `TASK_ORDER_GAP`, so
 * neither can ever collide; only the midpoint can, and it does exactly when the
 * two neighbours are less than two apart. Prepending walks below zero, which is
 * fine: a position is a relative sort key, never a count.
 *
 * Exported so `TaskStore` orders tasks by the identical arithmetic — two copies
 * of "where does this row go" could only ever drift apart.
 */
export function positionBetween(before: number | null, after: number | null): number | null {
  if (before === null) return after === null ? TASK_ORDER_GAP : after - TASK_ORDER_GAP;
  if (after === null) return before + TASK_ORDER_GAP;
  if (after - before <= 1) return null;
  return Math.floor((before + after) / 2);
}

/**
 * `positionBetween` plus the one recovery it needs: when the gap has run out,
 * `renumberScope` re-spaces the whole scope at `TASK_ORDER_GAP` steps and the
 * midpoint is computed once more against the neighbours' NEW positions. Returns
 * `null` only when the retry fails too — which after a re-spacing can mean just
 * one thing: `beforeId`/`afterId` do not describe a gap at all (the same row
 * twice, or the two given the wrong way round). The caller turns that into its
 * own validation error, so this helper stays free of any one store's error
 * family.
 *
 * `positionOf` reads a neighbour's current position and is the caller's gate on
 * scope membership — it throws for an id that is not a live sibling.
 */
export function placeBetween(
  positionOf: (id: string) => number,
  renumberScope: () => void,
  beforeId: string | null,
  afterId: string | null,
): number | null {
  const compute = (): number | null =>
    positionBetween(
      beforeId === null ? null : positionOf(beforeId),
      afterId === null ? null : positionOf(afterId),
    );

  const placed = compute();
  if (placed !== null) return placed;
  renumberScope();
  return compute();
}

/** A task list as the store returns it: camelCase keys, `parentId` null at the root, soft-deleted rows excluded from `listActive`. */
export interface TaskList {
  id: string;
  profileId: string;
  parentId: string | null;
  name: string;
  /** The one list per profile a task lands in when the user names none. Undeletable and unmovable; renamable. */
  isInbox: boolean;
  defaultView: TaskListView;
  /**
   * What this list remembers about each of its four views (ADR-050) — grouping,
   * sort and filters — or null when it has expressed no preference. Read
   * LENIENTLY (`parseStoredTaskViewConfig`): a config that no longer parses, or
   * that names a knob this build does not have, costs the user a fallback to the
   * defaults and never an unopenable list. That is deliberately the opposite of
   * `TaskStore.parseStoredRecurrence`, which throws on a damaged column — a
   * recurrence rule is the user's DATA, while a view config is how they last
   * looked at it.
   */
  viewConfig: TaskViewConfig | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** A heading inside one list. Scoped through its list — it carries no `profile_id` and no soft delete of its own. */
export interface TaskSection {
  id: string;
  listId: string;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
}

/** What `deleteList` does with the tasks the list holds — the two answers a user can give, and there is no third. */
export type DeleteListMode = "move-to-inbox" | "delete-tasks";

/** Fields accepted when creating a list; `parentId` absent or null makes it a root list. */
export interface CreateTaskListInput {
  name: string;
  parentId?: string | null;
}

interface TaskListRow {
  id: string;
  profile_id: string;
  parent_id: string | null;
  name: string;
  is_inbox: number;
  default_view: TaskListView;
  view_config: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface TaskSectionRow {
  id: string;
  list_id: string;
  name: string;
  position: number;
  created_at: string;
  updated_at: string;
}

const LIST_COLUMNS =
  "id, profile_id, parent_id, name, is_inbox, default_view, view_config, position, " +
  "created_at, updated_at, deleted_at";
const SECTION_COLUMNS = "id, list_id, name, position, created_at, updated_at";

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteOrgStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the TASK module's organization layer (TASK-004 / ADR-029):
 * nested lists and the sections inside them. Mirrors `NoteOrgStore`: construct
 * one per profile, reuse it, over prepared, parameterized statements
 * (SEC-API-03), every value bound, never interpolated. Inputs are revalidated
 * here because the renderer is untrusted (SEC-EL-02), and every statement is
 * scoped by `profile_id` — a section is reached only through its already-scoped
 * list, so one profile's organization is invisible to a store scoped to another.
 * Every mutator takes the caller's `now` (the post-`NoteStore` idiom), so a
 * multi-row structural edit stamps one moment rather than several.
 *
 * **One class for lists and sections** because they are one feature: a section
 * is a heading inside a list, they share the ordering arithmetic, and every
 * section invariant is stated in terms of its list. Splitting them would mean
 * two stores holding the same list-scoped rules.
 *
 * **The Inbox** is the list a task lands in when the user names none. It is
 * renamable (a founder may prefer "Prijemno"), but neither deletable nor
 * movable — those refuse with a validation error, because a profile without an
 * Inbox is a profile in which `TaskStore.create` has nowhere to put a task.
 * `ensureInbox` is idempotent and is how a freshly created profile gets one;
 * migration 022 backfills every profile that predates this slice.
 *
 * **Ordering** is a sparse `position` per scope — (profile, parent) for lists,
 * (list) for sections — read and written through `positionBetween` /
 * `placeBetween`. Position bookkeeping (the scope maximum, a renumber) covers
 * every row in the scope INCLUDING soft-deleted lists, so restoring one puts it
 * back where it was; only listing and neighbour lookups filter by liveness.
 */
export class TaskListStore {
  private readonly insertList: Database.Statement;
  private readonly selectActiveLists: Database.Statement;
  private readonly selectActiveListById: Database.Statement;
  private readonly selectDeletedListById: Database.Statement;
  private readonly selectInbox: Database.Statement;
  private readonly selectSiblingListPosition: Database.Statement;
  private readonly selectMaxListPosition: Database.Statement;
  private readonly selectListScopeIds: Database.Statement;
  private readonly selectListAncestor: Database.Statement;
  private readonly selectChildListIds: Database.Statement;
  private readonly updateListName: Database.Statement;
  private readonly updateListView: Database.Statement;
  private readonly updateListViewConfig: Database.Statement;
  private readonly updateListPlacement: Database.Statement;
  private readonly updateListPosition: Database.Statement;
  private readonly markListDeleted: Database.Statement;
  private readonly markListRestored: Database.Statement;

  private readonly insertSection: Database.Statement;
  private readonly selectSections: Database.Statement;
  private readonly selectSectionById: Database.Statement;
  private readonly selectSiblingSectionPosition: Database.Statement;
  private readonly selectMaxSectionPosition: Database.Statement;
  private readonly selectSectionScopeIds: Database.Statement;
  private readonly updateSectionName: Database.Statement;
  private readonly updateSectionPlacement: Database.Statement;
  private readonly updateSectionPosition: Database.Statement;
  private readonly deleteSectionRow: Database.Statement;

  private readonly selectListTaskIds: Database.Statement;
  private readonly selectSectionTaskIds: Database.Statement;
  private readonly selectMovedTaskIds: Database.Statement;
  private readonly selectMaxTaskPosition: Database.Statement;
  private readonly placeTask: Database.Statement;
  private readonly markListTasksDeleted: Database.Statement;
  private readonly markListTasksRestored: Database.Statement;

  constructor(
    private readonly db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    // A fresh list has no view preferences yet — `view_config` NULL is exactly
    // that, and the first toggle or select the user touches writes one.
    this.insertList = db.prepare(
      `INSERT INTO task_lists
         (id, profile_id, parent_id, name, is_inbox, default_view, view_config, position,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, ?, ?, ?, 'list', NULL, ?, ?, ?, NULL)`,
    );
    // NULL parents sort first in SQLite's default ASC order, so root lists lead
    // and every other scope follows grouped by its parent — one flat array the
    // UI nests by `parentId`, in each scope's own position order.
    this.selectActiveLists = db.prepare(
      `SELECT ${LIST_COLUMNS} FROM task_lists
       WHERE profile_id = ? AND deleted_at IS NULL
       ORDER BY parent_id, position, id`,
    );
    this.selectActiveListById = db.prepare(
      `SELECT ${LIST_COLUMNS} FROM task_lists
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectDeletedListById = db.prepare(
      `SELECT ${LIST_COLUMNS} FROM task_lists
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );
    this.selectInbox = db.prepare(
      `SELECT ${LIST_COLUMNS} FROM task_lists
       WHERE profile_id = ? AND is_inbox = 1 AND deleted_at IS NULL
       ORDER BY position, id LIMIT 1`,
    );
    this.selectSiblingListPosition = db.prepare(
      `SELECT position FROM task_lists
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL AND parent_id IS ?`,
    );
    this.selectMaxListPosition = db.prepare(
      `SELECT max(position) AS maxPosition FROM task_lists
       WHERE profile_id = ? AND parent_id IS ?`,
    );
    this.selectListScopeIds = db.prepare(
      `SELECT id FROM task_lists
       WHERE profile_id = ? AND parent_id IS ? ORDER BY position, id`,
    );
    // Walks the new parent's ancestor chain (including itself); a cycle exists
    // iff the moving list's id shows up in that chain — `NoteOrgStore`'s guard,
    // verbatim.
    this.selectListAncestor = db.prepare(
      `WITH RECURSIVE anc(lid) AS (
         SELECT ?
         UNION ALL
         SELECT l.parent_id FROM task_lists l JOIN anc ON l.id = anc.lid
         WHERE l.parent_id IS NOT NULL
       )
       SELECT 1 FROM anc WHERE lid = ?`,
    );
    // Soft-deleted children included: a child left pointing at a list that is
    // itself deleted would come back, on restore, under a parent nobody sees.
    this.selectChildListIds = db.prepare(
      `SELECT id FROM task_lists
       WHERE parent_id = ? AND profile_id = ? ORDER BY position, id`,
    );
    this.updateListName = db.prepare(
      `UPDATE task_lists SET name = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.updateListView = db.prepare(
      `UPDATE task_lists SET default_view = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.updateListViewConfig = db.prepare(
      `UPDATE task_lists SET view_config = ?, updated_at = ? WHERE id = ? AND profile_id = ?`,
    );
    this.updateListPlacement = db.prepare(
      `UPDATE task_lists SET parent_id = ?, position = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    // A renumber re-spaces siblings the user did not touch, so it deliberately
    // leaves their `updated_at` alone — the same reasoning `NoteOrgStore` gives
    // for promoted notes.
    this.updateListPosition = db.prepare(
      `UPDATE task_lists SET position = ? WHERE id = ? AND profile_id = ?`,
    );
    this.markListDeleted = db.prepare(
      `UPDATE task_lists SET deleted_at = ?, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.markListRestored = db.prepare(
      `UPDATE task_lists SET deleted_at = NULL, updated_at = ?
       WHERE id = ? AND profile_id = ? AND deleted_at IS NOT NULL`,
    );

    this.insertSection = db.prepare(
      `INSERT INTO task_sections (id, list_id, name, position, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.selectSections = db.prepare(
      `SELECT ${SECTION_COLUMNS} FROM task_sections WHERE list_id = ? ORDER BY position, id`,
    );
    // Joined to `task_lists` in every case: a section carries no `profile_id`,
    // so this join IS its profile scoping.
    this.selectSectionById = db.prepare(
      `SELECT s.id, s.list_id, s.name, s.position, s.created_at, s.updated_at
       FROM task_sections s JOIN task_lists l ON l.id = s.list_id
       WHERE s.id = ? AND l.profile_id = ? AND l.deleted_at IS NULL`,
    );
    this.selectSiblingSectionPosition = db.prepare(
      `SELECT position FROM task_sections WHERE id = ? AND list_id = ?`,
    );
    this.selectMaxSectionPosition = db.prepare(
      `SELECT max(position) AS maxPosition FROM task_sections WHERE list_id = ?`,
    );
    this.selectSectionScopeIds = db.prepare(
      `SELECT id FROM task_sections WHERE list_id = ? ORDER BY position, id`,
    );
    this.updateSectionName = db.prepare(
      `UPDATE task_sections SET name = ?, updated_at = ? WHERE id = ?`,
    );
    this.updateSectionPlacement = db.prepare(
      `UPDATE task_sections SET position = ?, updated_at = ? WHERE id = ?`,
    );
    this.updateSectionPosition = db.prepare(
      `UPDATE task_sections SET position = ? WHERE id = ?`,
    );
    this.deleteSectionRow = db.prepare(`DELETE FROM task_sections WHERE id = ?`);

    this.selectListTaskIds = db.prepare(
      `SELECT id FROM tasks
       WHERE list_id = ? AND profile_id = ? AND deleted_at IS NULL
       ORDER BY section_id IS NOT NULL, section_id, position, created_at, id`,
    );
    // EVERY task of the section, soft-deleted ones included: `deleteSection`
    // HARD-deletes its row, and `tasks.section_id` has no `ON DELETE` clause, so
    // a single deleted task left pointing at it would fail the whole delete on a
    // foreign key. Their relative order among the live rows is preserved either
    // way, and a restored one then belongs to the body — its heading is gone.
    this.selectSectionTaskIds = db.prepare(
      `SELECT id FROM tasks
       WHERE section_id = ? AND profile_id = ?
       ORDER BY position, created_at, id`,
    );
    // The move-to-inbox counterpart of `markListTasksRestored`: the tasks a
    // delete SENT to the Inbox rather than took down, identified by the same
    // equality one column over — their `updated_at` is the move's stamp, which
    // is the list's own `deleted_at` (see `deleteList`). `list_id`/`section_id`
    // pin them to where the move left them, so a task since moved on is missed
    // by both halves of the test rather than one.
    this.selectMovedTaskIds = db.prepare(
      `SELECT id FROM tasks
       WHERE profile_id = ? AND list_id = ? AND section_id IS NULL
         AND deleted_at IS NULL AND updated_at = ?
       ORDER BY position, created_at, id`,
    );
    this.selectMaxTaskPosition = db.prepare(
      `SELECT max(position) AS maxPosition FROM tasks
       WHERE profile_id = ? AND list_id = ? AND section_id IS ?`,
    );
    this.placeTask = db.prepare(
      `UPDATE tasks SET list_id = ?, section_id = ?, position = ?, updated_at = ?
       WHERE id = ? AND profile_id = ?`,
    );
    this.markListTasksDeleted = db.prepare(
      `UPDATE tasks SET deleted_at = ?, updated_at = ?
       WHERE list_id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    // The equality trick (see `restoreList`): only the tasks THIS delete removed
    // carry the list's own `deleted_at`.
    this.markListTasksRestored = db.prepare(
      `UPDATE tasks SET deleted_at = NULL, updated_at = ?
       WHERE list_id = ? AND profile_id = ? AND deleted_at = ?`,
    );
  }

  // ---------------------------------------------------------------------
  // Lists
  // ---------------------------------------------------------------------

  /** This profile's active lists as one flat array — root lists first, then each parent's children, every scope in position order. */
  listActive(): TaskList[] {
    const rows = this.selectActiveLists.all(this.profileId) as TaskListRow[];
    return rows.map(toTaskList);
  }

  /**
   * The profile's Inbox, creating it if this profile somehow has none —
   * idempotent, so a caller may run it on every unlock. Every profile that
   * predates ADR-029 got one from migration 022; this is what a profile created
   * afterwards gets at creation time, minted the same way.
   */
  ensureInbox(now: string): TaskList {
    const validNow = validateDateTime(now);
    const existing = this.selectInbox.get(this.profileId) as TaskListRow | undefined;
    if (existing) return toTaskList(existing);
    return this.insertNewList("Inbox", null, true, validNow);
  }

  /** Creates a list, appended at the end of its parent scope (TASK-004). */
  createList(input: CreateTaskListInput, now: string): TaskList {
    const validNow = validateDateTime(now);
    const name = validateName(input.name);
    const parentId = input.parentId ?? null;
    if (parentId !== null) this.requireActiveList(parentId);
    return this.insertNewList(name, parentId, false, validNow);
  }

  /** Renames a list. The Inbox renames like any other — only its deletion and its placement are fixed. */
  renameList(id: string, name: string, now: string): void {
    const validNow = validateDateTime(now);
    const trimmed = validateName(name);
    this.requireActiveList(id);
    this.updateListName.run(trimmed, validNow, id, this.profileId);
  }

  /** Sets the view this list opens in — one of the four shapes (TASK-005 / ADR-050). */
  setDefaultView(id: string, view: TaskListView, now: string): void {
    const validNow = validateDateTime(now);
    const validView = validateView(view);
    this.requireActiveList(id);
    this.updateListView.run(validView, validNow, id, this.profileId);
  }

  /**
   * Replaces what this list remembers about its views (ADR-050) — the whole
   * config at once, not one knob, because the renderer holds the config it is
   * editing and a merge here would be this store guessing which half is stale.
   *
   * The shape is revalidated STRICTLY (SEC-EL-02: the renderer is untrusted, and
   * a config also arrives from an archive) and a value that is not a config is
   * refused rather than silently trimmed — the write is where a mistake is still
   * the caller's to fix. `null`, and any config that asks for nothing, store as
   * NULL: there is exactly one representation of "no preferences", so a list
   * never carries a `{}` that reads differently from a list that carries
   * nothing.
   */
  setViewConfig(id: string, config: TaskViewConfig | null, now: string): void {
    const validNow = validateDateTime(now);
    const valid = validateTaskViewConfig(config);
    if (valid === null) {
      throw new TaskListValidationError('"config" is not a valid task view configuration.');
    }
    this.requireActiveList(id);
    // ADR-060: a section-grouped board's column keys are section IDS — the one
    // vocabulary the shape validator cannot know, so it is checked here, where
    // the sections are. Closed vocabularies (status/priority) and the
    // hide-every-column refusal are already the validator's; hiding every
    // SECTION is legal, because the keyless list-body column is always drawn.
    const kanban = valid.kanban;
    if (kanban !== undefined && kanban.groupBy === "section") {
      const keys = [...(kanban.hiddenColumns ?? []), ...(kanban.columnOrder ?? [])];
      if (keys.length > 0) {
        const rows = this.selectSectionScopeIds.all(id) as { id: string }[];
        const sections = new Set(rows.map((row) => row.id));
        for (const key of keys) {
          if (!sections.has(key)) {
            throw new TaskListValidationError(
              '"config" names a kanban column that is not a section of this list.',
            );
          }
        }
      }
    }
    this.updateListViewConfig.run(
      serializeTaskViewConfig(valid),
      validNow,
      id,
      this.profileId,
    );
  }

  /**
   * Re-parents AND re-orders in one call, because in a drag-and-drop tree they
   * are one gesture: `parentId` names the scope the list lands in, and
   * `beforeId`/`afterId` the live siblings it lands between there (either may be
   * null at an end of the scope). Refuses a move that would make the list its
   * own ancestor — including into itself — and refuses to move the Inbox at all.
   */
  moveList(
    id: string,
    parentId: string | null,
    beforeId: string | null,
    afterId: string | null,
    now: string,
  ): void {
    const validNow = validateDateTime(now);
    const list = this.requireActiveList(id);
    if (list.is_inbox === 1) {
      throw new TaskListValidationError("The Inbox cannot be moved.");
    }
    if (parentId !== null) {
      this.requireActiveList(parentId);
      if (parentId === id) {
        throw new TaskListValidationError("A list cannot be moved into itself.");
      }
      if (this.selectListAncestor.get(parentId, id)) {
        throw new TaskListValidationError("A list cannot be moved into its own descendant.");
      }
    }
    if (beforeId === id || afterId === id) {
      throw new TaskListValidationError("A list cannot be ordered against itself.");
    }

    // One transaction, because a renumber and the move it made room for are one
    // edit: half of them is a scope re-spaced for a row that never arrived.
    this.db.transaction(() => {
      const position = this.placeInListScope(parentId, beforeId, afterId);
      this.updateListPlacement.run(parentId, position, validNow, id, this.profileId);
    })();
  }

  /**
   * Soft-deletes a list, in one transaction, taking the tasks it holds with it
   * one of the two ways a user can mean (ADR-029):
   *
   *  - `"move-to-inbox"` — every live task of the list, in any section, moves to
   *    the Inbox body (`section_id` cleared) appended at its end in their
   *    current order, each stamped with the list's own `deleted_at`. The list
   *    keeps its now-empty sections, so restoring it brings the structure back;
   *    `restoreList` walks the moved tasks home by that stamp.
   *  - `"delete-tasks"` — the list and its live tasks are soft-deleted with the
   *    SAME `deleted_at` stamp, which is exactly what `restoreList` undoes.
   *
   * The two are mutually exclusive by construction — a delete either sends its
   * tasks to the Inbox or takes them down, never both — which is what lets
   * `restoreList` tell one undo from the other without a stored mode.
   *
   * Either way its child lists PROMOTE to the deleted list's own parent
   * (`NoteOrgStore.deleteFolder`'s rule), appended at the end of that scope in
   * their current order — a subtree must never disappear because its parent did.
   * The Inbox refuses outright: it is where "move to inbox" moves things.
   */
  deleteList(id: string, mode: DeleteListMode, now: string): void {
    const validNow = validateDateTime(now);
    const list = this.requireActiveList(id);
    if (list.is_inbox === 1) {
      throw new TaskListValidationError("The Inbox cannot be deleted.");
    }
    if (mode !== "move-to-inbox" && mode !== "delete-tasks") {
      throw new TaskListValidationError(`Unknown delete mode "${String(mode)}".`);
    }

    this.db.transaction(() => {
      if (mode === "move-to-inbox") {
        const inbox = this.ensureInbox(validNow);
        const taskIds = (this.selectListTaskIds.all(id, this.profileId) as { id: string }[]).map(
          (row) => row.id,
        );
        let position = this.maxTaskPosition(inbox.id, null);
        for (const taskId of taskIds) {
          position = nextPosition(position);
          this.placeTask.run(inbox.id, null, position, validNow, taskId, this.profileId);
        }
      } else {
        this.markListTasksDeleted.run(validNow, validNow, id, this.profileId);
      }

      const childIds = (this.selectChildListIds.all(id, this.profileId) as { id: string }[]).map(
        (row) => row.id,
      );
      let childPosition = this.maxListPosition(list.parent_id);
      for (const childId of childIds) {
        childPosition = nextPosition(childPosition);
        this.updateListPlacement.run(
          list.parent_id,
          childPosition,
          validNow,
          childId,
          this.profileId,
        );
      }

      this.markListDeleted.run(validNow, validNow, id, this.profileId);
    })();
  }

  /**
   * Restores a soft-deleted list together with exactly the tasks that delete
   * took away from it — whichever of the two things it did with them, in one
   * transaction, so a half-applied undo is not a state anybody can observe.
   *
   *  - after `"delete-tasks"`, the tasks whose `deleted_at` EQUALS the list's own
   *    come back with it;
   *  - after `"move-to-inbox"`, the tasks now sitting in the Inbox whose
   *    `updated_at` EQUALS the list's `deleted_at` are moved back to it.
   *
   * That equality is the whole mechanism, and it is why `deleteList` stamps one
   * `now` across every row it touches: a task the user has deleted, moved or
   * edited since carries a different instant, so it stays exactly where they put
   * it — an undo must never fight a later explicit action. No extra column, no
   * "removed by list" flag, and nothing to keep in step.
   *
   * The two halves are exclusive: a restore that genuinely brought tasks back
   * from the dead was undoing a `"delete-tasks"`, which sent nothing to the
   * Inbox, so it does not go looking there. What remains is a task that was in
   * the Inbox all along and happens to carry the identical millisecond — the
   * same residue the `deleted_at` equality has always had, one column over.
   */
  restoreList(id: string, now: string): void {
    const validNow = validateDateTime(now);
    const row = this.selectDeletedListById.get(id, this.profileId) as TaskListRow | undefined;
    if (!row) {
      throw new TaskListNotFoundError(`No deleted list "${id}" to restore in this profile.`);
    }

    this.db.transaction(() => {
      this.markListRestored.run(validNow, id, this.profileId);
      if (row.deleted_at === null) return;
      const revived = this.markListTasksRestored.run(validNow, id, this.profileId, row.deleted_at);
      if (revived.changes === 0) this.reclaimMovedTasks(id, row.deleted_at, validNow);
    })();
  }

  /**
   * The `"move-to-inbox"` half of `restoreList`: the tasks that delete parked in
   * the Inbox, appended back at the end of the restored list's BODY in the order
   * they left in.
   *
   * The body rather than their old sections, because the move cleared
   * `section_id` outright — that identity is not recorded anywhere, so restoring
   * it would mean inventing it. The list's sections themselves survived the
   * delete, empty, and the user re-files into them.
   */
  private reclaimMovedTasks(listId: string, stamp: string, now: string): void {
    const inbox = this.selectInbox.get(this.profileId) as TaskListRow | undefined;
    if (!inbox) return;
    const taskIds = (
      this.selectMovedTaskIds.all(this.profileId, inbox.id, stamp) as { id: string }[]
    ).map((row) => row.id);
    let position = this.maxTaskPosition(listId, null);
    for (const taskId of taskIds) {
      position = nextPosition(position);
      this.placeTask.run(listId, null, position, now, taskId, this.profileId);
    }
  }

  // ---------------------------------------------------------------------
  // Sections
  // ---------------------------------------------------------------------

  /** One active, owned list's sections, in position order. */
  listSections(listId: string): TaskSection[] {
    this.requireActiveList(listId);
    const rows = this.selectSections.all(listId) as TaskSectionRow[];
    return rows.map(toTaskSection);
  }

  /** Creates a section, appended at the end of its list. */
  createSection(listId: string, name: string, now: string): TaskSection {
    const validNow = validateDateTime(now);
    const trimmed = validateName(name);
    this.requireActiveList(listId);

    const id = uuidv7();
    const position = nextPosition(this.maxSectionPosition(listId));
    this.insertSection.run(id, listId, trimmed, position, validNow, validNow);
    return { id, listId, name: trimmed, position, createdAt: validNow, updatedAt: validNow };
  }

  renameSection(id: string, name: string, now: string): void {
    const validNow = validateDateTime(now);
    const trimmed = validateName(name);
    this.requireSection(id);
    this.updateSectionName.run(trimmed, validNow, id);
  }

  /** Re-orders a section within its own list; `beforeId`/`afterId` are its live siblings there, as in `moveList`. */
  moveSection(id: string, beforeId: string | null, afterId: string | null, now: string): void {
    const validNow = validateDateTime(now);
    const section = this.requireSection(id);
    if (beforeId === id || afterId === id) {
      throw new TaskListValidationError("A section cannot be ordered against itself.");
    }

    // One transaction, for the same reason `moveList` is one.
    this.db.transaction(() => {
      const position = this.placeInSectionScope(section.list_id, beforeId, afterId);
      this.updateSectionPlacement.run(position, validNow, id);
    })();
  }

  /**
   * Deletes a section, first promoting its tasks to the list BODY — appended at
   * its end in their current order, in the same transaction. A section is a
   * heading, not a container the user files things into permanently; removing
   * one must move its contents up, never delete them (and the schema's own
   * `tasks.section_id` foreign key would refuse the delete anyway).
   */
  deleteSection(id: string, now: string): void {
    const validNow = validateDateTime(now);
    const section = this.requireSection(id);

    this.db.transaction(() => {
      const taskIds = (this.selectSectionTaskIds.all(id, this.profileId) as { id: string }[]).map(
        (row) => row.id,
      );
      let position = this.maxTaskPosition(section.list_id, null);
      for (const taskId of taskIds) {
        position = nextPosition(position);
        this.placeTask.run(section.list_id, null, position, validNow, taskId, this.profileId);
      }
      this.deleteSectionRow.run(id);
    })();
  }

  // ---------------------------------------------------------------------
  // Placement
  // ---------------------------------------------------------------------

  /** Inserts a fresh list row at the end of its parent scope — the one place a list row is minted. */
  private insertNewList(
    name: string,
    parentId: string | null,
    isInbox: boolean,
    now: string,
  ): TaskList {
    const id = uuidv7();
    const position = nextPosition(this.maxListPosition(parentId));
    this.insertList.run(id, this.profileId, parentId, name, isInbox ? 1 : 0, position, now, now);
    return {
      id,
      profileId: this.profileId,
      parentId,
      name,
      isInbox,
      defaultView: "list",
      viewConfig: null,
      position,
      createdAt: now,
      updatedAt: now,
    };
  }

  /** The position a list takes between two live siblings of `parentId`, renumbering that scope once if the gap has run out. */
  private placeInListScope(
    parentId: string | null,
    beforeId: string | null,
    afterId: string | null,
  ): number {
    const position = placeBetween(
      (siblingId) => {
        const row = this.selectSiblingListPosition.get(siblingId, this.profileId, parentId) as
          | { position: number }
          | undefined;
        if (!row) {
          throw new TaskListNotFoundError(
            `No active list "${siblingId}" to order against in this scope.`,
          );
        }
        return row.position;
      },
      () => {
        const ids = this.selectListScopeIds.all(this.profileId, parentId) as { id: string }[];
        ids.forEach((row, index) => {
          this.updateListPosition.run((index + 1) * TASK_ORDER_GAP, row.id, this.profileId);
        });
      },
      beforeId,
      afterId,
    );
    if (position === null) {
      throw new TaskListValidationError(
        '"beforeId" and "afterId" do not describe a gap in this scope.',
      );
    }
    return position;
  }

  /** The section counterpart of `placeInListScope`, over one list's own sections. */
  private placeInSectionScope(
    listId: string,
    beforeId: string | null,
    afterId: string | null,
  ): number {
    const position = placeBetween(
      (siblingId) => {
        const row = this.selectSiblingSectionPosition.get(siblingId, listId) as
          | { position: number }
          | undefined;
        if (!row) {
          throw new TaskSectionNotFoundError(
            `No section "${siblingId}" to order against in list "${listId}".`,
          );
        }
        return row.position;
      },
      () => {
        const ids = this.selectSectionScopeIds.all(listId) as { id: string }[];
        ids.forEach((row, index) => {
          this.updateSectionPosition.run((index + 1) * TASK_ORDER_GAP, row.id);
        });
      },
      beforeId,
      afterId,
    );
    if (position === null) {
      throw new TaskListValidationError(
        '"beforeId" and "afterId" do not describe a gap in this list.',
      );
    }
    return position;
  }

  private maxListPosition(parentId: string | null): number | null {
    const row = this.selectMaxListPosition.get(this.profileId, parentId) as {
      maxPosition: number | null;
    };
    return row.maxPosition;
  }

  private maxSectionPosition(listId: string): number | null {
    const row = this.selectMaxSectionPosition.get(listId) as { maxPosition: number | null };
    return row.maxPosition;
  }

  private maxTaskPosition(listId: string, sectionId: string | null): number | null {
    const row = this.selectMaxTaskPosition.get(this.profileId, listId, sectionId) as {
      maxPosition: number | null;
    };
    return row.maxPosition;
  }

  // ---------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------

  /** Reads an active list in this profile or throws — the gate every list reference goes through. */
  private requireActiveList(id: string): TaskListRow {
    const row = this.selectActiveListById.get(id, this.profileId) as TaskListRow | undefined;
    if (!row) {
      throw new TaskListNotFoundError(`No active list "${id}" in this profile.`);
    }
    return row;
  }

  /** Reads a section of an active list in this profile or throws — the gate every section reference goes through. */
  private requireSection(id: string): TaskSectionRow {
    const row = this.selectSectionById.get(id, this.profileId) as TaskSectionRow | undefined;
    if (!row) {
      throw new TaskSectionNotFoundError(`No section "${id}" in this profile.`);
    }
    return row;
  }
}

/**
 * The end of a scope whose current maximum is `max` (`null` when the scope is
 * empty) — `positionBetween`'s append endpoint, which by construction always has
 * room, spelled out here so the append paths need no null check for a case that
 * cannot happen.
 */
function nextPosition(max: number | null): number {
  return max === null ? TASK_ORDER_GAP : max + TASK_ORDER_GAP;
}

function toTaskList(row: TaskListRow): TaskList {
  return {
    id: row.id,
    profileId: row.profile_id,
    parentId: row.parent_id,
    name: row.name,
    isInbox: row.is_inbox === 1,
    defaultView: row.default_view,
    viewConfig: parseStoredTaskViewConfig(row.view_config),
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTaskSection(row: TaskSectionRow): TaskSection {
  return {
    id: row.id,
    listId: row.list_id,
    name: row.name,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** One rule for both row kinds: a list and a section are both labels, bounded the same way. */
function validateName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TaskListValidationError("A name must not be empty.");
  }
  if (trimmed.length > MAX_TASK_LIST_NAME_LENGTH) {
    throw new TaskListValidationError(
      `A name must not exceed ${MAX_TASK_LIST_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateView(value: TaskListView): TaskListView {
  if (!(TASK_LIST_VIEWS as readonly string[]).includes(value)) {
    throw new TaskListValidationError(`Unknown list view "${String(value)}".`);
  }
  return value;
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new TaskListValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
