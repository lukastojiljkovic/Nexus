import type { Migration } from "./migrations.js";

/**
 * Migration 73 - the culture corner's storage: where you went, what you
 * listened to, and the tracks you own.
 *
 * **Six tables, one module, and the shape follows the diagram.** `culture_visits`
 * and `culture_music_entries` are the two LOGS (two rows per evening, not one
 * row with a kind switch: a play and an exhibition have almost no columns in
 * common, and a single table would be half NULLs and every query filtered by
 * kind). `culture_tracks` is the LIBRARY the log may point at, and
 * `culture_playlists` + `culture_playlist_items` are a hand-ordered list over
 * the library. `culture_visit_photos` is the visit's attachment index, the
 * `note_attachments` arrangement (migration 013) one module over.
 *
 * **A track's duration is milliseconds, `INTEGER`, and the whole music side
 * counts in them.** `duration_ms` is what a decoder reports and what a player
 * seeks to; a formatted `3:34` in a column would lose the seconds a total needs
 * and would have to be parsed back before anything could be added up. The
 * formatter is `@nexus/core`'s `formatCultureDuration`, at the display edge
 * only.
 *
 * **`play_count` and `last_played_at` are the track's, and the listening TIME
 * is derived from them.** Nothing stores a running total: `play_count x
 * duration_ms` is the whole arithmetic (`summarizeCulture`), so a track whose
 * duration was corrected later reports a corrected total, which a stored sum
 * could not. `play_count` is capped at `1_000_000` - not a product decision but
 * an arithmetic one, and it is the only bound here that exists to keep a later
 * multiplication inside a JavaScript number: a million plays of a 24-hour track
 * is 8.64e13 ms, three orders of magnitude below 2^53.
 *
 * **`culture_music_entries.track_id` is `ON DELETE SET NULL`, and that is the
 * one cascade in this migration that is not a delete.** A log entry is a
 * MEMORY: it carries its own artist and title, which the user typed, and the
 * pointer to the user's own file is an extra - not the entry's identity. Losing
 * the file must therefore lose only the pointer. `CultureStore.softDeleteTrack`
 * does the same thing on the soft path, where the foreign key cannot act,
 * because a soft-deleted track that a log still points at would show a play
 * button for a file the library no longer holds. `culture_playlist_items`
 * cascades instead: a playlist that keeps a slot for a track that is gone is a
 * hole with nothing in it.
 *
 * **`rank` (migration 062) orders a playlist, not a `position`.** The order is
 * the user's and moves are one row at a time, which is exactly the scope
 * fractional ranks exist for - and a track may appear in a playlist TWICE, so
 * the item row is the thing being ordered and `(playlist_id, track_id)` is
 * deliberately NOT unique. There is no CHECK on the shape of `rank`: migration
 * 062's own reason (SQLite cannot add one to an existing table) does not apply
 * to a new one, but the rule lives in `@nexus/core`'s `isRank` and a second
 * statement of it in SQL would be the copy that drifts. The store validates on
 * the way in AND on the way out.
 *
 * **`price_minor` and `price_currency` are one fact, and the CHECK says so.**
 * An amount with no currency has no unit and a currency with no amount is a
 * label on nothing, which is `habits.unit`'s rule (migration 055) applied to
 * money. The amount is an integer in MINOR units, `fin_transactions`' own
 * representation, so `1250` is 12,50 EUR and never a float: a price is money,
 * and `money.ts` carries the argument for why nothing in this application
 * stores a decimal.
 *
 * **Nothing here is journalled.** Sync is on hold (ADR-083's triggers are off
 * by default and the module is off entirely), so these tables carry no
 * `sync_journal` trigger and no entry in `@nexus/sync`'s map. A table with a
 * trigger but no map entry would journal objects nothing can push; the pair
 * belongs to whoever re-engages sync, and until then the journal stays empty for
 * this module.
 *
 * **Every index here is a read that exists, and nothing more.** A visit is read
 * as "this profile's, between two dates" (the calendar) and a listening entry as
 * "this profile's, newest first"; a track is read as "everything live in this
 * profile's library" and then ordered in JavaScript by the sr-Latn collator,
 * which SQLite cannot do here; and a playlist is read in rank order, so the id
 * tiebreak rides in `(playlist_id, rank, id)` beside the ORDER BY that names it.
 * The other three are REVERSE lookups - "which rows name this hash", "which slots
 * name this track" - and each has a reader: `CultureStore.softDeleteTrack` asks
 * the second, and the first is what main's blob reference count asks (the union
 * stage 2 extends to these tables, exactly as the three attachment tables are
 * already in it).
 *
 * **`visit_date`, `entry_date` and `start_time` carry no CHECK.** The first two
 * are a bare local day and the third is a wall clock, exactly as
 * `fin_transactions.tx_date` and `habits.reminder_time` are, and those are
 * validated in their stores rather than in SQL: `2026-02-30` is a value
 * `length()` cannot judge, and the real-calendar-day rule already has one home
 * (`isBareDate` in `@nexus/db`'s `finance/money.ts`).
 */
