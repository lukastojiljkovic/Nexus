import type { Migration } from "./migrations.js";

/**
 * Migration 17 — global search's index (ADR-021 / PRD 08 SRCH-001/002). The
 * index lives INSIDE the encrypted database, not in a separate file or an
 * in-memory structure, so it inherits encryption at rest for free; and it is
 * maintained entirely by SQL triggers on the source tables, so no application
 * code — including bulk-import paths not yet written — can ever forget to
 * keep it current. A row lands in `search_entries` the moment its source row
 * is written, and is gone the moment that source row stops being "active",
 * with zero calls from any store into a search module.
 *
 * `search_entries` is the one row-per-searchable-entity table. It carries
 * BOTH the display text (`title`/`body` — the original, for rendering a
 * result) and the matchable text (`title_folded`/`body_folded` — run through
 * `@nexus/core`'s `foldSearchText`, registered on the connection as the SQL
 * function `nx_fold` by `openDatabase`, since SQLite's own tokenizer folds
 * neither Serbian đ nor Cyrillic). Folding is lossy (č and ć both fold to c),
 * so a folded column can never replace the stored form.
 *
 * `UNIQUE (kind, entity_id)` deliberately excludes `profile_id`: entity ids
 * are UUIDv7 and every entity belongs to exactly one profile, so the pair
 * alone is already unique — and every trigger below both looks up and
 * deletes by exactly `(kind, entity_id)`, which this same index then serves
 * as a point lookup rather than a scan.
 *
 * `search_fts` stores no text of its own: it is a pure inverted index over
 * the folded columns, addressed by `search_entries.id` as its rowid
 * (`content = ''`, `contentless_delete = 1`). A contentless FTS5 table cannot
 * UPDATE a row in place, which is why the update path everywhere below is
 * delete-then-insert rather than an UPDATE. The tokenizer's own
 * `remove_diacritics 2` is left on as a harmless second layer over text
 * `nx_fold` has already folded — it never has anything left to do, but
 * leaving it on costs nothing and guards against a future column that might
 * bypass folding.
 *
 * One VIEW per indexed kind (`search_source_<kind>`) defines that kind's
 * projection exactly once; every source-table trigger AND the one-time
 * backfill at the bottom both read the SAME view, so "what a live edit
 * indexes" and "what a fresh migration backfills" can never drift apart.
 * Every view applies `substr(<body expression>, 1, 8000)` to its body in both
 * `body` and `body_folded` — the per-entry body cap — so one huge note or
 * card back can never bloat the index.
 *
 * Each of the nine kinds gets an `<table>_search_ai` / `_au` / `_ad` trigger
 * triple: AI inserts the freshly-created row's projection; AD removes it; AU
 * deletes-then-reinserts from the view, which is what makes a soft delete, an
 * undelete and an ordinary edit all ONE code path — the view's own liveness
 * `WHERE` is what decides whether the reinsert produces a row at all.
 *
 * Two liveness choices are deliberate, not oversights:
 *  - `card` and `attachment` additionally require their PARENT to be alive
 *    (deck, note respectively), because their search result deep-links
 *    THROUGH that parent — an entry whose deep link cannot resolve is worse
 *    than a missing entry.
 *  - `exam` and `deck` do NOT require their subject to be alive, mirroring
 *    `ExamStore.list`/`DeckStore.list`, which do not either: the index must
 *    show exactly what the module's own list shows, no more and no less.
 *
 * Three kinds need a trigger beyond their own table because their projection
 * embeds or is gated by another table's row: `note_snapshots` (AI/AU only —
 * a snapshot carries a note's body) refreshes its note's entry;
 * `notes_search_au` additionally refreshes the note's `attachment` entries
 * (their liveness reads the PARENT note's `deleted_at`); `decks_search_au`
 * additionally refreshes the deck's `card` entries (same reason); and
 * `subjects_search_au` additionally refreshes the subject's `exam` entries,
 * because an exam's title embeds its subject's name.
 */
