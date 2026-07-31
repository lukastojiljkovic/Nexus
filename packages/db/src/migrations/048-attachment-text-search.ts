import type { Migration } from "./migrations.js";

/**
 * The task kind's DISPLAY body — migration 025's expression, character for
 * character. It is what a search result actually shows, and nothing about it
 * changes here: the task's own description, then the names of the files
 * attached to it.
 */
const TASK_DISPLAY_BODY = `substr(
            coalesce(description, '')
              || coalesce(
                   CASE WHEN coalesce(description, '') = '' THEN '' ELSE ' ' END
                     || (SELECT group_concat(file_name, ' ')
                           FROM (SELECT file_name FROM task_attachments
                                  WHERE task_id = tasks.id
                                  ORDER BY id)),
                   ''),
            1, 8000)`;

/**
 * The task kind's MATCH body: the display body with every attached file's
 * extracted text riding directly behind its own name.
 *
 * `nullif(extracted_text, '')` is what makes the two bodies coincide again
 * whenever there is nothing to add — a NULL (never extracted) and an empty
 * string (extracted, nothing there) both collapse the `' ' || …` to NULL, which
 * the `coalesce` turns into the empty string, leaving the part as the bare file
 * name. So on a file whose attachments carry no text this expression produces
 * byte-for-byte what `TASK_DISPLAY_BODY` produces, which is precisely why this
 * migration needs no re-projection of its own (see the class comment).
 *
 * `group_concat` over a sub-select carrying its own `ORDER BY` for the reason
 * migration 025 gives: the aggregate is documented to concatenate in an
 * ARBITRARY order, and an aggregate over an ordered subquery cannot be
 * flattened away, which is what makes the order survive rather than merely tend
 * to. The 8000-character cap wraps the whole thing, exactly as every other
 * kind's does — a long description crowds out the file text the same way it
 * already crowds out the file names.
 */
const TASK_MATCH_BODY = `substr(
            coalesce(description, '')
              || coalesce(
                   CASE WHEN coalesce(description, '') = '' THEN '' ELSE ' ' END
                     || (SELECT group_concat(part, ' ')
                           FROM (SELECT file_name
                                          || coalesce(' ' || nullif(extracted_text, ''), '') AS part
                                   FROM task_attachments
                                  WHERE task_id = tasks.id
                                  ORDER BY id)),
                   ''),
            1, 8000)`;

/** The `search_entries` column list every projecting statement writes, in the order migration 017 fixed. */
const ENTRY_COLUMNS =
  "kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at";

/**
 * Migration 48 — the CONTENTS of text and markdown attachments become findable
 * (SRCH-008, the half of ADR-021's open question that needs no dependency).
 *
 * ADR-021 shipped attachment FILE NAMES into the index and recorded the
 * contents as needing per-format text extraction, "the same work File Preview
 * needs". File Preview then shipped (ADR-064) and brought exactly that
 * extraction for the formats that need nothing installed: `sniffMime`'s bounded
 * UTF-8 heuristic (`text/plain`) plus `isTextPreviewAttachment` /
 * `decodePreviewText` in main. This migration is the storage half of using it.
 *
 * **PDF and DOCX/XLSX/PPTX stay out, by name.** Reading their text needs a
 * parser — a dependency this repo adds none of — and the alternative,
 * scraping recognisable byte runs out of a compressed container, would put
 * fragments of the wrong words into an index the user is entitled to trust. An
 * honest absence beats a partial, wrong extraction. `subject_attachments` stays
 * out too, for a different reason: its file NAMES are not projected either
 * (migration 035 says so deliberately), and indexing the contents of files
 * whose names are not searchable would be a wider feature wearing this one's
 * clothes. And PRIVATE notes stay out by construction — their sealed tables get
 * no projection views at all (migration 045), which is a guarantee this feature
 * must not become the exception to; the private section keeps its own separate
 * in-memory index.
 *
 * ## The column
 *
 * `extracted_text` is nullable on both tables, and its NULL-ness is the whole
 * bookkeeping mechanism:
 *
 *  - **NULL** — never attempted. The backfill's candidate set is exactly this.
 *  - **non-NULL** — attempted, and the value is whatever came out. An empty
 *    string therefore means "we looked and there is nothing to index", which
 *    covers all three ways that happens: a file that is not text after all, a
 *    blob that has gone missing, and bytes that would not decode. One value,
 *    one meaning — *attempted* — so a row whose blob is unreadable is never
 *    retried forever, and no second flag column is needed to say so.
 *
 * No trigger can fill it: the bytes live encrypted on disk outside the
 * database, so extraction happens in MAIN, once, at the moment the app already
 * holds both the blob key and the bytes. What SQL sees is the finished column.
 * A file that predates this migration is filled by main's bounded post-unlock
 * backfill, which is also why the two partial indexes below exist — keyed on
 * `id` with the predicate `extracted_text IS NULL`, they ARE the pending queue,
 * they shrink to nothing as it drains, and they keep an unlock on a fully
 * indexed library from scanning both tables to discover there is no work.
 *
 * ## The projection: matchable, not displayed
 *
 * The extracted text rides `body_folded` — the MATCHABLE column — and
 * deliberately NOT `body`, the displayed one. This is the one place where
 * migration 025's rule that the two must stay identical is broken on purpose,
 * and it is broken in the direction of honesty rather than away from it: a
 * result's snippet is supposed to show the RECORD, and a paragraph lifted out
 * of an attached file's innards is not the record's own text. Splicing it in
 * would make a task's summary line read as though the task itself said
 * something it never said.
 *
 * The divergence is what the surface then reads: a hit whose query terms appear
 * nowhere in the title or snippet it was shown must have matched something
 * indexed but not displayed, and after this migration the only such text is
 * attachment content — so `toSearchResult` marks exactly those results, and the
 * search page and palette say so out loud instead of showing a row that appears
 * to match nothing.
 *
 * ## The mechanism, and why there is no backfill statement
 *
 * A view swap, exactly as migration 025 did it. `search_source_task` and
 * `search_source_attachment` are dropped and recreated under the same names,
 * so migration 017's and 025's own triggers — which name the views rather than
 * restating their projections — keep working untouched and index the wider body
 * from their next fire onwards. `rebuildSearchIndex` reads the same names, so
 * the repair path widens with them and no TypeScript changes.
 *
 * Two trigger notes:
 *  - `task_attachments_search_au` is recreated with `extracted_text` added to
 *    its `AFTER UPDATE OF` list. That narrowing is why the trigger exists in
 *    that form (migration 025): it keeps a correction to `mime` or `size_bytes`
 *    from re-projecting a task for nothing, and a column that DOES change the
 *    projection has to be named in it or the first extraction would land in the
 *    table without ever reaching the index.
 *  - `note_attachments_search_au` needs no change at all: migration 017 wrote it
 *    unnarrowed (`AFTER UPDATE ON note_attachments`), so it already fires on a
 *    write to any column, this one included. Left exactly as it is — narrowing
 *    it now would be a behaviour change to a trigger this slice has no quarrel
 *    with.
 *
 * And deliberately NO re-projection statement, where migration 025 needed one.
 * Every `extracted_text` in the file is NULL at the moment this migration runs,
 * and with every value NULL both widened expressions produce byte-for-byte what
 * the old ones produced (`nullif` collapses the addition away above;
 * `nx_fold(substr(coalesce(NULL, ''), 1, 8000))` is the empty string the
 * attachment kind's `body_folded` already was). Re-projecting would rewrite
 * every task and attachment entry in the file to the identical value. Each
 * row's FIRST extraction fires its own refresh trigger, which is where the
 * index actually gains anything.
 *
 * ## Interchange
 *
 * `extracted_text` deliberately does NOT travel in an archive, and this needs no
 * schema-version bump. It is *derived* from bytes that already travel — the
 * blob is in `blobs/<sha256>` either way — so carrying it would duplicate
 * content the archive already holds and add a second copy that can disagree
 * with the first (an older writer's extraction, restored into a newer reader).
 * A restored profile's attachment rows therefore arrive NULL, which is the
 * honest "not attempted yet" state, and main runs a backfill pass at the end of
 * every restore and import apply as well as at unlock — so the restore path
 * ends consistent and the rows are covered rather than left waiting for a
 * relaunch.
 */