export const migration073: Migration = {
  version: 73,
  up(db) {
    db.exec(`
      CREATE TABLE culture_visits (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        kind           TEXT NOT NULL
                         CHECK (kind IN ('museum', 'gallery', 'exhibition', 'theatre', 'opera',
                                         'ballet', 'concert', 'cinema', 'festival', 'other')),
        title          TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
        venue          TEXT NOT NULL CHECK (length(venue) > 0 AND length(venue) <= 120),
        city           TEXT CHECK (city IS NULL OR (length(city) > 0 AND length(city) <= 80)),
        visit_date     TEXT NOT NULL,
        start_time     TEXT,
        rating         INTEGER
                         CHECK (rating IS NULL OR
                                (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 10)),
        notes          TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
        price_minor    INTEGER
                         CHECK (price_minor IS NULL OR
                                (typeof(price_minor) = 'integer' AND price_minor >= 0)),
        price_currency TEXT
                         CHECK (price_currency IS NULL OR
                                (length(price_currency) = 3 AND
                                 price_currency = upper(price_currency))),
        companions     TEXT
                         CHECK (companions IS NULL OR
                                (length(companions) > 0 AND length(companions) <= 200)),
        created_at     TEXT NOT NULL,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT,
        -- A price is an amount AND its currency: one without the other is not a
        -- price, and a CHECK is what makes the half-written pair unrepresentable
        -- rather than a rule the next writer has to remember.
        CHECK ((price_minor IS NULL) = (price_currency IS NULL))
      );

      CREATE INDEX culture_visits_profile_date
        ON culture_visits (profile_id, visit_date, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE culture_visit_photos (
        id         TEXT PRIMARY KEY,
        visit_id   TEXT NOT NULL REFERENCES culture_visits(id) ON DELETE CASCADE,
        file_name  TEXT NOT NULL,
        mime       TEXT NOT NULL,
        size_bytes INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256     TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX culture_visit_photos_visit ON culture_visit_photos (visit_id);
      CREATE INDEX culture_visit_photos_sha ON culture_visit_photos (sha256);

      CREATE TABLE culture_tracks (
        id             TEXT PRIMARY KEY,
        profile_id     TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title          TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
        artist         TEXT CHECK (artist IS NULL OR (length(artist) > 0 AND length(artist) <= 200)),
        album          TEXT CHECK (album IS NULL OR (length(album) > 0 AND length(album) <= 200)),
        track_number   INTEGER
                         CHECK (track_number IS NULL OR
                                (typeof(track_number) = 'integer' AND track_number > 0)),
        release_year   INTEGER
                         CHECK (release_year IS NULL OR
                                (typeof(release_year) = 'integer' AND
                                 release_year BETWEEN 1000 AND 9999)),
        -- 0 means "the file was imported before anything could measure it" and is
        -- allowed on purpose: the bytes are on disk and playable either way, and
        -- refusing the row would be this module deciding it may not hold a file
        -- it cannot describe. 86 400 000 is one day and nothing musical reaches
        -- it; it is here so the value stays a plausible millisecond count.
        duration_ms    INTEGER NOT NULL
                         CHECK (typeof(duration_ms) = 'integer' AND
                                duration_ms >= 0 AND duration_ms <= 86400000),
        file_name      TEXT NOT NULL,
        mime           TEXT NOT NULL,
        size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
        sha256         TEXT NOT NULL,
        imported_at    TEXT NOT NULL,
        play_count     INTEGER NOT NULL DEFAULT 0
                         CHECK (typeof(play_count) = 'integer' AND
                                play_count >= 0 AND play_count <= 1000000),
        last_played_at TEXT,
        updated_at     TEXT NOT NULL,
        deleted_at     TEXT
      );

      -- The library read: everything live in this profile. The ORDER is applied
      -- in the store, by the sr-Latn collator, which is not something SQLite here
      -- can do - so this index is the profile filter and nothing more.
      CREATE INDEX culture_tracks_profile
        ON culture_tracks (profile_id, id)
        WHERE deleted_at IS NULL;
      CREATE INDEX culture_tracks_sha ON culture_tracks (sha256);

      CREATE TABLE culture_music_entries (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        artist     TEXT NOT NULL CHECK (length(artist) > 0 AND length(artist) <= 200),
        title      TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 200),
        kind       TEXT NOT NULL CHECK (kind IN ('album', 'track', 'live', 'other')),
        entry_date TEXT NOT NULL,
        rating     INTEGER
                     CHECK (rating IS NULL OR
                            (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 10)),
        notes      TEXT NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
        -- A memory keeps its words when the file goes: see the file doc.
        track_id   TEXT REFERENCES culture_tracks(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX culture_music_entries_profile_date
        ON culture_music_entries (profile_id, entry_date, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE culture_playlists (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name       TEXT NOT NULL CHECK (length(name) > 0 AND length(name) <= 100),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
      );

      CREATE INDEX culture_playlists_profile_active
        ON culture_playlists (profile_id, name, id)
        WHERE deleted_at IS NULL;

      CREATE TABLE culture_playlist_items (
        id          TEXT PRIMARY KEY,
        playlist_id TEXT NOT NULL REFERENCES culture_playlists(id) ON DELETE CASCADE,
        track_id    TEXT NOT NULL REFERENCES culture_tracks(id) ON DELETE CASCADE,
        rank        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      );

      -- (playlist_id, rank) is the only order anything reads, and the id
      -- tiebreak rides along in the index for the same reason it is in the ORDER
      -- BY. NOT unique: a playlist may hold one track twice.
      CREATE INDEX culture_playlist_items_order ON culture_playlist_items (playlist_id, rank, id);
      CREATE INDEX culture_playlist_items_track ON culture_playlist_items (track_id);
    `);
  },
};
