import type { Migration } from "./migrations.js";

/**
 * Migration 29 — task dependencies (ADR-037): "this task cannot start until that
 * one is done". A dependency is a directed edge between two tasks of one
 * profile, so it is stored the way migration 023 stores a task's labels — a bare
 * join table keyed by the pair, with no row of its own to name and nothing to
 * time-stamp. An edge is either there or it is not.
 *
 * `blocker_id` is the task that must finish; `blocked_id` is the task waiting on
 * it. Both cascade, so hard-deleting either end prunes the edge. The PRIMARY KEY
 * `(blocker_id, blocked_id)` makes one pair unrepeatable, which is what lets
 * `TaskDependencyStore.addDependency` be an idempotent `ON CONFLICT DO NOTHING`
 * rather than a read-then-write. `task_dependencies_blocked` covers the reverse
 * lookup — "what is this task waiting on" — which is the direction the edit form
 * reads in, while the primary key's own index covers the forward one.
 *
 * NO `profile_id` column, exactly as `task_tag_links` has none: both ends are
 * tasks, and a task already carries its profile, so scoping rides the join
 * (`TaskDependencyStore` reaches every row through an already-scoped `tasks`
 * subquery). A column here would be a second, independently-writable answer to a
 * question the tasks already answer.
 *
 * Nothing is added to `tasks` either, for migration 023's reason: being blocked
 * is not a stored fact but a DERIVED one — a task is blocked while any of its
 * blockers is live and not done — so a column would be a cached copy that every
 * completion, deletion and restore would have to remember to refresh.
 *
 * A task's soft delete (`tasks.deleted_at`) leaves its edges standing, so
 * `TaskStore.restore` brings a task back still blocked (and still blocking);
 * only the store's reads filter them out, the arrangement `task_tag_links` has.
 *
 * The acyclicity rule has no SQL expression — `CHECK` cannot walk a graph — so
 * it lives in the store (a recursive CTE over the blocker chain) and, because an
 * archive bypasses the store entirely, in the archive parser's own twin
 * (`importArchive.ts`).
 */
export const migration029: Migration = {
  version: 29,
  up(db) {
    db.exec(`
      CREATE TABLE task_dependencies (
        blocker_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        blocked_id  TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        PRIMARY KEY (blocker_id, blocked_id)
      );
      CREATE INDEX task_dependencies_blocked ON task_dependencies (blocked_id);
    `);
  },
};
