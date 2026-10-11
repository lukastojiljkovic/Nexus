import type { Migration } from "./migrations.js";

/**
 * Migration 72 — the LIBRARY module's storage: six tables for „what I read and
 * watched".
 *
 * **One row per WORK, not per reading.** `library_items` holds the thing, and
 * every decision about what a work IS (its kind, its progress shape, its one
 * cover) is stated here in the schema rather than left to a store to remember.
 * A second reading is a second `library_passes` row, which is the whole reason
 * that table exists: a re-read is not an edit of the first reading — it is
 * another reading, with its own dates and its own rating, and an item with one
 * pair of date columns could only ever describe the most recent one.
 *
 * **Progress is six nullable columns whose shape depends on `kind`.** A book has
 * `pages_read`/`pages_total`, a series has `season`/`episode` and their two
 * optional totals, a film has none — and „none" is not a special case, it is
 * six NULLs. Two coupling CHECKs make the impossible combinations
 * unrepresentable rather than merely refused: a film cannot carry pages, and a
 * book cannot carry seasons. The other three CHECKs are the rule the brief names
 * — „never more than the total when the total is known" — for pages, seasons and
 * episodes; where the total is unknown there is nothing to compare against, and
 * a count with no total is an ordinary answer („ne znam koliko ima epizoda").
 *
 * **Every numeric column says `typeof(x) = 'integer'`** rather than trusting
 * INTEGER affinity, which is migration 055's lesson: SQLite converts a REAL to
 * an INTEGER only when the conversion is lossless, so `8.5` would sit happily in
 * an `INTEGER` column and every total over it would be a float from then on.
 *
 * **The cover is a 1:1 CHILD, and `item_id` IS its primary key.** One work
 * has one cover, so a second row for one item is unrepresentable rather
 * than deduplicated in the store — the arrangement migration 068 gave
 * `circuit_chassis` (one machine per circuit), and for the same reason. The row
 * carries NO bytes: they live in main's content-addressed blob store, keyed by
 * `sha256`, exactly as every attachment row since migration 013 has done
 * (ADR-014). That is why a cover can reference a file, why the same image
 * attached twice is one file on disk, and why the profile archive has to carry
 * the blob separately — see `LibraryStore.exportData`.
 *
 * **Order inside a collection is a fractional `rank`, not an integer.**
 * Migration 062's decision applied to a NEW scope: the user drags items in a
 * collection, so a move is a hand-ordering, and a hand-ordering is a rank — one
 * row rewritten, never a mass UPDATE, which is what made two devices reordering
 * one list lossy. The column carries no CHECK: `isRank` at the store boundary is
 * the gate, exactly as it is on the five scopes 062 converted, and the ORDER BY
 * that reads it is `(rank, id)`, so a hand-made archive that gave two rows one
 * rank still has a total order.
 *
 * **The four unique indexes are the model, not optimisations.**
 * `library_passes_item_seq` makes „two passes with the same sequence for one
 * item" unrepresentable, and `library_collection_items_pair` does the same for
 * „the same work twice in one collection" — which is what makes the adopt
 * operation idempotent by construction rather than by a careful `if`.
 * `library_items_wikidata` is the third and the sharpest: a profile may hold at
 * most one LIVE item per Wikidata Q-id, because matching a curated list's entry
 * „by Wikidata id first" is only well defined while that is true. It is
 * PARTIAL (`deleted_at IS NULL`) so a soft-deleted item does not block a fresh
 * one — the soft delete is the user's, and re-adding a work they threw away must
 * work. `library_collections_adopted` does the same job for adoptions: at most
 * one live collection per suggested list per profile, which is what a second
 * adoption of the same list finds and returns unchanged.
 *
 * **What this migration deliberately does NOT do, and why it matters at
 * merge.** The six tables are NOT in `RESTORE_WIPE_TABLES`, they have NO sync
 * journal triggers, and they are therefore absent from `@nexus/sync`'s
 * `SYNC_MAP`:
 *
 * - The wipe list is a whole-profile REPLACE: a restore empties every table on
 *   it and refills it from the archive. The library is not in the archive yet —
 *   wiring `LibraryStore.exportData` into `ProfileData` is stage 2's job — so
 *   putting these tables on that list today would make every restore delete the
 *   user's library with nothing to put back. They join the list in the same
 *   change that teaches the archive to carry them.
 * - The journal triggers describe what syncs, and sync is on hold permanently
 *   (the project's current focus). New collections are not journaled; the
 *   trigger set stays as migration 63 froze it.
 * - `SYNC_MAP` would want all six classified as `collection`s — a cover reached
 *   through its item is `circuit_chassis`' shape (a natural key and a
 *   `profileVia`), and a collection ITEM carries a rank, so it is a row the user
 *   can point at rather than a bare pair. That registration lives in `@nexus/sync`,
 *   which this change may not touch, and it is only kept honest by
 *   `packages/db`'s own `collectionGuard.test.ts` — so it is left to whoever
 *   first registers this module.
 *
 * **`library_items` is a referenced parent from the moment this runs**, so a
 * later column on it must land by `ALTER TABLE … ADD COLUMN` and never by a
 * table rebuild: `DROP TABLE`'s implicit DELETE fires every `ON DELETE` action
 * pointing at it, and `PRAGMA foreign_keys` is a no-op inside the transaction
 * `runMigrations` wraps a migration in (ADR-042, migration 054).
 *
 * **Every child reaches its profile through its parent**, which is why five of
 * the six tables carry no `profile_id`: a pass, a thought and a link are scoped
 * through the item or the collection that owns them, and every statement in
 * `LibraryStore` resolves that parent in THIS profile before it touches a child.
 * The one exception is `library_collections`, which IS the profile's own row.
 */
