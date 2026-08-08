import type Database from "better-sqlite3-multiple-ciphers";
import { FIRST_RANK, rankBetween } from "@nexus/core";
import type { Migration } from "./migrations.js";

/**
 * Migration 62 — every hand-orderable scope stops counting and starts ranking.
 *
 * THE DEFECT THIS CLOSES. Since migration 022 an ordered scope has been a column
 * of integers spaced 1024 apart, and an insert between two neighbours took their
 * midpoint. Ten inserts at the same spot exhaust the gap, and the recovery was
 * `renumberScope`: rewrite EVERY row in the scope at fresh 1024 steps.
 *
 * On one machine that is only expensive. Across two it is lossy, and this is the
 * migration's whole reason for existing (ADR-082 §3.1). A renumber is a mass
 * UPDATE that says nothing about what the user did, so two devices that each
 * reorder the same list produce two mass UPDATEs — and a last-writer-wins merge
 * keeps one and silently discards the other person's reordering. No field-level
 * merge can rescue it: the field that changed on both sides is "every row's
 * position". Worse, 022 back-filled `position NOT NULL DEFAULT 0` onto every task
 * that already existed, so for that whole corpus there is not even a tiebreak.
 *
 * A fractional rank (`@nexus/core`'s `rankBetween`) has no gap to exhaust. Between
 * any two distinct ranks there is always another one, so a move is ALWAYS a
 * one-row write and the only row two devices can disagree about is the one that
 * actually moved. `renumberScope` does not get a rank-shaped replacement; it is
 * deleted, because the case it recovered from cannot arise.
 *
 * **This has to happen before the first row ever syncs.** Afterwards it is a
 * migration of every task on every device, coordinated across a network — instead
 * of a local rewrite of a column nothing outside this machine has seen.
 *
 * **The five scopes, and the five that are deliberately left alone.** Converted
 * here: `tasks` (within list + section), `task_lists` (within parent),
 * `task_sections` (within list), `dashboard_sets` and `dashboard_widgets` (within
 * profile). Each is a row the user can point at, drag, and will sync as its own
 * object. NOT converted: `fit_routine_items` and `fit_workout_sets`, whose
 * `position` is an index into their parent's array — they sync as a FIELD of the
 * routine or the workout, replaced whole, so there are never two independent
 * writers to merge (ADR-082 §2). Converting them would add a rank string to
 * express what the array's own order already says.
 *
 * **Why `ADD COLUMN` + back-fill + `DROP COLUMN` and not a table rebuild.** Four
 * of the five are parents: `tasks` references itself and is referenced by
 * `task_tag_links`, `task_attachments`, `task_dependencies` and `task_reminders`;
 * `task_lists` and `task_sections` are referenced by `tasks`; `dashboard_sets` by
 * `dashboard_widgets.set_id`. Rebuilding a referenced parent re-arms the hazard
 * migration 038 documents at length — `DROP TABLE` fires the children's
 * `ON DELETE` actions inside a transaction where `PRAGMA foreign_keys` is a no-op.
 * `DROP COLUMN` touches no constraint and fires nothing. `position` carries no
 * index on the three task tables and appears in no view or trigger
 * (`search_source_task` selects title, description and due date, never position),
 * so the only two indexes in the way are dropped and re-cut on `rank` below.
 *
 * **The cost of not rebuilding** is that `rank` cannot carry a CHECK — SQLite
 * cannot add one to an existing table. The default is therefore a VALID rank
 * (`i0`, the integer zero) rather than the empty string, so a raw insert that
 * forgets the column produces a row at the top of its scope instead of a row
 * whose sort key is unrepresentable. `isRank` at every store boundary is what
 * actually enforces the shape, exactly as `TaskStore` has always been the gate on
 * `position` (migration 022's own test says so).
 */
export const migration062: Migration = {
  version: 62,
  up(db) {
    db.exec(`
      ALTER TABLE tasks              ADD COLUMN rank TEXT NOT NULL DEFAULT '${FIRST_RANK}';
      ALTER TABLE task_lists         ADD COLUMN rank TEXT NOT NULL DEFAULT '${FIRST_RANK}';
      ALTER TABLE task_sections      ADD COLUMN rank TEXT NOT NULL DEFAULT '${FIRST_RANK}';
      ALTER TABLE dashboard_sets     ADD COLUMN rank TEXT NOT NULL DEFAULT '${FIRST_RANK}';
      ALTER TABLE dashboard_widgets  ADD COLUMN rank TEXT NOT NULL DEFAULT '${FIRST_RANK}';
    `);

    // Soft-deleted rows are ranked with the rest: an undelete puts the row back
    // where it was, and skipping them would leave live `i0` collisions behind.
    rerank(db, "tasks", "id", ["profile_id", "list_id", "section_id"], [
      "position",
      "created_at",
      "id",
    ]);
    rerank(db, "task_lists", "id", ["profile_id", "parent_id"], ["position", "id"]);
    rerank(db, "task_sections", "id", ["list_id"], ["position", "id"]);
    rerank(db, "dashboard_sets", "id", ["profile_id"], ["position", "id"]);
    rerank(db, "dashboard_widgets", "instance_id", ["profile_id", "set_id"], [
      "position",
      "instance_id",
    ]);

    db.exec(`
      DROP INDEX dashboard_sets_profile_position;
      DROP INDEX dashboard_widgets_profile_position;

      ALTER TABLE tasks              DROP COLUMN position;
      ALTER TABLE task_lists         DROP COLUMN position;
      ALTER TABLE task_sections      DROP COLUMN position;
      ALTER TABLE dashboard_sets     DROP COLUMN position;
      ALTER TABLE dashboard_widgets  DROP COLUMN position;

      CREATE INDEX dashboard_sets_profile_rank
        ON dashboard_sets (profile_id, rank);
      CREATE INDEX dashboard_widgets_profile_rank
        ON dashboard_widgets (profile_id, rank);
    `);
  },
};

/**
 * Walks one table in scope order and stamps each scope's rows with consecutive
 * ranks, preserving exactly the order the old integers produced — including their
 * tiebreaks, which is why `orderColumns` spells out what each store's `ORDER BY`
 * spelled out. A scope whose positions were all `0` (022's back-fill) therefore
 * keeps its `created_at, id` order rather than acquiring a new arbitrary one.
 *
 * Every identifier here is a literal from the call sites above — never user input
 * — so interpolating them is safe; the values are all bound.
 */
function rerank(
  db: Database.Database,
  table: string,
  idColumn: string,
  scopeColumns: readonly string[],
  orderColumns: readonly string[],
): void {
  const rows = db
    .prepare(
      `SELECT ${idColumn} AS id, ${scopeColumns.join(", ")} FROM ${table}
        ORDER BY ${[...scopeColumns, ...orderColumns].join(", ")}`,
    )
    .all() as Record<string, unknown>[];

  const update = db.prepare(`UPDATE ${table} SET rank = ? WHERE ${idColumn} = ?`);

  let scopeKey: string | null = null;
  let rank: string | null = null;
  for (const row of rows) {
    const key = JSON.stringify(scopeColumns.map((column) => row[column] ?? null));
    if (key !== scopeKey) {
      scopeKey = key;
      rank = null;
    }
    // `rankBetween(previous, null)` is an append, and an append off an integer
    // rank is an integer increment — so a scope of N rows gets N consecutive
    // ranks and never a growing string.
    rank = rankBetween(rank, null) ?? FIRST_RANK;
    update.run(rank, row["id"]);
  }
}
