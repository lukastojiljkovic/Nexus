import type { Migration } from "./migrations.js";

/**
 * Migration 86 — the WIKI module's storage: what a person READ, and what they
 * KEPT.
 *
 * **Two tables, and neither holds a file.** The offline libraries themselves are
 * device-level — a 119 GB English Wikipedia is one file on one disk, and two
 * profiles on that machine are looking at the same one — so which ZIMs this
 * machine has lives in `<userData>/zim/libraries.json`, the arrangement ADR-091
 * uses for a pack's `installed.json`. What is genuinely per profile is what a
 * person did inside those files: the pages they opened, and the pages they
 * marked. That is what these two tables hold, and a row is three strings: which
 * library, which entry inside it, and what the entry was called when it was
 * opened.
 *
 * **`wiki_history` is a visit LOG, and the UNIQUE index is what makes it one.**
 * `(profile_id, library_id, path)` is unique and a re-visit UPDATES the row's
 * `visited_at` rather than appending a second one: a list of the fifty places
 * somebody has been is a list of places, and the same article opened twice is one
 * place. The store trims the tail to `MAX_WIKI_HISTORY` rows on every write, so
 * the table's size is bounded by its reader rather than by how long the app has
 * been installed.
 *
 * **`wiki_bookmarks` is what the user AUTHORED, and its index is the same shape
 * for a different reason.** Marking a page twice is one mark — the user pressed
 * one button — and `UNIQUE (profile_id, library_id, path)` makes that
 * unrepresentable rather than leaving the store to remember, exactly as
 * `timers_presets`' UNIQUE does for two presets with one name.
 *
 * **`length(path)` is checked because the path is what a page hands main.** The
 * bound is the one `paths.ts` enforces on the way in; a column CHECK repeats it
 * so that a row is never stored that this build's own reader would refuse to
 * open (`check:ids`' lesson, applied to a field that is not called an id).
 *
 * **`typeof(x) = 'text'` and the timestamp shape.** Timestamps are the ISO
 * instants every table in this database uses, and `visited_at` is stored as the
 * instant it happened rather than as a counter, so the ordering is the clock's
 * and a later read needs no state.
 *
 * **No journal triggers, and no entry in `RESTORE_WIPE_TABLES`**, on migration
 * 82's terms: that list and `@nexus/sync`'s collection map are held equal by
 * `sync/collectionGuard.test.ts` and sync is on hold, so a table added to one
 * without the other is a red gate rather than a decision. `ON DELETE CASCADE`
 * takes these rows when a profile goes, which is the path privacy depends on.
 *
 * **Two indexes.** `wiki_history_recent` serves the only history read there is —
 * this profile's, newest first, capped. The UNIQUE index above is a rule rather
 * than a read, and the bookmark list is ordered in the store by title with the
 * Serbian collator, so it needs no second index: a profile's marks are a
 * handful of rows.
 */
export const migration086: Migration = {
  version: 86,
  up(db) {
    db.exec(`
      CREATE TABLE wiki_history (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        library_id  TEXT NOT NULL CHECK (length(library_id) > 0 AND length(library_id) <= 64),
        path        TEXT NOT NULL CHECK (length(path) > 0 AND length(path) <= 512),
        title       TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
        visited_at  TEXT NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- The only history read there is: this profile's, newest first.
      CREATE INDEX wiki_history_recent ON wiki_history (profile_id, visited_at DESC, id DESC);

      -- One row per place, not one per visit; a re-visit moves the row.
      CREATE UNIQUE INDEX wiki_history_place ON wiki_history (profile_id, library_id, path);

      CREATE TABLE wiki_bookmarks (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        library_id  TEXT NOT NULL CHECK (length(library_id) > 0 AND length(library_id) <= 64),
        path        TEXT NOT NULL CHECK (length(path) > 0 AND length(path) <= 512),
        title       TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );

      -- Marking a page twice is one mark.
      CREATE UNIQUE INDEX wiki_bookmarks_place ON wiki_bookmarks (profile_id, library_id, path);
    `);
  },
};
