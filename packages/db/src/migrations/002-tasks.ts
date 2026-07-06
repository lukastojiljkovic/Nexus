import type { Migration } from "./migrations.js";

/**
 * Migration 2 — the TASK module's v0 data layer (PRD 03: TASK-001 fields,
 * TASK-004 subtasks/nested sub-lists, TASK-005 kanban, TASK-008 done rollup).
 *
 * One `tasks` table, profile-scoped and soft-deletable. A closed `status` enum
 * is the single field that drives both list check-off (done ⇔ status 'done')
 * and kanban columns (grouped on the select field by the views engine);
 * `priority` is the second closed enum kanban can group on. `parent_id` is the
 * self-reference for subtasks and nested sub-lists. Ids are UUIDv7 text and all
 * timestamps are ISO-8601 text (ADR-001). Container tables (lists/sections),
 * tags, recurrence, reminders and attachments are deferred to their own slices
 * — no speculative columns here.
 */
export const migration002: Migration = {
  version: 2,
  up(db) {
    db.exec(`
      CREATE TABLE tasks (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        parent_id    TEXT REFERENCES tasks(id) ON DELETE CASCADE,
        title        TEXT NOT NULL,
        description  TEXT,
        status       TEXT NOT NULL DEFAULT 'todo'
                       CHECK (status IN ('todo', 'doing', 'done')),
        priority     TEXT NOT NULL DEFAULT 'none'
                       CHECK (priority IN ('none', 'low', 'medium', 'high')),
        due_date     TEXT,
        start_date   TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        completed_at TEXT,
        deleted_at   TEXT,
        -- Completion invariant: a task is done exactly when it carries a
        -- completion timestamp. Keeps list check-off, kanban drag, and the
        -- done-state conflict rule (PRD §7) from ever disagreeing.
        CHECK ((status = 'done') = (completed_at IS NOT NULL))
      );

      -- The hot path is "active tasks for one profile, in creation order"
      -- (PRD §7 budgets it at 10k+ tasks). This partial index covers that query
      -- and keeps soft-deleted rows out of it.
      CREATE INDEX tasks_profile_active
        ON tasks (profile_id, created_at, id)
        WHERE deleted_at IS NULL;
    `);
  },
};