export const migration048: Migration = {
  version: 48,
  up(db) {
    db.exec(`
      ALTER TABLE note_attachments ADD COLUMN extracted_text TEXT;
      ALTER TABLE task_attachments ADD COLUMN extracted_text TEXT;

      -- The pending queue, as an index: exactly the rows the backfill still has
      -- to look at, in insertion order (id is a UUIDv7). Empties itself as the
      -- backfill drains, so an unlock on a fully indexed library reads nothing.
      CREATE INDEX note_attachments_text_pending ON note_attachments (id)
        WHERE extracted_text IS NULL;
      CREATE INDEX task_attachments_text_pending ON task_attachments (id)
        WHERE extracted_text IS NULL;

      DROP VIEW search_source_task;

      CREATE VIEW search_source_task AS
        SELECT
          'task'                        AS kind,
          id                            AS entity_id,
          profile_id                    AS profile_id,
          NULL                          AS parent_id,
          title                         AS title,
          ${TASK_DISPLAY_BODY}          AS body,
          nx_fold(title)                AS title_folded,
          nx_fold(${TASK_MATCH_BODY})   AS body_folded,
          due_date                      AS context_date,
          updated_at                    AS updated_at
        FROM tasks
        WHERE deleted_at IS NULL;

      DROP VIEW search_source_attachment;

      -- Migration 017's projection with one column changed: an attachment's
      -- own entry gains its file's text as its matchable body, while the
      -- displayed body stays empty — the result row shows the file NAME, which
      -- is the attachment's own text, and says separately that the match came
      -- from inside it. Liveness, parent and profile scoping are untouched.
      CREATE VIEW search_source_attachment AS
        SELECT
          'attachment'                                            AS kind,
          a.id                                                     AS entity_id,
          n.profile_id                                             AS profile_id,
          a.note_id                                                AS parent_id,
          a.file_name                                              AS title,
          ''                                                       AS body,
          nx_fold(a.file_name)                                     AS title_folded,
          nx_fold(substr(coalesce(a.extracted_text, ''), 1, 8000)) AS body_folded,
          NULL                                                     AS context_date,
          a.created_at                                             AS updated_at
        FROM note_attachments a
        JOIN notes n ON n.id = a.note_id
        WHERE n.deleted_at IS NULL;

      -- Migration 025's trigger with \`extracted_text\` added to the column
      -- narrowing; the body is its own, verbatim.
      DROP TRIGGER task_attachments_search_au;
      CREATE TRIGGER task_attachments_search_au
        AFTER UPDATE OF file_name, extracted_text ON task_attachments
      BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = new.task_id;
        INSERT INTO search_entries (${ENTRY_COLUMNS})
          SELECT ${ENTRY_COLUMNS} FROM search_source_task WHERE entity_id = new.task_id;
      END;
    `);
  },
};