export const migration072: Migration = {
  version: 72,
  up(db) {
    db.exec(`
      CREATE TABLE library_items (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind           TEXT NOT NULL CHECK (kind IN ('book', 'film', 'series')),
        title          TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 300),
        original_title TEXT
                         CHECK (original_title IS NULL
                                OR (length(original_title) > 0 AND length(original_title) <= 300)),
        -- The ordered creator list, as canonical JSON (see serializeLibraryList).
        -- No CHECK on its contents: a list of trimmed bounded names is a JS
        -- question, and the store is the gate (migration 011's own choice for
        -- the folder palette).
        creators_json  TEXT NOT NULL,
        year           INTEGER
                         CHECK (year IS NULL
                                OR (typeof(year) = 'integer' AND year >= 1 AND year <= 9999)),
        status         TEXT NOT NULL
                         CHECK (status IN ('planned', 'in-progress', 'done', 'dropped')),
        rating         INTEGER
                         CHECK (rating IS NULL
                                OR (typeof(rating) = 'integer' AND rating >= 1 AND rating <= 10)),
        pages_read     INTEGER
                         CHECK (pages_read IS NULL
                                OR (typeof(pages_read) = 'integer'
                                    AND pages_read >= 0 AND pages_read <= 100000)),
        pages_total    INTEGER
                         CHECK (pages_total IS NULL
                                OR (typeof(pages_total) = 'integer'
                                    AND pages_total >= 1 AND pages_total <= 100000)),
        season         INTEGER
                         CHECK (season IS NULL
                                OR (typeof(season) = 'integer'
                                    AND season >= 1 AND season <= 100000)),
        episode        INTEGER
                         CHECK (episode IS NULL
                                OR (typeof(episode) = 'integer'
                                    AND episode >= 1 AND episode <= 100000)),
        seasons_total  INTEGER
                         CHECK (seasons_total IS NULL
                                OR (typeof(seasons_total) = 'integer'
                                    AND seasons_total >= 1 AND seasons_total <= 100000)),
        episodes_total INTEGER
                         CHECK (episodes_total IS NULL
                                OR (typeof(episodes_total) = 'integer'
                                    AND episodes_total >= 1 AND episodes_total <= 100000)),
        tags_json      TEXT NOT NULL,
        summary        TEXT CHECK (summary IS NULL OR length(summary) <= 2000),
        -- A COARSE backstop for the Q-id grammar, deliberately: the real rule is
        -- isWikidataId in @nexus/core, checked by the store and by the
        -- archive reader, and GLOB cannot express „a positive integer with no
        -- leading zero" without a twenty-term pattern nobody could read.
        wikidata_id    TEXT
                         CHECK (wikidata_id IS NULL
                                OR (length(wikidata_id) BETWEEN 2 AND 19
                                    AND wikidata_id GLOB 'Q[1-9]*')),
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT,
        -- A film carries no reading progress at all, and a book carries none of
        -- the four series fields: „none" is six NULLs rather than a kind of
        -- row.
        CHECK (kind = 'book' OR (pages_read IS NULL AND pages_total IS NULL)),
        CHECK (kind <> 'book'
               OR (season IS NULL AND episode IS NULL
                   AND seasons_total IS NULL AND episodes_total IS NULL)),
        -- „Never more than the total when the total is known" (the brief), for
        -- each of the three counts that has a total.
        CHECK (pages_read IS NULL OR pages_total IS NULL OR pages_read <= pages_total),
        CHECK (season IS NULL OR seasons_total IS NULL OR season <= seasons_total),
        CHECK (episode IS NULL OR episodes_total IS NULL OR episode <= episodes_total)
      );

      -- The only whole-list read there is: this profile's live items. The sr-Latn
      -- order is decided in the store (SQLite's BINARY collation would put
      -- „Šuma" after „Zdravlje"), so title is here for the SCOPE's sake and
      -- id closes it, the shape every other profile-active index has.
      CREATE INDEX library_items_profile_active
        ON library_items (profile_id, title, id)
        WHERE deleted_at IS NULL;

      -- One live item per work per profile — see the file doc. The store
      -- translates a violation into a named refusal.
      CREATE UNIQUE INDEX library_items_wikidata
        ON library_items (profile_id, wikidata_id)
        WHERE wikidata_id IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE library_item_covers (
        item_id    TEXT PRIMARY KEY REFERENCES library_items(id) ON DELETE CASCADE,
        file_name  TEXT NOT NULL CHECK (length(file_name) > 0 AND length(file_name) <= 255),
        mime       TEXT NOT NULL CHECK (length(mime) > 0 AND length(mime) <= 100),
        size_bytes INTEGER NOT NULL
                     CHECK (typeof(size_bytes) = 'integer'
                            AND size_bytes > 0 AND size_bytes <= 52428800),
        sha256     TEXT NOT NULL CHECK (length(sha256) = 64),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE library_passes (
        id          TEXT PRIMARY KEY,
        item_id     TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        -- 1-based and ascending in the order the passes were recorded, so «the
        -- latest pass» is ORDER BY seq DESC LIMIT 1 and never a guess about
        -- which of two null dates is later.
        seq         INTEGER NOT NULL CHECK (typeof(seq) = 'integer' AND seq >= 1),
        started_on  TEXT,
        finished_on TEXT,
        rating      INTEGER
                      CHECK (rating IS NULL
                             OR (typeof(rating) = 'integer' AND rating >= 1 AND rating <= 10)),
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        CHECK (started_on IS NULL OR finished_on IS NULL OR started_on <= finished_on)
      );

      CREATE UNIQUE INDEX library_passes_item_seq ON library_passes (item_id, seq);

      CREATE TABLE library_thoughts (
        id         TEXT PRIMARY KEY,
        item_id    TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        -- entry_date, not date: a column called date collides with SQLite's own
        -- DATE() in a reader's head (fin_transactions.tx_date,
        -- fit_measurements.day — the house spells it out for that reason).
        entry_date TEXT NOT NULL,
        text       TEXT NOT NULL CHECK (length(text) > 0 AND length(text) <= 4000),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The journal's read: one item's entries, oldest first with id closing
      -- the day a second entry was written on.
      CREATE INDEX library_thoughts_item_day
        ON library_thoughts (item_id, entry_date, id);

      CREATE TABLE library_collections (
        id           TEXT PRIMARY KEY,
        profile_id   TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name         TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 120),
        description  TEXT CHECK (description IS NULL OR length(description) <= 500),
        -- The id of the curated list this collection was ADOPTED from, or NULL
        -- for one the user made. NOT a foreign key: a suggested list is not a
        -- row anywhere (it ships with the app), and the value here is the
        -- bundle's own stable id.
        suggested_id TEXT,
        created_at   TEXT NOT NULL,
        updated_at   TEXT NOT NULL,
        deleted_at   TEXT
      );

      CREATE INDEX library_collections_profile_active
        ON library_collections (profile_id, name, id)
        WHERE deleted_at IS NULL;

      -- One LIVE collection per suggested list per profile: what a second
      -- adoption of the same list finds (see the file doc). Partial, so deleting
      -- an adopted collection and adopting it again is allowed.
      CREATE UNIQUE INDEX library_collections_adopted
        ON library_collections (profile_id, suggested_id)
        WHERE suggested_id IS NOT NULL AND deleted_at IS NULL;

      CREATE TABLE library_collection_items (
        id            TEXT PRIMARY KEY,
        collection_id TEXT NOT NULL REFERENCES library_collections(id) ON DELETE CASCADE,
        item_id       TEXT NOT NULL REFERENCES library_items(id) ON DELETE CASCADE,
        rank          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      -- The same work cannot sit in one collection twice — what makes the adopt
      -- operation idempotent by construction. „In SEVERAL collections" is a
      -- different statement and stays true: the pair is per collection.
      CREATE UNIQUE INDEX library_collection_items_pair
        ON library_collection_items (collection_id, item_id);

      -- The collection's own order, read as (rank, id).
      CREATE INDEX library_collection_items_order
        ON library_collection_items (collection_id, rank, id);

      -- The other side of the foreign key: „which collections hold this work",
      -- and the scan a delete of an item would otherwise make of every link row.
      CREATE INDEX library_collection_items_item
        ON library_collection_items (item_id);
    `);
  },
};
