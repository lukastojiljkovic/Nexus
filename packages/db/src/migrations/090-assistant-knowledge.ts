import type { Migration } from "./migrations.js";

/**
 * Migration 90 - the assistant's knowledge base (ADR-104), the local index the
 * assistant retrieves from.
 *
 * **It lives in the encrypted profile database, and four tables are the whole
 * of it.** The assistant's knowledge is an index OVER the user's own notes,
 * tasks, events and attachment text, so the rule ADR-018 states for
 * `search_entries` applies unchanged: an index that is not encrypted at rest is
 * a second, plainer copy of everything the database was encrypted to protect.
 * Nothing here is a source of truth - every row is derived from a table above it
 * and can be rebuilt from it (`reindex`), which is why none of these tables
 * carries a `created_at`/`updated_at` column: there is no moment in them anybody
 * could want, and a timestamp would invite a reader to treat a derived row as a
 * record.
 *
 * **`knowledge_chunks` is one row per retrievable passage**, `ordinal` its
 * position inside its source document, so re-indexing one document replaces
 * exactly its own rows. `(kind, source_id, locale, ordinal)` is the uniqueness
 * rule rather than a surrogate: the chunker is pure, so re-chunking an unchanged
 * document produces the same rows at the same ordinals, and the locale is part of
 * the key because the app manual ships the same page in `sr` and `en`
 * (`assistant/manual/<locale>/<page>.md`) - the same kind and source id twice is
 * one page in two languages, not a conflict.
 *
 * **`knowledge_fts` stores no text of its own.** It is a contentless inverted
 * index over the folded haystack (title, keywords and passage) addressed by
 * `knowledge_chunks.id` as its rowid, exactly as migration 017's `search_fts` is,
 * and for the same reason: folding is what makes a name written with U+0111, the
 * same name typed `dj` and the Cyrillic spelling one string, SQLite's own
 * tokenizer does not fold it, and a contentless table means the indexed text is
 * not written to disk a second time. The folding happens in the trigger rather
 * than in a stored column deliberately - the haystack's definition (which fields
 * are searchable) then exists in exactly one place, the statement that maintains
 * the index, and cannot drift from what a write puts in the table. A contentless
 * FTS5 table cannot UPDATE a row in place, which is why the update path is
 * delete-then-insert.
 *
 * **`knowledge_vectors` is one row per embedded passage**, with `model_id` and
 * `dimensions` beside the blob so a vector written by a different embedding model
 * can never be compared against a query from this one: cosine similarity between
 * two models' spaces is a number, and it would be a number nothing checks.
 * `ON DELETE CASCADE` is what makes deleting a passage delete its vector - a
 * tombstone of a thousand floats per deleted note would otherwise accumulate for
 * the life of the profile.
 *
 * **`knowledge_cursors` is one row per indexed source**, so a pass can ask what
 * has changed since it last looked instead of re-reading the whole profile. The
 * marker is a string whose meaning belongs to the source (the newest `updated_at`
 * it saw, a content fingerprint, an installed pack version); this table stores it
 * opaquely and never parses it.
 *
 * **No sync journal triggers, deliberately.** Migration 063's journal is for
 * content, this is an index over content, and sync is on hold permanently
 * (CLAUDE.md, 2026-08-31). The day sync resumes, an index is the last thing that
 * should cross a wire: it is rebuilt from whatever arrives.
 *
 * Nothing here reads a source table, and there is no backfill - a fresh table has
 * no rows to fill, and the first indexing pass fills it from the sources.
 */
export const migration090: Migration = {
  version: 90,
  up(db) {
    db.exec(`
      CREATE TABLE knowledge_chunks (
        id            INTEGER PRIMARY KEY,
        profile_id    TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL,
        source_id     TEXT NOT NULL,
        -- '' for a source that is not language-specific (a note, a pack
        -- article); 'sr' or 'en' for the app manual, so a query is answered
        -- from the pages in the language the user is reading.
        locale        TEXT NOT NULL DEFAULT '',
        pack_id       TEXT,
        -- 1 for a passage from a pack whose notice is "safety": an answer that
        -- cites it must carry the pack's disclaimer.
        safety        INTEGER NOT NULL DEFAULT 0 CHECK (safety IN (0, 1)),
        title         TEXT NOT NULL,
        -- The words folded into the searchable haystack beside the passage (the
        -- manual's front-matter keywords). Never shown to anybody.
        keywords      TEXT NOT NULL DEFAULT '',
        locator       TEXT,
        location_json TEXT,
        ordinal       INTEGER NOT NULL,
        text          TEXT NOT NULL,
        -- The uniqueness rule carries the PROFILE, because the database holds
        -- every profile of one account: two profiles index the same manual page
        -- and the same pack article, and they are two rows over two profiles,
        -- not a conflict. Without the profile here the second profile to be
        -- indexed would fail on the first page.
        UNIQUE (profile_id, kind, source_id, locale, ordinal)
      );

      -- The re-index hot path: one document's rows, to replace them.
      CREATE INDEX knowledge_chunks_source
        ON knowledge_chunks (profile_id, kind, source_id);

      CREATE VIRTUAL TABLE knowledge_fts USING fts5(
        haystack,
        content = '',
        contentless_delete = 1,
        tokenize = 'unicode61 remove_diacritics 2'
      );

      -- The haystack, in one place: the title, the keywords, the passage's
      -- heading path and the passage. The NULL guard around the locator is
      -- load-bearing rather than tidy - SQL's concatenation propagates NULL, and
      -- a NULL haystack tokenizes to nothing, so the passage would be inserted
      -- and unfindable.
      CREATE TRIGGER knowledge_chunks_ai AFTER INSERT ON knowledge_chunks BEGIN
        INSERT INTO knowledge_fts (rowid, haystack)
        VALUES (new.id, nx_fold(new.title || ' ' || new.keywords || ' '
          || coalesce(new.locator, '') || ' ' || new.text));
      END;
      CREATE TRIGGER knowledge_chunks_ad AFTER DELETE ON knowledge_chunks BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.id;
      END;
      CREATE TRIGGER knowledge_chunks_au AFTER UPDATE ON knowledge_chunks BEGIN
        DELETE FROM knowledge_fts WHERE rowid = old.id;
        INSERT INTO knowledge_fts (rowid, haystack)
        VALUES (new.id, nx_fold(new.title || ' ' || new.keywords || ' '
          || coalesce(new.locator, '') || ' ' || new.text));
      END;

      CREATE TABLE knowledge_vectors (
        chunk_id   INTEGER PRIMARY KEY REFERENCES knowledge_chunks(id) ON DELETE CASCADE,
        model_id   TEXT NOT NULL,
        dimensions INTEGER NOT NULL CHECK (dimensions > 0),
        -- The embedder's own Float32 values: written and read by this build
        -- alone, and never by a second reader that could disagree about their
        -- layout (knowledge/vectors.ts records the one assumption).
        vector     BLOB NOT NULL
      );

      CREATE INDEX knowledge_vectors_model ON knowledge_vectors (model_id);

      CREATE TABLE knowledge_cursors (
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        source     TEXT NOT NULL,
        marker     TEXT NOT NULL,
        PRIMARY KEY (profile_id, source)
      );
    `);
  },
};
