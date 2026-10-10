import type { Migration } from "./migrations.js";

/**
 * Migration 87 — the MAPS module's storage: the pins a person dropped.
 *
 * **One table, because a pin is one thing.** A title, a note, a colour and a
 * point. Everything the map itself draws comes from the pack (the tiles, the
 * style, the place index) and none of it is this profile's data: a pin is the
 * only thing a user of this module authors, which is why nothing else is here.
 *
 * **The colour is a TOKEN NAME, not a colour.** `zlato`, `suma`, `grafit` and
 * the rest are the eight accent swatches `packages/tokens` publishes as
 * `--nx-swatch-*`; the row stores which one, and the page resolves it. A stored
 * hex value would be a palette decision frozen into somebody's data — it would
 * survive a theme change, a contrast fix and a new palette, and the next person
 * to open that profile would see a colour the design system no longer has. It
 * is also the one shape that keeps `check:colours` honest: no code path can put
 * a raw value in this column, because the CHECK would refuse it.
 *
 * **`lat`/`lon` are REAL, and the CHECKs say so.** `typeof(x) = 'integer'` is
 * this schema's rule for a column that IS an integer (migration 055's lesson),
 * and a coordinate is not: `44` is a legitimate latitude and arrives as an
 * INTEGER in SQLite, which is why the type test admits both and the bound does
 * the real work. The bounds are the validator's own (`-90..90`, `-180..180`), so
 * a row that violated them is unreachable rather than merely unwritten.
 *
 * **No soft delete, and no rank.** A pin is not a document with a history: it
 * is a mark on a map, and "remove it" means remove it. Order is not the user's
 * either — the list is read by title through the Serbian collator, which is a
 * read rule rather than a stored one, and a `deleted_at` column no reader would
 * filter on is the shape this schema deliberately does not grow.
 *
 * **Not in `RESTORE_WIPE_TABLES`, and no journal triggers.** ADR-090 §6 states
 * the rule this table follows: that list is DERIVED into `@nexus/sync`'s
 * collection map, which `packages/db/src/sync/collectionGuard.test.ts` holds
 * equal to it, and a module built on the kit may not edit `@nexus/sync` — so a
 * kit table added to the list would be a red gate rather than a decision. The
 * kit's rule is the other one: the module REPLACES its own rows, in its own
 * `replaceFromArchive`, inside the same restore transaction. `timers_presets`
 * and `elec_settings` are named as the documented precedents in that guard test
 * with this same reasoning written beside them. Sync is on hold permanently, so
 * there are no journal triggers and no `SYNC_MAP` entry; the pair belongs
 * together on the day sync resumes.
 *
 * **`maps_pins` is a referenced parent from the moment this runs**, so a later
 * column lands by `ALTER TABLE … ADD COLUMN` and never by a table rebuild:
 * `DROP TABLE`'s implicit DELETE fires every `ON DELETE` action pointing at it,
 * and `PRAGMA foreign_keys` is a no-op inside the transaction `runMigrations`
 * wraps a migration in (ADR-042, migration 054).
 */
export const migration087: Migration = {
  version: 87,
  up(db) {
    db.exec(`
      CREATE TABLE maps_pins (
        id         TEXT PRIMARY KEY,
        profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        title      TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 120),
        note       TEXT CHECK (note IS NULL OR length(note) <= 2000),
        lat        REAL NOT NULL
                     CHECK (typeof(lat) IN ('integer', 'real') AND lat BETWEEN -90 AND 90),
        lon        REAL NOT NULL
                     CHECK (typeof(lon) IN ('integer', 'real') AND lon BETWEEN -180 AND 180),
        -- The eight accent swatches (see the file doc). A ninth colour is a
        -- token added to packages/tokens first, and this list follows it.
        color      TEXT NOT NULL
                     CHECK (color IN ('zlato', 'bronza', 'maslina', 'suma',
                                      'zad', 'ruza', 'bordo', 'grafit')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      -- The only pin read there is: this profile's pins, by title. The sr-Latn
      -- order is decided in the store (SQLite's BINARY collation would put
      -- „Šabac“ after „Sombor“), so title is here for the SCOPE's sake and id
      -- closes it, the shape every other profile-owned index has.
      CREATE INDEX maps_pins_profile_title ON maps_pins (profile_id, title, id);
    `);
  },
};