export const migration017: Migration = {
  version: 17,
  up(db) {
    db.exec(`
      CREATE TABLE search_entries (
        id            INTEGER PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        entity_id     TEXT NOT NULL,
        parent_id     TEXT,
        title         TEXT NOT NULL,
        body          TEXT NOT NULL DEFAULT '',
        title_folded  TEXT NOT NULL,
        body_folded   TEXT NOT NULL DEFAULT '',
        context_date  TEXT,
        updated_at    TEXT NOT NULL,
        UNIQUE (kind, entity_id)
      );

      -- Hot path: "this profile's entries, most recently touched first" — the
      -- freshness-ordered default before any query narrows things down.
      CREATE INDEX search_entries_recent ON search_entries (profile_id, updated_at, id);

      -- Hot path: "this kind's entries under one parent" — every refresh
      -- trigger below (deck -> its cards, note -> its attachments, subject ->
      -- its exams) looks up through this index.
      CREATE INDEX search_entries_parent ON search_entries (kind, parent_id);

      CREATE VIRTUAL TABLE search_fts USING fts5(
        title,
        body,
        content = '',
        contentless_delete = 1,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- The three triggers that keep search_fts in step with search_entries.
      -- Every write to search_entries goes through exactly one of these — no
      -- other code path ever touches search_fts directly.
      CREATE TRIGGER search_entries_ai AFTER INSERT ON search_entries BEGIN
        INSERT INTO search_fts (rowid, title, body) VALUES (new.id, new.title_folded, new.body_folded);
      END;
      CREATE TRIGGER search_entries_ad AFTER DELETE ON search_entries BEGIN
        DELETE FROM search_fts WHERE rowid = old.id;
      END;
      CREATE TRIGGER search_entries_au AFTER UPDATE ON search_entries BEGIN
        DELETE FROM search_fts WHERE rowid = old.id;
        INSERT INTO search_fts (rowid, title, body) VALUES (new.id, new.title_folded, new.body_folded);
      END;

      -- -----------------------------------------------------------------
      -- One projection view per indexed kind (read the class doc comment
      -- above for why one view, read by both triggers and the backfill).
      -- -----------------------------------------------------------------

      CREATE VIEW search_source_task AS
        SELECT
          'task'                                              AS kind,
          id                                                   AS entity_id,
          profile_id                                           AS profile_id,
          NULL                                                 AS parent_id,
          title                                                AS title,
          substr(coalesce(description, ''), 1, 8000)          AS body,
          nx_fold(title)                                       AS title_folded,
          nx_fold(substr(coalesce(description, ''), 1, 8000)) AS body_folded,
          due_date                                             AS context_date,
          updated_at                                           AS updated_at
        FROM tasks
        WHERE deleted_at IS NULL;

      CREATE VIEW search_source_event AS
        SELECT
          'event'                                                                                   AS kind,
          id                                                                                          AS entity_id,
          profile_id                                                                                  AS profile_id,
          NULL                                                                                        AS parent_id,
          title                                                                                       AS title,
          substr(trim(coalesce(description, '') || ' ' || coalesce(location, '')), 1, 8000)          AS body,
          nx_fold(title)                                                                              AS title_folded,
          nx_fold(substr(trim(coalesce(description, '') || ' ' || coalesce(location, '')), 1, 8000)) AS body_folded,
          start_at                                                                                    AS context_date,
          updated_at                                                                                  AS updated_at
        FROM events
        WHERE deleted_at IS NULL;

      -- LEFT JOIN because a note may not have a snapshot yet (no compaction
      -- has ever run) — such a note still indexes, just with an empty body.
      CREATE VIEW search_source_note AS
        SELECT
          'note'                                               AS kind,
          n.id                                                  AS entity_id,
          n.profile_id                                          AS profile_id,
          NULL                                                  AS parent_id,
          n.title                                               AS title,
          substr(coalesce(s.plaintext, ''), 1, 8000)           AS body,
          nx_fold(n.title)                                      AS title_folded,
          nx_fold(substr(coalesce(s.plaintext, ''), 1, 8000))  AS body_folded,
          NULL                                                  AS context_date,
          n.updated_at                                          AS updated_at
        FROM notes n
        LEFT JOIN note_snapshots s ON s.note_id = n.id
        WHERE n.deleted_at IS NULL;

      CREATE VIEW search_source_document AS
        SELECT
          'document'                                                               AS kind,
          id                                                                        AS entity_id,
          profile_id                                                                AS profile_id,
          NULL                                                                      AS parent_id,
          label                                                                     AS title,
          substr(trim(coalesce(notes, '') || ' ' || doc_type), 1, 8000)            AS body,
          nx_fold(label)                                                            AS title_folded,
          nx_fold(substr(trim(coalesce(notes, '') || ' ' || doc_type), 1, 8000))   AS body_folded,
          expiry_date                                                               AS context_date,
          updated_at                                                                AS updated_at
        FROM tracked_documents
        WHERE deleted_at IS NULL;

      CREATE VIEW search_source_subject AS
        SELECT
          'subject'                                          AS kind,
          id                                                  AS entity_id,
          profile_id                                          AS profile_id,
          NULL                                                AS parent_id,
          name                                                 AS title,
          substr(coalesce(semester, ''), 1, 8000)            AS body,
          nx_fold(name)                                       AS title_folded,
          nx_fold(substr(coalesce(semester, ''), 1, 8000))   AS body_folded,
          NULL                                                AS context_date,
          updated_at                                          AS updated_at
        FROM subjects
        WHERE deleted_at IS NULL;

      -- The exam title embeds its subject's name (the middle dot is U+00B7,
      -- spaced both sides) — subjects_search_au below refreshes these rows on
      -- a subject rename. Deliberately does NOT require the subject itself to
      -- be alive: ExamStore.list does not either.
      CREATE VIEW search_source_exam AS
        SELECT
          'exam'                                             AS kind,
          x.id                                                AS entity_id,
          x.profile_id                                        AS profile_id,
          x.subject_id                                        AS parent_id,
          x.exam_type || ' · ' || s.name                      AS title,
          substr(coalesce(x.scope, ''), 1, 8000)             AS body,
          nx_fold(x.exam_type || ' · ' || s.name)             AS title_folded,
          nx_fold(substr(coalesce(x.scope, ''), 1, 8000))    AS body_folded,
          x.exam_date                                         AS context_date,
          x.updated_at                                        AS updated_at
        FROM exams x
        JOIN subjects s ON s.id = x.subject_id
        WHERE x.deleted_at IS NULL;

      -- Deliberately does NOT require the subject to be alive, mirroring
      -- search_source_exam: DeckStore.list does not either.
      CREATE VIEW search_source_deck AS
        SELECT
          'deck'          AS kind,
          id              AS entity_id,
          profile_id      AS profile_id,
          subject_id      AS parent_id,
          name            AS title,
          ''              AS body,
          nx_fold(name)   AS title_folded,
          ''              AS body_folded,
          NULL            AS context_date,
          updated_at      AS updated_at
        FROM decks
        WHERE deleted_at IS NULL;

      -- A card's search result deep-links THROUGH its deck, so this
      -- additionally requires the deck to be alive — an entry whose deep link
      -- cannot resolve is worse than a missing entry.
      CREATE VIEW search_source_card AS
        SELECT
          'card'                             AS kind,
          c.id                                AS entity_id,
          c.profile_id                        AS profile_id,
          c.deck_id                           AS parent_id,
          c.front                             AS title,
          substr(c.back, 1, 8000)            AS body,
          nx_fold(c.front)                    AS title_folded,
          nx_fold(substr(c.back, 1, 8000))   AS body_folded,
          c.due                               AS context_date,
          c.updated_at                        AS updated_at
        FROM cards c
        JOIN decks d ON d.id = c.deck_id
        WHERE c.deleted_at IS NULL AND d.deleted_at IS NULL;

      -- Same deep-link reasoning as search_source_card: an attachment is
      -- revealed inside its note, so this requires the PARENT note to be
      -- alive. note_attachments carries no profile_id of its own — it comes
      -- through the join — and has no body of its own to index, only a name.
      CREATE VIEW search_source_attachment AS
        SELECT
          'attachment'          AS kind,
          a.id                  AS entity_id,
          n.profile_id          AS profile_id,
          a.note_id             AS parent_id,
          a.file_name           AS title,
          ''                    AS body,
          nx_fold(a.file_name)  AS title_folded,
          ''                    AS body_folded,
          NULL                  AS context_date,
          a.created_at          AS updated_at
        FROM note_attachments a
        JOIN notes n ON n.id = a.note_id
        WHERE n.deleted_at IS NULL;

      -- -----------------------------------------------------------------
      -- Source-table triggers. See the class doc comment for the general
      -- AI/AU/AD shape and which tables need an extra refresh beyond their
      -- own row.
      -- -----------------------------------------------------------------

      CREATE TRIGGER tasks_search_ai AFTER INSERT ON tasks BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_task WHERE entity_id = new.id;
      END;
      CREATE TRIGGER tasks_search_au AFTER UPDATE ON tasks BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_task WHERE entity_id = new.id;
      END;
      CREATE TRIGGER tasks_search_ad AFTER DELETE ON tasks BEGIN
        DELETE FROM search_entries WHERE kind = 'task' AND entity_id = old.id;
      END;

      CREATE TRIGGER events_search_ai AFTER INSERT ON events BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_event WHERE entity_id = new.id;
      END;
      CREATE TRIGGER events_search_au AFTER UPDATE ON events BEGIN
        DELETE FROM search_entries WHERE kind = 'event' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_event WHERE entity_id = new.id;
      END;
      CREATE TRIGGER events_search_ad AFTER DELETE ON events BEGIN
        DELETE FROM search_entries WHERE kind = 'event' AND entity_id = old.id;
      END;

      CREATE TRIGGER tracked_documents_search_ai AFTER INSERT ON tracked_documents BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_document WHERE entity_id = new.id;
      END;
      CREATE TRIGGER tracked_documents_search_au AFTER UPDATE ON tracked_documents BEGIN
        DELETE FROM search_entries WHERE kind = 'document' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_document WHERE entity_id = new.id;
      END;
      CREATE TRIGGER tracked_documents_search_ad AFTER DELETE ON tracked_documents BEGIN
        DELETE FROM search_entries WHERE kind = 'document' AND entity_id = old.id;
      END;

      -- subjects_search_au additionally refreshes this subject's exam
      -- entries: a rename must propagate into every exam title that embeds
      -- the old name, or it goes stale.
      CREATE TRIGGER subjects_search_ai AFTER INSERT ON subjects BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_subject WHERE entity_id = new.id;
      END;
      CREATE TRIGGER subjects_search_au AFTER UPDATE ON subjects BEGIN
        DELETE FROM search_entries WHERE kind = 'subject' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_subject WHERE entity_id = new.id;
        DELETE FROM search_entries WHERE kind = 'exam' AND parent_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_exam WHERE parent_id = new.id;
      END;
      CREATE TRIGGER subjects_search_ad AFTER DELETE ON subjects BEGIN
        DELETE FROM search_entries WHERE kind = 'subject' AND entity_id = old.id;
      END;

      CREATE TRIGGER exams_search_ai AFTER INSERT ON exams BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_exam WHERE entity_id = new.id;
      END;
      CREATE TRIGGER exams_search_au AFTER UPDATE ON exams BEGIN
        DELETE FROM search_entries WHERE kind = 'exam' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_exam WHERE entity_id = new.id;
      END;
      CREATE TRIGGER exams_search_ad AFTER DELETE ON exams BEGIN
        DELETE FROM search_entries WHERE kind = 'exam' AND entity_id = old.id;
      END;

      -- decks_search_au additionally refreshes this deck's card entries, the
      -- same reason subjects_search_au refreshes its exams: a card's search
      -- result deep-links through its deck, so the deck's own liveness change
      -- must propagate onto every card indexed under it.
      CREATE TRIGGER decks_search_ai AFTER INSERT ON decks BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_deck WHERE entity_id = new.id;
      END;
      CREATE TRIGGER decks_search_au AFTER UPDATE ON decks BEGIN
        DELETE FROM search_entries WHERE kind = 'deck' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_deck WHERE entity_id = new.id;
        DELETE FROM search_entries WHERE kind = 'card' AND parent_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_card WHERE parent_id = new.id;
      END;
      CREATE TRIGGER decks_search_ad AFTER DELETE ON decks BEGIN
        DELETE FROM search_entries WHERE kind = 'deck' AND entity_id = old.id;
      END;

      CREATE TRIGGER cards_search_ai AFTER INSERT ON cards BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_card WHERE entity_id = new.id;
      END;
      CREATE TRIGGER cards_search_au AFTER UPDATE ON cards BEGIN
        DELETE FROM search_entries WHERE kind = 'card' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_card WHERE entity_id = new.id;
      END;
      CREATE TRIGGER cards_search_ad AFTER DELETE ON cards BEGIN
        DELETE FROM search_entries WHERE kind = 'card' AND entity_id = old.id;
      END;

      -- notes_search_au additionally refreshes this note's attachment
      -- entries (search_source_attachment's liveness filter reads the PARENT
      -- note's deleted_at), so soft-deleting a note takes its attachments out
      -- of search and restoring it brings them back.
      CREATE TRIGGER notes_search_ai AFTER INSERT ON notes BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_note WHERE entity_id = new.id;
      END;
      CREATE TRIGGER notes_search_au AFTER UPDATE ON notes BEGIN
        DELETE FROM search_entries WHERE kind = 'note' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_note WHERE entity_id = new.id;
        DELETE FROM search_entries WHERE kind = 'attachment' AND parent_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_attachment WHERE parent_id = new.id;
      END;
      CREATE TRIGGER notes_search_ad AFTER DELETE ON notes BEGIN
        DELETE FROM search_entries WHERE kind = 'note' AND entity_id = old.id;
      END;

      -- A snapshot carries a note's body (search_source_note LEFT JOINs
      -- note_snapshots), so both its insert (first compaction) and update
      -- (re-compaction with fresh plaintext) refresh the note's own entry. No
      -- AD trigger: a snapshot only disappears with its note, whose own AD
      -- trigger above already removes the note's entry entirely.
      CREATE TRIGGER note_snapshots_search_ai AFTER INSERT ON note_snapshots BEGIN
        DELETE FROM search_entries WHERE kind = 'note' AND entity_id = new.note_id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_note WHERE entity_id = new.note_id;
      END;
      CREATE TRIGGER note_snapshots_search_au AFTER UPDATE ON note_snapshots BEGIN
        DELETE FROM search_entries WHERE kind = 'note' AND entity_id = new.note_id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_note WHERE entity_id = new.note_id;
      END;

      CREATE TRIGGER note_attachments_search_ai AFTER INSERT ON note_attachments BEGIN
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_attachment WHERE entity_id = new.id;
      END;
      CREATE TRIGGER note_attachments_search_au AFTER UPDATE ON note_attachments BEGIN
        DELETE FROM search_entries WHERE kind = 'attachment' AND entity_id = old.id;
        INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
          SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at
          FROM search_source_attachment WHERE entity_id = new.id;
      END;
      CREATE TRIGGER note_attachments_search_ad AFTER DELETE ON note_attachments BEGIN
        DELETE FROM search_entries WHERE kind = 'attachment' AND entity_id = old.id;
      END;

      -- -----------------------------------------------------------------
      -- Backfill: an existing install gains this migration with data already
      -- sitting in every source table, so each kind is indexed once here,
      -- reading the exact same view its triggers use above.
      -- -----------------------------------------------------------------

      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_task;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_event;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_note;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_document;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_subject;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_exam;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_deck;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_card;
      INSERT INTO search_entries (kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at)
        SELECT kind, entity_id, profile_id, parent_id, title, body, title_folded, body_folded, context_date, updated_at FROM search_source_attachment;
    `);
  },
};
