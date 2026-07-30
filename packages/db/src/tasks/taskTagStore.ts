import type Database from "better-sqlite3-multiple-ciphers";
import { TaskNotFoundError, TaskTagNotFoundError, TaskTagValidationError } from "../errors.js";
import { uuidv7 } from "../ids.js";

type DatabaseHandle = Database.Database;

/** A task tag as the store returns it — a per-profile label, unique by (profile, name). */
export interface TaskTag {
  id: string;
  profileId: string;
  name: string;
  createdAt: string;
}

/** One task-tag attachment. */
export interface TaskTagLink {
  taskId: string;
  tagId: string;
}

interface TaskTagRow {
  id: string;
  profile_id: string;
  name: string;
  created_at: string;
}

interface TaskTagLinkRow {
  task_id: string;
  tag_id: string;
}

const TAG_COLUMNS = "id, profile_id, name, created_at";

/**
 * The `note_tags` bound, copied rather than reinvented: a label is a label
 * whichever entity carries it. Exported (and re-exported from the package
 * barrel) so `TaskTemplateStore` — whose payloads carry tag NAMES rather than
 * ids — bounds them by this very number instead of a second copy of it.
 */
export const MAX_TASK_TAG_NAME_LENGTH = 50;

/** Accepts a full ISO-8601 date-time (the `now` every mutating method takes) — mirrors noteOrgStore.ts. */
const ISO_8601_DATETIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})?$/;

/**
 * Persistence for the TASK module's tags (migration 023): per-profile labels and
 * the task-tag many-to-many join. This is `NoteOrgStore`'s tag half applied to
 * tasks — method for method, rule for rule, deliberately — because it is the
 * same feature on a different entity, and a second set of semantics for "a
 * label" would only mean two things for the UI to explain. Construct one per
 * profile, reuse it, over prepared, parameterized statements (SEC-API-03), every
 * value bound, never interpolated. Inputs are revalidated here because the
 * renderer is untrusted (SEC-EL-02), and every statement is scoped by
 * `profile_id` — the links are reached through their already-scoped task, so one
 * profile's tags are invisible to a store scoped to another.
 *
 * Inherited from `NoteOrgStore` verbatim: `createTag` is get-or-create (tag
 * names are unique per profile, and re-tagging with an existing name is a
 * normal, non-erroring path for the UI's tag input); `attachTag` requires an
 * ACTIVE task, while `listTagLinks` merely hides a soft-deleted task's links
 * rather than deleting them, so restoring the task brings its tags back.
 *
 * Tags live in their own store rather than in `TaskStore` or `TaskListStore`,
 * for `NoteOrgStore`'s own reason: what a task IS and how it is LABELLED are
 * separate concerns, and neither of the other two stores would gain anything
 * from carrying eight more statements.
 */
export class TaskTagStore {
  private readonly insertTag: Database.Statement;
  private readonly selectTags: Database.Statement;
  private readonly selectTagById: Database.Statement;
  private readonly selectTagByName: Database.Statement;
  private readonly selectTagNameCollision: Database.Statement;
  private readonly updateTagName: Database.Statement;
  private readonly deleteTagRow: Database.Statement;

  private readonly selectActiveTaskById: Database.Statement;
  private readonly selectTagLinks: Database.Statement;
  private readonly insertTagLink: Database.Statement;
  private readonly deleteTagLink: Database.Statement;

  constructor(
    db: DatabaseHandle,
    private readonly profileId: string,
  ) {
    this.insertTag = db.prepare(
      `INSERT INTO task_tags (id, profile_id, name, created_at) VALUES (?, ?, ?, ?)`,
    );
    this.selectTags = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM task_tags WHERE profile_id = ? ORDER BY name`,
    );
    this.selectTagById = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM task_tags WHERE id = ? AND profile_id = ?`,
    );
    this.selectTagByName = db.prepare(
      `SELECT ${TAG_COLUMNS} FROM task_tags WHERE profile_id = ? AND name = ?`,
    );
    this.selectTagNameCollision = db.prepare(
      `SELECT id FROM task_tags WHERE profile_id = ? AND name = ? AND id != ?`,
    );
    this.updateTagName = db.prepare(
      `UPDATE task_tags SET name = ? WHERE id = ? AND profile_id = ?`,
    );
    this.deleteTagRow = db.prepare(`DELETE FROM task_tags WHERE id = ? AND profile_id = ?`);

