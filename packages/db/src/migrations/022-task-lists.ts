import { uuidv7 } from "../ids.js";
import type { Migration } from "./migrations.js";

/**
 * Migration 22 — task lists and sections (TASK-004, ADR-029). Three halves that
 * only make sense together, which is why they are one migration:
 *
 *  - `task_lists` — the nestable containers a task lives in, profile-scoped and
 *    soft-deletable like `tasks` itself, with a self-referencing `parent_id`
 *    (the `note_folders` shape from migration 011, plus ordering). `is_inbox`
 *    marks the one list every profile always has: the default a task lands in
 *    when the user names none. `default_view` is the per-list list/kanban
 *    preference (TASK-005's two views, closed by a CHECK).
 *
 *  - `task_sections` — headings INSIDE one list. No `profile_id` of its own and
 *    no soft delete: a section is scoped through its list (the `document_renewals`
 *    arrangement), and deleting one is a structural edit whose tasks
 *    `TaskListStore` promotes to the list body rather than losing.
 *
 *  - `tasks.list_id` / `tasks.section_id` / `tasks.position` — where a task sits.
 *    `list_id` is added NULLable because SQLite's `ALTER TABLE ADD COLUMN` cannot
 *    add a NOT NULL column with a `REFERENCES` clause to a populated table; the
 *    backfill below fills every existing row and `TaskStore` writes it on every
 *    insert, so a NULL after this migration is corruption rather than "no list"
 *    — which is exactly how `TaskStore` reads it.
 *
 * **Ordering columns.** `position` is a sparse integer sort key, not an index:
 * rows in one scope are spaced `POSITION_GAP` apart so an insert between two
 * neighbours is a single UPDATE of the moved row (the midpoint) instead of a
 * renumber of everything after it. `TaskListStore.positionBetween` owns that
 * arithmetic and renumbers a scope only when a gap genuinely runs out. No
 * UNIQUE constraint: equal positions inside one scope are legal (the readers all
 * break the tie on `id`), which is what lets a promoted subtree keep its
 * relative order without a table-wide reshuffle.
 *
 * **Superseded by migration 062**, which replaced this column with a
 * fractional `rank` TEXT: an integer gap can run out, and the whole-scope
 * renumber that recovered from it is a mass UPDATE that a two-device merge
 * cannot tell apart from an intentional reordering. Everything above is
 * what this migration DID; none of it is the shape on disk today.
 *
 * **The Inbox backfill.** Every profile that already exists gains one, here, so
 * no session ever opens a profile without the list `TaskStore.create` defaults
 * to. New profiles get theirs from `TaskListStore.ensureInbox` at creation time
 * — the same row, minted the same way. Timestamps come from a single JS
 * `new Date().toISOString()` rather than SQLite's own clock so every row this
 * migration writes carries the identical stamp.
 *
 * `POSITION_GAP` is spelled out here rather than imported from
 * `TaskListStore`: a migration is a frozen historical record, and importing a
 * constant that a later slice could retune would retroactively change what this
 * migration did.
 */
const POSITION_GAP = 1024;

export const migration022: Migration = {
  version: 22,
  up(db) {
    db.exec(`
      CREATE TABLE task_lists (
        id            TEXT PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        parent_id     TEXT REFERENCES task_lists(id),
        name          TEXT NOT NULL,
        is_inbox      INTEGER NOT NULL DEFAULT 0 CHECK (is_inbox IN (0, 1)),
        default_view  TEXT NOT NULL DEFAULT 'list' CHECK (default_view IN ('list', 'kanban')),
        position      INTEGER NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL,
        deleted_at    TEXT
      );

      CREATE TABLE task_sections (
        id          TEXT PRIMARY KEY,
        list_id     TEXT NOT NULL REFERENCES task_lists(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        position    INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      ALTER TABLE tasks ADD COLUMN list_id TEXT REFERENCES task_lists(id);
      ALTER TABLE tasks ADD COLUMN section_id TEXT REFERENCES task_sections(id);
      ALTER TABLE tasks ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    `);

    // One stamp for every row this migration writes.
    const now = new Date().toISOString();
    const insertInbox = db.prepare(
      `INSERT INTO task_lists
         (id, profile_id, parent_id, name, is_inbox, default_view, position,
          created_at, updated_at, deleted_at)
       VALUES (?, ?, NULL, 'Inbox', 1, 'list', 0, ?, ?, NULL)`,
    );
    // Soft-deleted tasks are backfilled too: restoring one later must not
    // resurrect a row with no list to sit in.
    const selectTasks = db.prepare(
      `SELECT id FROM tasks WHERE profile_id = ? ORDER BY created_at, id`,
    );
    const placeTask = db.prepare(`UPDATE tasks SET list_id = ?, position = ? WHERE id = ?`);

    const profiles = db.prepare(`SELECT id FROM profiles ORDER BY created_at, id`).all() as {
      id: string;
    }[];
    for (const profile of profiles) {
      const inboxId = uuidv7();
      insertInbox.run(inboxId, profile.id, now, now);

      let position = 0;
      for (const task of selectTasks.all(profile.id) as { id: string }[]) {
        position += POSITION_GAP;
        placeTask.run(inboxId, position, task.id);
      }
    }
  },
};
