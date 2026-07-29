import type { Migration } from "./migrations.js";

/**
 * Migration 20 — people-lite (CAL-007, ADR-026): the birthdays and
 * anniversaries the calendar draws beside its events.
 *
 * One `people` table, profile-scoped and soft-deletable, mirroring `events`:
 * UUIDv7 text ids, ISO-8601 text timestamps, `deleted_at` soft delete, and an
 * ON DELETE CASCADE to `profiles` (ADR-001).
 *
 * **Why `month`/`day` are integers and not a date string.** The recurring fact
 * a person carries has no year in it — "the fourteenth of March" is the whole
 * of it — so any date string here would need a year invented to fill the slot,
 * and an invented year is a lie that leaks: it would sort, it would render, and
 * something downstream would eventually read it as the birth year. Two small
 * integers say exactly what is known and nothing more. `year` is a SEPARATE,
 * nullable column precisely because it is the part that may be unknown; when it
 * is present the UI derives an age from it.
 *
 * The CHECKs cover the ranges a single column can speak for (1-12, 1-31); they
 * deliberately cannot express that the PAIR is a real calendar day, since
 * `(2, 30)` breaks no per-column range. `PeopleStore` is the gate for that (it
 * validates the pair against a leap year, so 29 February is accepted — leap-day
 * birthdays exist), with `parseImportArchive`'s twin covering the one other way
 * a row can reach this table.
 *
 * No index: a profile's people are read as one small whole list, exactly like
 * `note_folders`/`note_tags` — an index over a handful of rows would cost more
 * to maintain than the scan it replaces.
 */
export const migration020: Migration = {
  version: 20,
  up(db) {
    db.exec(`
      CREATE TABLE people (
        id          TEXT PRIMARY KEY,
        profile_id  TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        kind        TEXT NOT NULL CHECK (kind IN ('birthday', 'anniversary')),
        month       INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
        day         INTEGER NOT NULL CHECK (day BETWEEN 1 AND 31),
        year        INTEGER,
        note        TEXT,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        deleted_at  TEXT
      );
    `);
  },
};