    this.selectActiveTaskById = db.prepare(
      `SELECT id FROM tasks WHERE id = ? AND profile_id = ? AND deleted_at IS NULL`,
    );
    this.selectTagLinks = db.prepare(
      `SELECT ttl.task_id, ttl.tag_id
       FROM task_tag_links ttl
       JOIN tasks t ON t.id = ttl.task_id
       WHERE t.profile_id = ? AND t.deleted_at IS NULL
       ORDER BY ttl.task_id, ttl.tag_id`,
    );
    this.insertTagLink = db.prepare(
      `INSERT INTO task_tag_links (task_id, tag_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
    );
    this.deleteTagLink = db.prepare(
      `DELETE FROM task_tag_links
       WHERE task_id = ? AND tag_id = ? AND task_id IN (SELECT id FROM tasks WHERE profile_id = ?)`,
    );
  }

  // ---------------------------------------------------------------------
  // Tags
  // ---------------------------------------------------------------------

  /** This profile's tags, alphabetical by name. */
  listTags(): TaskTag[] {
    const rows = this.selectTags.all(this.profileId) as TaskTagRow[];
    return rows.map(toTaskTag);
  }

  /** Get-or-create by trimmed name: an existing tag with the same name is returned, never duplicated. */
  createTag(name: string, now: string): TaskTag {
    const validNow = validateDateTime(now);
    const trimmed = validateTagName(name);

    const existing = this.selectTagByName.get(this.profileId, trimmed) as TaskTagRow | undefined;
    if (existing) {
      return toTaskTag(existing);
    }

    const id = uuidv7();
    this.insertTag.run(id, this.profileId, trimmed, validNow);
    return { id, profileId: this.profileId, name: trimmed, createdAt: validNow };
  }

  /** Renames a tag; renaming to its own current name is a no-op, not a collision. */
  renameTag(id: string, name: string): void {
    const trimmed = validateTagName(name);
    this.requireTag(id);

    const collision = this.selectTagNameCollision.get(this.profileId, trimmed, id);
    if (collision) {
      throw new TaskTagValidationError(`A tag named "${trimmed}" already exists in this profile.`);
    }

    this.updateTagName.run(trimmed, id, this.profileId);
  }

  /** Deletes a tag; its links are pruned by the schema's CASCADE. */
  deleteTag(id: string): void {
    this.requireTag(id);
    this.deleteTagRow.run(id, this.profileId);
  }

  // ---------------------------------------------------------------------
  // Tag links
  // ---------------------------------------------------------------------

  /** Every task-tag attachment in this profile, excluding soft-deleted tasks. */
  listTagLinks(): TaskTagLink[] {
    const rows = this.selectTagLinks.all(this.profileId) as TaskTagLinkRow[];
    return rows.map((row) => ({ taskId: row.task_id, tagId: row.tag_id }));
  }

  /** Attaches a tag to an active task; attaching an already-attached tag is a no-op. */
  attachTag(taskId: string, tagId: string): void {
    this.requireActiveTask(taskId);
    this.requireTag(tagId);
    this.insertTagLink.run(taskId, tagId);
  }

  /** Detaches a tag from a task; silent (never throws) whether or not the link existed. */
  detachTag(taskId: string, tagId: string): void {
    this.deleteTagLink.run(taskId, tagId, this.profileId);
  }

  // ---------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------

  /** Reads a tag in this profile or throws — the gate every tag reference goes through. */
  private requireTag(id: string): TaskTagRow {
    const row = this.selectTagById.get(id, this.profileId) as TaskTagRow | undefined;
    if (!row) {
      throw new TaskTagNotFoundError(`No tag "${id}" in this profile.`);
    }
    return row;
  }

  /** Confirms an active task exists in this profile or throws. */
  private requireActiveTask(id: string): void {
    const row = this.selectActiveTaskById.get(id, this.profileId);
    if (!row) {
      throw new TaskNotFoundError(`No active task "${id}" in this profile.`);
    }
  }
}

function toTaskTag(row: TaskTagRow): TaskTag {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    createdAt: row.created_at,
  };
}

function validateTagName(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new TaskTagValidationError("A tag name must not be empty.");
  }
  if (trimmed.length > MAX_TASK_TAG_NAME_LENGTH) {
    throw new TaskTagValidationError(
      `A tag name must not exceed ${MAX_TASK_TAG_NAME_LENGTH} characters after trimming.`,
    );
  }
  return trimmed;
}

function validateDateTime(value: string): string {
  if (!ISO_8601_DATETIME.test(value)) {
    throw new TaskTagValidationError('"now" must be an ISO-8601 date-time.');
  }
  return value;
}
