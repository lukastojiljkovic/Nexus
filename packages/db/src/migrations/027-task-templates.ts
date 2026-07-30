import type { Migration } from "./migrations.js";

/**
 * Migration 27 — task templates (ADR-035 / TASK-010): a saved shape a task can
 * be created FROM, deliberately modelled on migration 015's `note_templates`
 * rather than on a task. Everything below follows from that one decision:
 * a template is content to instantiate, with no identity in the task graph, no
 * completion state, no place in any list's order, and no history worth keeping.
 *
 * `payload` is the whole task-shaped body as **JSON text** — title,
 * description, priority, a relative `dueOffsetDays`, the reminder ladder, the
 * recurrence rule, tag NAMES and direct subtask titles. JSON rather than a
 * column apiece for the reason `note_templates.content` is: none of it is ever
 * queried, filtered or joined on — the row is read whole, validated whole and
 * handed to `TaskStore.create` whole — so a dozen columns (three of them
 * arrays, which SQLite has no type for anyway) would buy nothing a JSON blob
 * does not already give. `TaskTemplateStore` validates every field on the way
 * IN and on the way OUT, which is where the shape is actually enforced; no
 * `CHECK` here could express any of it.
 *
 * Two choices inside that payload are worth naming, because they are what makes
 * a template survive time and editing:
 *
 *  - **`dueOffsetDays` is relative, never an absolute date.** A template saying
 *    "due 2026-08-01" rots the day after; one saying "due in 3 days" is still
 *    true next year. A rule phases from the date apply computes, and the
 *    reminder ladder counts back from it, so both anchors travel with the
 *    offset instead of pointing at a day in the past.
 *  - **Tags are NAMES, not ids.** A template that stored `task_tags.id` would
 *    break the moment the user deleted that tag — a hard delete, since
 *    migration 023's tags carry no soft delete — and would be unusable in any
 *    other profile. Names re-resolve through `TaskTagStore`'s get-or-create at
 *    apply time, so a deleted tag is simply recreated, which is what the user
 *    means by applying a template that carries it.
 *
 * The UNIQUE `(profile_id, name)` index makes the name the user-facing identity
 * of a template, exactly as it does for note templates: it is what "saving
 * under an existing name replaces it" relies on (`TaskTemplateStore.saveByName`
 * is an upsert on this pair). There is no rename here, and therefore no
 * self-excluding collision statement: a task template is captured FROM a task
 * rather than edited in place, so renaming one is saving it again under the new
 * name — the same act by a different word.
 *
 * There is deliberately **no soft delete**, again following `note_templates`:
 * nothing references a template (a task created from one keeps no link back —
 * it is a task like any other from the moment it exists), so deleting one
 * cannot orphan anything, and the undo is to save it again.
 *
 * The table carries no `list_id`/`section_id` either. A template is applied
 * where the user is standing, which is the list the rail has selected; storing a
 * destination would mean a template silently filing tasks into a list the user
 * is not looking at, and would break the moment that list was deleted.
 */
export const migration027: Migration = {
  version: 27,
  up(db) {
    db.exec(`
      CREATE TABLE task_templates (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        payload     TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE UNIQUE INDEX task_templates_profile_name ON task_templates (profile_id, name);
    `);
  },
};
