import type { Migration } from "./migrations.js";

/**
 * The task kind's body projection (migration 017's, widened): the task's own
 * description, then the names of the files attached to it. Written once and
 * spliced into BOTH `body` and `body_folded` below — a code-level constant at
 * the same trust level as the SQL text around it, never a value from anywhere —
 * because the two columns are the same text seen twice, once for display and
 * once for matching, and a projection that drifted between them would index
 * words the snippet cannot show.
 *
 * Three properties the shape is chosen for:
 *  - With no attachments the sub-select aggregates zero rows, yielding NULL —
 *    so the separator, which is concatenated INSIDE the `coalesce`, vanishes
 *    with it and the body comes out byte-for-byte what migration 017 produced.
 *    That is also why nothing here is `trim`med the way `search_source_event`
 *    trims its two-part body: `TaskStore` stores a description verbatim (only
 *    an all-whitespace one collapses to NULL), so trimming would have quietly
 *    rewritten the body of every attachment-less task in the file.
 *  - With no description the `CASE` drops the separator instead, so the
 *    filenames stand alone rather than behind a leading space.
 *  - `group_concat` alone is documented to concatenate in an ARBITRARY order,
 *    so the rows come from a sub-select ordered by `id` (a UUIDv7 — insertion
 *    order without a second column). An aggregate over a subquery carrying its
 *    own `ORDER BY` cannot be flattened away, which is what makes the order
 *    survive into the aggregate rather than merely tending to.
 *
 * The 8000-character cap wraps the WHOLE thing, exactly as every other kind's
 * body cap does: a description long enough to hit it crowds the filenames out
 * of the index, the same way an event's long description crowds out its
 * location today. The alternative — capping the halves separately — would let
 * one row store more indexed text than any other kind can.
 */
const TASK_SEARCH_BODY = `substr(
            coalesce(description, '')
              || coalesce(
                   CASE WHEN coalesce(description, '') = '' THEN '' ELSE ' ' END
                     || (SELECT group_concat(file_name, ' ')
                           FROM (SELECT file_name FROM task_attachments
                                  WHERE task_id = tasks.id
                                  ORDER BY id)),
                   ''),
            1, 8000)`;

/** The `search_entries` column list every projecting statement below writes, in the order migration 017 fixed. */
const ENTRY_COLUMNS =
  "kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at";

/**
 * Migration 25 — a task's attachment filenames become findable, through the
 * TASK's own search entry (ADR-032).
 *
 * Deliberately NOT a tenth search kind. A note attachment earns an entry of its
 * own because it has a destination of its own: the note's Prilozi panel, which
 * a result can reveal. A task's files live only inside the task edit form —
 * there is nowhere else for a hit to land — so the task IS the destination.
 * Indexing the names inside the task's entry makes searching a filename surface
 * the task carrying it, with the filename visible in the snippet, instead of a
 * result whose only possible action is "open the task anyway".
 *
 * The mechanism is a view swap: `search_source_task` is dropped and recreated
 * under the same name, identical in every column but `body`/`body_folded` (see
 * `TASK_SEARCH_BODY` above). Migration 017's `tasks_search_ai`/`_au`/`_ad`
 * triggers name that view rather than restating its projection, so they keep
 * working untouched and index the wider body from their next fire onwards —
 * which is the entire reason 017 put one view per kind in the schema instead of
 * repeating the SELECT inside each trigger. `rebuildSearchIndex` reads the same
 * view by name too, so the repair path widens with it and no TypeScript changes.
 *
 * What the view alone cannot do is notice that a CHILD row changed: a task's
 * own `updated_at` does not move when a file is attached to it. Hence three
 * triggers on `task_attachments`, each refreshing the PARENT task's entry with
 * the same delete-then-reinsert `notes_search_au` uses for its note-attachment
 * children (a contentless FTS5 row cannot be updated in place — see 017).
 * `AFTER UPDATE OF file_name` is scoped to the one column the projection reads:
 * `task_id` never moves (`TaskAttachmentStore` has no such method, and a file
 * changing owner is not a state the UI can produce), and a row whose `mime` or
 * `size_bytes` is corrected has nothing to reindex.
 *
 * Finally the task kind is re-projected once. A file already carrying migration
 * 024 has attachment rows whose names were never in the index — their task
 * entries were written by the OLD view — and they would stay invisible until
 * each task happened to be edited. This is 017's own backfill narrowed to the
 * one kind whose projection changed; on a fresh database it matches no rows at
 * all. Every other view, trigger and kind is left exactly as it was.
 */
export const migration025: Migration = {
  version: 25,
  up(db) {
    db.exec(`
      DROP VIEW search_source_task;

      CREATE VIEW search_source_task AS
        SELECT
          'task'                          AS kind,
          id                              AS entity_id,
          profile_id                      AS profile_id,
          NULL                            AS parent_id,
          title                           AS title,
          ${TASK_SEARCH_BODY}             AS body,
          nx_fold(title)                  AS title_folded,
          nx_fold(${TASK_SEARCH_BODY})    AS body_folded,
          due_date                        AS context_date,
          updated_at                      AS updated_at
        FROM tasks
        WHERE deleted_at IS NULL;

      CREATE TRIGGER task_attachments_search_ai AFTER INSERT ON task_attachments BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = new.task_id;
        INSERT INTO search_entries (${ENTRY_COLUMNS})
          SELECT ${ENTRY_COLUMNS} FROM search_source_task WHERE entity_id = new.task_id;
      END;
      CREATE TRIGGER task_attachments_search_au AFTER UPDATE OF file_name ON task_attachments BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = new.task_id;
        INSERT INTO search_entries (${ENTRY_COLUMNS})
          SELECT ${ENTRY_COLUMNS} FROM search_source_task WHERE entity_id = new.task_id;
      END;
      -- \`old\`, not \`new\`: an AFTER DELETE trigger has no \`new\` row, and reading
      -- one is not an error SQLite reports — it is a refresh that silently does
      -- nothing. The reinsert finds no task at all when the delete came from a
      -- task's (or profile's) own cascade, since SQLite removes the parent row
      -- before running the child action, which is exactly what keeps a hard
      -- delete from resurrecting the entry its own AD trigger just removed.
      CREATE TRIGGER task_attachments_search_ad AFTER DELETE ON task_attachments BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = old.task_id;
        INSERT INTO search_entries (${ENTRY_COLUMNS})
          SELECT ${ENTRY_COLUMNS} FROM search_source_task WHERE entity_id = old.task_id;
      END;

      DELETE FROM search_entries WHERE kind = 'task';
      INSERT INTO search_entries (${ENTRY_COLUMNS})
        SELECT ${ENTRY_COLUMNS} FROM search_source_task;
    `);
  },
};
